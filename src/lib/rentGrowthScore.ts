/**
 * Rent-growth propensity, as three scores that are deliberately never blended.
 *
 *   Structural (5–10 yr base rate)  — jobs, population, income, renter depth.
 *   Cyclical   (12–36 mo timing)    — where the CoStar submarket sits in the
 *                                      supply cycle. Ranked nationally by the
 *                                      costar_submarket_signals view.
 *   Micro      (asset positioning)  — how far this asset's rent sits below its
 *                                      class, its renters' incomes and the tier
 *                                      above.
 *
 * A great asset in the back half of a delivery wave and a mediocre asset in a
 * tightening submarket are different bets, and one blended number hides which
 * one you're looking at. So each leg is scored and shown on its own.
 *
 * Structural and micro have no national panel behind them, so they rank the
 * deal against the live pipeline: "better than X% of the deals we're looking
 * at". Cyclical ranks against ~2,000 CoStar submarkets. Every factor also
 * carries the Ansonia thesis threshold where one exists, so a 90th-percentile
 * deal that still misses the buybox reads as a miss.
 *
 * Pure: no network calls. Inputs come from deals, deal_enrichment.rings and
 * costar_submarket_signals_v.
 */
import { DEFAULT_BENCHMARKS } from "@/lib/dealScoring";
import { CYCLICAL_SIGNALS, COMBINED, formatSignal, type SubmarketSignals } from "@/lib/marketData";

export type Leg = "structural" | "cyclical" | "micro";

export const LEGS: Array<{ key: Leg; label: string; horizon: string; basis: string }> = [
  { key: "structural", label: "Structural", horizon: "5–10 yr base rate", basis: "vs live pipeline" },
  { key: "cyclical", label: "Cyclical", horizon: "12–36 mo timing", basis: "vs US submarkets" },
  { key: "micro", label: "Micro", horizon: "asset positioning", basis: "vs live pipeline" },
];

/** CoStar star slices, cheapest first. */
export const SLICES = ["1 & 2 Star", "3 Star", "4 & 5 Star"] as const;
export type Slice = (typeof SLICES)[number];

/** The thesis buys 1990s–2010s value-add, which CoStar mostly rates 3 Star. */
export function inferSlice(vintage: number | null | undefined): Slice {
  if (vintage == null) return "3 Star";
  if (vintage >= 2015) return "4 & 5 Star";
  if (vintage < 1985) return "1 & 2 Star";
  return "3 Star";
}

export type Rings = Record<string, Record<string, number | string | null>>;

export interface ScoreInputs {
  id: string;
  property_name?: string | null;
  city?: string | null;
  state?: string | null;
  msa?: string | null;
  unit_count?: number | null;
  vintage_year?: number | null;
  in_place_avg_rent?: number | null;
  median_rent_tract?: number | null;
  median_income_tract?: number | null;
  area_median_income_1mi?: number | null;
  population_growth_pct?: number | null;
  job_growth_pct?: number | null;
  rent_trend_12mo_pct?: number | null;
  costar_submarket_code?: string | null;
}

export interface Factor {
  key: string;
  leg: Leg;
  label: string;
  help: string;
  /** Raw value, already in display units. */
  value: number | null;
  display: string;
  better: "higher" | "lower";
  /** 0–1, 1 = best for rent growth. Null when there aren't enough peers to rank. */
  pct: number | null;
  /** Pipeline median, 0–1 on the same scale, for the tick on the bar. */
  medianPct?: number | null;
  /** Ansonia buybox check, when the thesis sets one. */
  thesis?: { label: string; pass: boolean | null };
  source: string;
}

export interface LegScore {
  leg: Leg;
  score: number | null;
  factors: Factor[];
  /** How many factors had a rank. */
  ranked: number;
}

export interface DealScore {
  dealId: string;
  slice: Slice;
  legs: Record<Leg, LegScore>;
  headline: { title: string; body: string };
}

/** Peers below this count can't produce a meaningful pipeline percentile. */
export const MIN_PEERS = 5;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Share of peers this value beats or ties for rent growth. 1 = best.
 * `peers` includes the value itself.
 */
export function favourablePercentile(value: number | null, peers: number[], better: "higher" | "lower"): number | null {
  if (!isNum(value) || peers.length < MIN_PEERS) return null;
  const n = peers.filter((p) => (better === "higher" ? p <= value : p >= value)).length;
  return n / peers.length;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const money = (v: number | null) => (v == null ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`);
const pctTxt = (v: number | null, digits = 1, signed = false) =>
  v == null ? "—" : `${signed && v > 0 ? "+" : ""}${v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}%`;

/** 5-yr Esri forecast, annualised, in percent. */
function cagr(cy: unknown, fy: unknown, years = 5): number | null {
  const a = num(cy);
  const b = num(fy);
  if (a == null || b == null || a <= 0) return null;
  return (Math.pow(b / a, 1 / years) - 1) * 100;
}

// ---------------------------------------------------------------- raw factors

type RawFactor = Omit<Factor, "pct" | "medianPct" | "display"> & { format: (v: number | null) => string };

/** The per-deal numbers, before anything is ranked. */
export function rawFactors(
  deal: ScoreInputs,
  rings: Rings | null | undefined,
  signals: SubmarketSignals[] | null | undefined,
): RawFactor[] {
  const r3 = rings?.["3mi"] ?? null;
  const b = DEFAULT_BENCHMARKS;
  const slice = inferSlice(deal.vintage_year);
  const sig = (scope: string) => signals?.find((s) => s.scope === scope) ?? null;
  const rent = isNum(deal.in_place_avg_rent) && deal.in_place_avg_rent > 0 ? deal.in_place_avg_rent : null;

  // ---- structural
  const income3 = num(r3?.MEDHINC_CY) ?? (isNum(deal.area_median_income_1mi) ? deal.area_median_income_1mi : null) ?? deal.median_income_tract ?? null;
  const incomeGrowth = cagr(r3?.MEDHINC_CY, r3?.MEDHINC_FY);
  const pop = isNum(deal.population_growth_pct) ? deal.population_growth_pct : cagr(r3?.TOTPOP_CY, r3?.TOTPOP_FY);
  const renters = num(r3?.RENTER_CY);
  const owners = num(r3?.OWNER_CY);
  const renterShare = renters != null && owners != null && renters + owners > 0 ? (renters / (renters + owners)) * 100 : null;

  // ---- micro
  const own = sig(slice);
  const top = sig("4 & 5 Star");
  const classRent = isNum(own?.eff_now) ? own!.eff_now : null;
  let gap: number | null = null;
  let gapSource = "";
  if (rent != null && classRent != null && classRent > 0) {
    gap = ((rent - classRent) / classRent) * 100;
    gapSource = `CoStar ${slice} effective rent, submarket`;
  } else if (rent != null && isNum(deal.median_rent_tract) && deal.median_rent_tract > 0) {
    gap = ((rent - deal.median_rent_tract) / deal.median_rent_tract) * 100;
    gapSource = "Census tract median gross rent (no CoStar submarket picked)";
  }
  const rti = rent != null && income3 != null && income3 > 0 ? ((rent * 12) / income3) * 100 : null;
  const spreadUp =
    rent != null && slice !== "4 & 5 Star" && isNum(top?.eff_now) ? top!.eff_now - rent : null;

  // ---- cyclical (already ranked nationally; carried through as-is)
  const combined = sig(COMBINED);
  const cyc: RawFactor[] = CYCLICAL_SIGNALS.map((s) => {
    const v = combined ? (combined[s.key] as number | null) : null;
    return {
      key: `c_${String(s.key)}`,
      leg: "cyclical",
      label: s.label,
      help: s.help,
      value: v,
      better: s.better,
      format: (x) => formatSignal(x, s.format),
      thesis:
        s.key === "uc_pct"
          ? { label: `< ${b.supply_ceiling_pct}% of stock`, pass: isNum(v) ? v * 100 < b.supply_ceiling_pct : null }
          : undefined,
      source: "CoStar submarket, all classes",
    };
  });

  return [
    {
      key: "s_job",
      leg: "structural",
      label: "Job growth, MSA YoY",
      help: "BLS total nonfarm employment, year over year, for the deal's metro. The demand that fills units five years out.",
      value: deal.job_growth_pct ?? null,
      better: "higher",
      format: (v) => pctTxt(v, 1, true),
      thesis: { label: `≥ ${b.job_growth_floor_pct}% (natl avg)`, pass: isNum(deal.job_growth_pct) ? deal.job_growth_pct >= b.job_growth_floor_pct : null },
      source: "BLS SAE, MSA",
    },
    {
      key: "s_pop",
      leg: "structural",
      label: "Population growth, 5-mi",
      help: "Esri's five-year population forecast inside a 5-mile ring, annualised.",
      value: pop,
      better: "higher",
      format: (v) => pctTxt(v, 2, true),
      thesis: { label: `≥ ${b.population_growth_floor_pct}% (natl avg)`, pass: pop == null ? null : pop >= b.population_growth_floor_pct },
      source: "Esri, 5-mi ring",
    },
    {
      key: "s_income_growth",
      leg: "structural",
      label: "Household income growth, 3-mi",
      help: "Esri's five-year median household income forecast inside a 3-mile ring, annualised. Rent follows what renters can pay.",
      value: incomeGrowth,
      better: "higher",
      format: (v) => pctTxt(v, 1, true),
      source: "Esri, 3-mi ring",
    },
    {
      key: "s_income",
      leg: "structural",
      label: "Median household income, 3-mi",
      help: "Esri current-year median household income inside a 3-mile ring.",
      value: income3,
      better: "higher",
      format: money,
      thesis: { label: `≥ $${(b.income_floor / 1000).toFixed(0)}K`, pass: income3 == null ? null : income3 >= b.income_floor },
      source: r3?.MEDHINC_CY != null ? "Esri, 3-mi ring" : "Area median income",
    },
    {
      key: "s_renters",
      leg: "structural",
      label: "Renter share of households, 3-mi",
      help: "Renter-occupied ÷ occupied housing units inside a 3-mile ring. A deeper renter pool absorbs rent increases with less turnover.",
      value: renterShare,
      better: "higher",
      format: (v) => pctTxt(v, 0),
      source: "Esri, 3-mi ring",
    },
    ...cyc,
    {
      key: "m_gap",
      leg: "micro",
      label: "Rent gap to market",
      help: "This asset's rent vs the market rent for its class. Further below means more room to push rents on renovation. The asset side is HelloData's average asking rent on available units, which runs above in-place rent, so the true gap is usually wider.",
      value: gap,
      better: "lower",
      format: (v) => pctTxt(v, 1, true),
      thesis: { label: "≥ 10% below market", pass: gap == null ? null : gap <= -10 },
      source: gapSource || "—",
    },
    {
      key: "m_rti",
      leg: "micro",
      label: "Rent-to-income, 3-mi",
      help: "A year of this asset's rent ÷ the 3-mile median household income. Lower means renters can absorb an increase.",
      value: rti,
      better: "lower",
      format: (v) => pctTxt(v, 1),
      source: "HelloData rent ÷ Esri 3-mi income",
    },
    {
      key: "m_spread_up",
      leg: "micro",
      label: "Spread to 4 & 5 Star",
      help: "Monthly rent gap between this asset and the submarket's 4 & 5 Star effective rent. The ceiling a renovated unit can grow into before it competes with new product.",
      value: spreadUp,
      better: "higher",
      format: money,
      source: "CoStar 4 & 5 Star effective rent, submarket",
    },
  ];
}

// ---------------------------------------------------------------- scoring

export interface PipelineEntry {
  deal: ScoreInputs;
  rings: Rings | null;
  signals: SubmarketSignals[];
}

/**
 * Scores every deal in the pipeline. Structural and micro factors are ranked
 * against the other pipeline deals; cyclical factors use CoStar's national
 * ranks. A leg needs at least half its factors ranked to score, so a deal with
 * one data point doesn't get a confident number.
 */
export function scorePipeline(entries: PipelineEntry[]): Map<string, DealScore> {
  const raws = entries.map((e) => ({ e, raws: rawFactors(e.deal, e.rings, e.signals) }));
  const peers = new Map<string, number[]>();
  for (const { raws: rs } of raws)
    for (const f of rs) if (f.leg !== "cyclical" && isNum(f.value)) peers.set(f.key, [...(peers.get(f.key) ?? []), f.value]);

  const out = new Map<string, DealScore>();
  for (const { e, raws: rs } of raws) {
    const combined = e.signals.find((s) => s.scope === COMBINED) ?? null;
    const factors: Factor[] = rs.map((f) => {
      let pct: number | null;
      let medianPct: number | null = null;
      if (f.leg === "cyclical") {
        const sig = CYCLICAL_SIGNALS.find((s) => `c_${String(s.key)}` === f.key)!;
        pct = combined ? ((combined[sig.pct] as number | null) ?? null) : null;
      } else {
        const p = peers.get(f.key) ?? [];
        pct = favourablePercentile(f.value, p, f.better);
        medianPct = favourablePercentile(median(p), p, f.better);
      }
      const { format, ...rest } = f;
      return { ...rest, display: format(f.value), pct, medianPct };
    });

    const leg = (k: Leg): LegScore => {
      const fs = factors.filter((f) => f.leg === k);
      const ranked = fs.filter((f) => f.pct != null);
      let score: number | null;
      if (k === "cyclical") score = combined?.cyclical_score ?? null;
      else
        score =
          ranked.length >= Math.ceil(fs.length / 2)
            ? Math.round((ranked.reduce((a, f) => a + f.pct!, 0) / ranked.length) * 100)
            : null;
      return { leg: k, score, factors: fs, ranked: ranked.length };
    };
    const legs = { structural: leg("structural"), cyclical: leg("cyclical"), micro: leg("micro") };
    out.set(e.deal.id, {
      dealId: e.deal.id,
      slice: inferSlice(e.deal.vintage_year),
      legs,
      headline: headline(legs.structural.score, legs.cyclical.score, legs.micro.score),
    });
  }
  return out;
}

// ---------------------------------------------------------------- headline

const HI = 60;
const LO = 40;

/** The one-line read. Rule-based, so the same three numbers always say the same thing. */
export function headline(s: number | null, c: number | null, m: number | null): { title: string; body: string } {
  if (s == null && c == null && m == null)
    return {
      title: "Not enough data to score.",
      body: "Pick the CoStar submarket and run Esri and HelloData enrichment on the Overview tab, then come back.",
    };
  const hi = (v: number | null) => v != null && v >= HI;
  const lo = (v: number | null) => v != null && v < LO;

  if (hi(m) && lo(c))
    return {
      title: "Strong asset, wrong moment.",
      body: "The asset trades well below its market, but the submarket is working through a delivery wave. Price it for the trough rather than underwriting near-term rent growth.",
    };
  if (hi(m) && hi(c) && hi(s))
    return {
      title: "Right asset, right market, right time.",
      body: "Rents sit below market, supply is tightening and the metro is growing. Every leg supports the value-add thesis.",
    };
  if (hi(m) && hi(c))
    return {
      title: "Upside with a tailwind.",
      body: "Room to push rents and a submarket turning in the landlord's favour. Check the structural base rate before underwriting growth past year three.",
    };
  if (hi(c) && lo(m))
    return {
      title: "Good timing, thin upside.",
      body: "The submarket is tightening, but this asset already rents near its market. Returns would come from the cycle, not from the renovation.",
    };
  if (hi(s) && lo(c))
    return {
      title: "Good market, early in the cycle.",
      body: "The long-run base rate is strong, but deliveries are still landing. A deal to track until concessions burn off.",
    };
  if (lo(s) && lo(c))
    return {
      title: "Headwinds on both clocks.",
      body: "Weak long-run demand and a soft supply cycle. The asset would need to carry the whole return on its own.",
    };
  if (hi(m))
    return {
      title: "Strong asset, neutral market.",
      body: "The upside is at the property. The market neither helps nor hurts on current data.",
    };
  return {
    title: "Mixed signals.",
    body: "No leg stands out. Read the factors below before leaning on any one score.",
  };
}

// ---------------------------------------------------------------- forecast check

/**
 * CoStar's forward rent forecast vs what rents actually did. A forecast far
 * above the trailing year is the vendor betting on a turn; worth a look before
 * an underwriting leans on it.
 */
export function forecastCheck(signals: SubmarketSignals[] | null | undefined, deal: ScoreInputs) {
  const c = signals?.find((s) => s.scope === COMBINED) ?? null;
  const forecast = isNum(c?.rent_forecast_3y_cagr) ? c!.rent_forecast_3y_cagr * 100 : null;
  const t12 = isNum(c?.rent_growth_t12) ? c!.rent_growth_t12 * 100 : null;
  const asset = isNum(deal.rent_trend_12mo_pct) ? deal.rent_trend_12mo_pct : null;
  const gapBps = forecast != null && t12 != null ? Math.round((t12 - forecast) * 100) : null;
  return { forecast, t12, asset, gapBps, review: gapBps != null && Math.abs(gapBps) >= 150 };
}
