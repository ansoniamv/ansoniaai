import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logAiUsage } from "../_shared/logUsage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash-lite";

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

async function classify(text: string): Promise<{ classification: "firm" | "deal"; summary: string; usage: any }> {
  const prompt = `You classify a note written by a real-estate PE deal team about a capital partner (an LP/investor firm).

Return ONLY compact JSON, no prose, no code fences:
{"classification":"firm"|"deal","summary":"<= 120 chars"}

- "firm" = firm-level / investor-level update: strategy change, mandate change, geography/asset-class focus shift, personnel change, fund close, why they walked from a deal, general check-size or LOI posture change, contact/relationship update.
- "deal" = specific to one deal (commitment amount, deal-specific due diligence, deal-specific status).

Summary is a one-line human recap (no quotes, no leading label).

NOTE:
"""${text.slice(0, 4000)}"""`;

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gateway ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const raw = (data?.choices?.[0]?.message?.content ?? "").trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in LLM response: " + raw.slice(0, 200));
  const parsed = JSON.parse(jsonMatch[0]);
  const classification = parsed.classification === "firm" ? "firm" : "deal";
  const summary = String(parsed.summary ?? "").slice(0, 200);
  return { classification, summary, usage: data?.usage };
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

    const { classification, summary, usage } = await classify(text);
    await logAiUsage(sb, { function_name: "classify-note", model: MODEL, provider: "lovable-gateway", usage });

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
