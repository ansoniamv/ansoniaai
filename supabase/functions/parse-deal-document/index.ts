// parse-deal-document
// Reads one uploaded deal document (OM, rent roll, T12) and turns what it
// states into pending proposals for the deal. It never writes to public.deals:
// a person reviews the proposals on the deal page and applies the ones they
// trust (apply_deal_document_proposals).
//
// The call returns 202 straight away and parses in the background, because a
// 60-page OM can outlast the browser's patience. The deal page polls
// deal_documents.parse_status.
//
// Text is pulled out of the file here and sent as text. Sending a PDF as a
// document makes the model read every page as an image too, which costs several
// times as many tokens; only a scanned PDF with no text layer goes that way.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";
// SheetJS 0.20.3, vendored. npm's last release (0.18.5) has a prototype-pollution
// bug on crafted workbooks, and these files come from outside; the fixed builds
// live only on cdn.sheetjs.com, which the Supabase bundler refuses to import from.
// Copied verbatim from https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs
// (sha256 8fd6cb925d6f890f17a52902e50c501702bb1da5e7a5d1f606cb2fd0c005fa20).
import * as XLSX from "../_shared/vendor/xlsx-0.20.3.mjs";
import { corsFor, requireApprovedUser } from "../_shared/auth.ts";
import { callClaudeRaw } from "../_shared/anthropic.ts";
import { assertWithinBudget, BudgetExceededError } from "../_shared/aiBudget.ts";
import { logAiUsage } from "../_shared/logUsage.ts";
import { DEAL_DOCS_MODEL } from "../_shared/featureModels.ts";
import {
  chunkDocumentText,
  DETAIL_SCHEMAS,
  DETAIL_SYSTEM,
  hasDetail,
  mergeRentRollParts,
  normalizeDetail,
  summarizeDetail,
} from "../_shared/dealDocumentDetail.ts";
import { errorResponse } from "../_shared/errors.ts";
import {
  clampDocumentText,
  documentKind,
  EXTRACTION_SCHEMA,
  EXTRACTION_SYSTEM,
  normalizeExtraction,
  proposalsFromExtraction,
  SCANNED_CHARS_PER_PAGE,
} from "../_shared/dealDocuments.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "deal-documents";
/**
 * A 'parsing' row older than this is a run that died, not one in flight. The
 * runtime kills a request at 400 s without an error, so past ~7 minutes nothing
 * is still working on it. src/hooks/useDealDocuments.ts uses the same cutoff.
 */
const STALE_PARSE_MS = 7 * 60_000;
/** Parallel transcription calls for one rent roll (~150 rows each). */
const MAX_DETAIL_PIECES = 12;
/** Scanned PDFs go to the model as a document: its limits are 100 pages, 32MB a request. */
const SCANNED_MAX_PAGES = 100;
const SCANNED_MAX_BYTES = 20 * 1024 * 1024;

class UserFacingError extends Error {}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const authz = await requireApprovedUser(req);
  if (!authz.ok) return authz.response;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const { document_id } = await req.json().catch(() => ({}));
    if (typeof document_id !== "string" || !document_id) return json({ error: "document_id is required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Claim the row. The OR lets an abandoned run be retried; a live one is left alone.
    const staleBefore = new Date(Date.now() - STALE_PARSE_MS).toISOString();
    const { data: claimed, error: claimErr } = await admin
      .from("deal_documents")
      .update({ parse_status: "parsing", parse_started_at: new Date().toISOString(), parse_error: null })
      .eq("id", document_id)
      .or(`parse_status.neq.parsing,parse_started_at.lt.${staleBefore}`)
      .select("*")
      .maybeSingle();
    if (claimErr) throw claimErr;
    if (!claimed) {
      const { data: exists } = await admin.from("deal_documents").select("id").eq("id", document_id).maybeSingle();
      return exists ? json({ status: "parsing" }, 409) : json({ error: "Document not found" }, 404);
    }

    const work = parseDocument(admin, claimed).catch(async (e) => {
      const message = e instanceof UserFacingError || e instanceof BudgetExceededError
        ? e.message
        : "Parsing failed. Try again, or check the function logs.";
      console.error(JSON.stringify({ fn: "parse-deal-document", document_id, detail: String(e?.stack ?? e) }));
      await admin
        .from("deal_documents")
        .update({ parse_status: "failed", parse_error: message })
        .eq("id", document_id);
    });

    if (typeof EdgeRuntime !== "undefined") {
      EdgeRuntime.waitUntil(work);
      return json({ status: "parsing" }, 202);
    }
    await work;
    return json({ status: "done" });
  } catch (e) {
    return errorResponse(e, cors, { fn: "parse-deal-document" });
  }
});


async function parseDocument(admin: any, doc: any): Promise<void> {
  const kind = documentKind(doc.file_name, doc.content_type);
  if (kind === "unsupported") {
    throw new UserFacingError("Unsupported file type. Upload a PDF, Excel workbook or CSV.");
  }

  const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(doc.storage_path);
  if (dlErr || !blob) throw new Error(`download failed: ${dlErr?.message}`);
  const bytes = new Uint8Array(await blob.arrayBuffer());

  // Build the model input: extracted text, or the PDF itself when it is a scan.
  // `body` keeps the full text so a long rent roll can be split for transcription.
  let content: any[];
  let body: string | null = null;
  const warnings: string[] = [];
  if (kind === "pdf") {
    const pdf = await getDocumentProxy(bytes.slice());
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = text as string[];
    const chars = pages.reduce((n, p) => n + p.trim().length, 0);
    if (chars / Math.max(1, totalPages) >= SCANNED_CHARS_PER_PAGE) {
      body = pages.map((p, i) => `=== Page ${i + 1} ===\n${p.trim()}`).join("\n\n");
      content = [textBlock(doc.file_name, body, warnings)];
    } else {
      if (totalPages > SCANNED_MAX_PAGES || bytes.length > SCANNED_MAX_BYTES) {
        throw new UserFacingError(
          `This PDF looks scanned (no text layer) and is too large to read as images ` +
            `(${totalPages} pages; limit ${SCANNED_MAX_PAGES} pages / 20MB). Upload the Excel version or a text PDF.`,
        );
      }
      warnings.push("Scanned PDF: read from page images.");
      content = [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(bytes) } },
        { type: "text", text: `File name: ${doc.file_name}\nExtract the figures from this document.` },
      ];
    }
  } else if (kind === "spreadsheet") {
    const wb = XLSX.read(bytes, { type: "array", cellDates: true });
    const sheets: string = wb.SheetNames.map((name: string) => {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false, strip: true, rawNumbers: true });
      return `=== Sheet: ${name} ===\n${csv}`;
    }).join("\n\n");
    body = sheets;
    content = [textBlock(doc.file_name, sheets, warnings)];
  } else {
    body = new TextDecoder().decode(bytes);
    content = [textBlock(doc.file_name, body, warnings)];
  }

  // One metered, logged call.
  const ask = async (
    system: string,
    schema: Record<string, unknown>,
    maxTokens: number,
    userContent: any[],
    disableThinking = false,
  ) => {
    // A person clicked upload and is watching the panel: interactive priority.
    await assertWithinBudget(admin, "interactive");
    let res;
    try {
      res = await callClaudeRaw({
        model: DEAL_DOCS_MODEL,
        system,
        messages: [{ role: "user", content: userContent }],
        max_tokens: maxTokens,
        effort: "low",
        disableThinking,
        schema,
        timeoutMs: 300_000,
        maxRetries: 0,
      });
    } catch (e: any) {
      await logAiUsage(admin, {
        function_name: "parse-deal-document", model: DEAL_DOCS_MODEL, provider: "anthropic",
        usage: null, deal_id: doc.deal_id, success: false,
        ...({ http_status: e?.status ?? null, error_text: e?.message ?? String(e) } as any),
      });
      throw e;
    }
    await logAiUsage(admin, {
      function_name: "parse-deal-document", model: res.model, provider: "anthropic",
      usage: res.usage, deal_id: doc.deal_id,
    });
    if (res.stop_reason === "max_tokens") throw new Error("model output was cut off at max_tokens");
    return { model: res.model, parsed: JSON.parse(res.text) };
  };

  // Only the run that claimed the row may write to it: a slower, older run
  // finishing late must not overwrite a newer read of the same document.
  const writeDoc = async (fields: Record<string, unknown>) => {
    const { error } = await admin
      .from("deal_documents")
      .update(fields)
      .eq("id", doc.id)
      .eq("parse_started_at", doc.parse_started_at);
    if (error) throw error;
  };

  // ---- Stage 1: classify and read the headline figures; save them at once ----
  const first = await ask(EXTRACTION_SYSTEM, EXTRACTION_SCHEMA, 8000, content);
  const extraction = normalizeExtraction(first.parsed);
  const { proposals, rejected } = proposalsFromExtraction(extraction);

  const { data: deal, error: dealErr } = await admin
    .from("deals")
    .select("unit_count,vintage_year,total_sqft,occupancy_pct,in_place_avg_rent,gross_scheduled_rent,t12_noi,t12_opex,expense_ratio,asking_price")
    .eq("id", doc.deal_id)
    .single();
  if (dealErr) throw dealErr;
  // Compare against the deal as it is now, and skip anything that would not change it.
  const changes = proposals.filter((p) => !sameNumber((deal as any)[p.field], p.value));

  // A re-parse replaces this document's earlier candidates rather than stacking on them.
  await admin
    .from("deal_document_proposals")
    .update({ status: "superseded", decided_at: new Date().toISOString() })
    .eq("document_id", doc.id)
    .eq("status", "pending");
  if (changes.length) {
    const { error: insErr } = await admin.from("deal_document_proposals").insert(
      changes.map((p) => ({
        deal_id: doc.deal_id,
        document_id: doc.id,
        field: p.field,
        value: p.value,
        previous_value: (deal as any)[p.field] ?? null,
        evidence: p.evidence,
        rank: p.rank,
      })),
    );
    if (insErr) throw insErr;
  }

  const notes = () => [
    extraction.notes?.trim(),
    ...warnings,
    rejected.length
      ? `Not offered (failed a sanity check): ${rejected.map((r) => `${r.figure} — ${r.reason}`).join("; ")}.`
      : "",
    proposals.length && !changes.length ? "Every figure found already matches the deal." : "",
  ].filter(Boolean).join(" ") || null;

  const detailType = hasDetail(extraction.doc_type) ? extraction.doc_type : null;
  await writeDoc({
    parse_status: "parsed",
    parsed_at: new Date().toISOString(),
    doc_type: extraction.doc_type,
    doc_as_of: extraction.as_of,
    doc_property_name: extraction.property_name,
    parse_notes: notes(),
    model: first.model,
    extraction: { ...extraction, rejected },
    summary: null,
    detail_status: detailType ? "reading" : "skipped",
  });
  if (!detailType) return;

  // ---- Stage 2: the full breakdown. Its failure costs the breakdown only ----
  // Thinking off: copying rows needs no reasoning, and on the Summerlin rent roll
  // it was ~40% of the output tokens and time. A rent roll is split into pieces
  // read in parallel: one call over Sugar Run's 394 units was still running when
  // the runtime killed it at 400 s.
  try {
    if (detailType === "rent_roll" && body) {
      const pieces = chunkDocumentText(body);
      if (pieces.length > MAX_DETAIL_PIECES) {
        warnings.push(`Rent roll too long to transcribe in full; the first ${MAX_DETAIL_PIECES} of ${pieces.length} parts were read.`);
      }
      const parts = await Promise.all(
        pieces.slice(0, MAX_DETAIL_PIECES).map((piece, i) =>
          ask(DETAIL_SYSTEM.rent_roll, DETAIL_SCHEMAS.rent_roll, 32_000, [
            {
              type: "text",
              text:
                `File name: ${doc.file_name}\nPart ${i + 1} of ${pieces.length}. Transcribe only the units that appear in this part.\n\n` +
                `<document_part>\n${piece}\n</document_part>`,
            },
          ], true).then((r) => normalizeDetail(r.parsed).rent_roll)
        ),
      );
      extraction.detail = { ...extraction.detail, rent_roll: mergeRentRollParts(parts) };
    } else {
      const second = await ask(DETAIL_SYSTEM[detailType], DETAIL_SCHEMAS[detailType], 32_000, content, true);
      extraction.detail = normalizeDetail(second.parsed);
    }
  } catch (e: any) {
    console.error(JSON.stringify({ fn: "parse-deal-document", document_id: doc.id, stage: "detail", detail: String(e?.message ?? e) }));
    warnings.push("The full breakdown could not be read; the headline figures are unaffected.");
    await writeDoc({ detail_status: "failed", parse_notes: notes() });
    return;
  }

  const summary = summarizeDetail(extraction.detail, {
    unit_count: extraction.figures.unit_count.value,
    occupied_units: extraction.figures.occupied_units.value,
    noi: extraction.figures.noi_annual.value,
    opex: extraction.figures.total_operating_expenses_annual.value,
  });
  await writeDoc({
    summary,
    detail_status: "done",
    parse_notes: notes(),
    extraction: { ...extraction, rejected },
  });
}

function textBlock(fileName: string, body: string, warnings: string[]) {
  const { text, truncated } = clampDocumentText(body);
  if (truncated) warnings.push("Document was too long to read in full; the middle section was skipped.");
  return { type: "text", text: `File name: ${fileName}\n\n<document>\n${text}\n</document>` };
}

function sameNumber(current: unknown, proposed: number): boolean {
  if (current === null || current === undefined || current === "") return false;
  const n = Number(current);
  return Number.isFinite(n) && Math.abs(n - proposed) <= Math.max(0.005, Math.abs(proposed) * 1e-6);
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
