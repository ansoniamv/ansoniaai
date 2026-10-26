import { describe, it, expect } from "vitest";
import {
  deriveValues,
  docLabel,
  scorePipelineDeal,
  scoreSignal,
  type PillarConfig,
  type SignalConfig,
} from "../../supabase/functions/_shared/pipelineScoreEngine";

const sig = (o: Partial<SignalConfig> & Pick<SignalConfig, "pillar_id" | "name" | "field_source" | "scoring_method">): SignalConfig => ({
  min_value: null,
  max_value: null,
  optimal_min: null,
  optimal_max: null,
  weight_within_pillar: 10,
  ...o,
});

/** The Deal Economics and Value-Add config after 20261031120000. */
const PILLARS: PillarConfig[] = [
  { id: "va", key: "value_add", name: "Value-Add Opportunity", weight: 20 },
  { id: "econ", key: "deal_economics", name: "Deal Economics", weight: 10 },
];
const SIGNALS: SignalConfig[] = [
  sig({ pillar_id: "va", name: "Rent gap to market", field_source: "derived.rent_gap_pct", scoring_method: "higher_better", min_value: -10, max_value: 20, weight_within_pillar: 30 }),
  sig({ pillar_id: "va", name: "Loss-to-lease", field_source: "derived.loss_to_lease_pct", scoring_method: "higher_better", min_value: 0, max_value: 10, weight_within_pillar: 25 }),
  sig({ pillar_id: "econ", name: "Estimated equity ($M)", field_source: "deals.estimated_equity", scoring_method: "higher_better", min_value: "5", max_value: "100", weight_within_pillar: 25 }),
  sig({ pillar_id: "econ", name: "Price per unit", field_source: "derived.price_per_unit", scoring_method: "lower_better", min_value: 50000, max_value: 300000, weight_within_pillar: 30 }),
  sig({ pillar_id: "econ", name: "Going-in yield", field_source: "derived.going_in_yield_pct", scoring_method: "higher_better", min_value: 4, max_value: 7, weight_within_pillar: 30 }),
  sig({ pillar_id: "econ", name: "Affordable component", field_source: "derived.affordable_bonus", scoring_method: "boolean", weight_within_pillar: 10 }),
];

// 820 South Michigan as it sat on 2026-10-26: $37M ask, 150 units, $12.9M equity.
const MICHIGAN = {
  asking_price: 37,
  unit_count: 150,
  estimated_equity: 12.9,
  in_place_avg_rent: 2040,
  median_rent_tract: 1964,
  vintage_year: 2008,
  affordable: false,
};

describe("deriveValues", () => {
  it("works price per unit out in dollars from an ask stored in $M", () => {
    expect(deriveValues({ deal: MICHIGAN }).price_per_unit.value).toBe(246667);
  });

  it("benchmarks rent against CoStar's class rent when a submarket is picked", () => {
    const d = deriveValues({ deal: MICHIGAN, costarClass: { scope: "3 Star", eff_now: 2400 } });
    expect(d.rent_gap_pct.value).toBe(15);
    expect(d.rent_gap_pct.source).toMatch(/CoStar 3 Star/);
  });

  it("falls back to the tract median and says so", () => {
    const d = deriveValues({ deal: MICHIGAN });
    expect(d.rent_gap_pct.value).toBe(-3.9);
    expect(d.rent_gap_pct.source).toMatch(/Census tract/);
  });

  it("leaves affordability out for a market-rate deal instead of scoring it 0", () => {
    expect(deriveValues({ deal: MICHIGAN }).affordable_bonus.value).toBeNull();
    expect(deriveValues({ deal: { ...MICHIGAN, is_affordable_housing: true } }).affordable_bonus.value).toBe(true);
  });

  it("puts HelloData's per-square-metre density and fractional price change in signal units", () => {
    const d = deriveValues({ deal: { population_density_tract: 0.00138, avg_price_change: -0.0067 } });
    expect(d.population_density_sqmi.value).toBe(3574);
    expect(d.avg_price_change_pct.value).toBe(-0.7);
  });

  it("reads an occupancy stored as a fraction as a percentage", () => {
    expect(deriveValues({ deal: { occupancy_pct: 0.91 } }).occupancy_pct.value).toBe(91);
    expect(deriveValues({ deal: { occupancy_pct: 94.2 } }).occupancy_pct.value).toBe(94.2);
  });

  it("prefers the applied deal NOI over the parsed T12, and cites which it used", () => {
    const t12 = { facts: { total_income: 6_000_000, total_expenses: 2_700_000, noi: 3_300_000 }, label: "T12 · t12.xlsx" };
    const fromDoc = deriveValues({ deal: MICHIGAN, t12 });
    expect(fromDoc.going_in_yield_pct.value).toBe(8.9);
    expect(fromDoc.going_in_yield_pct.source).toMatch(/^T12 · t12.xlsx/);
    expect(fromDoc.expense_ratio_pct.value).toBe(45);

    const applied = deriveValues({ deal: { ...MICHIGAN, t12_noi: 2_220_000 }, t12 });
    expect(applied.going_in_yield_pct.value).toBe(6);
  });

  it("works delinquency out as a share of one month's occupied rent", () => {
    const rentRoll = {
      facts: { occupied: 90, notice: 10, physical_occupancy_pct: 95, avg_lease_rent: 1500, loss_to_lease_pct: 6.2, delinquent_total: 7500 },
      label: "Rent roll",
    };
    const d = deriveValues({ deal: {}, rentRoll });
    expect(d.delinquency_pct.value).toBe(5);
    expect(d.loss_to_lease_pct.value).toBe(6.2);
    expect(d.occupancy_pct.value).toBe(95);
  });
});

describe("scorePipelineDeal", () => {
  it("no longer pins price per unit at 100 and equity at 0", () => {
    const s = scorePipelineDeal({ deal: MICHIGAN }, PILLARS, SIGNALS);
    const econ = s.pillars.find((p) => p.key === "deal_economics")!;
    const by = (n: string) => econ.signals.find((x) => x.name === n)!;
    expect(by("Price per unit").score).toBe(21);
    expect(by("Estimated equity ($M)").score).toBe(8);
    expect(by("Affordable component").score).toBeNull();
    expect(by("Going-in yield").score).toBeNull();
  });

  it("drops document signals when there are no documents, rather than scoring them", () => {
    const s = scorePipelineDeal({ deal: MICHIGAN }, PILLARS, SIGNALS);
    const va = s.pillars.find((p) => p.key === "value_add")!;
    expect(va.signals.find((x) => x.name === "Loss-to-lease")!.score).toBeNull();
    // Rent gap -3.9% on -10..20 → 20; the only scored signal in the pillar.
    expect(va.score).toBe(20);
  });

  it("splits the base score into points that add back up to it", () => {
    const s = scorePipelineDeal({ deal: MICHIGAN }, PILLARS, SIGNALS);
    const total = s.pillars.reduce((a, p) => a + (p.points ?? 0), 0);
    expect(Math.abs(total - s.base_score)).toBeLessThanOrEqual(0.5);
  });

  it("carries the scoring range and source through for the card", () => {
    const s = scorePipelineDeal({ deal: MICHIGAN }, PILLARS, SIGNALS);
    const ppu = s.pillars[1].signals.find((x) => x.name === "Price per unit")!;
    expect(ppu).toMatchObject({ method: "lower_better", min_value: 50000, max_value: 300000, source: "Asking price ÷ units" });
    const eq = s.pillars[1].signals.find((x) => x.name === "Estimated equity ($M)")!;
    expect(eq.source).toBe("Deal");
  });

  it("cites a deals column by its recorded field source", () => {
    const deal = { ...MICHIGAN, field_sources: { estimated_equity: { kind: "document", provider: "Deal document", label: "OM", recorded_at: "x" } } };
    const s = scorePipelineDeal({ deal }, PILLARS, SIGNALS);
    expect(s.pillars[1].signals.find((x) => x.name === "Estimated equity ($M)")!.source).toBe("Deal document");
  });

  it("is base 50, insufficient, when nothing scores", () => {
    const s = scorePipelineDeal({ deal: {} }, PILLARS, SIGNALS);
    expect(s).toMatchObject({ base_score: 50, confidence: "insufficient" });
  });
});

describe("scoreSignal", () => {
  it("accepts numeric config as strings, as Postgres numeric arrives", () => {
    expect(scoreSignal(52.5, { scoring_method: "higher_better", min_value: "5", max_value: "100", optimal_min: null, optimal_max: null })).toBe(50);
  });
});

describe("docLabel", () => {
  it("joins the parts it has", () => {
    expect(docLabel("Rent roll", "RR.xlsx", "As of 9/30/2026")).toBe("Rent roll · RR.xlsx · As of 9/30/2026");
    expect(docLabel("T12", "t12.pdf", null)).toBe("T12 · t12.pdf");
  });
});
