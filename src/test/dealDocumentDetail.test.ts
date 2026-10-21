import { describe, it, expect } from "vitest";
import {
  DETAIL_SCHEMAS,
  chunkDocumentText,
  isoDate,
  mergeRentRollParts,
  normalizeDetail,
  summarizeDetail,
  summarizeRentRoll,
  summarizeT12,
} from "../../supabase/functions/_shared/dealDocumentDetail";

const NOW = new Date("2026-10-21T12:00:00Z");

/** Six units, worked by hand: 4 occupied (one on notice), 1 pre-leased, 1 vacant. */
const RENT_ROLL = normalizeDetail({
  rent_roll: {
    as_of_iso: "2026-06-23",
    units: [
      { u: "101", t: "A1", bd: 1, sf: 650, st: "occupied", mr: 1200, lr: 1100, le: "2026-07-31", bal: 0 },
      { u: "102", t: "A1", bd: 1, sf: 650, st: "notice", mr: 1200, lr: 1000, le: "2026-06-30", bal: 250 },
      { u: "103", t: "B1", bd: 2, sf: 900, st: "occupied", mr: 1500, lr: 1500, le: "2027-03-15", bal: -40 },
      { u: "104", t: "B1", bd: 2, sf: 900, st: "occupied", mr: 1500, lr: 1350, le: "2026-05-31", bal: 600 },
      { u: "105", t: "B1", bd: 2, sf: 900, st: "vacant_leased", mr: 1500, lr: 0, le: "", bal: -1 },
      { u: "106", t: "S", bd: 0, sf: 450, st: "vacant", mr: 950, lr: 0, le: "", bal: -1 },
    ],
    charge_codes: [
      { code: "rent", monthly_total: 4950 },
      { code: "petfee", monthly_total: 50 },
      { code: "parking", monthly_total: 100 },
    ],
  },
});

describe("schemas", () => {
  it("have no union-typed parameters at all", () => {
    for (const s of Object.values(DETAIL_SCHEMAS)) expect(JSON.stringify(s)).not.toMatch(/"anyOf"|"type":\[/);
  });
  it("each fill exactly their own section, in the shape normalizeDetail reads", () => {
    for (const [type, s] of Object.entries(DETAIL_SCHEMAS)) expect(s.required).toEqual([type]);
  });
});

describe("isoDate", () => {
  it.each([
    ["2026-07-31", "2026-07-31"],
    ["2026-02-31", null], // Date.parse would roll this into March
    ["7/31/26", null],
    ["", null],
    ["2026-7-31", null],
  ])("%s -> %s", (input, out) => expect(isoDate(input)).toBe(out));
});

describe("normalizeDetail", () => {
  it("turns -1 and empty strings into null", () => {
    const u = RENT_ROLL.rent_roll.units[4];
    expect(u.lease_end).toBeNull();
    expect(u.balance).toBeNull();
  });
  it("tolerates a missing detail entirely", () => {
    const d = normalizeDetail(undefined);
    expect(d.rent_roll.units).toEqual([]);
    expect(d.t12.lines).toEqual([]);
  });
});

describe("summarizeRentRoll", () => {
  const s = summarizeRentRoll(RENT_ROLL.rent_roll, NOW)!;

  it("counts statuses and occupancy", () => {
    expect([s.units, s.occupied, s.notice, s.vacant_leased, s.vacant]).toEqual([6, 3, 1, 1, 1]);
    expect(s.physical_occupancy_pct).toBe(66.7); // 4 of 6
    expect(s.leased_pct).toBe(66.7); // 3 occupied (no notice) + 1 pre-leased
  });
  it("averages lease rent over occupied units only", () => {
    expect(s.avg_lease_rent).toBe(1238); // (1100 + 1000 + 1500 + 1350) / 4
  });
  it("computes loss to lease on occupied units", () => {
    // market 5400, lease 4950 -> 8.3%
    expect(s.loss_to_lease_pct).toBe(8.3);
  });
  it("builds the unit mix by bedrooms, studio first", () => {
    expect(s.unit_mix.map((r) => [r.beds, r.units, r.occupied])).toEqual([
      [0, 1, 0],
      [1, 2, 2],
      [2, 3, 2],
    ]);
    expect(s.unit_mix[1].avg_lease_rent).toBe(1050);
  });
  it("buckets expirations from the rent roll date, not today", () => {
    expect(s.expirations[0]).toEqual({ month: "2026-06", count: 1 });
    expect(s.expirations[1]).toEqual({ month: "2026-07", count: 1 });
    expect(s.expirations.find((e) => e.month === "2027-03")?.count).toBe(1);
    expect(s.expired_or_mtm).toBe(1); // 104 ended 2026-05-31
  });
  it("sums delinquency on occupied units only, ignoring prepaids", () => {
    expect(s.delinquent_units).toBe(2);
    expect(s.delinquent_total).toBe(850);
  });
  it("lists other income without the base rent code", () => {
    expect(s.other_income_monthly.map((c) => c.code)).toEqual(["petfee", "parking"]);
  });
  it("totals sqft only when every unit has one", () => {
    expect(s.total_sqft).toBe(4450);
  });
});

const T12 = normalizeDetail({
  t12: {
    months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    lines: [
      { label: "POTENTIAL RENT", cat: "gross_potential_rent", m: Array(12).fill(100), total: 1200 },
      { label: "VACANCY", cat: "vacancy_loss", m: Array(12).fill(-10), total: -120 },
      { label: "TOTAL REVENUE", cat: "total_income", m: [...Array(9).fill(90), 120, 120, 120], total: 1170 },
      { label: "TOTAL PAYROLL", cat: "payroll", m: Array(12).fill(20), total: 240 },
      { label: "Electric", cat: "utilities", m: Array(12).fill(5), total: -1 },
      { label: "Water", cat: "utilities", m: Array(12).fill(5), total: -1 },
      { label: "TOTAL OPERATING EXPENSES", cat: "total_expenses", m: Array(12).fill(30), total: 360 },
      { label: "NET OPERATING INCOME", cat: "noi", m: [...Array(9).fill(60), 90, 90, 90], total: 810 },
      { label: "Capital Replacements", cat: "below_noi", m: Array(12).fill(7), total: 84 },
    ],
  },
});

describe("summarizeT12", () => {
  const s = summarizeT12(T12.t12)!;
  const cat = (c: string) => s.categories.find((r) => r.category === c)!;

  it("sums detail lines into a category when there is no subtotal", () => {
    expect(cat("utilities").annual).toBe(120);
    expect(cat("utilities").lines).toEqual(["Electric", "Water"]);
  });
  it("annualizes the last three months as the run rate", () => {
    expect(s.t3_noi).toBe(1080); // 90 x 3 x 4, vs 810 trailing twelve
    expect(s.noi).toBe(810);
  });
  it("keeps below-NOI lines out of the totals", () => {
    expect(s.total_expenses).toBe(360);
    expect(cat("below_noi").annual).toBe(84);
  });
  it("names the period", () => expect(s.period).toBe("Jan – Dec"));
});

describe("summarizeDetail checks", () => {
  it("is quiet when the transcription matches the document", () => {
    const s = summarizeDetail(RENT_ROLL, { unit_count: 6, occupied_units: 4, noi: null, opex: null }, NOW);
    expect(s.checks).toEqual([]);
  });
  it("flags units dropped from the transcription", () => {
    const s = summarizeDetail(RENT_ROLL, { unit_count: 160, occupied_units: 150, noi: null, opex: null }, NOW);
    expect(s.checks.join(" ")).toMatch(/lists 6 units but states 160/);
    expect(s.checks.join(" ")).toMatch(/summary states 150/);
  });
  it("flags unit rents that disagree with the charge summary", () => {
    const off = normalizeDetail({
      rent_roll: {
        as_of_iso: "",
        units: [{ u: "1", t: "", bd: 1, sf: -1, st: "occupied", mr: 1500, lr: 1200, le: "", bal: -1 }],
        charge_codes: [{ code: "rent", monthly_total: 1500 }],
      },
    });
    expect(summarizeDetail(off, { unit_count: null, occupied_units: null, noi: null, opex: null }, NOW).checks[0])
      .toMatch(/\$1,200 a month; the charge summary says \$1,500/);
  });
  it("flags expense categories that do not add up to total opex", () => {
    // payroll 240 + utilities 120 = 360: agrees. Drop payroll and it should not.
    const partial = { ...T12, t12: { ...T12.t12, lines: T12.t12.lines.filter((l) => l.category !== "payroll") } };
    const s = summarizeDetail(partial, { unit_count: null, occupied_units: null, noi: 810, opex: 360 }, NOW);
    expect(s.checks.join(" ")).toMatch(/Expense categories add up to \$120; total operating expenses are \$360/);
  });
  it("flags a line whose months do not sum to its total", () => {
    const bad = normalizeDetail({
      t12: { months: Array(12).fill("m"), lines: [{ label: "TOTAL PAYROLL", cat: "payroll", m: Array(12).fill(20), total: 300 }] },
    });
    expect(summarizeDetail(bad, { unit_count: null, occupied_units: null, noi: null, opex: null }, NOW).checks[0])
      .toMatch(/"TOTAL PAYROLL": the months add up to \$240, not the stated \$300/);
  });
});

describe("chunkDocumentText", () => {
  const sheet = (name: string, rows: number) =>
    [`=== Sheet: ${name} ===`, "Unit,Type,Rent", ...Array.from({ length: rows }, (_, i) => `${100 + i},A1,1200`)].join("\n");

  it("leaves a short document whole", () => {
    expect(chunkDocumentText("short", 100)).toEqual(["short"]);
  });
  it("cuts a long sheet, repeats its header and loses no row", () => {
    const text = sheet("Rent Roll", 400);
    const pieces = chunkDocumentText(text, 2000);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces.slice(1)) expect(p).toContain("Unit,Type,Rent");
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(2000);
    for (let i = 0; i < 400; i++) expect(pieces.some((p) => p.includes(`\n${100 + i},A1,1200`))).toBe(true);
  });
  it("overlaps consecutive pieces so a unit split across the cut is whole somewhere", () => {
    const pieces = chunkDocumentText(sheet("Rent Roll", 400), 2000);
    const lastRow = pieces[0].trim().split("\n").pop()!;
    expect(pieces[1]).toContain(lastRow);
  });
  it("packs short sheets together", () => {
    const text = [sheet("A", 5), sheet("B", 5), sheet("C", 200)].join("\n");
    const pieces = chunkDocumentText(text, 2000);
    expect(pieces[0]).toContain("=== Sheet: A ===");
    expect(pieces[0]).toContain("=== Sheet: B ===");
  });
});

describe("mergeRentRollParts", () => {
  const part = (units: Array<[string, number | null]>, codes: Array<[string, number]> = []) =>
    normalizeDetail({
      rent_roll: {
        as_of_iso: "",
        units: units.map(([u, lr]) => ({ u, t: "A1", bd: 1, sf: lr === null ? -1 : 700, st: "occupied", mr: 1300, lr: lr ?? -1, le: "", bal: -1 })),
        charge_codes: codes.map(([code, monthly_total]) => ({ code, monthly_total })),
      },
    }).rent_roll;

  it("keeps one copy of a unit listed on two sheets, in first-seen order", () => {
    const m = mergeRentRollParts([part([["101", 1200], ["102", 1250]]), part([["101", 1200], ["103", 1100]])]);
    expect(m.units.map((u) => u.unit)).toEqual(["101", "102", "103"]);
  });
  it("prefers the more complete reading of a unit cut across pieces", () => {
    const m = mergeRentRollParts([part([["104", null]]), part([["104", 1275]])]);
    expect(m.units).toHaveLength(1);
    expect(m.units[0].lease_rent).toBe(1275);
  });
  it("matches unit numbers regardless of case and spacing", () => {
    expect(mergeRentRollParts([part([["2-104a", 1]]), part([[" 2-104A ", 1]])]).units).toHaveLength(1);
  });
  it("takes each charge code once", () => {
    const m = mergeRentRollParts([part([], [["rent", 5000]]), part([], [["rent", 5000], ["petfee", 50]])]);
    expect(m.charge_codes.map((c) => c.code)).toEqual(["rent", "petfee"]);
  });
});
