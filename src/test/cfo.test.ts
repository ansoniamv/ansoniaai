import { describe, expect, it } from "vitest";
import { cfoToInput, parseCfoInput } from "@/lib/cfo";

const today = new Date(2026, 9, 2); // Oct 2, 2026

describe("parseCfoInput", () => {
  it("treats empty input as clearing both fields", () => {
    expect(parseCfoInput("   ", today)).toEqual({ cfo_date: null, cfo_note: null });
  });

  it("parses US dates with 2- and 4-digit years", () => {
    expect(parseCfoInput("10/15/26", today)).toEqual({ cfo_date: "2026-10-15", cfo_note: null });
    expect(parseCfoInput("1/5/2027", today)).toEqual({ cfo_date: "2027-01-05", cfo_note: null });
  });

  it("parses ISO dates", () => {
    expect(parseCfoInput("2026-10-21", today)).toEqual({ cfo_date: "2026-10-21", cfo_note: null });
  });

  it("fills in the year, rolling forward when the date is long past", () => {
    expect(parseCfoInput("10/15", today).cfo_date).toBe("2026-10-15");
    expect(parseCfoInput("9/20", today).cfo_date).toBe("2026-09-20");
    expect(parseCfoInput("1/10", today).cfo_date).toBe("2027-01-10");
  });

  it("keeps text after a date as the note", () => {
    expect(parseCfoInput("10/15/26 - tentative", today)).toEqual({
      cfo_date: "2026-10-15",
      cfo_note: "tentative",
    });
  });

  it("stores anything that isn't a date as a note", () => {
    expect(parseCfoInput("Off Market", today)).toEqual({ cfo_date: null, cfo_note: "Off Market" });
    expect(parseCfoInput("TBD - broker to advise", today).cfo_date).toBeNull();
  });

  it("rejects impossible dates instead of storing a wrong one", () => {
    expect(parseCfoInput("2/30/26", today)).toEqual({ cfo_date: null, cfo_note: "2/30/26" });
    expect(parseCfoInput("13/1/26", today).cfo_date).toBeNull();
    expect(parseCfoInput("10/15/2", today).cfo_date).toBeNull();
  });

  it("round-trips through cfoToInput", () => {
    for (const v of [
      { cfo_date: "2026-10-15", cfo_note: null },
      { cfo_date: null, cfo_note: "Off Market" },
      { cfo_date: "2026-11-03", cfo_note: "tentative" },
    ]) {
      expect(parseCfoInput(cfoToInput(v), today)).toEqual(v);
    }
  });
});
