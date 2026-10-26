import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  DEAL_DOCUMENT_FIELDS,
  EXTRACTED_FIGURES,
  EXTRACTION_SCHEMA,
  clampDocumentText,
  documentKind,
  normalizeExtraction,
  proposalsFromExtraction,
  rankFor,
  type DocumentExtraction,
  type ExtractedFigure,
  type DocType,
} from "../../supabase/functions/_shared/dealDocuments";
import { normalizeDetail } from "../../supabase/functions/_shared/dealDocumentDetail";

const NOW = new Date("2026-10-21T12:00:00Z");

function extraction(
  doc_type: DocType,
  figures: Partial<Record<ExtractedFigure, number>>,
): DocumentExtraction {
  return {
    doc_type,
    property_name: "Test Apartments",
    property_address: null,
    as_of: null,
    notes: "",
    detail: normalizeDetail({}),
    figures: Object.fromEntries(
      EXTRACTED_FIGURES.map((f) => [
        f,
        figures[f] === undefined ? { value: null, evidence: null } : { value: figures[f]!, evidence: `quote for ${f}` },
      ]),
    ) as DocumentExtraction["figures"],
  };
}

const byField = (ps: { field: string; value: number }[]) => Object.fromEntries(ps.map((p) => [p.field, p.value]));

describe("apply_deal_document_proposals whitelist", () => {
  // The SQL function interpolates the field into an UPDATE; its list is the real
  // guard. A field added here but not there would be proposed and then refused.
  // Every migration that (re)defines the function, so the live one is covered.
  it.each([
    "20261021120000_deal_documents.sql",
    "20261029120000_deal_field_sources.sql",
  ])("matches DEAL_DOCUMENT_FIELDS exactly in %s", (file) => {
    const sql = readFileSync(path.resolve(__dirname, "../../supabase/migrations", file), "utf8");
    const block = sql.match(/allowed CONSTANT text\[\] := ARRAY\[([\s\S]*?)\];/i)![1];
    const sqlFields = [...block.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]).sort();
    expect(sqlFields).toEqual([...DEAL_DOCUMENT_FIELDS].sort());
  });
});

describe("EXTRACTION_SCHEMA", () => {
  it("requires every figure, so the model cannot silently omit one", () => {
    expect((EXTRACTION_SCHEMA.properties.figures as { required: string[] }).required).toEqual([...EXTRACTED_FIGURES]);
  });
  it("stays under the API's 16 union-typed parameter limit", () => {
    // Over the limit the API 400s every call; the first deploy had 24.
    let unions = 0;
    const walk = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const node = n as { type?: unknown; anyOf?: unknown };
      if (Array.isArray(node.type) || node.anyOf) unions++;
      Object.values(n).forEach(walk);
    };
    walk(EXTRACTION_SCHEMA);
    expect(unions).toBeLessThanOrEqual(16);
  });
  it("never combines a type union with an enum (the 5f7f1fb 400)", () => {
    const walk = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const node = n as { type?: unknown; enum?: unknown };
      if (Array.isArray(node.type) && node.enum) throw new Error("type union with enum");
      Object.values(n).forEach(walk);
    };
    expect(() => walk(EXTRACTION_SCHEMA)).not.toThrow();
  });
});

describe("normalizeExtraction", () => {
  const out = normalizeExtraction({
    doc_type: "rent_roll",
    property_name: "  ",
    as_of: "06/23/2026",
    figures: {
      unit_count: { found: true, value: 160, evidence: "Totals: 160" },
      noi_annual: { found: false, value: 0, evidence: "" },
    },
    notes: "",
  });
  it("turns found:false into null, never a real zero", () => {
    expect(out.figures.noi_annual).toEqual({ value: null, evidence: null, quote: null, location: null });
    expect(out.figures.unit_count).toEqual({ value: 160, evidence: "Totals: 160", quote: null, location: null });
  });
  it("treats a figure the model left out as not found", () => {
    expect(out.figures.asking_price_usd.value).toBeNull();
  });
  it("turns blank strings into null", () => {
    expect(out.property_name).toBeNull();
    expect(out.as_of).toBe("06/23/2026");
  });
  it("falls back to 'other' for an unknown doc type", () => {
    expect(normalizeExtraction({ doc_type: "lease" }).doc_type).toBe("other");
  });
  it("produces no proposals for a not-found zero", () => {
    expect(proposalsFromExtraction(out, NOW).proposals.map((p) => p.field)).toEqual(["unit_count"]);
  });
});

describe("proposalsFromExtraction: a T12", () => {
  const { proposals, rejected } = proposalsFromExtraction(
    extraction("t12", {
      gross_potential_rent_annual: 3_240_000,
      effective_gross_income_annual: 2_746_330,
      total_operating_expenses_annual: 1_352_657.21,
      noi_annual: 1_393_672.77,
    }),
    NOW,
  );
  const v = byField(proposals);

  it("rounds dollar lines to whole dollars", () => {
    expect(v.t12_noi).toBe(1_393_673);
    expect(v.t12_opex).toBe(1_352_657);
    expect(v.gross_scheduled_rent).toBe(3_240_000);
  });
  it("computes the expense ratio in percent, not as a fraction", () => {
    expect(v.expense_ratio).toBe(49.3);
    expect(proposals.find((p) => p.field === "expense_ratio")!.evidence).toMatch(/^computed/);
  });
  it("rejects nothing", () => expect(rejected).toEqual([]));
});

describe("proposalsFromExtraction: an OM", () => {
  it("converts the asking price to millions, which is what deals stores", () => {
    const { proposals } = proposalsFromExtraction(extraction("om", { asking_price_usd: 31_250_000 }), NOW);
    expect(byField(proposals).asking_price).toBe(31.25);
  });
  it("refuses a price that was already given in millions", () => {
    const { proposals, rejected } = proposalsFromExtraction(extraction("om", { asking_price_usd: 31.25 }), NOW);
    expect(byField(proposals).asking_price).toBeUndefined();
    expect(rejected[0].figure).toBe("asking_price_usd");
  });
  it("proposes the vintage", () => {
    const { proposals } = proposalsFromExtraction(extraction("om", { year_built: 1998 }), NOW);
    expect(byField(proposals).vintage_year).toBe(1998);
  });
});

describe("proposalsFromExtraction: a rent roll", () => {
  it("reads a stated fraction as a percentage", () => {
    const { proposals } = proposalsFromExtraction(extraction("rent_roll", { unit_count: 160, occupancy_pct: 0.794 }), NOW);
    expect(byField(proposals).occupancy_pct).toBe(79.4);
  });
  it("computes occupancy from counts when none is stated, and says so", () => {
    const { proposals } = proposalsFromExtraction(extraction("rent_roll", { unit_count: 160, occupied_units: 127 }), NOW);
    const p = proposals.find((x) => x.field === "occupancy_pct")!;
    expect(p.value).toBe(79.4);
    expect(p.evidence).toMatch(/^computed: 127 occupied \/ 160 units/);
  });
  it("refuses more occupied units than units", () => {
    const { proposals, rejected } = proposalsFromExtraction(extraction("rent_roll", { unit_count: 160, occupied_units: 171 }), NOW);
    expect(byField(proposals).occupancy_pct).toBeUndefined();
    expect(rejected[0].figure).toBe("occupied_units");
  });
  it("does not propose financials a rent roll cannot contain", () => {
    const { proposals } = proposalsFromExtraction(extraction("rent_roll", { noi_annual: 1_000_000, unit_count: 160 }), NOW);
    expect(byField(proposals).t12_noi).toBeUndefined();
    expect(byField(proposals).unit_count).toBe(160);
  });
  it("refuses an implausible square footage per unit", () => {
    const { rejected } = proposalsFromExtraction(extraction("rent_roll", { unit_count: 160, net_rentable_sqft: 688 }), NOW);
    expect(rejected[0].figure).toBe("net_rentable_sqft");
  });
  it("refuses a monthly GPR passed off as annual", () => {
    const { proposals, rejected } = proposalsFromExtraction(
      extraction("t12", { unit_count: 160, gross_potential_rent_annual: 187_966 }),
      NOW,
    );
    expect(byField(proposals).gross_scheduled_rent).toBeUndefined();
    expect(rejected[0].figure).toBe("gross_potential_rent_annual");
  });
});

describe("proposalsFromExtraction: internal consistency", () => {
  it("offers none of the T12 totals when opex exceeds income", () => {
    const { proposals, rejected } = proposalsFromExtraction(
      extraction("t12", {
        effective_gross_income_annual: 1_000_000,
        total_operating_expenses_annual: 1_400_000,
        noi_annual: 400_000,
      }),
      NOW,
    );
    const v = byField(proposals);
    expect(v.t12_noi).toBeUndefined();
    expect(v.t12_opex).toBeUndefined();
    expect(v.expense_ratio).toBeUndefined();
    expect(rejected.map((r) => r.figure)).toContain("noi_annual");
  });
  it("allows a negative NOI", () => {
    const { proposals } = proposalsFromExtraction(extraction("t12", { noi_annual: -85_000 }), NOW);
    expect(byField(proposals).t12_noi).toBe(-85_000);
  });
  it("refuses a units count outside 1-5000", () => {
    const { rejected } = proposalsFromExtraction(extraction("om", { unit_count: 12_000 }), NOW);
    expect(rejected[0].figure).toBe("unit_count");
  });
});

describe("rankFor", () => {
  it("trusts the rent roll over the OM for occupancy, and the T12 over the OM for NOI", () => {
    expect(rankFor("occupancy_pct", "rent_roll")).toBeGreaterThan(rankFor("occupancy_pct", "om"));
    expect(rankFor("t12_noi", "t12")).toBeGreaterThan(rankFor("t12_noi", "om"));
  });
});

describe("documentKind", () => {
  it.each([
    ["Rent Roll Detail.xls", null, "spreadsheet"],
    ["T12.XLSX", null, "spreadsheet"],
    ["om.pdf", null, "pdf"],
    ["download", "application/pdf", "pdf"],
    ["rr.csv", null, "text"],
    ["photo.jpg", "image/jpeg", "unsupported"],
  ])("%s (%s) is %s", (name, type, kind) => {
    expect(documentKind(name, type)).toBe(kind);
  });
});

describe("clampDocumentText", () => {
  it("leaves short text alone", () => {
    expect(clampDocumentText("abc", 10)).toEqual({ text: "abc", truncated: false });
  });
  it("keeps the end, where a rent roll's totals live", () => {
    const text = "HEAD" + "x".repeat(1000) + "Totals: 160 units";
    const out = clampDocumentText(text, 200);
    expect(out.truncated).toBe(true);
    expect(out.text.startsWith("HEAD")).toBe(true);
    expect(out.text.endsWith("Totals: 160 units")).toBe(true);
  });
});
