import { describe, it, expect } from "vitest";
import {
  selectWritableFields,
  FILL_IF_NULL_KEYS,
} from "../../supabase/functions/_shared/hellodataMapping";

// A loaded deal row comes from select("*"), so every real column is a key even
// when its value is null. Keys absent here are not columns.
const row = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  msa: null,
  vintage_year: null,
  management_company: null,
  median_income_tract: null,
  ...over,
});

describe("selectWritableFields", () => {
  it("drops keys that are not columns on the deal row", () => {
    // Regression: the mapper emits street_address_raw for hellodata-detail's
    // New Deal form, but it is not a column on public.deals. Including it makes
    // PostgREST reject the whole update, so every enrichment silently 400s.
    const out = selectWritableFields(
      { msa: "Chicago", street_address_raw: "123 Main St" },
      row(),
    );
    expect(out).toEqual({ msa: "Chicago" });
    expect("street_address_raw" in out).toBe(false);
  });

  it("strips nulls so a blank never overwrites an existing value", () => {
    const out = selectWritableFields(
      { msa: null, median_income_tract: 55000 },
      row({ msa: "Existing MSA" }),
    );
    expect(out).toEqual({ median_income_tract: 55000 });
  });

  it("fills a fill-if-null key when the deal has no value", () => {
    const out = selectWritableFields({ management_company: "Real Mgmt" }, row());
    expect(out).toEqual({ management_company: "Real Mgmt" });
  });

  it("does not clobber a fill-if-null key that already has a value", () => {
    // A HelloData mismatch wrote "Extended Stay America" over a hand-entered
    // manager; the prior value was recoverable from nowhere.
    const out = selectWritableFields(
      { management_company: "Extended Stay America" },
      row({ management_company: "Ardent" }),
    );
    expect(out).toEqual({});
  });

  it("overwrites non-protected keys freely", () => {
    const out = selectWritableFields(
      { median_income_tract: 61000 },
      row({ median_income_tract: 42000 }),
    );
    expect(out).toEqual({ median_income_tract: 61000 });
  });

  it("protects management_company alongside the intake keys", () => {
    expect(FILL_IF_NULL_KEYS.has("management_company")).toBe(true);
    expect(FILL_IF_NULL_KEYS.has("vintage_year")).toBe(true);
    expect(FILL_IF_NULL_KEYS.has("median_income_tract")).toBe(false);
  });
});
