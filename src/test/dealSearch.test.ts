import { describe, expect, it } from "vitest";
import { searchDealsByName } from "@/lib/dealSearch";

const d = (property_name: string | null) => ({ property_name });
const names = (rows: { property_name: string | null }[]) => rows.map((r) => r.property_name);

describe("searchDealsByName", () => {
  it("returns nothing for an empty or whitespace query", () => {
    expect(searchDealsByName([d("Oak Ridge")], "")).toEqual([]);
    expect(searchDealsByName([d("Oak Ridge")], "   ")).toEqual([]);
  });

  it("ignores case, accents and repeated spaces", () => {
    expect(names(searchDealsByName([d("Café  Lofts")], "cafe lofts"))).toEqual(["Café  Lofts"]);
    expect(names(searchDealsByName([d("The Reserve")], "THE   reserve"))).toEqual(["The Reserve"]);
  });

  it("ranks exact, then prefix, then word-start, then substring", () => {
    const rows = [d("Parkside Oaks"), d("The Oaks at Park"), d("Oakwood"), d("Oak")];
    expect(names(searchDealsByName(rows, "oak"))).toEqual([
      "Oak", "Oakwood", "Parkside Oaks", "The Oaks at Park",
    ]);
  });

  it("keeps the caller's order within a rank", () => {
    const rows = [d("Elm Court"), d("Elm Gardens")];
    expect(names(searchDealsByName(rows, "elm"))).toEqual(["Elm Court", "Elm Gardens"]);
  });

  it("skips unnamed deals and honours the limit", () => {
    const rows = [d(null), d("A1"), d("A2"), d("A3")];
    expect(names(searchDealsByName(rows, "a", 2))).toEqual(["A1", "A2"]);
  });
});
