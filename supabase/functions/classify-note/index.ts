import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logAiUsage } from "../_shared/logUsage.ts";
import { completeText } from "../_shared/ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Model routing lives in _shared/ai.ts — Claude Opus 5 primary, gateway fallback.

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function sha256(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function classify(
  text: string,
): Promise<{ classification: "firm" | "deal"; summary: string; usage: any; model: string; provider: string }> {
  const prompt = `You classify a note written by a real-estate PE deal team about a capital partner (an LP/investor firm).

Return ONLY compact JSON, no prose, no code fences:
{"classification":"firm"|"deal","summary":"<= 120 chars"}

- "firm" = firm-level / investor-level update: strategy change, mandate change, geography/asset-class focus shift, personnel change, fund close, why they walked from a deal, general check-size or LOI posture change, contact/relationship update.
- "deal" = specific to one deal (commitment amount, deal-specific due diligence, deal-specific status).

Summary is a one-line human recap (no quotes, no leading label).

NOTE:
"""${text.slice(0, 4000)}"""`;

  // Classification is mechanical, so run it at low effort to keep cost down.
  const res = await completeText(prompt, { maxTokens: 4000, effort: "low" });
  const jsonMatch = res.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in LLM response: " + res.text.slice(0, 200));
  const parsed = JSON.parse(jsonMatch[0]);
  const classification = parsed.classification === "firm" ? "firm" : "deal";
  const summary = String(parsed.summary ?? "").slice(0, 200);
  return { classification, summary, usage: res.usage, model: res.model, provider: res.provider };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { note_id } = await req.json();
    if (!note_id) throw new Error("note_id required");

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: note, error } = await sb
      .from("notes")
      .select("id, content, content_format, classified_content_hash, entity_type")
      .eq("id", note_id)
      .single();
    if (error) throw error;
    if (!note) throw new Error("note not found");

    const text = note.content_format === "html" ? stripHtml(note.content ?? "") : (note.content ?? "");
    if (!text) {
      return new Response(JSON.stringify({ skipped: "empty" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const hash = await sha256(text);
    if (hash === note.classified_content_hash) {
      return new Response(JSON.stringify({ skipped: "unchanged" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { classification, summary, usage, model, provider } = await classify(text);
    await logAiUsage(sb, { function_name: "classify-note", model, provider, usage });

    const { error: updErr } = await sb
      .from("notes")
      .update({
        classification,
        classification_summary: summary,
        classified_at: new Date().toISOString(),
        classified_content_hash: hash,
      })
      .eq("id", note_id);
    if (updErr) throw updErr;

    return new Response(JSON.stringify({ classification, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
