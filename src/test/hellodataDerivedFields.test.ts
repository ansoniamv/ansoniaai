import { describe, it, expect } from "vitest";
import {
  mapHelloDataProperty,
  selectWritableFields,
  collectRentHistory,
  sameUnitRentTrendPct,
  buildFeeSchedule,
  concessionValue,
} from "../../supabase/functions/_shared/hellodataMapping";

// Dates are built backwards from a fixed anchor so the windows stay stable.
const ANCHOR = new Date("2026-09-01T00:00:00Z");
const monthsAgo = (n: number) =>
  new Date(ANCHOR.getTime() - n * 30.44 * 86_400_000).toISOString().slice(0, 10);

const unit = (name: string, prices: Array<[number, number]>) => ({
  unit_name: name,
  history: prices.map(([months, price]) => ({ from_date: monthsAgo(months), effective_price: price })),
});

describe("sameUnitRentTrendPct", () => {
  it("measures each unit against itself, not the month's unit mix", () => {
    // Every unit is flat. A naive month-over-month average would read +49%,
    // because the only unit listed at the anchor is the expensive one.
    const avail = [
      unit("101", [[13, 1000], [0, 1000]]),
      unit("102", [[13, 1200], [0, 1200]]),
      unit("PH1", [[13, 3000], [0, 3000]]),
    ];
    const series = collectRentHistory({}, avail);
    expect(sameUnitRentTrendPct(series, 12)).toBe(0);
  });

  it("returns the median change so one outlier cannot carry it", () => {
    const avail = [
      unit("101", [[4, 1000], [0, 1050]]), // +5%
      unit("102", [[4, 1000], [0, 1040]]), // +4%
      unit("103", [[4, 1000], [0, 1060]]), // +6%
      unit("104", [[4, 1000], [0, 1400]]), // +40%, a renovated unit returning
    ];
    const series = collectRentHistory({}, avail);
    // Mean would be +13.75%. Median of 4/5/6/40 is 5.5.
    expect(sameUnitRentTrendPct(series, 3)).toBe(5.5);
  });

  it("reports a decline", () => {
    const avail = [
      unit("101", [[4, 1000], [0, 940]]),
      unit("102", [[4, 1000], [0, 950]]),
      unit("103", [[4, 1000], [0, 930]]),
    ];
    // -6%, -5%, -7% -> median -6%.
    expect(sameUnitRentTrendPct(collectRentHistory({}, avail), 3)).toBe(-6);
  });

  it("is null below the minimum sample rather than confidently wrong", () => {
    const avail = [unit("101", [[4, 1000], [0, 1100]])];
    expect(sameUnitRentTrendPct(collectRentHistory({}, avail), 3)).toBeNull();
  });

  it("skips units that had no price when the window opened", () => {
    // Two units span the window; the third only came online last month, so its
    // lease-up price is not a rent change and must not be counted.
    const avail = [
      unit("101", [[4, 1000], [0, 1020]]),
      unit("102", [[4, 1000], [0, 1040]]),
      unit("new", [[1, 2000], [0, 2000]]),
    ];
    expect(sameUnitRentTrendPct(collectRentHistory({}, avail), 3)).toBeNull();
  });

  it("reads history hung on the property root as well as on units", () => {
    const p = {
      history: [
        { unit_name: "101", from_date: monthsAgo(4), effective_price: 1000 },
        { unit_name: "101", from_date: monthsAgo(0), effective_price: 1100 },
        { unit_name: "102", from_date: monthsAgo(4), effective_price: 1000 },
        { unit_name: "102", from_date: monthsAgo(0), effective_price: 1100 },
        { unit_name: "103", from_date: monthsAgo(4), effective_price: 1000 },
        { unit_name: "103", from_date: monthsAgo(0), effective_price: 1100 },
      ],
    };
    expect(sameUnitRentTrendPct(collectRentHistory(p, []), 3)).toBe(10);
  });

  it("anchors to the latest data, so a stale cached payload still reports", () => {
    // Nothing newer than 8 months ago. The 3-month window ends there.
    const avail = [
      unit("101", [[12, 1000], [8, 1100]]),
      unit("102", [[12, 1000], [8, 1100]]),
      unit("103", [[12, 1000], [8, 1100]]),
    ];
    expect(sameUnitRentTrendPct(collectRentHistory({}, avail), 3)).toBe(10);
  });
});

describe("buildFeeSchedule", () => {
  it("normalizes named fee fields with their frequency", () => {
    const { schedule, moveInFeesTotal } = buildFeeSchedule({
      admin_fee: 250,
      application_fee: 75,
      cats_monthly_rent: 35,
      max_deposit: 500,
    });
    expect(moveInFeesTotal).toBe(325);
    expect(schedule).toEqual([
      { label: "Admin fee", amount: 250, frequency: "one_time" },
      { label: "Application fee", amount: 75, frequency: "one_time" },
      { label: "Cat rent", amount: 35, frequency: "monthly" },
      { label: "Deposit (max)", amount: 500, frequency: "deposit" },
    ]);
  });

  it("folds in the unstructured fees array without duplicating a named fee", () => {
    const { schedule } = buildFeeSchedule({
      admin_fee: 250,
      fees: [
        { label: "Admin Fee", amount: 250, frequency: "one-time" },
        { label: "Trash valet", amount: 25, frequency: "monthly" },
      ],
    });
    expect(schedule).toEqual([
      { label: "Admin fee", amount: 250, frequency: "one_time" },
      { label: "Trash valet", amount: 25, frequency: "monthly" },
    ]);
  });

  it("distinguishes no fees posted from no fee data", () => {
    expect(buildFeeSchedule({}).schedule).toBeNull();
    expect(buildFeeSchedule({}).moveInFeesTotal).toBeNull();
    expect(buildFeeSchedule({ admin_fee: 0 }).moveInFeesTotal).toBe(0);
  });
});

describe("concessionValue", () => {
  it("converts the structured extraction to weeks and to a share of annual rent", () => {
    const { weeksFree, pctOfRent } = concessionValue(
      [{ description: "6 weeks free", items: [{ free_weeks: 6 }] }],
      1500,
    );
    expect(weeksFree).toBe(6);
    expect(pctOfRent).toBe(11.54);
  });

  it("converts months at 4.345 weeks", () => {
    const { weeksFree } = concessionValue(
      [{ description: null, items: [{ free_months: 1 }] }],
      1500,
    );
    expect(weeksFree).toBe(4.34);
  });

  it("falls back to the advertised text when nothing was extracted", () => {
    const { weeksFree } = concessionValue(
      [{ description: "Look and lease: 8 WEEKS FREE on select homes", items: null }],
      1500,
    );
    expect(weeksFree).toBe(8);
  });

  it("takes the largest offer when several run at once", () => {
    const { weeksFree } = concessionValue(
      [
        { description: "2 weeks free", items: [{ free_weeks: 2 }] },
        { description: "6 weeks free", items: [{ free_weeks: 6 }] },
      ],
      1500,
    );
    expect(weeksFree).toBe(6);
  });

  it("annualizes a dollar discount against rent", () => {
    const { pctOfRent } = concessionValue(
      [{ description: "$900 off", items: [{ amount_off: 900 }] }],
      1500,
    );
    expect(pctOfRent).toBe(5);
  });

  it("is null when there is no active concession", () => {
    expect(concessionValue([], 1500)).toEqual({ weeksFree: null, pctOfRent: null });
  });
});

describe("mapHelloDataProperty — payload-derived fields", () => {
  it("separates nothing available from no availability data", () => {
    expect(mapHelloDataProperty({ building_availability: [], number_units: 200 }).update)
      .toMatchObject({ units_available: 0, exposure_pct: 0 });
    expect(mapHelloDataProperty({ number_units: 200 }).update)
      .toMatchObject({ units_available: null, exposure_pct: null });
  });

  it("computes exposure against the property's own unit count", () => {
    const { update } = mapHelloDataProperty({
      number_units: 200,
      building_availability: Array.from({ length: 22 }, (_, i) => ({ unit_name: `u${i}` })),
    });
    expect(update.units_available).toBe(22);
    expect(update.exposure_pct).toBe(11);
  });

  it("takes the median days on market, not the mean", () => {
    const { update } = mapHelloDataProperty({
      building_availability: [
        { days_on_market: 10 }, { days_on_market: 14 }, { days_on_market: 400 },
      ],
    });
    expect(update.median_days_on_market).toBe(14);
  });

  it("normalizes room-level quality onto the 0-100 scale of the blended score", () => {
    const { update } = mapHelloDataProperty({
      building_quality: { property_overall_quality: 0.62, kitchen_quality: 0.41, pool_quality: 0.88 },
    });
    expect(update.building_quality_score).toBe(62);
    expect(update.building_quality_detail).toEqual({
      property_overall_quality: 62, kitchen_quality: 41, pool_quality: 88,
    });
  });

  it("dedupes and sorts amenities, accepting strings or objects", () => {
    const { update } = mapHelloDataProperty({
      building_amenities: ["Pool", { name: "Fitness Center" }, "Pool"],
      unit_amenities: [],
    });
    expect(update.building_amenities).toEqual(["Fitness Center", "Pool"]);
    expect(update.unit_amenities).toBeNull();
  });

  it("keeps a missing subtype flag null rather than reading it as false", () => {
    const { update } = mapHelloDataProperty({ is_student: true, is_condo: false });
    expect(update.is_student_housing).toBe(true);
    expect(update.is_condo).toBe(false);
    expect(update.is_senior_housing).toBeNull();
  });

  it("falls back to the predicted unit count and says that it did", () => {
    const filed = mapHelloDataProperty({ number_units: 212, number_units_prediction: 208 }).update;
    expect(filed.unit_count).toBe(212);
    expect(filed.unit_count_is_estimated).toBe(false);

    const predicted = mapHelloDataProperty({ number_units_prediction: 208 }).update;
    expect(predicted.unit_count).toBe(208);
    expect(predicted.unit_count_is_estimated).toBe(true);

    const neither = mapHelloDataProperty({}).update;
    expect(neither.unit_count).toBeNull();
    expect(neither.unit_count_is_estimated).toBeNull();
  });

  it("does not let a provenance flag outlive the value it describes", () => {
    // unit_count is fill-if-null, so on a deal an analyst already typed a count
    // into, the mapper's count is dropped — and the flag must go with it, or it
    // brands the analyst's figure a model guess.
    const mapped = mapHelloDataProperty({ number_units_prediction: 208 }).update;
    // A loaded row comes from select("*"), so the flag columns are keys too.
    const row = (unitCount: number | null) => ({
      id: "d1", unit_count: unitCount, vintage_year: null,
      unit_count_is_estimated: null, vintage_is_estimated: null,
    });
    const out = selectWritableFields(mapped, row(212));
    expect(out.unit_count).toBeUndefined();
    expect(out.unit_count_is_estimated).toBeUndefined();

    const onEmpty = selectWritableFields(mapped, row(null));
    expect(onEmpty.unit_count).toBe(208);
    expect(onEmpty.unit_count_is_estimated).toBe(true);
  });

  it("survives a payload carrying none of the new sections", () => {
    const { update } = mapHelloDataProperty({ building_name: "Ardent", city: "Dallas" });
    expect(update.property_name).toBe("Ardent");
    for (const k of [
      "rent_trend_3mo_pct", "rent_trend_12mo_pct", "exposure_pct", "median_days_on_market",
      "concession_weeks_free", "concession_pct_of_rent", "fee_schedule", "move_in_fees_total",
      "building_amenities", "unit_amenities", "building_quality_detail", "number_stories",
      "census_tract_id", "street_view_url",
    ]) {
      expect(update[k], `${k} should be null on a bare payload`).toBeNull();
    }
  });
});
