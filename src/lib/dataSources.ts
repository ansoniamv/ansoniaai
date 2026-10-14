/**
 * Which vendor a scoring input comes from, so every number on the AI Score tab
 * can say where it was measured. Labels are vendor names a reader recognises,
 * with the detail (ring, geography, table) kept for the tooltip.
 */
export type Vendor = "CoStar" | "Esri" | "HelloData" | "BLS" | "Census" | "Deal record" | "Calculated";

export interface SourceInfo {
  vendor: Vendor;
  detail: string;
}

/** deals columns written by the HelloData mapper (_shared/hellodataMapping.ts). */
const HELLODATA_COLUMNS = new Set([
  "in_place_avg_rent", "concession_spread_pct", "avg_time_on_market", "avg_price_change", "avg_posting_duration",
  "building_quality_score", "is_lease_up", "uses_rev_management", "review_avg_rating", "review_count",
  "review_positive_count", "review_negative_count", "rent_trend_3mo_pct", "rent_trend_12mo_pct", "units_available",
  "exposure_pct", "median_days_on_market", "concession_weeks_free", "concession_pct_of_rent", "move_in_fees_total",
]);

/** Census tract demographics, delivered through HelloData's property lookup. */
const TRACT_COLUMNS = new Set([
  "median_income_tract", "median_rent_tract", "median_age_tract", "bachelors_pct_tract", "vacancy_rate_tract",
  "owner_occupied_pct_tract", "population_density_tract", "race_breakdown_tract",
]);

/**
 * A pillar signal's field_source path (deal-score's resolve()) → vendor.
 * `newSupplySource` is deals.new_supply_source, because new_supply_pct_of_stock
 * is CoStar when a submarket is picked and Esri otherwise.
 */
export function sourceOfPath(path: string | null | undefined, newSupplySource?: string | null): SourceInfo {
  const [root, ...rest] = (path ?? "").split(".");
  const col = rest[0] ?? "";
  if (root === "costar") return { vendor: "CoStar", detail: "CoStar submarket, all classes" };
  if (root === "deal_enrichment") return { vendor: "Esri", detail: `Esri ${rest.join(".")}` };
  if (root === "permits") return { vendor: "Census", detail: "Census Building Permits Survey" };
  if (root === "derived") {
    if (col === "rent_gap_pct") return { vendor: "Calculated", detail: "HelloData rent vs Census tract median rent" };
    if (col === "price_per_unit") return { vendor: "Calculated", detail: "Asking price ÷ units (deal record)" };
    return { vendor: "Calculated", detail: col };
  }
  if (root === "deals") {
    if (HELLODATA_COLUMNS.has(col)) return { vendor: "HelloData", detail: "HelloData property data" };
    if (TRACT_COLUMNS.has(col)) return { vendor: "Census", detail: "Census ACS tract, via HelloData" };
    if (col === "job_growth_pct") return { vendor: "BLS", detail: "BLS total nonfarm employment, MSA, YoY" };
    if (col === "population_growth_pct") return { vendor: "Esri", detail: "Esri 5-mi ring, 5-yr forecast" };
    if (col === "area_median_income_1mi") return { vendor: "Esri", detail: "Esri 1-mi ring" };
    if (col === "new_supply_pct_of_stock")
      return newSupplySource === "costar_uc"
        ? { vendor: "CoStar", detail: "CoStar under construction ÷ inventory" }
        : { vendor: "Esri", detail: "Esri 5-mi housing-unit growth" };
    return { vendor: "Deal record", detail: "Entered on the deal or extracted from the OM" };
  }
  return { vendor: "Deal record", detail: path || "Unknown" };
}
