import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { completeText } from "../_shared/ai.ts";
import { logAiUsage } from "../_shared/logUsage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

// Fields we will populate on `partners` from notes.
type FieldSpec = {
  key: string;
  type: "text[]" | "number" | "boolean";
  description: string;
};

const FIELDS: FieldSpec[] = [
  { key: "geography", type: "text[]", description: "Markets/regions where the partner INVESTS (not where the firm is headquartered). Accept broad regions like 'Midwest', 'Sunbelt', 'Southeast US', 'Texas', or specific MSAs like 'Denver'. Include any location the notes describe as a place they invest in, target, focus on, allocate capital to, own assets in, or have a mandate for. Do NOT include the firm's HQ / office location unless the notes explicitly say they also invest there." },
  { key: "investor_type", type: "text[]", description: "Investor type: e.g. Family Office, HNW, Institutional, Fund, Pension, GP Co-Invest" },
  { key: "hold_period", type: "text[]", description: "Hold period options (e.g. '3-5 yr', '5-7 yr', '10+ yr')" },
  { key: "product_types", type: "text[]", description: "Asset/product types: multifamily, BTR, student, industrial, retail, mixed-use, etc." },
  { key: "min_equity_m", type: "number", description: "Minimum check size in USD millions (number only)" },
  { key: "max_equity_m", type: "number", description: "Maximum check size in USD millions (number only)" },
  { key: "strategy_value_add", type: "boolean", description: "Value-add strategy" },
  { key: "strategy_core_plus", type: "boolean", description: "Core-plus strategy" },
  { key: "strategy_workforce", type: "boolean", description: "Workforce housing strategy" },
  { key: "strategy_affordable", type: "boolean", description: "Affordable housing strategy" },
  { key: "urban_infill", type: "boolean", description: "Invests in urban infill" },
  { key: "suburban", type: "boolean", description: "Invests in suburban locations" },
];

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function sha256(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isBlank(field: FieldSpec, value: any): boolean {
  if (value === null || value === undefined) return true;
  if (field.type === "text[]") return !Array.isArray(value) || value.length === 0;
  if (field.type === "boolean") return value === false;
  if (field.type === "number") return value === null || value === undefined || value === 0;
  return !value;
}

function valuesEqual(field: FieldSpec, a: any, b: any): boolean {
  if (field.type === "text[]") {
    const aa = Array.isArray(a) ? [...a].map((x) => String(x).toLowerCase()).sort() : [];
    const bb = Array.isArray(b) ? [...b].map((x) => String(x).toLowerCase()).sort() : [];
    return aa.length === bb.length && aa.every((v, i) => v === bb[i]);
  }
  return a === b;
}

class GatewayError extends Error {
  status: number;
  creditLimit: boolean;
  constructor(status: number, body: string) {
    super(`Gateway ${status}: ${body.slice(0, 300)}`);
    this.status = status;
    this.creditLimit = status === 402 || status === 403 || /credit_limit_reached/i.test(body);
  }
}

// Routing and retries live in _shared/ai.ts — Claude Opus 5 primary, gateway fallback.
async function callLLM(prompt: string, ctx?: { supabase: any; partner_id?: string }): Promise<string> {
  // Floor the budget: Opus 5 thinking tokens share max_tokens.
  const res = await completeText(prompt, { maxTokens: 8000 });
  if (ctx?.supabase) {
    await logAiUsage(ctx.supabase, {
      function_name: "enrich-partner-from-notes",
      model: res.model,
      provider: res.provider,
      usage: res.usage,
      partner_id: ctx.partner_id ?? null,
    });
  }
  return res.text;
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { partner_id, force } = await req.json();
    if (!partner_id) throw new Error("partner_id required");

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: partner, error: pErr } = await sb
      .from("partners")
      .select("*")
      .eq("id", partner_id)
      .single();
    if (pErr) throw pErr;
    if (!partner) throw new Error("partner not found");

    // Notes linked to this partner: primary owner OR via note_links
    const { data: links } = await sb
      .from("note_links")
      .select("note_id")
      .eq("linked_type", "partner")
      .eq("linked_id", partner_id);
    const linkedIds = Array.from(new Set((links ?? []).map((l: any) => l.note_id)));

    const filterParts = [`and(entity_type.eq.partner,entity_id.eq.${partner_id})`];
    if (linkedIds.length > 0) filterParts.push(`id.in.(${linkedIds.join(",")})`);

    const { data: notes, error: nErr } = await sb
      .from("notes")
      .select("id, content, content_format, created_at")
      .or(filterParts.join(","))
      .order("created_at", { ascending: false });
    if (nErr) throw nErr;

    // Also fetch partner_interactions rows — the "Add a note…" box on the profile writes here.
    const { data: interactions, error: iErr } = await sb
      .from("partner_interactions")
      .select("id, content, interaction_type, author, interaction_date")
      .eq("partner_id", partner_id)
      .order("interaction_date", { ascending: false });
    if (iErr) throw iErr;

    // Build note blobs, newest-first, with dates. Include interactions + notes + additional/organized.
    type Blob = { id: string; text: string; date: string | null };
    const blobs: Blob[] = [];

    for (const it of interactions ?? []) {
      const text = (it.content ?? "").trim();
      if (!text) continue;
      const prefix = it.interaction_type ? `[${it.interaction_type}${it.author ? ` · ${it.author}` : ""}] ` : "";
      blobs.push({
        id: `__interaction_${it.id}__`,
        text: prefix + text,
        date: it.interaction_date ?? null,
      });
    }
    for (const n of notes ?? []) {
      const text = n.content_format === "html" ? stripHtml(n.content ?? "") : (n.content ?? "");
      if (!text) continue;
      blobs.push({ id: n.id, text, date: n.created_at ?? null });
    }
    if (partner.additional_notes) {
      blobs.push({ id: "__additional_notes__", text: partner.additional_notes, date: null });
    }
    // NOTE: intentionally NOT feeding partner.organized_notes back in — it's an
    // AI-generated summary of the same source notes, so re-ingesting it would
    // cause drift/echo. We rewrite it fresh each run below.

    // Sort newest-first (nulls last)
    blobs.sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    });

    if (blobs.length === 0) {
      return new Response(JSON.stringify({ skipped: "no_notes" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const hashInput = blobs.map((b) => `${b.id}@${b.date ?? ""}:${b.text}`).join("\n---\n");
    const hash = await sha256(hashInput);
    if (!force && hash === partner.enrichment_notes_hash) {
      return new Response(JSON.stringify({ skipped: "unchanged" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Consider ALL fields now — human values are protected via the "suggested" path below.
    const notesBlock = blobs
      .map((b, i) => {
        const dateLabel = b.date ? new Date(b.date).toISOString().slice(0, 10) : "undated";
        return `[NOTE ${i + 1} id=${b.id} date=${dateLabel}]\n${b.text.slice(0, 2500)}`;
      })
      .join("\n\n");

    const fieldList = FIELDS
      .map((f) => `- ${f.key} (${f.type}): ${f.description}`)
      .join("\n");

    const prompt = `You are extracting structured data about a real-estate capital partner (LP/investor firm) from free-form notes, AND writing an organized markdown summary of what we know about them.

Partner: ${partner.name}

Notes are provided NEWEST-FIRST with their dates. When notes conflict, PREFER THE MOST RECENT statement.

Extract ONLY the fields listed. If a field is not clearly supported by the notes, return null for it. Do NOT invent.

For every field you fill, cite the note IDs (from the [NOTE X id=...] header) that support it.

Return your answer as TWO blocks, in this exact order and format:

<FIELDS_JSON>
{
  "fields": {
    "<field_key>": { "value": <value or null>, "source_note_ids": ["<id>", ...] }
  }
}
</FIELDS_JSON>

<ORGANIZED_NOTES>
Write a concise institutional-style briefing in markdown, using EXACTLY the section headings below in this order. Omit no heading — if a section has no supporting information in the notes, write a single bullet: "- Not indicated in notes." Do NOT invent facts. Keep the whole briefing under ~350 words.

## Firm Overview
- 1–3 bullets: what the firm is, HQ, AUM if stated, fund vs. family office vs. HNW, etc.

## Investment Mandate
- **Product types:** …
- **Geography:** …
- **Check size:** … (use "$Xm–$Ym equity" format when known)
- **Strategy:** value-add / core-plus / workforce / affordable / etc.
- **Hold period:** …

## Deal Preferences
- Bullets on unit count, vintage, submarket profile (urban infill vs. suburban), business plan preferences, deal structure (JV, GP co-invest, LP), and any hard filters.

## Relationship & Activity
- Bullets on recent conversations, deals reviewed/passed, warmth, key contacts, and next steps.

## Flags
- **Green flags:** …
- **Red flags / constraints:** …

Formatting rules (strict):
- Use only ##, **bold labels:**, and "- " bullets. No H1, no tables, no horizontal rules, no emojis.
- One blank line between sections. No trailing whitespace.
- Prefer specifics (numbers, MSAs, dates) over generalities.
- Raw markdown — no JSON escaping.
</ORGANIZED_NOTES>

Value rules:
- text[] fields: array of short canonical strings (e.g. ["Southeast US","Texas"]).
- number fields: plain JSON number (millions of USD for equity fields).
- boolean fields: true or false only if notes clearly support; else null.

Fields:
${fieldList}

NOTES (newest first):
${notesBlock}`;

    const raw = await callLLM(prompt, { supabase: sb, partner_id });

    // Extract fields JSON block (fall back to first {...} match).
    const fieldsBlockMatch = raw.match(/<FIELDS_JSON>([\s\S]*?)<\/FIELDS_JSON>/i);
    const jsonSource = fieldsBlockMatch ? fieldsBlockMatch[1] : raw;
    const jsonMatch = jsonSource.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in LLM output: " + raw.slice(0, 200));
    const parsed = JSON.parse(jsonMatch[0]);
    const extracted = parsed.fields ?? {};

    // Extract organized notes markdown block (plain text, no JSON escaping).
    const orgMatch = raw.match(/<ORGANIZED_NOTES>([\s\S]*?)<\/ORGANIZED_NOTES>/i);
    const organizedNotes = orgMatch ? orgMatch[1].trim() : "";

    const updates: Record<string, any> = {};
    const enrichedMeta: Record<string, any> = { ...(partner.enriched_fields ?? {}) };
    const validSourceIds = new Set<string>();
    const noteDates = new Map<string, string | null>();
    for (const b of blobs) { validSourceIds.add(b.id); noteDates.set(b.id, b.date); }
    /** Newest source-note date = when the information is true as of. */
    const newestNoteDate = (ids: string[], fallback: string): string => {
      const ts = ids.map((id) => noteDates.get(id)).filter(Boolean) as string[];
      if (ts.length === 0) return fallback;
      return ts.reduce((a, b) => (new Date(b).getTime() > new Date(a).getTime() ? b : a));
    };

    // Fields the user has manually set via the pencil-edit UI on the partner
    // profile. These are permanently locked from enrichment — the LLM may
    // still surface a value for them, but we skip the field entirely below.
    const manualFields = new Set<string>((partner.manual_fields ?? []) as string[]);

    const filled: string[] = [];
    const overwritten: string[] = [];
    const suggested: string[] = [];

    for (const f of FIELDS) {
      const entry = extracted[f.key];
      if (!entry) continue;
      const val = entry.value;
      if (val === null || val === undefined) continue;
      if (f.type === "text[]" && (!Array.isArray(val) || val.length === 0)) continue;
      if (f.type === "number" && typeof val !== "number") continue;
      if (f.type === "boolean" && typeof val !== "boolean") continue;

      const cleanSourceIds = (entry.source_note_ids ?? []).filter((id: string) => validSourceIds.has(id));
      const now = new Date().toISOString();
      const asOf = newestNoteDate(cleanSourceIds, now);
      const stamp = {
        source: "notes",
        as_of: asOf,
        written_at: now,
        note_ids: cleanSourceIds,
        source_note_ids: cleanSourceIds,
        extracted_at: now,
      };
      const currentVal = (partner as any)[f.key];
      const currentMeta = enrichedMeta[f.key];
      const isCurrentlyBlank = isBlank(f, currentVal);
      const wasEnriched = !!currentMeta && !currentMeta.suggested_only;

      // Manually-locked fields: never overwrite silently. If the LLM proposes a
      // different value, surface it as a reviewable suggestion. If the value
      // matches or the field is blank, do nothing (respect the manual lock).
      if (manualFields.has(f.key)) {
        if (!isCurrentlyBlank && !valuesEqual(f, currentVal, val)) {
          const existing = currentMeta ?? {};
          enrichedMeta[f.key] = {
            ...existing,
            suggested: { value: val, ...stamp },
          };
          suggested.push(f.key);
        }
        continue;
      }



      if (isCurrentlyBlank) {
        // Fill blank
        updates[f.key] = val;
        enrichedMeta[f.key] = { ...stamp };
        filled.push(f.key);
      } else if (valuesEqual(f, currentVal, val)) {
        // Same value — refresh provenance if it was enriched
        if (wasEnriched) {
          enrichedMeta[f.key] = {
            ...currentMeta,
            ...stamp,
            suggested: undefined,
          };
          delete enrichedMeta[f.key].suggested;
        }
      } else if (wasEnriched) {
        // Previously enriched — safe to overwrite with newer note-derived value
        updates[f.key] = val;
        enrichedMeta[f.key] = { ...stamp };
        overwritten.push(f.key);
      } else {
        // Human-entered value — do NOT overwrite. Store as suggestion.
        const existing = currentMeta ?? {};
        enrichedMeta[f.key] = {
          ...existing,
          suggested: { value: val, ...stamp },
        };
        suggested.push(f.key);
      }
    }

    // Update organized_notes if the LLM produced one. Safe to overwrite: this
    // column is AI-managed (rendered as markdown, not user-editable in the UI).
    if (organizedNotes) {
      updates.organized_notes = organizedNotes;
    }

    updates.enriched_fields = enrichedMeta;
    updates.enrichment_notes_hash = hash;
    updates.enriched_at = new Date().toISOString();

    const { error: uErr } = await sb.from("partners").update(updates).eq("id", partner_id);
    if (uErr) throw uErr;

    return new Response(JSON.stringify({ filled, overwritten, suggested }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    if (e instanceof GatewayError && e.creditLimit) {
      return new Response(
        JSON.stringify({ skipped: "credit_limit_reached", error: "Workspace AI credit limit reached" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (e instanceof GatewayError) {
      return new Response(
        JSON.stringify({ skipped: "gateway_error", error: e.message, status: e.status }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

