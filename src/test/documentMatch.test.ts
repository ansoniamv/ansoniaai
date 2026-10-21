import { describe, it, expect } from "vitest";
import {
  addressParts,
  blocksApply,
  checkDocumentAgainstDeal,
  latestMonthIn,
  type DocumentForCheck,
} from "@/lib/documentMatch";

const NOW = new Date("2026-10-21T12:00:00Z");
const ym = (y: number, m: number) => y * 12 + (m - 1);

const FOUNDRY = {
  property_name: "Foundry Townhomes",
  unit_count: 120,
  property_address: "630 Fairview Road, Simpsonville, SC, 29680",
  city: "Simpsonville",
  state: "SC",
};

const doc = (over: Partial<DocumentForCheck>): DocumentForCheck => ({
  doc_type: "rent_roll",
  doc_property_name: "Foundry Townhomes",
  doc_as_of: null,
  doc_unit_count: null,
  doc_address: null,
  summary: null,
  ...over,
});

const kinds = (d: DocumentForCheck, deal = FOUNDRY) => checkDocumentAgainstDeal(d, deal, NOW).map((i) => i.kind);

describe("checkDocumentAgainstDeal", () => {
  it("holds the 2021 'The Foundry' rent roll uploaded to Foundry Townhomes", () => {
    // As stored in production: the names pass, the units and the date do not.
    const issues = checkDocumentAgainstDeal(
      doc({ doc_property_name: "The Foundry", doc_as_of: "March 17, 2021", doc_unit_count: 167 }),
      FOUNDRY,
      NOW,
    );
    expect(issues.map((i) => i.kind).sort()).toEqual(["stale", "units"]);
    expect(blocksApply(issues)).toBe(true);
    expect(issues.find((i) => i.kind === "units")!.message).toBe("It lists 167 units; this deal has 120.");
    expect(issues.find((i) => i.kind === "stale")!.message).toBe("It is dated 5 years ago.");
  });

  it("passes the matching OM and T12", () => {
    expect(
      kinds(doc({ doc_type: "om", doc_as_of: "09/16/2026 rent roll", doc_unit_count: 120, doc_address: "630 Fairview Road, Simpsonville, SC 29680" })),
    ).toEqual([]);
    expect(kinds(doc({ doc_type: "t12", doc_property_name: "Foundry Townhomes (630 Fairview)", doc_as_of: "Oct 2025-Sep 2026" }))).toEqual([]);
  });

  it("falls back to the rent roll's own unit total when the figure was not stated", () => {
    const summary = { rent_roll: { units: 167, as_of: "2026-09-01" } } as unknown as DocumentForCheck["summary"];
    expect(kinds(doc({ summary }))).toEqual(["units"]);
  });

  it("tolerates a few units of difference (down units, a model)", () => {
    expect(kinds(doc({ doc_unit_count: 123 }))).toEqual([]);
    expect(kinds(doc({ doc_unit_count: 126 }))).toEqual([]);
    expect(kinds(doc({ doc_unit_count: 127 }))).toEqual(["units"]);
  });

  it("says nothing about units when the deal has none yet", () => {
    expect(kinds(doc({ doc_unit_count: 167 }), { ...FOUNDRY, unit_count: null as unknown as number })).toEqual([]);
  });

  it("holds a document from another state or ZIP", () => {
    expect(kinds(doc({ doc_address: "630 Fairview Road, Greenville, NC 27834" }))).toEqual(["location"]);
    expect(kinds(doc({ doc_address: "630 Fairview Road, Simpsonville, SC 29681" }))).toEqual(["location"]);
  });

  it("only warns on a different street, since a property can front two", () => {
    const issues = checkDocumentAgainstDeal(doc({ doc_address: "12 Harrison Bridge Rd, Simpsonville, SC" }), FOUNDRY, NOW);
    expect(issues.map((i) => [i.kind, i.severity])).toEqual([["street", "warn"]]);
    expect(kinds(doc({ doc_address: "632 Fairview Rd" }))).toEqual([]);
  });

  it("reads the address out of OM facts for documents parsed before property_address existed", () => {
    const summary = { om: { facts: [{ label: "address", value: "1 Main St, Austin, TX 78701", page: 2 }] } } as unknown as DocumentForCheck["summary"];
    expect(kinds(doc({ doc_type: "om", summary }))).toEqual(["location"]);
  });

  it("warns, never holds, on a different name", () => {
    const issues = checkDocumentAgainstDeal(doc({ doc_property_name: "Sugar Run" }), FOUNDRY, NOW);
    expect(issues.map((i) => [i.kind, i.severity])).toEqual([["name", "warn"]]);
  });

  it("flags age by document type", () => {
    expect(kinds(doc({ doc_as_of: "2026-04-30" }))).toEqual([]); // rent roll, 6 months
    expect(kinds(doc({ doc_as_of: "2026-03-31" }))).toEqual(["stale"]);
    expect(kinds(doc({ doc_type: "t12", doc_as_of: "Nov 2024 - Oct 2025" }))).toEqual([]);
    expect(kinds(doc({ doc_type: "t12", doc_as_of: "Sep 2024 - Aug 2025" }))).toEqual(["stale"]);
    expect(kinds(doc({ doc_type: "other", doc_as_of: "2019" }))).toEqual([]);
  });

  it("raises nothing for a date it cannot read", () => {
    expect(kinds(doc({ doc_as_of: "current" }))).toEqual([]);
  });
});

describe("latestMonthIn", () => {
  it.each([
    ["March 17, 2021", ym(2021, 3)],
    ["09/16/2026 rent roll", ym(2026, 9)],
    ["Oct 2025-Sep 2026", ym(2026, 9)],
    ["Jun-25 – May-26", ym(2026, 5)],
    ["T12 ending 8/2026", ym(2026, 8)],
    ["2021-03-17", ym(2021, 3)],
    ["Sept. 30, 2025", ym(2025, 9)],
    ["FY 2024", ym(2024, 12)],
  ])("%s", (text, want) => {
    expect(latestMonthIn(text)).toBe(want);
  });

  it("does not read a word that starts like a month as one", () => {
    expect(latestMonthIn("Market 2021")).toBe(ym(2021, 12));
    expect(latestMonthIn("Decatur Station")).toBeNull();
  });

  it("is null for nothing it recognises", () => {
    expect(latestMonthIn("as of today")).toBeNull();
    expect(latestMonthIn(null)).toBeNull();
  });
});

describe("addressParts", () => {
  it("reads number, street, state and ZIP", () => {
    expect(addressParts("1255 South Michigan Avenue, Chicago, IL, 60605")).toEqual({
      number: "1255", street: "michigan", state: "IL", zip: "60605",
    });
  });
  it("does not read a street suffix as a state", () => {
    expect(addressParts("40 Fairview Ct").state).toBeNull();
    expect(addressParts("40 Fairview Ct, Hartford, CT").state).toBe("CT");
  });
});
