import { describe, it, expect } from "vitest";
import {
  hellodataFieldSources,
  normalizeForQuote,
  quoteChecker,
} from "../../supabase/functions/_shared/fieldSources";
import {
  EXTRACTED_FIGURES,
  proposalsFromExtraction,
  type DocumentExtraction,
  type ExtractedFigure,
} from "../../supabase/functions/_shared/dealDocuments";
import { normalizeDetail } from "../../supabase/functions/_shared/dealDocumentDetail";
import { mapHelloDataProperty } from "../../supabase/functions/_shared/hellodataMapping";

describe("quoteChecker", () => {
  const pdf = "=== Page 14 ===\nFinancial Summary\nNet Operating   Income\n$2,431,880\nThe property was built in 2018 and has 260 units.";
  const csv = "=== Sheet: Summary ===\nTotal Occupied,271\n\"Gross Potential Rent\",\"4,812,000\"";
  const inPdf = quoteChecker(pdf);
  const inCsv = quoteChecker(csv);

  it("accepts the document's words across line breaks and runs of spaces", () => {
    expect(inPdf("Net Operating Income $2,431,880")).toBe(true);
    expect(inPdf("built in 2018 and has 260 units")).toBe(true);
  });
  it("accepts a spreadsheet row quoted as cells in order", () => {
    expect(inCsv("Total Occupied 271")).toBe(true);
    expect(inCsv("Gross Potential Rent 4,812,000")).toBe(true);
  });
  it("accepts curly quotes and dashes for straight ones", () => {
    expect(quoteChecker("Year Built - 2018")("Year Built – 2018")).toBe(true);
  });
  it("refuses a different number", () => {
    expect(inPdf("Net Operating Income $2,431,890")).toBe(false);
    expect(inPdf("has 250 units")).toBe(false);
  });
  it("refuses a paraphrase", () => {
    expect(inPdf("NOI of $2,431,880")).toBe(false);
  });
  it("refuses a quote with no number in it, or too short to mean anything", () => {
    expect(inPdf("Financial Summary")).toBe(false);
    expect(inPdf("260")).toBe(false);
    expect(inPdf("")).toBe(false);
    expect(inPdf(null)).toBe(false);
  });
  it("passes nothing when there is no text to check against", () => {
    expect(quoteChecker(null)("Net Operating Income $2,431,880")).toBe(false);
  });
  it("normalizes case and separators the same way on both sides", () => {
    expect(normalizeForQuote("  Total\tOccupied, 271 ")).toBe("total occupied 271");
  });
});

function extraction(doc_type: DocumentExtraction["doc_type"], figures: Partial<Record<ExtractedFigure, number>>): DocumentExtraction {
  return {
    doc_type,
    property_name: null,
    property_address: null,
    as_of: null,
    notes: "",
    detail: normalizeDetail({}),
    figures: Object.fromEntries(
      EXTRACTED_FIGURES.map((f) => [
        f,
        figures[f] === undefined
          ? { value: null, evidence: null, quote: null, location: null }
          : { value: figures[f]!, evidence: `evidence for ${f}`, quote: `quote for ${f} ${figures[f]}`, location: `p.${f.length}` },
      ]),
    ) as DocumentExtraction["figures"],
  };
}

describe("proposalsFromExtraction quotes", () => {
  const { proposals } = proposalsFromExtraction(
    extraction("om", {
      unit_count: 200,
      occupied_units: 190,
      total_operating_expenses_annual: 1_000_000,
      effective_gross_income_annual: 2_500_000,
      noi_annual: 1_500_000,
    }),
  );
  const by = Object.fromEntries(proposals.map((p) => [p.field, p]));

  it("carries the figure's quote and location onto its proposal", () => {
    expect(by.unit_count.quote).toBe("quote for unit_count 200");
    expect(by.unit_count.location).toBe("p.10");
  });
  it("quotes the figure a computed occupancy came from", () => {
    expect(by.occupancy_pct.quote).toBe("quote for occupied_units 190");
  });
  it("has no quote for a ratio computed across two figures", () => {
    expect(by.expense_ratio.quote).toBeNull();
    expect(by.expense_ratio.location).toBeNull();
  });
});

describe("hellodataFieldSources", () => {
  const at = "2026-10-26T12:00:00.000Z";

  it("cites only the fields the write carries", () => {
    const s = hellodataFieldSources({ median_rent_tract: 1450, median_income_tract: null }, { at });
    expect(Object.keys(s)).toEqual(["median_rent_tract"]);
    expect(s.median_rent_tract).toMatchObject({ kind: "api", provider: "HelloData", recorded_at: at });
  });
  it("says when the unit count or vintage is HelloData's prediction", () => {
    const s = hellodataFieldSources(
      { unit_count: 208, unit_count_is_estimated: true, vintage_year: 2018, vintage_is_estimated: false },
      { at },
    );
    expect(s.unit_count.label).toMatch(/predicted/);
    expect(s.vintage_year.label).not.toMatch(/predicted/);
  });
  it("says in-place rent is an asking rent, and over how many units", () => {
    const s = hellodataFieldSources({ in_place_avg_rent: 1850 }, { at, rentBasis: { from: "listed_units", units: 12 } });
    expect(s.in_place_avg_rent.label).toMatch(/12 units/);
    expect(s.in_place_avg_rent.label).toMatch(/asking rent/i);
  });
});

describe("mapHelloDataProperty rentBasis", () => {
  it("is the listed units when any are listed", () => {
    const { rentBasis } = mapHelloDataProperty({
      building_availability: [{ price: 1800 }, { price: 1900 }],
    });
    expect(rentBasis).toEqual({ from: "listed_units", units: 2 });
  });
  it("is the property average when none are listed", () => {
    expect(mapHelloDataProperty({ avg_price: 1700 }).rentBasis).toEqual({ from: "property_average" });
  });
  it("is null with no rent at all", () => {
    expect(mapHelloDataProperty({}).rentBasis).toBeNull();
  });
});
