import { describe, it, expect } from "vitest";
import { addressFromDocument, type AddressDoc } from "../../supabase/functions/_shared/documentAddress.ts";

const TWIN = { property_name: "Twin Towers", address: null, property_address: null, state: "IL", zip: null, unit_count: 253 };
const doc = (over: Partial<AddressDoc> = {}): AddressDoc => ({
  property_name: "Twin Towers",
  property_address: "1649 E. 50th Street, Chicago, IL 60615",
  unit_count: 253,
  ...over,
});

describe("addressFromDocument", () => {
  it("takes the street and ZIP from a document for the same property", () => {
    expect(addressFromDocument(doc(), TWIN)).toEqual({ ok: true, address: "1649 E. 50th Street", zip: "60615" });
  });
  it("replaces a value no lookup can use", () => {
    expect(addressFromDocument(doc(), { ...TWIN, address: "Michigan Avenue" }).ok).toBe(true);
  });
  it("never replaces a real street", () => {
    expect(addressFromDocument(doc(), { ...TWIN, address: "10 Other St" }).ok).toBe(false);
  });
  it("refuses a document for another property", () => {
    expect(addressFromDocument(doc({ property_name: "Lakeview Commons" }), TWIN).ok).toBe(false);
  });
  it("refuses an unnamed document", () => {
    expect(addressFromDocument(doc({ property_name: null }), TWIN).ok).toBe(false);
  });
  it("refuses another state", () => {
    expect(addressFromDocument(doc({ property_address: "1649 E. 50th Street, Gary, IN 46401" }), TWIN).ok).toBe(false);
  });
  it("refuses a unit count that disagrees", () => {
    expect(addressFromDocument(doc({ unit_count: 120 }), TWIN).ok).toBe(false);
  });
  it("refuses a city-only address", () => {
    expect(addressFromDocument(doc({ property_address: "Chicago, IL 60615" }), TWIN).ok).toBe(false);
  });
  it("keeps the deal's ZIP when it has one", () => {
    expect(addressFromDocument(doc(), { ...TWIN, zip: "60615" })).toEqual({ ok: true, address: "1649 E. 50th Street", zip: null });
  });
});
