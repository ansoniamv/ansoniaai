// Reads recent deal_feedback rows and distills them into a "How Ansonia decides" note
// stored in learned_strategy. Used as soft context by gate-deals + score-deals.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { completeText } from "../_shared/ai.ts";
import { logAiUsage } from "../_shared/logUsage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: feedback, error } = await supabase
      .from("deal_feedback")
      .select("action, category, reason_text, deal_snapshot, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    const denials = (feedback ?? []).filter((f: any) => f.action === "deny");
    if (denials.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "No denial feedback yet" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    

    const compact = denials.map((d: any) => ({
      category: d.category,
      reason: d.reason_text,
      deal: d.deal_snapshot,
    }));

    const prompt =
      `You are analyzing denial decisions from an institutional multifamily real-estate investor (Ansonia Properties) to surface the actual investment criteria the team applies.\n\n` +
      `Below are ${compact.length} recent passes. For each: the analyst-picked category, free-text reason, and a snapshot of the deal at decision time.\n\n` +
      `DENIALS:\n${JSON.stringify(compact, null, 2)}\n\n` +
      `Write a concise "How Ansonia decides" note (<= 350 words) capturing the recurring REASONS they pass on deals. Use this structure:\n\n` +
      `## Geography\n- ...\n## Asset Type & Quality\n- ...\n## Size & Scale\n- ...\n## Pricing & Returns\n- ...\n## Condition / Vintage\n- ...\n## Sponsor / Operator\n- ...\n## Other Patterns\n- ...\n\n` +
      `Rules:\n- Cite specifics when patterns are clear (e.g. "Consistently passing on <50 units", "Avoiding pre-1980 vintage in tertiary markets").\n- Omit sections with no signal.\n- Speak in principles, not anecdotes. No deal names.\n- This will be appended as CONTEXT to future AI screening — keep it dense and actionable.`;

    // Claude Opus 5 primary, gateway fallback — see _shared/ai.ts.
    const res = await completeText(prompt, { maxTokens: 8000 });
    await logAiUsage(supabase, { function_name: "learn-from-feedback", model: res.model, provider: res.provider, usage: res.usage });
    const content = res.text;
    if (!content) throw new Error("Empty model response");

    // Single evolving row — replace existing
    const { data: existing } = await supabase
      .from("learned_strategy")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      await supabase.from("learned_strategy").update({
        content,
        example_count: denials.length,
        updated_at: new Date().toISOString(),
        updated_by: "learn-from-feedback",
      }).eq("id", existing.id);
    } else {
      await supabase.from("learned_strategy").insert({
        content,
        example_count: denials.length,
        updated_by: "learn-from-feedback",
      });
    }

    return new Response(JSON.stringify({ ok: true, example_count: denials.length, length: content.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("learn-from-feedback failed", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
