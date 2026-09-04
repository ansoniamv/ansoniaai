import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { completeJSON } from "../_shared/ai.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logAiUsage } from "../_shared/logUsage.ts";
import { corsFor, requireUserOrService } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

// --- Scoring helpers --------------------------------------------------------
function clamp(n: number, min = 0, max = 100) { return Math.max(min, Math.min(max, n)); }

function scoreSignal(value: any, signal: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const { scoring_method, min_value, max_value, optimal_min, optimal_max } = signal;

  if (scoring_method === "boolean") {
    // For boolean signals, "presence" / true = 100, false/empty = 0
    const truthy = value === true || (typeof value === "string" && value.length > 0) || (typeof value === "number" && value > 0);
    return truthy ? 100 : 0;
  }
  const num = Number(value);
  if (Number.isNaN(num)) return null;

  if (scoring_method === "higher_better") {
    if (min_value == null || max_value == null) return 50;
    return clamp(((num - min_value) / (max_value - min_value)) * 100);
  }
  if (scoring_method === "lower_better") {
    if (min_value == null || max_value == null) return 50;
    return clamp(((max_value - num) / (max_value - min_value)) * 100);
  }
  if (scoring_method === "range_optimal") {
    if (optimal_min == null || optimal_max == null) return 50;
    if (num >= optimal_min && num <= optimal_max) return 100;
    if (min_value != null && num < optimal_min) {
      const span = optimal_min - min_value;
      return clamp(((num - min_value) / Math.max(1, span)) * 100);
    }
    if (max_value != null && num > optimal_max) {
      const span = max_value - optimal_max;
      return clamp(((max_value - num) / Math.max(1, span)) * 100);
    }
    return 50;
  }
  return null;
}

// Resolve a field_source path against deal + enrichment + permits + derived values
function resolve(path: string, ctx: any): any {
  const parts = path.split(".");
  let obj: any = ctx;
  // Map root prefix
  const root = parts[0];
  if (root === "deals") obj = ctx.deal;
  else if (root === "deal_enrichment") obj = ctx.enrichment;
  else if (root === "permits") obj = ctx.permits;
  else if (root === "derived") obj = ctx.derived;
  else return undefined;

  for (let i = 1; i < parts.length; i++) {
    if (obj == null) return undefined;
    obj = obj[parts[i]];
  }
  return obj;
}

serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Invoked from the UI and by esri-enrich / hellodata-enrich, which forward the
  // service-role key.
  const authz = await requireUserOrService(req);
  if (authz && !authz.ok) return authz.response;

  try {
    const { deal_id } = await req.json();
    if (!deal_id) {
      return new Response(JSON.stringify({ error: "deal_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Ensure market metrics (pop growth, new supply, job growth) are populated
    // on the deal row before scoring. Best-effort — never blocks scoring.
    try {
      const { error: mmErr } = await supabase.functions.invoke("market-metrics-enrich", { body: { deal_id } });
      if (mmErr) console.error("market-metrics-enrich error:", mmErr);
    } catch (e) {
      console.error("market-metrics-enrich invoke failed:", e);
    }

    // Load deal + enrichment + pillars + signals + thesis
    const [{ data: deal }, { data: enrichment }, { data: pillars }, { data: signals }, { data: thesisRow }] = await Promise.all([
      supabase.from("deals").select("*").eq("id", deal_id).single(),
      supabase.from("deal_enrichment").select("*").eq("deal_id", deal_id).maybeSingle(),
      supabase.from("buy_box_pillars").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("buy_box_signals").select("*").eq("is_active", true),
      supabase.from("buy_box_thesis").select("content").limit(1).maybeSingle(),
    ]);

    if (!deal) throw new Error("Deal not found");

    // Pull permits if we have a city/state — best-effort
    let permits: any = { permits_per_1k_units: null, total_permits_t12: null };
    // Skip permits fetch for now (CBSA mapping is TBD); leave null and signal scores will be null
    // TODO: add city/state -> CBSA crosswalk

    // Derived values
    const inPlace = Number(deal.in_place_avg_rent) || 0;
    const market = Number(deal.median_rent_tract) || 0;
    const rent_gap_pct = market > 0 && inPlace > 0 ? ((market - inPlace) / market) * 100 : null;
    const price_per_unit = deal.asking_price && deal.unit_count ? Number(deal.asking_price) / Number(deal.unit_count) : null;
    // Map value_add_potential text → numeric
    const vapMap: Record<string, number> = { low: 1, medium: 2, high: 3 };
    const value_add_num = deal.value_add_potential ? vapMap[String(deal.value_add_potential).toLowerCase()] ?? null : null;

    const ctx = {
      deal: { ...deal, value_add_potential: value_add_num },
      enrichment: enrichment ?? {},
      permits,
      derived: { rent_gap_pct, price_per_unit },
    };

    // Compute pillar scores + coverage
    const pillarBreakdown: any[] = [];
    let weightedSum = 0;
    let totalWeight = 0;
    let weightCovered = 0;
    let weightTotalAll = 0;
    let pillarsCovered = 0;
    const pillarsTotal = (pillars ?? []).length;
    let signalsCovered = 0;
    let signalsTotal = 0;

    for (const pillar of pillars ?? []) {
      const pSignals = (signals ?? []).filter((s) => s.pillar_id === pillar.id);
      const sigResults: any[] = [];
      let pSum = 0;
      let pWeight = 0;
      for (const sig of pSignals) {
        const raw = resolve(sig.field_source, ctx);
        const score = scoreSignal(raw, sig);
        signalsTotal += 1;
        sigResults.push({
          name: sig.name,
          field_source: sig.field_source,
          raw_value: raw ?? null,
          score,
          weight: sig.weight_within_pillar,
        });
        if (score != null) {
          signalsCovered += 1;
          pSum += score * sig.weight_within_pillar;
          pWeight += sig.weight_within_pillar;
        }
      }
      const pillarScore = pWeight > 0 ? Math.round(pSum / pWeight) : null;
      pillarBreakdown.push({
        key: pillar.key,
        name: pillar.name,
        weight: pillar.weight,
        score: pillarScore,
        signals: sigResults,
      });
      weightTotalAll += Number(pillar.weight) || 0;
      if (pillarScore != null) {
        pillarsCovered += 1;
        weightCovered += Number(pillar.weight) || 0;
        weightedSum += pillarScore * pillar.weight;
        totalWeight += pillar.weight;
      }
    }

    const baseScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;
    const weightCoveredPct = weightTotalAll > 0 ? weightCovered / weightTotalAll : 0;

    let confidence: "high" | "medium" | "low" | "insufficient";
    if (pillarsCovered === 0) confidence = "insufficient";
    else if (weightCoveredPct >= 0.7 && pillarsCovered >= Math.ceil(pillarsTotal / 2)) confidence = "high";
    else if (weightCoveredPct >= 0.4) confidence = "medium";
    else confidence = "low";

    const coverage = {
      pillars_covered: pillarsCovered,
      pillars_total: pillarsTotal,
      signals_covered: signalsCovered,
      signals_total: signalsTotal,
      weight_covered_pct: Math.round(weightCoveredPct * 100) / 100,
    };

    // LLM thesis adjustment (skipped when insufficient; scaled by confidence)
    const thesis = thesisRow?.content ?? "";
    let adjustment = 0;
    let summary = "";

    if (thesis && confidence !== "insufficient" && confidence !== "low") {
      try {
        const summaryPayload = {
          property: deal.property_name,
          city: deal.city, state: deal.state,
          unit_count: deal.unit_count, vintage: deal.vintage_year,
          asking_price: deal.asking_price, price_per_unit,
          affordable: deal.affordable, value_add: deal.value_add_potential,
          rent_gap_pct, in_place_rent: inPlace, market_rent: market,
          base_score: baseScore,
          pillars: pillarBreakdown.map((p) => ({ name: p.name, score: p.score, weight: p.weight })),
        };
        // Claude Opus 5 primary, gateway fallback — see _shared/ai.ts.
        // Asking for a JSON object rather than a forced tool call keeps this
        // provider-agnostic across the primary and fallback models.
        const prompt =
          `THESIS:\n${thesis}\n\nDEAL DATA:\n${JSON.stringify(summaryPayload, null, 2)}\n\n` +
          `Return ONLY a JSON object, no prose and no code fences:\n` +
          `{"rationale":"2-3 sentence narrative justifying the adjustment",` +
          `"adjustment":<integer between -10 and 10 reflecting how well the deal aligns ` +
          `with the thesis beyond the numeric pillar score>}`;
        const { parsed, model, provider, usage } = await completeJSON<{ rationale?: string; adjustment?: number }>(
          prompt,
          {
            system: "You are an investment committee analyst evaluating a value-add multifamily deal against an investment thesis. Be concise and specific.",
            maxTokens: 4000,
          },
        );
        await logAiUsage(supabase, { function_name: "deal-score", model, provider, usage, deal_id });
        const raw = Math.max(-10, Math.min(10, Number(parsed.adjustment) || 0));
        // Scale by confidence: high = 1.0, medium = 0.5
        const scale = confidence === "high" ? 1 : 0.5;
        adjustment = Math.round(raw * scale);
        summary = String(parsed.rationale || "");
      } catch (e) {
        console.error("LLM call failed:", e);
      }
    }

    const finalScore = clamp(baseScore + adjustment, 0, 100);

    await supabase.from("deals").update({
      ai_score: finalScore,
      ai_score_summary: summary || `Base score ${baseScore} from ${pillarsCovered} of ${pillarsTotal} pillars (${Math.round(weightCoveredPct * 100)}% weight covered).`,
      pillar_scores: { base_score: baseScore, final_score: finalScore, adjustment, pillars: pillarBreakdown, confidence, coverage },
      score_thesis_adjustment: adjustment,
      score_confidence: confidence,
      score_coverage: coverage,
      last_scored_at: new Date().toISOString(),
    }).eq("id", deal_id);

    return new Response(JSON.stringify({
      deal_id, ai_score: finalScore, base_score: baseScore, adjustment, summary, pillars: pillarBreakdown, confidence, coverage,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
