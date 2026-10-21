// process-data-room-source
// Reads one Data Room source (an uploaded file, a website, or a note), stores
// its text as searchable passages (data_room_chunks), and writes an AI summary
// and key facts onto the source. build-data-room-brief later compiles those
// summaries into the Company Brief.
//
// Admin only, like every other write to the Data Room. Returns 202 and works in
// the background, as parse-deal-document does: a long deck or a ten-page site
// outlasts the browser's patience. The page polls data_room_sources.status.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";
import { unzipSync, strFromU8 } from "https://esm.sh/fflate@0.8.2";
// SheetJS 0.20.3, vendored; see parse-deal-document for why.
import * as XLSX from "../_shared/vendor/xlsx-0.20.3.mjs";
import { corsFor, requireRole } from "../_shared/auth.ts";
import { callClaudeRaw } from "../_shared/anthropic.ts";
import { assertWithinBudget, BudgetExceededError } from "../_shared/aiBudget.ts";
import { logAiUsage } from "../_shared/logUsage.ts";
import { DATA_ROOM_MODEL } from "../_shared/featureModels.ts";
import { errorResponse } from "../_shared/errors.ts";
import { clampDocumentText, SCANNED_CHARS_PER_PAGE } from "../_shared/dealDocuments.ts";
import {
  chunkSections,
  dataRoomFileKind,
  mapLinks,
  normalizeSummary,
  ooxmlText,
  pickWebsitePages,
  SCANNED_SUMMARY_SCHEMA,
  type Section,
  sectionsText,
  slidePaths,
  SUMMARY_SCHEMA,
  SUMMARY_SYSTEM,
} from "../_shared/dataRoom.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
const BUCKET = "data-room";
/** Matches STALE_PROCESS_MS in src/hooks/useDataRoom.ts. */
const STALE_PROCESS_MS = 7 * 60_000;
/** Scanned PDFs go to the model as a document: its limits are 100 pages, 32MB a request. */
const SCANNED_MAX_PAGES = 100;
const SCANNED_MAX_BYTES = 20 * 1024 * 1024;

class UserFacingError extends Error {}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const authz = await requireRole(req, "admin");
  if (!authz.ok) return authz.response;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const { source_id } = await req.json().catch(() => ({}));
    if (typeof source_id !== "string" || !source_id) return json({ error: "source_id is required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Claim the row; an abandoned run may be retried, a live one is left alone.
    const staleBefore = new Date(Date.now() - STALE_PROCESS_MS).toISOString();
    const { data: claimed, error: claimErr } = await admin
      .from("data_room_sources")
      .update({ status: "processing", process_started_at: new Date().toISOString(), error: null })
      .eq("id", source_id)
      .or(`status.neq.processing,process_started_at.lt.${staleBefore}`)
      .select("*")
      .maybeSingle();
    if (claimErr) throw claimErr;
    if (!claimed) {
      const { data: exists } = await admin.from("data_room_sources").select("id").eq("id", source_id).maybeSingle();
      return exists ? json({ status: "processing" }, 409) : json({ error: "Source not found" }, 404);
    }

    const work = processSource(admin, claimed).catch(async (e) => {
      const message = e instanceof UserFacingError || e instanceof BudgetExceededError
        ? e.message
        : "Reading failed. Try again, or check the function logs.";
      console.error(JSON.stringify({ fn: "process-data-room-source", source_id, detail: String(e?.stack ?? e) }));
      await admin
        .from("data_room_sources")
        .update({ status: "failed", error: message })
        .eq("id", source_id)
        .eq("process_started_at", claimed.process_started_at);
    });

    if (typeof EdgeRuntime !== "undefined") {
      EdgeRuntime.waitUntil(work);
      return json({ status: "processing" }, 202);
    }
    await work;
    return json({ status: "done" });
  } catch (e) {
    return errorResponse(e, cors, { fn: "process-data-room-source" });
  }
});

type Read = {
  sections: Section[];
  warnings: string[];
  pagesRead?: { url: string; title: string | null }[];
  /** A scanned PDF: sent to the model as a document, transcribed by it. */
  pdfBytes?: Uint8Array;
};

async function processSource(admin: any, src: any): Promise<void> {
  const read: Read =
    src.kind === "file"
      ? await readFile(admin, src)
      : src.kind === "website"
      ? await readWebsite(src.url)
      : { sections: [{ locator: null, text: String(src.body ?? "") }], warnings: [] };

  // Only the run that claimed the row may write to it.
  const writeSource = async (fields: Record<string, unknown>) => {
    const { error } = await admin
      .from("data_room_sources")
      .update(fields)
      .eq("id", src.id)
      .eq("process_started_at", src.process_started_at);
    if (error) throw error;
  };

  // A note is the team's own words: stored and searched as written, and passed
  // to the brief whole. Summarising it would only paraphrase guidance.
  let summary: ReturnType<typeof normalizeSummary> | null = null;
  let model: string | null = null;
  if (src.kind !== "note") {
    const r = await summarize(admin, src, read);
    summary = r.summary;
    model = r.model;
    if (read.pdfBytes) {
      read.sections = (summary.transcript ?? []).map((p) => ({ locator: `Page ${p.page}`, text: p.text }));
    }
  }

  const fullText = sectionsText(read.sections);
  const chunks = chunkSections(read.sections);
  if (!chunks.length && !summary?.summary) {
    throw new UserFacingError("No readable text was found in this source.");
  }

  // Replace this source's passages. Delete first so a re-read that finds less
  // text does not leave stale passages from the last one.
  const { error: delErr } = await admin.from("data_room_chunks").delete().eq("source_id", src.id);
  if (delErr) throw delErr;
  for (let i = 0; i < chunks.length; i += 200) {
    const { error } = await admin.from("data_room_chunks").insert(
      chunks.slice(i, i + 200).map((c) => ({ source_id: src.id, ordinal: c.ordinal, locator: c.locator, content: c.content })),
    );
    if (error) throw error;
  }

  // Keep a title or category a person chose; fill in the defaults.
  const defaultTitle = src.title === src.file_name || src.title === src.url || !String(src.title ?? "").trim();
  await writeSource({
    status: "ready",
    processed_at: new Date().toISOString(),
    error: null,
    notes: read.warnings.join(" ") || null,
    summary: summary?.summary ?? null,
    key_facts: summary?.key_facts ?? [],
    char_count: fullText.length,
    pages_read: read.pagesRead ?? null,
    model,
    ...(summary && defaultTitle && summary.suggested_title ? { title: summary.suggested_title } : {}),
    ...(summary && src.category === "other" ? { category: summary.suggested_category } : {}),
  });
}

// ------------------------------------------------------------------ files

async function readFile(admin: any, src: any): Promise<Read> {
  const kind = dataRoomFileKind(src.file_name ?? "", src.content_type);
  if (kind === "unsupported") {
    throw new UserFacingError("Unsupported file type. Upload a PDF, Word, PowerPoint, Excel, CSV or text file.");
  }
  const { data: blob, error } = await admin.storage.from(BUCKET).download(src.storage_path);
  if (error || !blob) throw new Error(`download failed: ${error?.message}`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const warnings: string[] = [];

  if (kind === "pdf") {
    const pdf = await getDocumentProxy(bytes.slice());
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = text as string[];
    const chars = pages.reduce((n, p) => n + p.trim().length, 0);
    if (chars / Math.max(1, totalPages) >= SCANNED_CHARS_PER_PAGE) {
      return { sections: pages.map((p, i) => ({ locator: `Page ${i + 1}`, text: p })), warnings };
    }
    if (totalPages > SCANNED_MAX_PAGES || bytes.length > SCANNED_MAX_BYTES) {
      throw new UserFacingError(
        `This PDF has little or no text layer and is too large to read as images ` +
          `(${totalPages} pages; limit ${SCANNED_MAX_PAGES} pages / 20MB). Upload a text PDF or the original file.`,
      );
    }
    warnings.push("Little or no text layer: read from the page images.");
    return { sections: [], warnings, pdfBytes: bytes };
  }

  if (kind === "spreadsheet") {
    const wb = XLSX.read(bytes, { type: "array", cellDates: true });
    const sections = wb.SheetNames.map((name: string) => ({
      locator: `Sheet: ${name}`,
      text: XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false, strip: true, rawNumbers: true }),
    }));
    return { sections, warnings };
  }

  if (kind === "docx" || kind === "pptx") {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(bytes);
    } catch {
      throw new UserFacingError("This file could not be opened. Save it again as .docx / .pptx and re-upload.");
    }
    if (kind === "docx") {
      const doc = files["word/document.xml"];
      if (!doc) throw new UserFacingError("This Word file has no document body.");
      return { sections: [{ locator: null, text: ooxmlText(strFromU8(doc)) }], warnings };
    }
    const sections = slidePaths(Object.keys(files)).map((p, i) => {
      const notes = files[p.replace("slides/slide", "notesSlides/notesSlide")];
      const text = ooxmlText(strFromU8(files[p])) + (notes ? `\nSpeaker notes: ${ooxmlText(strFromU8(notes))}` : "");
      return { locator: `Slide ${i + 1}`, text };
    });
    return { sections, warnings };
  }

  return { sections: [{ locator: null, text: new TextDecoder().decode(bytes) }], warnings };
}

// ------------------------------------------------------------------ websites

async function firecrawl(path: string, body: unknown): Promise<any> {
  const res = await fetch(`https://api.firecrawl.dev/v2/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.success === false) {
    throw new Error(`firecrawl ${path} ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

async function readWebsite(url: string): Promise<Read> {
  if (!FIRECRAWL_API_KEY) throw new UserFacingError("Website reading is not configured (FIRECRAWL_API_KEY is not set).");
  const warnings: string[] = [];

  let links: string[] = [];
  try {
    links = mapLinks(await firecrawl("map", { url, limit: 200 }));
  } catch (e) {
    // Without the map we still read the page that was given.
    console.error(JSON.stringify({ fn: "process-data-room-source", stage: "map", detail: String(e) }));
    warnings.push("Could not list the site's pages; read the address given only.");
  }
  const pages = pickWebsitePages(url, links);
  if (!pages.length) throw new UserFacingError("That address is not a valid URL.");

  const results = await Promise.all(
    pages.map(async (page) => {
      try {
        const r = await firecrawl("scrape", { url: page, formats: ["markdown"], onlyMainContent: true });
        const markdown = String(r?.data?.markdown ?? "").trim();
        return markdown ? { url: page, title: r?.data?.metadata?.title ?? null, markdown } : null;
      } catch (e) {
        console.error(JSON.stringify({ fn: "process-data-room-source", stage: "scrape", page, detail: String(e) }));
        return null;
      }
    }),
  );
  const ok = results.filter((r): r is NonNullable<typeof r> => r !== null);
  if (!ok.length) throw new UserFacingError("None of the site's pages could be read.");
  if (ok.length < pages.length) warnings.push(`${pages.length - ok.length} of ${pages.length} pages could not be read.`);

  return {
    sections: ok.map((r) => ({ locator: r.url, text: r.markdown })),
    pagesRead: ok.map((r) => ({ url: r.url, title: r.title })),
    warnings,
  };
}

// ------------------------------------------------------------------ summary

async function summarize(admin: any, src: any, read: Read) {
  let content: any[];
  let schema: Record<string, unknown> = SUMMARY_SCHEMA as unknown as Record<string, unknown>;
  const label = `Source: ${src.title} (${src.kind}${src.file_name ? `, file ${src.file_name}` : ""}${src.url ? `, ${src.url}` : ""})`;
  if (read.pdfBytes) {
    schema = SCANNED_SUMMARY_SCHEMA as unknown as Record<string, unknown>;
    content = [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(read.pdfBytes) } },
      { type: "text", text: `${label}\nSummarise this document, and transcribe each page's text for search.` },
    ];
  } else {
    const { text, truncated } = clampDocumentText(sectionsText(read.sections));
    if (truncated) read.warnings.push("Too long to summarise in full; the middle was skipped for the summary (all of it is searchable).");
    content = [{ type: "text", text: `${label}\n\n<source>\n${text}\n</source>` }];
  }

  // An admin clicked add and is watching the page.
  await assertWithinBudget(admin, "interactive");
  let res;
  try {
    res = await callClaudeRaw({
      model: DATA_ROOM_MODEL,
      system: SUMMARY_SYSTEM,
      messages: [{ role: "user", content }],
      max_tokens: read.pdfBytes ? 48_000 : 8000,
      effort: "low",
      schema,
      timeoutMs: 300_000,
      maxRetries: 0,
    });
  } catch (e: any) {
    await logAiUsage(admin, {
      function_name: "process-data-room-source", model: DATA_ROOM_MODEL, provider: "anthropic", usage: null, success: false,
      ...({ http_status: e?.status ?? null, error_text: e?.message ?? String(e) } as any),
    });
    throw e;
  }
  await logAiUsage(admin, { function_name: "process-data-room-source", model: res.model, provider: "anthropic", usage: res.usage });
  if (res.stop_reason === "max_tokens") {
    throw new UserFacingError("This document was too long to read in one pass. Split it, or upload a text PDF.");
  }
  return { summary: normalizeSummary(JSON.parse(res.text)), model: res.model };
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
