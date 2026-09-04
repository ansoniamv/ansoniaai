// Score acquisitions-pipeline deals (inbox_deals) against the live buy_box config.
// Reads pillars + active signals fresh on every invocation — never use hardcoded weights.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { completeText } from "../_shared/ai.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logAiUsage } from "../_shared/logUsage.ts";
import { corsFor, requireUserOrService } from "../_shared/auth.ts";

// One LLM call is issued per deal, so the batch must be bounded server-side.
// A caller may only ever REDUCE this, never raise it.
const MAX_DEALS_PER_CALL = 200;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const RATIONALE_MODEL = "google/gemini-2.5-flash";

function clamp(n: number, min = 0, max = 100) { return Math.max(min, Math.min(max, n)); }

function scoreSignal(value: unknown, sig: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const { scoring_method, min_value, max_value, optimal_min, optimal_max } = sig;

  if (scoring_method === "boolean") {
    const truthy = value === true || (typeof value === "string" && value.length > 0 && value !== "false") || (typeof value === "number" && value > 0);
    return truthy ? 100 : 0;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return null;

  if (scoring_method === "higher_better") {
    if (min_value == null || max_value == null || max_value === min_value) return 50;
    return Math.round(clamp(((num - min_value) / (max_value - min_value)) * 100));
  }
  if (scoring_method === "lower_better") {
    if (min_value == null || max_value == null || max_value === min_value) return 50;
    return Math.round(clamp(((max_value - num) / (max_value - min_value)) * 100));
  }
  if (scoring_method === "range_optimal") {
    if (optimal_min == null || optimal_max == null) return 50;
    if (num >= optimal_min && num <= optimal_max) return 100;
    if (min_value != null && num < optimal_min) {
      const span = Math.max(1, optimal_min - min_value);
      return Math.round(clamp(((num - min_value) / span) * 100));
    }
    if (max_value != null && num > optimal_max) {
      const span = Math.max(1, max_value - optimal_max);
      return Math.round(clamp(((max_value - num) / span) * 100));
    }
    return 50;
  }
  return null;
}

// Parse loose asking-price text like "$12.5M", "12,500,000"
function parsePriceText(t: string | null | undefined): number | null {
  if (!t) return null;
  const s = String(t).toLowerCase().replace(/[$,\s]/g, "");
  const m = s.match(/^(-?\d+(?:\.\d+)?)([mk]?)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2] === "m") return n * 1_000_000;
  if (m[2] === "k") return n * 1_000;
  return n;
}

// Map signal field_source paths against an inbox_deal + derived values.
function resolve(path: string, ctx: any): unknown {
  const parts = path.split(".");
  const root = parts[0];
  let obj: any;
  if (root === "deals") {
    // Map legacy deals.* fields onto the inbox_deal schema where possible.
    const d = ctx.deal;
    const aliasMap: Record<string, any> = {
      unit_count: d.units,
      vintage_year: d.year_built,
      city: d.location_city,
      state: d.location_state,
      msa: d.msa,
      property_name: d.property_name,
      asking_price: ctx.derived.asking_price_num,
      affordable: d.strategy && /afford/i.test(d.strategy),
      value_add_potential: d.strategy && /value[\s-]?add/i.test(d.strategy) ? 3 : (d.strategy && /core/i.test(d.strategy) ? 1 : 2),
    };
    const key = parts[1];
    if (key in aliasMap) return aliasMap[key];
    // Unknown deals.* field — not present on inbox_deal
    return undefined;
  }
  if (root === "derived") obj = ctx.derived;
  else if (root === "deal_enrichment" || root === "permits") return undefined; // not available for inbox deals
  else return undefined;

  for (let i = 1; i < parts.length; i++) {
    if (obj == null) return undefined;
    obj = obj[parts[i]];
  }
  return obj;
}

function tierFromScore(score: number): "strong" | "medium" | "maybe" | "skip" {
  if (score >= 75) return "strong";
  if (score >= 55) return "medium";
  if (score >= 35) return "maybe";
  return "skip";
}

async function generateRationale(
  deal: any,
  finalScore: number,
  breakdown: any[],
  thesis: string,
  learnedStrategy: string,
  examples: Array<{ category: string | null; reason: string | null; deal: any }>,
  ctx?: { supabase: any },
): Promise<string | null> {
  // Model availability is handled inside _shared/ai.ts.
  const scored = breakdown.filter((p) => p.score != null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (!scored.length) return null;
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
    // Claude Opus 5 primary, gateway fallback — see _shared/ai.ts. The rationale
    // is two sentences, but Opus 5 thinking shares max_tokens, so the budget is
    // well above the old 220-token ceiling; low effort keeps the cost down.
    const res = await completeText(user, { system, maxTokens: 4000, effort: "low" });
    if (ctx?.supabase) {
      await logAiUsage(ctx.supabase, {
        function_name: "score-deals",
        model: res.model,
        provider: res.provider,
        usage: res.usage,
        deal_id: deal?.id,
      });
    }
    return res.text ? res.text.trim() : null;
  } catch (e) {
    console.error("Rationale model call failed", e);
    return null;
  }
}

// Exclude pillars that represent deal-economics / pricing / returns / underwriting.
// Inbox scoring is a top-of-funnel FIT signal — economics are assessed later in the
// Pipeline scorer (deal-score). Match generously on pillar key + name.
const ECONOMICS_RE = /econ|pric|return|yield|cap[\s_-]?rate|irr|underwrit/i;
function isEconomicsPillar(p: any): boolean {
  return ECONOMICS_RE.test(String(p?.key ?? "")) || ECONOMICS_RE.test(String(p?.name ?? ""));
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
  const asking_price_num = parsePriceText(deal.asking_price);
  const price_per_unit = asking_price_num && deal.units ? asking_price_num / deal.units : null;
  const ctx = {
    deal,
    derived: { asking_price_num, price_per_unit, rent_gap_pct: null },
  };

  const breakdown: any[] = [];
  let weightedSum = 0;
  let totalWeight = 0;

  // Filter out economics-related pillars from the inbox fit-score entirely.
  const fitPillars = (pillars ?? []).filter((p) => !isEconomicsPillar(p));

  for (const pillar of fitPillars) {
    const pSignals = signals.filter((s) => s.pillar_id === pillar.id && s.is_active);
    const sigResults: any[] = [];
    let pSum = 0;
    let pWeight = 0;
    for (const sig of pSignals) {
      const raw = resolve(sig.field_source, ctx);
      const score = scoreSignal(raw, sig);
      sigResults.push({
        name: sig.name,
        field_source: sig.field_source,
        raw_value: raw ?? null,
        score,
        weight: sig.weight_within_pillar,
      });
      if (score != null) {
        pSum += score * sig.weight_within_pillar;
        pWeight += sig.weight_within_pillar;
      }
    }
    const pillarSubscore = pWeight > 0 ? Math.round(pSum / pWeight) : null;
    const contribution = pillarSubscore != null ? (pillarSubscore * pillar.weight) / 100 : null;
    breakdown.push({
      key: pillar.key,
      name: pillar.name,
      weight: pillar.weight,
      score: pillarSubscore,
      contribution,
      signals: sigResults,
    });
    if (pillarSubscore != null) {
      weightedSum += pillarSubscore * pillar.weight;
      totalWeight += pillar.weight;
    }
  }

  // Don't let sparse data score a fresh deal as "skip". When too few pillars
  // produced a real subscore, leave the deal unscored (null tier/score) so the
  // board still surfaces it instead of burying it at the bottom.
  const scoredPillarCount = breakdown.filter((p) => p.score != null).length;
  const MIN_SCORED_PILLARS = 2;
  const hasEnoughSignal = totalWeight > 0 && scoredPillarCount >= MIN_SCORED_PILLARS;

  const finalScore = hasEnoughSignal ? Math.round(weightedSum / totalWeight) : null;
  const tier = hasEnoughSignal ? tierFromScore(finalScore as number) : null;
  const rationale = hasEnoughSignal
    ? await generateRationale(deal, finalScore as number, breakdown, thesis, learnedStrategy, examples, { supabase })
    : null;

  await supabase.from("inbox_deals").update({
    fit_score: finalScore,
    fit_tier: tier,
    fit_rationale: rationale,
  }).eq("id", deal.id);

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
