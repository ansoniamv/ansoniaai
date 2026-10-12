import { describe, expect, it } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import * as XLSX from "xlsx-js-style";
import { classifyPeriod, parseCostarExport, quarterEnd } from "@/lib/costarExport";

const HEADER = [
  "Property Class Name", "Period", "Slice", "As Of", "Geography Name", "Property Type", "Geography Code",
  "Forecast Scenario", "CBSA Code", "Geography Type", "Inventory Units", "Under Construction Units",
  "Net Delivered Units 12 Mo", "Occupancy Rate", "Market Asking Rent/Unit", "Market Effective Rent/Unit",
  "Vacancy Rate",
];

function row(period: string, overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    "Property Class Name": "Multi-Family", Period: period, Slice: "3 Star", "As Of": "2026 Q4",
    "Geography Name": "Atlanta - GA USA - Barrow County", "Property Type": "Multi-Family",
    "Geography Code": "APT-1-6732", "Forecast Scenario": "Base Case", "CBSA Code": 12060,
    "Geography Type": "Submarket", "Inventory Units": 689, "Under Construction Units": 324,
    "Net Delivered Units 12 Mo": 0, "Occupancy Rate": 0.907, "Market Asking Rent/Unit": 1724,
    "Market Effective Rent/Unit": null, "Vacancy Rate": 0.093,
  };
  return HEADER.map((h) => (h in overrides ? overrides[h] : base[h]));
}

// jsdom's Blob has no arrayBuffer(); browsers and Node's do.
const blob = (parts: ArrayBuffer[]) => new NodeBlob(parts) as unknown as Blob;

function workbook(rows: unknown[][]): Blob {
  const ws = XLSX.utils.aoa_to_sheet([HEADER, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "DataExport");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer;
  return blob([buf]);
}

describe("classifyPeriod", () => {
  it("reads CoStar's YTD / EST suffixes and splits history from forecast around the as-of quarter", () => {
    expect(classifyPeriod("2025 Q4", 2026, 4).kind).toBe("history");
    expect(classifyPeriod("2026 Q4 YTD", 2026, 4).kind).toBe("ytd");
    expect(classifyPeriod("2026 Q4 EST", 2026, 4).kind).toBe("estimate");
    expect(classifyPeriod("2027 Q4", 2026, 4)).toEqual({ year: 2027, quarter: 4, kind: "forecast" });
    expect(classifyPeriod("2026 Q2", 2026, 4).kind).toBe("history");
    expect(classifyPeriod("2026 Q4", 2026, 4).kind).toBe("estimate");
  });

  it("throws on a label it can't read instead of filing it under some year", () => {
    expect(() => classifyPeriod("FY2026", 2026, 4)).toThrow(/Unrecognised period "FY2026"/);
  });
});

describe("quarterEnd", () => {
  it("returns the last calendar day of the quarter", () => {
    expect(quarterEnd(2026, 4)).toBe("2026-12-31");
    expect(quarterEnd(2024, 1)).toBe("2024-03-31");
    expect(quarterEnd(2026, 2)).toBe("2026-06-30");
  });
});

describe("parseCostarExport", () => {
  it("maps the export onto costar_series rows", async () => {
    const out = await parseCostarExport(
      workbook([row("2025 Q4"), row("2026 Q4 YTD"), row("2027 Q4", { "Under Construction Units": null })]),
    );
    expect(out.asOf).toBe("2026 Q4");
    expect(out.asOfDate).toBe("2026-12-31");
    expect(out.rows).toHaveLength(3);
    const ytd = out.rows.find((r) => r.period_kind === "ytd")!;
    expect(ytd).toMatchObject({
      geography_type: "Submarket",
      geography_code: "APT-1-6732",
      geography_name: "Atlanta - GA USA - Barrow County",
      cbsa_code: "12060",
      slice: "3 Star",
      period_year: 2026,
      period_quarter: 4,
      inventory_units: 689,
      under_construction_units: 324,
      occupancy_rate: 0.907,
      effective_rent_unit: null,
    });
    // Unpromoted columns are kept under their CoStar header; promoted and
    // descriptive ones are not duplicated into metrics.
    expect(ytd.metrics).toEqual({ "Vacancy Rate": 0.093 });
    expect(out.rows[2].under_construction_units).toBeNull();
    expect(out.summary.geographies).toBe(1);
    expect(out.summary.periods).toEqual(["2025 Q4", "2026 Q4 YTD", "2027 Q4"]);
  });

  it("warns when the export has no 1 & 2 Star slice, since supply % then reads high", async () => {
    const out = await parseCostarExport(workbook([row("2026 Q4 YTD")]));
    expect(out.summary.warnings.join(" ")).toMatch(/No 1 & 2 Star slice/);
    const withC = await parseCostarExport(workbook([row("2026 Q4 YTD"), row("2026 Q4 YTD", { Slice: "1 & 2 Star" })]));
    expect(withC.summary.warnings.join(" ")).not.toMatch(/1 & 2 Star/);
  });

  it("refuses a file that mixes two vintages", async () => {
    await expect(
      parseCostarExport(workbook([row("2026 Q4 YTD"), row("2026 Q3 YTD", { "As Of": "2026 Q3" })])),
    ).rejects.toThrow(/mixes two vintages/);
  });

  it("refuses a workbook that isn't a CoStar export", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["Name", "Rent"], ["A", 1]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const file = blob([XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer]);
    await expect(parseCostarExport(file)).rejects.toThrow(/missing columns As Of, Geography Type/);
  });

  it("never turns a non-numeric cell into a number", async () => {
    const out = await parseCostarExport(workbook([row("2026 Q4 YTD", { "Inventory Units": "n/a" })]));
    expect(out.rows[0].inventory_units).toBeNull();
  });
});
