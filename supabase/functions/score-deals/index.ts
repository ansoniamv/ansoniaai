// Score acquisitions-pipeline deals (inbox_deals) against the live buy_box config.
// Reads pillars + active signals fresh on every invocation — never use hardcoded weights.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { completeText } from "../_shared/ai.ts";
import { DEAL_INBOX_MODEL } from "../_shared/dealInboxModel.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logAiUsage, logAiFailure } from "../_shared/logUsage.ts";
import { corsFor, requireUserOrService } from "../_shared/auth.ts";
import { computeDealScore } from "../_shared/dealScoreEngine.ts";

// One LLM call is issued per deal, so the batch must be bounded server-side.
// A caller may only ever REDUCE this, never raise it.
const MAX_DEALS_PER_CALL = 200;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// The rationale call runs on DEAL_INBOX_MODEL (Sonnet 5) via _shared/ai.ts —
// see the call site below. Provider routing belongs in _shared/ai.ts, not here.


async function generateRationale(
  deal: any,
  finalScore: number,
  breakdown: any[],
  thesis: string,
  learnedStrategy: string,
  examples: Array<{ category: string | null; reason: string | null; deal: any }>,
  ctx?: { supabase: any },
): Promise<{ text: string | null; error: string | null }> {
  // Model availability is handled inside _shared/ai.ts.
  const scored = breakdown.filter((p) => p.score != null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (!scored.length) return { text: null, error: null };
  const highest = scored[0];
  const lowest = scored[scored.length - 1];
  const summary = {
    property: deal.property_name,
    location: [deal.location_city, deal.location_state].filter(Boolean).join(", "),
    msa: deal.msa,
    units: deal.units,
    year_built: deal.year_built,
    asset_class: deal.asset_class,
    strategy: deal.strategy,
    asking_price: deal.asking_price,
    fit_score: finalScore,
    pillars: breakdown.map((p) => ({ name: p.name, weight: p.weight, score: p.score })),
    highest_pillar: highest?.name,
    lowest_pillar: lowest?.name,
  };
  const strategyBlock = learnedStrategy
    ? `\n\nLEARNED ANSONIA PASS PATTERNS (reason the way the team actually does):\n${learnedStrategy.slice(0, 4000)}`
    : "";
  const examplesBlock = examples.length
    ? `\n\nRECENT DENIAL EXAMPLES (few-shot context):\n${examples
        .slice(0, 5)
        .map((e, i) => `${i + 1}. [${e.category ?? "uncategorized"}] ${e.reason ?? ""}`)
        .join("\n")}`
    : "";
  const system = "You are an investment analyst at Ansonia Properties triaging multifamily deals at the TOP of the funnel. This is a FIT signal, not an underwriting verdict. Reason ONLY about market, submarket demand, demographics, asset type, vintage, size, location, and value-add potential. NEVER mention or penalize for missing/absent deal economics, pricing, asking price, purchase price, cap rate, returns, IRR, yield, rent-to-market gap, or underwriting data — those are evaluated later in the pipeline, not here. Write a single concise 2-sentence rationale (<=55 words total) explaining the fit score against the thesis. Reference the strongest and weakest pillar by name. No preamble, no markdown, no bullet points.";
  const user = `ANSONIA INVESTMENT THESIS:\n${thesis || "(no thesis configured)"}${strategyBlock}${examplesBlock}\n\nDEAL + PILLAR SCORES:\n${JSON.stringify(summary, null, 2)}\n\nWrite the 2-sentence rationale now.`;
  try {
    // Sonnet 5 via DEAL_INBOX_MODEL, no gateway fallback — see _shared/ai.ts.
    // The rationale is two sentences, but adaptive thinking shares max_tokens, so
    // 1500 still leaves room above the old 220-token ceiling; low effort keeps
    // the cost down on a call that runs once per deal.
    const res = await completeText(user, {
      model: DEAL_INBOX_MODEL,
      system,
      maxTokens: 1500,
      effort: "low",
      allowFallback: false,
    });
    if (ctx?.supabase) {
      await logAiUsage(ctx.supabase, {
        function_name: "score-deals",
        model: res.model,
        provider: res.provider,
        usage: res.usage,
        deal_id: deal?.id,
      });
    }
    return { text: res.text ? res.text.trim() : null, error: null };
  } catch (e) {
    // Returned rather than swallowed. A null rationale with no recorded reason
    // renders as nothing at all on the card, so the failure was invisible.
    const message = e instanceof Error ? e.message : String(e);
    console.error("Rationale model call failed", message);
    if (ctx?.supabase) {
      await logAiFailure(ctx.supabase, {
        function_name: "score-deals",
        error: e,
        deal_id: deal?.id ?? null,
      });
    }
    return { text: null, error: message };
  }
}


async function scoreOne(
  supabase: any,
  deal: any,
  pillars: any[],
  signals: any[],
  thesis: string,
  learnedStrategy: string,
  examples: Array<{ category: string | null; reason: string | null; deal: any }>,
) {
  // Arithmetic lives in _shared/dealScoreEngine so it can be unit tested. Null
  // inputs are excluded and the weights renormalised at both levels there.
  const { breakdown, finalScore, tier, scoredPillarCount } = computeDealScore(deal, pillars, signals);
  const hasEnoughSignal = finalScore != null;
  const rationale = hasEnoughSignal
    ? await generateRationale(deal, finalScore as number, breakdown, thesis, learnedStrategy, examples, { supabase })
    : { text: null, error: null };

  const { error: updErr } = await supabase.from("inbox_deals").update({
    fit_score: finalScore,
    fit_tier: tier,
    fit_rationale: rationale.text,
    // Success clears a previous failure; a failure records why so the card can
    // show it with a retry instead of silently omitting the line.
    rationale_error: rationale.error,
    rationale_attempted_at: hasEnoughSignal ? new Date().toISOString() : null,
  }).eq("id", deal.id);
  if (updErr) console.error("[score-deals] update failed", deal.id, updErr.message);

  // Replace per-pillar breakdown rows
  await supabase.from("deal_pillar_scores").delete().eq("deal_id", deal.id);
  if (breakdown.length) {
    await supabase.from("deal_pillar_scores").insert(breakdown.map((p) => ({
      deal_id: deal.id,
      pillar_key: p.key,
      pillar_name: p.name,
      pillar_weight: p.weight,
      pillar_subscore: p.score,
      pillar_contribution: p.contribution,
      signals: p.signals,
    })));
  }

  return { deal_id: deal.id, fit_score: finalScore, fit_tier: tier };
}

serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authz = await requireUserOrService(req);
  if (authz && !authz.ok) return authz.response;

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const { deal_ids, since_days, limit } = body as { deal_ids?: string[]; since_days?: number; limit?: number };

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const [{ data: pillars }, { data: signals }, { data: thesisRow }, { data: ls }, { data: fb }] = await Promise.all([
      supabase.from("buy_box_pillars").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("buy_box_signals").select("*").eq("is_active", true),
      supabase.from("buy_box_thesis").select("content").limit(1).maybeSingle(),
      supabase.from("learned_strategy").select("content").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("deal_feedback").select("category, reason_text, deal_snapshot").eq("action", "deny").order("created_at", { ascending: false }).limit(5),
    ]);
    const thesis = thesisRow?.content ?? "";
    const learnedStrategy: string = ls?.content ?? "";
    const examples = (fb ?? []).map((f: any) => ({ category: f.category, reason: f.reason_text, deal: f.deal_snapshot }));

    let q = supabase.from("inbox_deals").select("*").order("email_received_at", { ascending: false });
    if (Array.isArray(deal_ids) && deal_ids.length) q = q.in("id", deal_ids.slice(0, MAX_DEALS_PER_CALL));
    else if (typeof since_days === "number" && since_days > 0) {
      const cutoff = new Date(Date.now() - since_days * 86400000).toISOString();
      q = q.gte("email_received_at", cutoff);
    }
    // Never score deals that the qualification gate has filtered out.
    q = q.neq("gate_status", "filtered");
    // An absent `limit` previously meant "every non-filtered deal", i.e. one LLM
    // call per pipeline row. The cap is now unconditional.
    const requested = typeof limit === "number" && limit > 0 ? limit : MAX_DEALS_PER_CALL;
    q = q.limit(Math.min(requested, MAX_DEALS_PER_CALL));

    const { data: deals, error } = await q;
    if (error) throw error;

    const results: any[] = [];
    // Sequential to keep Anthropic + DB pressure manageable
    for (const d of deals ?? []) {
      try { results.push(await scoreOne(supabase, d, pillars ?? [], signals ?? [], thesis, learnedStrategy, examples)); }
      catch (e) { console.error("score failed", d.id, e); results.push({ deal_id: d.id, error: String(e) }); }
    }

    return new Response(JSON.stringify({ scored: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
