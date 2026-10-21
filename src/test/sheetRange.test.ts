import { describe, expect, it } from "vitest";
import { dataExtent, trimToData } from "../../supabase/functions/_shared/sheetRange";

describe("dataExtent", () => {
  it("measures the cells that hold values, from A1", () => {
    expect(dataExtent({ "!ref": "A1:XFD1048576", C5: { v: 1 }, B9: { v: "x" }, "!merges": [] })).toBe("A1:C9");
  });

  it("ignores styled cells with no value", () => {
    expect(dataExtent({ "!ref": "A1:ZZ500", A1: { v: "Unit" }, Z400: { t: "z" }, AA500: { v: "" } })).toBe("A1:A1");
  });

  it("encodes multi-letter columns", () => {
    expect(dataExtent({ AZ2: { v: 1 } })).toBe("A1:AZ2");
    expect(dataExtent({ ZZ3: { v: 1 } })).toBe("A1:ZZ3");
    expect(dataExtent({ AAA1: { v: 0 } })).toBe("A1:AAA1");
  });

  it("is null for a sheet with no values", () => {
    expect(dataExtent({ "!ref": "A1:B2" })).toBeNull();
  });
});

describe("trimToData", () => {
  it("rewrites the declared range in place, and reports an empty sheet", () => {
    const sheet: Record<string, unknown> = { "!ref": "A1:ZZ50000", B3: { v: 1200 } };
    expect(trimToData(sheet)).toBe(true);
    expect(sheet["!ref"]).toBe("A1:B3");
    expect(trimToData({ "!ref": "A1:Z9" })).toBe(false);
  });
});
