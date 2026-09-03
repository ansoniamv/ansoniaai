// Reads recent capital_partner_feedback rows and distills them into a
// "How capital partners evaluate our deals" note stored in learned_partner_strategy.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
      .from("capital_partner_feedback")
      .select("category, reason_text, snapshot, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    const rows = feedback ?? [];
    if (rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "No partner pass feedback yet" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not set");

    const compact = rows.map((r: any) => ({
      category: r.category,
      reason: r.reason_text,
      deal: r.snapshot?.deal ?? null,
      partner: r.snapshot?.partner ?? null,
    }));

    const prompt =
      `You are analyzing why institutional capital partners pass on multifamily real-estate deals brought by Ansonia Properties. The goal is to distill how partners actually evaluate our deals so our team can pre-screen better.\n\n` +
      `Below are ${compact.length} recent partner passes. For each: analyst-picked category, free-text reason, a snapshot of the deal, and a snapshot of the partner profile at pass time.\n\n` +
      `PASSES:\n${JSON.stringify(compact, null, 2)}\n\n` +
      `Write a concise "How capital partners evaluate our deals" note (<= 350 words) using EXACTLY this structure:\n\n` +
      `## Check Size & Scale\n- ...\n## Markets & Geography\n- ...\n## Strategy & Risk Appetite\n- ...\n## Pricing & Returns\n- ...\n## Timing & Capital\n- ...\n## Relationship & Fit\n- ...\n## Other Patterns\n- ...\n\n` +
      `Rules:\n- Principles, not anecdotes. NEVER name a specific partner.\n- Cite specifics when patterns are clear (e.g. "Value-add funds pass when going-in cap is below 5.5%", "Core-plus partners avoid tertiary Sunbelt markets").\n- Omit sections with no signal.\n- Dense and actionable — this will be shown as guidance to analysts and to the partner-matching UI.`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Lovable-API-Key": LOVABLE_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      let friendly = `Gateway ${resp.status}`;
      try {
        const parsed = JSON.parse(t);
        if (parsed?.type === "credit_limit_reached" || resp.status === 402 || /credit/i.test(parsed?.message ?? "")) {
          friendly = "AI credits exhausted for this workspace. Top up credits to refresh learning.";
        } else if (resp.status === 429) {
          friendly = "AI gateway rate limit hit. Try again in a moment.";
        } else if (parsed?.message) {
          friendly = parsed.message;
        }
      } catch { /* not JSON */ }
      console.error("learn-from-partner-feedback gateway error", resp.status, t);
      return new Response(
        JSON.stringify({ ok: false, error: friendly, status: resp.status }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const j = await resp.json();
    const content = j?.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("Empty model response");

    const { data: existing } = await supabase
      .from("learned_partner_strategy")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      await supabase.from("learned_partner_strategy").update({
        content,
        example_count: rows.length,
        updated_at: new Date().toISOString(),
        updated_by: "learn-from-partner-feedback",
      }).eq("id", existing.id);
    } else {
      await supabase.from("learned_partner_strategy").insert({
        content,
        example_count: rows.length,
        updated_by: "learn-from-partner-feedback",
      });
    }

    return new Response(
      JSON.stringify({ ok: true, example_count: rows.length, length: content.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("learn-from-partner-feedback failed", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
