import { describe, expect, it } from "vitest";
import { sourceOfPath } from "@/lib/dataSources";
import { favourablePercentile, headline, inferSlice, scorePipeline, type PipelineEntry } from "@/lib/rentGrowthScore";

const deal = (id: string, over: Record<string, unknown> = {}): PipelineEntry => ({
  deal: { id, vintage_year: 2000, in_place_avg_rent: 1200, job_growth_pct: 1, population_growth_pct: 1, ...over },
  rings: { "3mi": { MEDHINC_CY: 60000, MEDHINC_FY: 66000, RENTER_CY: 40, OWNER_CY: 60 } },
  signals: [],
});

describe("favourablePercentile", () => {
  it("ranks higher-is-better and lower-is-better the same way round", () => {
    const peers = [1, 2, 3, 4, 5];
    expect(favourablePercentile(5, peers, "higher")).toBe(1);
    expect(favourablePercentile(1, peers, "lower")).toBe(1);
    expect(favourablePercentile(1, peers, "higher")).toBe(0.2);
  });
  it("refuses to rank against too few peers", () => {
    expect(favourablePercentile(3, [1, 2, 3], "higher")).toBeNull();
  });
});

describe("scorePipeline", () => {
  it("ranks structural factors against the pipeline", () => {
    const entries = [1, 2, 3, 4, 5].map((n) => deal(`d${n}`, { job_growth_pct: n }));
    const s = scorePipeline(entries);
    const best = s.get("d5")!.legs.structural.factors.find((f) => f.key === "s_job")!;
    const worst = s.get("d1")!.legs.structural.factors.find((f) => f.key === "s_job")!;
    expect(best.pct).toBe(1);
    expect(worst.pct).toBe(0.2);
    expect(best.thesis?.pass).toBe(true); // 5% clears the 1.2% national floor
    expect(worst.thesis?.pass).toBe(false); // 1% doesn't
  });

  it("leaves cyclical unscored without a CoStar submarket", () => {
    const s = scorePipeline([1, 2, 3, 4, 5].map((n) => deal(`d${n}`)));
    expect(s.get("d1")!.legs.cyclical.score).toBeNull();
  });

  it("falls back to the tract rent for the gap when CoStar is missing", () => {
    const s = scorePipeline([deal("a", { median_rent_tract: 1500 })]);
    const gap = s.get("a")!.legs.micro.factors.find((f) => f.key === "m_gap")!;
    expect(gap.value).toBeCloseTo(-20);
    expect(gap.thesis?.pass).toBe(true);
  });
});

describe("headline", () => {
  it("calls out a strong asset in a weak cycle", () => {
    expect(headline(64, 31, 86).title).toBe("Strong asset, wrong moment.");
  });
  it("says so when nothing is scored", () => {
    expect(headline(null, null, null).title).toMatch(/Not enough data/);
  });
});

describe("sources", () => {
  it("labels the gap with both vendors it's built from", () => {
    const s = scorePipeline([deal("a", { median_rent_tract: 1500 })]);
    const gap = s.get("a")!.legs.micro.factors.find((f) => f.key === "m_gap")!;
    expect(gap.sources.map((x) => x.vendor)).toEqual(["HelloData", "Census"]);
  });

  it("maps pillar field paths to vendors", () => {
    expect(sourceOfPath("costar.uc_pct").vendor).toBe("CoStar");
    expect(sourceOfPath("deal_enrichment.rings.3mi.MEDHINC_CY").vendor).toBe("Esri");
    expect(sourceOfPath("deals.in_place_avg_rent").vendor).toBe("HelloData");
    expect(sourceOfPath("deals.median_rent_tract").vendor).toBe("Census");
    expect(sourceOfPath("deals.job_growth_pct").vendor).toBe("BLS");
    expect(sourceOfPath("deals.asking_price").vendor).toBe("Deal record");
    expect(sourceOfPath("deals.new_supply_pct_of_stock", "costar_uc").vendor).toBe("CoStar");
    expect(sourceOfPath("deals.new_supply_pct_of_stock", "esri_housing_units").vendor).toBe("Esri");
  });
});

describe("inferSlice", () => {
  it("maps the thesis vintages to 3 Star", () => {
    expect(inferSlice(1998)).toBe("3 Star");
    expect(inferSlice(2018)).toBe("4 & 5 Star");
    expect(inferSlice(1979)).toBe("1 & 2 Star");
  });
});
