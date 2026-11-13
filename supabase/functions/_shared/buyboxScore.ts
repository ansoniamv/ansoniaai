/**
 * Turns a deals row into its buybox score columns (total_score, deal_tier, ...).
 *
 * Shared by the app (src/lib/persistDealScore.ts) and the server (onboard-deal,
 * parse-deal-document), so a deal scored in the background gets exactly the
 * number a person pressing Rescore would. The arithmetic itself is in
 * dealScoring.ts; this file only reads the inputs and shapes the write.
 *
 * NOTE: separate from the deal-score edge function / ai_score column.
 */
import {
  costarSliceFor,
  scoreDeal,
  type HelloDataPayload,
  type RegulatoryRisk,
  type ScoreableDeal,
  type SubmarketMarket,
} from "./dealScoring.ts";

// Structural, so the browser client and the Deno client both fit.
// deno-lint-ignore no-explicit-any
type Client = { from: (table: string) => any };
type Row = Record<string, unknown> & { id: string };

export interface PersistedScoreFields {
  passes_hard_filters: boolean;
  hard_filter_failures: Array<{ rule: string; detail: string }>;
  factor_scores: Record<string, number | null>;
  total_score: number | null;
  deal_tier: string;
  value_add_upside: number | null;
  scored_at: string;
}

/** Submarket code -> slice -> that slice's latest figures. */
export type SubmarketFigures = Map<string, Map<string, SubmarketMarket>>;

/**
 * The latest actual quarter (year-to-date or history, never a forecast) of
 * each slice of each submarket, from the current CoStar import — the same
 * import the Market panel reads.
 */
export async function loadSubmarketFigures(sb: Client, codes: string[]): Promise<SubmarketFigures> {
  const out: SubmarketFigures = new Map();
  if (!codes.length) return out;
  const { data: imp, error: impErr } = await sb
    .from("market_data_imports")
    .select("id")
    .eq("status", "complete")
    .contains("geography_types", ["Submarket"])
    .order("as_of_date", { ascending: false })
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (impErr) throw impErr;
  if (!imp) return out;

  const best = new Map<string, { rank: number; row: SubmarketMarket }>();
  for (let i = 0; i < codes.length; i += 100) {
    const { data, error } = await sb
      .from("costar_series")
      .select("geography_code, slice, period_year, period_quarter, occupancy_rate, asking_rent_unit, market_cap_rate")
      .eq("import_id", imp.id)
      .in("geography_code", codes.slice(i, i + 100))
      .in("period_kind", ["ytd", "history"]);
    if (error) throw error;
    for (const r of data ?? []) {
      const key = `${r.geography_code}|${r.slice}`;
      const rank = r.period_year * 10 + r.period_quarter;
      if ((best.get(key)?.rank ?? -1) >= rank) continue;
      best.set(key, {
        rank,
        row: {
          slice: r.slice,
          // CoStar stores rates as fractions; deals store percentages.
          occupancy_pct: r.occupancy_rate == null ? null : r.occupancy_rate * 100,
          asking_rent: r.asking_rent_unit ?? null,
          cap_rate_pct: r.market_cap_rate == null ? null : r.market_cap_rate * 100,
        },
      });
    }
  }
  for (const [key, { row }] of best) {
    const code = key.slice(0, key.indexOf("|"));
    if (!out.has(code)) out.set(code, new Map());
    out.get(code)!.set(row.slice, row);
  }
  return out;
}

function submarketFor(deal: Record<string, unknown>, figures: SubmarketFigures): SubmarketMarket | null {
  const code = deal.costar_submarket_code as string | null | undefined;
  if (!code) return null;
  const vintage = (deal.year_built as number | null) ?? (deal.vintage_year as number | null) ?? null;
  return figures.get(code)?.get(costarSliceFor(vintage)) ?? null;
}

function toScoreable(deal: Record<string, unknown>, submarket: SubmarketMarket | null = null): ScoreableDeal {
  const n = (k: string) => (deal[k] as number | null | undefined) ?? null;
  return {
    unit_count: n("unit_count"),
    vintage_year: n("vintage_year"),
    year_built: n("year_built") ?? n("vintage_year"),
    in_place_avg_rent: n("in_place_avg_rent"),
    classic_units_remaining: n("classic_units_remaining"),
    total_renovated_units: n("total_renovated_units"),
    asking_price: n("asking_price"),
    t12_noi: n("t12_noi"),
    t12_opex: n("t12_opex"),
    occupancy_pct: n("occupancy_pct"),
    expense_ratio: n("expense_ratio"),
    area_median_income_1mi: n("area_median_income_1mi"),
    population_growth_pct: n("population_growth_pct"),
    job_growth_pct: n("job_growth_pct"),
    new_supply_pct_of_stock: n("new_supply_pct_of_stock"),
    school_rating: n("school_rating"),
    nearest_employment_node_min: n("nearest_employment_node_min"),
    market_cap_rate: n("market_cap_rate"),
    hd_rent_vs_market_pct: n("hd_rent_vs_market_pct"),
    regulatory_risk: (deal.regulatory_risk as RegulatoryRisk | null) ?? null,
    hellodata_payload: (deal.hellodata_payload ?? null) as HelloDataPayload | null,
    submarket,
  };
}

/** The score columns for one deal. Pure given its figures. */
export function buyboxScoreFields(deal: Record<string, unknown>, figures: SubmarketFigures): PersistedScoreFields {
  const result = scoreDeal(toScoreable(deal, submarketFor(deal, figures)));
  return {
    passes_hard_filters: result.passes_hard_filters,
    hard_filter_failures: result.hard_filter_failures,
    factor_scores: result.factor_scores as unknown as Record<string, number | null>,
    total_score: result.total_score,
    deal_tier: result.deal_tier,
    value_add_upside: result.value_add_upside,
    scored_at: result.scored_at,
  };
}

/** Score one deal row and write the score columns back. */
export async function persistBuyboxScore(
  sb: Client,
  deal: Row,
  figures?: SubmarketFigures,
): Promise<PersistedScoreFields> {
  if (!figures) {
    const code = deal.costar_submarket_code as string | null | undefined;
    figures = await loadSubmarketFigures(sb, code ? [code] : []);
  }
  const fields = buyboxScoreFields(deal, figures);
  const { error } = await sb.from("deals").update(fields).eq("id", deal.id);
  if (error) throw error;
  return fields;
}

/** Re-read a deal and rescore it: for callers holding only its id. */
export async function rescoreBuybox(sb: Client, dealId: string): Promise<PersistedScoreFields | null> {
  const { data, error } = await sb.from("deals").select("*").eq("id", dealId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return await persistBuyboxScore(sb, data as Row);
}
