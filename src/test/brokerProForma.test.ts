import { describe, expect, it } from "vitest";
import { brokerProForma, firstDollars, type OmMetric, type OmLine, type ProFormaSource } from "@/lib/brokerProForma";

const pf = (label: string, value: string, page = 26): OmMetric => ({ label, value, page, basis: "pro_forma" });
const fact = (label: string, value: string, page = 8): OmLine => ({ label, value, page });
const om = (metrics: OmMetric[], facts: OmLine[] = [], extra: Partial<ProFormaSource> = {}): ProFormaSource => ({
  id: "om1",
  file_name: "OM.pdf",
  storage_path: "deal/om.pdf",
  doc_type: "om",
  parse_status: "parsed",
  doc_as_of: "2026-09-20",
  created_at: "2026-11-11T00:00:00Z",
  summary: { om: { facts, metrics } },
  ...extra,
});

describe("firstDollars", () => {
  it("reads the first dollar amount, with parentheses or a minus as negative", () => {
    expect(firstDollars("$1,619,439 ($134,953/mo, $8,435/unit)")).toBe(1619439);
    expect(firstDollars("($156,402) / -5.0%")).toBe(-156402);
    expect(firstDollars("Blended $8,274 per unit")).toBe(8274);
    expect(firstDollars("-$46,571")).toBe(-46571);
  });
  it("is null when there is no dollar amount", () => {
    expect(firstDollars("5.0%")).toBeNull();
    expect(firstDollars("-1")).toBeNull();
    expect(firstDollars("")).toBeNull();
  });
});

describe("brokerProForma", () => {
  it("picks LYV Durham's headline figures (CBRE layout)", () => {
    const r = brokerProForma([
      om(
        [
          pf("Est. ROIC on Renovation", "14%", 8),
          pf("Pro Forma Gross Potential Rent", "$3,128,034 ($260,670/mo, $16,292/unit)"),
          pf("Pro Forma Vacancy Loss", "($156,402) / -5.0%"),
          pf("Pro Forma Total Income", "$3,254,253 ($271,188/mo, $16,949/unit)"),
          pf("Pro Forma Controllable Expenses", "$1,046,478 ($5,450/unit, 32.2% of income)"),
          pf("Pro Forma Total Operating Expenses", "$1,577,214 ($8,215/unit, 48.5% of income)"),
          pf("Pro Forma Total Expenses", "$1,634,814 ($8,515/unit, 50.2% of income)"),
          pf("Pro Forma Net Operating Income", "$1,619,439 ($134,953/mo, $8,435/unit)"),
          pf("Cap Rate (Pro Forma)", "-1"),
        ],
        [fact("Est. Renovation Cost Per Unit", "$15,000"), fact("Est. Monthly Rent Premium (Renovation)", "$175")],
      ),
    ])!;
    expect(r.noi?.amount).toBe(1619439);
    expect(r.egi?.amount).toBe(3254253);
    expect(r.expenses?.amount).toBe(1577214); // before reserves
    expect(r.gpr?.amount).toBe(3128034);
    expect(r.renoCost?.amount).toBe(15000);
    expect(r.renoPremium?.amount).toBe(175);
    expect(r.lines).toHaveLength(9);
  });

  it("prefers the pro forma NOI over a cash-flow year and skips later years and per-unit lines (Berkadia)", () => {
    const r = brokerProForma([
      om(
        [
          pf("Pro Forma NOI (Year 1, after reserves)", "$4,126,663", 49),
          pf("Cash Flow Year 1 NOI", "$4,206,563", 49),
          pf("Cash Flow Year 2 NOI", "$4,360,628", 49),
          pf("NOI Per Unit (Pro Forma)", "$15,872 per unit", 55),
          pf("Total Revenue (EGI) Pro Forma", "$7,196,778, $27,680 per unit, $27.93 PSF", 53),
          pf("Total Other Income Pro Forma", "$448,434", 53),
          pf("Total Controllable Operating Expenses (Pro Forma)", "$1,179,153, $4,535 per unit", 59),
          pf("Total Expenses (Pro Forma)", "$3,018,115 (before reserves), $11,608 per unit", 59),
        ],
        [
          fact("Unit Renovation Cost (Value-Add Example)", "Blended $8,274 per unit"),
          fact("Unit Renovation Premium Achieved (Example)", "$114 per unit per month blended premium"),
        ],
      ),
    ])!;
    expect(r.noi).toMatchObject({ amount: 4126663, label: "Pro Forma NOI (Year 1, after reserves)", page: 49 });
    expect(r.egi?.amount).toBe(7196778);
    expect(r.expenses?.amount).toBe(3018115);
    expect(r.gpr).toBeNull();
    expect(r.renoCost?.amount).toBe(8274);
    expect(r.renoPremium?.amount).toBe(114);
  });

  it("takes a monthly premium, not an annual total or a cost, and prefers the weighted one", () => {
    const r = brokerProForma([
      om(
        [
          pf("Year 1 Pro Forma Net Operating Income", "$10,253,918 ($20,426/unit)", 63),
          pf("Year 1 Pro Forma NOI After Reserves", "$10,103,318", 63),
          pf("Year 2 NOI", "$10,666,154", 68),
          pf("Proforma Value-Add Premium (additional)", "$43,583"),
          pf("Renovation Premium Year 1 BR Avg", "$175/unit/month, $10,000 avg cost, 21% ROC"),
          pf("Renovation Weighted Avg Premium", "$197/unit/month, $11,325 avg cost, 21% ROC"),
        ],
        [fact("Renovated Units and Premium", "163 units, avg cost $11,325/unit, avg premium $197/unit/month")],
      ),
    ])!;
    expect(r.noi?.amount).toBe(10253918);
    expect(r.renoPremium).toMatchObject({ amount: 197, label: "Renovation Weighted Avg Premium" });
  });

  it("uses the newest parsed OM that has pro forma lines, and is null without one", () => {
    const older = om([pf("Pro Forma Net Operating Income", "$1,000,000")], [], {
      id: "old",
      doc_as_of: "2026-01-01",
    });
    const newer = om([pf("Pro Forma Net Operating Income", "$2,000,000")], [], { id: "new" });
    const noPf = om([{ label: "Physical Occupancy", value: "83%", page: 5, basis: "in_place" }], [], {
      id: "nopf",
      doc_as_of: "2026-12-01",
    });
    expect(brokerProForma([older, newer, noPf])?.document.id).toBe("new");
    expect(brokerProForma([noPf])).toBeNull();
    expect(brokerProForma([{ ...newer, parse_status: "parsing" }])).toBeNull();
    expect(brokerProForma([{ ...newer, doc_type: "t12" }])).toBeNull();
  });
});
