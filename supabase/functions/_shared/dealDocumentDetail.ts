/**
 * The full read of a deal document: rent roll units, T12 lines, OM facts — and
 * the arithmetic on top of them.
 *
 * The split is deliberate. The model TRANSCRIBES: one row per unit, one line per
 * statement line with its monthly values, OM facts as stated. Code COMPUTES:
 * unit mix, loss-to-lease, expirations, delinquency, category totals, T3. A
 * model copies a table reliably and adds it up unreliably — on the Summerlin
 * rent roll it divided the market-rent total by occupied units and called it
 * in-place rent. Every computed number here can be checked against its rows,
 * and the totals are checked against what the document itself states.
 *
 * Schema conventions (structured outputs refuse >16 union-typed parameters, so
 * there are no nullables): a number that is not stated is -1, a string that is
 * not stated is "". normalizeDetail turns both into null before anything reads
 * them.
 */

// ---------- schema ----------

export const UNIT_STATUSES = ["occupied", "notice", "vacant_leased", "vacant", "down", "other"] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export const T12_CATEGORIES = [
  "gross_potential_rent",
  "loss_to_lease",
  "vacancy_loss",
  "concessions",
  "bad_debt",
  "non_revenue_units",
  "other_income",
  "total_income",
  "taxes",
  "insurance",
  "payroll",
  "repairs_maintenance",
  "turnover",
  "contract_services",
  "utilities",
  "management_fee",
  "admin_marketing",
  "other_expense",
  "total_expenses",
  "noi",
  "below_noi",
] as const;
export type T12Category = (typeof T12_CATEGORIES)[number];

export const INCOME_CATEGORIES: T12Category[] = [
  "gross_potential_rent", "loss_to_lease", "vacancy_loss", "concessions", "bad_debt", "non_revenue_units", "other_income",
];
export const EXPENSE_CATEGORIES: T12Category[] = [
  "taxes", "insurance", "payroll", "repairs_maintenance", "turnover", "contract_services", "utilities",
  "management_fee", "admin_marketing", "other_expense",
];

const OM_BASES = ["in_place", "pro_forma", "other"] as const;
export type OmBasis = (typeof OM_BASES)[number];

const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const num = { type: "number" };
const str = { type: "string" };

/**
 * One schema per document type, each its own call after the figures call has
 * classified the document. A single schema holding the figures and all three
 * sections was refused outright ("The compiled grammar is too large"), so the
 * sections must never be recombined.
 *
 * Short keys on the per-unit rows: a 400-unit rent roll is 400 of these, and
 * keys are tokens.
 */
export const DETAIL_SCHEMAS = {
  rent_roll: obj({ rent_roll: obj({
    as_of_iso: str,
    units: {
      type: "array",
      items: obj({
        u: str, // unit number
        t: str, // unit type / floor plan code
        bd: num, // bedrooms, 0 = studio, -1 unknown
        sf: num,
        st: { type: "string", enum: [...UNIT_STATUSES] },
        mr: num, // market rent / month
        lr: num, // base lease rent / month (0 for vacant)
        le: str, // lease end, YYYY-MM-DD
        bal: num, // resident balance (positive = owed)
      }),
    },
    charge_codes: { type: "array", items: obj({ code: str, monthly_total: num }) },
  }) }),
  t12: obj({ t12: obj({
    months: { type: "array", items: str },
    lines: {
      type: "array",
      items: obj({
        label: str,
        cat: { type: "string", enum: [...T12_CATEGORIES] },
        m: { type: "array", items: num },
        total: num,
      }),
    },
  }) }),
  om: obj({ om: obj({
    facts: { type: "array", items: obj({ k: str, v: str, p: num }) },
    metrics: { type: "array", items: obj({ k: str, v: str, basis: { type: "string", enum: [...OM_BASES] }, p: num }) },
    amenities: { type: "array", items: str },
  }) }),
} as const;

export type DetailDocType = keyof typeof DETAIL_SCHEMAS;
export const hasDetail = (t: string): t is DetailDocType => t in DETAIL_SCHEMAS;

const DETAIL_PREAMBLE = `You transcribe commercial real estate deal documents for a multifamily investor into structured data. Transcribe exactly what the document shows; do not compute totals or averages. Unknown numbers are -1, unknown strings "".`;

const RENT_ROLL_INSTRUCTIONS = `This document is a rent roll. Fill rent_roll:
- as_of_iso: the rent roll date as YYYY-MM-DD, or "".
- units: EVERY unit in the text you are given, one entry each, in document order. If the same units are listed again (a second sheet or a summary repeating them), list each unit once. u = unit number, including the building when the document numbers units per building (e.g. "2-104"); t = unit type / floor plan code as written; bd = bedrooms (0 for studio; read it from the type name or a bed column; -1 if not determinable); sf = square feet; st = status: "occupied" (current resident, no notice), "notice" (occupied, notice to vacate), "vacant_leased" (vacant, pre-leased / applicant), "vacant" (vacant, unleased), "down" (model, office, down, non-revenue), "other"; mr = market rent per month; lr = the BASE rent charge per month for the current lease only (the "rent" charge code, not total charges, not fees; 0 for vacant units); le = lease end date as YYYY-MM-DD or ""; bal = the resident's balance (positive when owed, negative when prepaid, -1 if not shown). Applicants / future residents listed separately are NOT extra units — use them only to mark a vacant unit "vacant_leased".
- charge_codes: the summary of monthly charges by charge code for current residents, as stated (e.g. rent 204504, petfee 1155). Empty if the document has no such summary.`;

const T12_INSTRUCTIONS = `This document is an operating statement (T12). Fill t12:
- months: the month column labels in order, oldest first (e.g. "Jun 2025"). Empty if the statement has no monthly columns.
- lines: the statement's lines at the level it subtotals them. Where a group has a subtotal line (e.g. "TOTAL PAYROLL"), return only that subtotal; where a group has no subtotal, return its individual lines. Always include the statement's total income, total operating expenses and net operating income lines. cat tags each line: income lines gross_potential_rent, loss_to_lease, vacancy_loss, concessions, bad_debt, non_revenue_units (model/employee/admin units), other_income, total_income; expense lines taxes, insurance, payroll, repairs_maintenance, turnover (make-ready, painting, carpet, cleaning), contract_services (landscaping, pest, trash, security), utilities, management_fee, admin_marketing, other_expense, total_expenses; noi; below_noi (capital expenditures, replacements, debt service, anything after NOI). m = the monthly values in the same order as months (empty if none); total = the line's total column (-1 if not shown). Keep signs as the statement shows them (vacancy and concessions are usually negative).`;

const OM_INSTRUCTIONS = `This document is an offering memorandum. Fill om:
- facts: property facts as stated, each {k: label, v: value as written, p: page or -1}. Include where present: address, submarket, year built, year renovated, unit count, rentable SF, average unit size, stories / buildings, acreage, parking, utilities and who pays (RUBS / ratio billing), laundry, construction type, roof, HVAC, water heaters, property tax assessment, renovated units and premium achieved, pricing guidance, offers due / call for offers date, financing (assumable debt, rate, maturity).
- metrics: financial figures from the OM, each {k, v, basis, p}: basis "in_place" for trailing / current figures, "pro_forma" for the broker's projections (year 1, stabilized, post-renovation), "other" otherwise. Include in-place and pro forma NOI, cap rates, rents, occupancy, expense assumptions, renovation budget and premium, price per unit.
- amenities: community and unit amenities, each as a short phrase.`;

export const DETAIL_SYSTEM: Record<DetailDocType, string> = {
  rent_roll: `${DETAIL_PREAMBLE}\n\n${RENT_ROLL_INSTRUCTIONS}`,
  t12: `${DETAIL_PREAMBLE}\n\n${T12_INSTRUCTIONS}`,
  om: `${DETAIL_PREAMBLE}\n\n${OM_INSTRUCTIONS}`,
};

// ---------- normalized types ----------

export type RentRollUnit = {
  unit: string;
  type: string | null;
  beds: number | null;
  sqft: number | null;
  status: UnitStatus;
  market_rent: number | null;
  lease_rent: number | null;
  lease_end: string | null;
  balance: number | null;
};

export type T12Line = { label: string; category: T12Category; months: number[]; total: number | null };

export type DocumentDetail = {
  rent_roll: { as_of: string | null; units: RentRollUnit[]; charge_codes: { code: string; monthly_total: number }[] };
  t12: { months: string[]; lines: T12Line[] };
  om: {
    facts: { label: string; value: string; page: number | null }[];
    metrics: { label: string; value: string; basis: OmBasis; page: number | null }[];
    amenities: string[];
  };
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const known = (v: unknown): number | null => (isNum(v) && v !== -1 ? v : null);
const knownPositive = (v: unknown): number | null => (isNum(v) && v > 0 ? v : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * A strict calendar date. Date.parse would accept "2026-02-31" (rolling it into
 * March) and a dozen loose formats; a lease end that is not exactly a real
 * YYYY-MM-DD is treated as missing rather than guessed.
 */
export function isoDate(v: unknown): string | null {
  const s = text(v);
  const m = s && /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? s : null;
}

// deno-lint-ignore no-explicit-any
export function normalizeDetail(raw: any): DocumentDetail {
  const rr = raw?.rent_roll ?? {};
  const t = raw?.t12 ?? {};
  const om = raw?.om ?? {};
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    rent_roll: {
      as_of: isoDate(rr.as_of_iso),
      units: arr(rr.units)
        .filter((x) => text(x?.u))
        .map((x) => ({
          unit: text(x.u)!,
          type: text(x.t),
          beds: known(x.bd) !== null && x.bd >= 0 && x.bd <= 6 ? Math.round(x.bd) : null,
          sqft: knownPositive(x.sf),
          status: (UNIT_STATUSES as readonly string[]).includes(x.st) ? x.st : "other",
          market_rent: knownPositive(x.mr),
          lease_rent: known(x.lr) !== null && x.lr >= 0 ? x.lr : null,
          lease_end: isoDate(x.le),
          balance: known(x.bal),
        })),
      charge_codes: arr(rr.charge_codes)
        .filter((c) => text(c?.code) && isNum(c?.monthly_total))
        .map((c) => ({ code: text(c.code)!, monthly_total: c.monthly_total })),
    },
    t12: {
      months: arr(t.months).map((m) => text(m) ?? "").filter(Boolean),
      lines: arr(t.lines)
        .filter((l) => text(l?.label) && (T12_CATEGORIES as readonly string[]).includes(l?.cat))
        .map((l) => ({
          label: text(l.label)!,
          category: l.cat,
          months: arr(l.m).filter(isNum),
          total: known(l.total),
        })),
    },
    om: {
      facts: arr(om.facts)
        .filter((f) => text(f?.k) && text(f?.v))
        .map((f) => ({ label: text(f.k)!, value: text(f.v)!, page: knownPositive(f.p) })),
      metrics: arr(om.metrics)
        .filter((f) => text(f?.k) && text(f?.v))
        .map((f) => ({
          label: text(f.k)!,
          value: text(f.v)!,
          basis: (OM_BASES as readonly string[]).includes(f.basis) ? f.basis : "other",
          page: knownPositive(f.p),
        })),
      amenities: arr(om.amenities).map(text).filter((s): s is string => !!s),
    },
  };
}

// ---------- rent roll arithmetic ----------

export type UnitMixRow = {
  beds: number | null;
  units: number;
  occupied: number;
  avg_sqft: number | null;
  avg_market_rent: number | null;
  avg_lease_rent: number | null;
  loss_to_lease_pct: number | null;
};

export type RentRollSummary = {
  as_of: string | null;
  units: number;
  occupied: number;
  notice: number;
  vacant_leased: number;
  vacant: number;
  down: number;
  physical_occupancy_pct: number | null;
  leased_pct: number | null;
  avg_sqft: number | null;
  total_sqft: number | null;
  avg_market_rent: number | null;
  avg_lease_rent: number | null;
  loss_to_lease_pct: number | null;
  unit_mix: UnitMixRow[];
  /** "YYYY-MM" -> count, for the 12 months from the as-of date. */
  expirations: { month: string; count: number }[];
  expired_or_mtm: number;
  expiring_later: number;
  no_lease_end: number;
  delinquent_units: number;
  delinquent_total: number;
  other_income_monthly: { code: string; monthly_total: number }[];
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
const r0 = (n: number | null) => (n === null ? null : Math.round(n));

/** Loss to lease on units that have both rents: how far in-place sits below market. */
function lossToLease(units: RentRollUnit[]): number | null {
  const both = units.filter((u) => u.market_rent && u.lease_rent);
  if (!both.length) return null;
  const mr = sum(both.map((u) => u.market_rent!));
  const lr = sum(both.map((u) => u.lease_rent!));
  return mr > 0 ? r1(((mr - lr) / mr) * 100) : null;
}

const isOccupied = (u: RentRollUnit) => u.status === "occupied" || u.status === "notice";
const BASE_RENT_CODE = /^(rent|base ?rent|lease ?rent|rnt|rent ?charge)$/i;

export function summarizeRentRoll(rr: DocumentDetail["rent_roll"], fallbackAsOf: Date): RentRollSummary | null {
  const units = rr.units;
  if (!units.length) return null;
  const count = (s: UnitStatus) => units.filter((u) => u.status === s).length;
  const occupiedUnits = units.filter(isOccupied);

  const sqfts = units.map((u) => u.sqft).filter((x): x is number => x !== null);
  const groups = new Map<number | null, RentRollUnit[]>();
  for (const u of units) groups.set(u.beds, [...(groups.get(u.beds) ?? []), u]);
  const unit_mix = [...groups.entries()]
    .sort(([a], [b]) => (a ?? 99) - (b ?? 99))
    .map(([beds, us]) => {
      const occ = us.filter(isOccupied);
      return {
        beds,
        units: us.length,
        occupied: occ.length,
        avg_sqft: r0(avg(us.map((u) => u.sqft).filter((x): x is number => x !== null))),
        avg_market_rent: r0(avg(us.map((u) => u.market_rent).filter((x): x is number => x !== null))),
        avg_lease_rent: r0(avg(occ.map((u) => u.lease_rent).filter((x): x is number => !!x))),
        loss_to_lease_pct: lossToLease(occ),
      };
    });

  // Expirations bucket from the rent roll date, not today: a June rent roll read
  // in October should still show June's view of the lease schedule.
  const asOf = rr.as_of ? new Date(`${rr.as_of}T00:00:00Z`) : fallbackAsOf;
  const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const buckets = Array.from({ length: 12 }, (_, i) =>
    monthKey(new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + i, 1))),
  );
  const exp = new Map(buckets.map((b) => [b, 0]));
  let expired = 0, later = 0, noEnd = 0;
  for (const u of occupiedUnits) {
    if (!u.lease_end) { noEnd++; continue; }
    const k = u.lease_end.slice(0, 7);
    if (u.lease_end < (rr.as_of ?? asOf.toISOString().slice(0, 10))) expired++;
    else if (exp.has(k)) exp.set(k, exp.get(k)! + 1);
    else later++;
  }

  const delinquent = occupiedUnits.filter((u) => (u.balance ?? 0) > 0);
  return {
    as_of: rr.as_of,
    units: units.length,
    occupied: count("occupied"),
    notice: count("notice"),
    vacant_leased: count("vacant_leased"),
    vacant: count("vacant"),
    down: count("down"),
    physical_occupancy_pct: r1((occupiedUnits.length / units.length) * 100),
    leased_pct: r1(((count("occupied") + count("vacant_leased")) / units.length) * 100),
    avg_sqft: r0(avg(sqfts)),
    total_sqft: sqfts.length === units.length ? sum(sqfts) : null,
    avg_market_rent: r0(avg(units.map((u) => u.market_rent).filter((x): x is number => x !== null))),
    avg_lease_rent: r0(avg(occupiedUnits.map((u) => u.lease_rent).filter((x): x is number => !!x))),
    loss_to_lease_pct: lossToLease(occupiedUnits),
    unit_mix,
    expirations: buckets.map((month) => ({ month, count: exp.get(month)! })),
    expired_or_mtm: expired,
    expiring_later: later,
    no_lease_end: noEnd,
    delinquent_units: delinquent.length,
    delinquent_total: Math.round(sum(delinquent.map((u) => u.balance!))),
    other_income_monthly: rr.charge_codes.filter((c) => !BASE_RENT_CODE.test(c.code)),
  };
}

// ---------- T12 arithmetic ----------

export type T12CategoryRow = {
  category: T12Category;
  annual: number | null;
  /** Last three months x 4: the current run rate, which a twelve-month total smooths over. */
  t3_annualized: number | null;
  lines: string[];
};

export type T12Summary = {
  months: string[];
  period: string | null;
  categories: T12CategoryRow[];
  total_income: number | null;
  total_expenses: number | null;
  noi: number | null;
  t3_total_income: number | null;
  t3_total_expenses: number | null;
  t3_noi: number | null;
};

function lineAnnual(l: T12Line, monthCount: number): number | null {
  if (l.total !== null) return l.total;
  if (monthCount === 12 && l.months.length === 12) return sum(l.months);
  return null;
}

function lineT3(l: T12Line): number | null {
  return l.months.length >= 3 ? sum(l.months.slice(-3)) * 4 : null;
}

export function summarizeT12(t: DocumentDetail["t12"]): T12Summary | null {
  if (!t.lines.length) return null;
  const monthCount = t.months.length;
  const categories: T12CategoryRow[] = [];
  for (const cat of T12_CATEGORIES) {
    const lines = t.lines.filter((l) => l.category === cat);
    if (!lines.length) continue;
    const annuals = lines.map((l) => lineAnnual(l, monthCount));
    const t3s = lines.map(lineT3);
    categories.push({
      category: cat,
      annual: annuals.every((a) => a !== null) ? Math.round(sum(annuals as number[])) : null,
      t3_annualized: t3s.every((a) => a !== null) ? Math.round(sum(t3s as number[])) : null,
      lines: lines.map((l) => l.label),
    });
  }
  const get = (c: T12Category) => categories.find((r) => r.category === c);
  return {
    months: t.months,
    period: monthCount ? `${t.months[0]} – ${t.months[monthCount - 1]}` : null,
    categories,
    total_income: get("total_income")?.annual ?? null,
    total_expenses: get("total_expenses")?.annual ?? null,
    noi: get("noi")?.annual ?? null,
    t3_total_income: get("total_income")?.t3_annualized ?? null,
    t3_total_expenses: get("total_expenses")?.t3_annualized ?? null,
    t3_noi: get("noi")?.t3_annualized ?? null,
  };
}

// ---------- checks ----------

/** Within 1% (or $1 / 1 unit): transcription agrees with the document's own total. */
const agrees = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.01);
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * Cross-check the transcription against what the document states. Each failed
 * check means some rows were dropped or misread, and says so in plain words —
 * the summary is still shown, but nobody should trust it silently.
 */
export function detailChecks(
  detail: DocumentDetail,
  rr: RentRollSummary | null,
  t12: T12Summary | null,
  stated: { unit_count: number | null; occupied_units: number | null; noi: number | null; opex: number | null },
): string[] {
  const out: string[] = [];
  if (rr) {
    if (stated.unit_count !== null && rr.units !== stated.unit_count) {
      out.push(`Rent roll lists ${rr.units} units but states ${stated.unit_count}; the unit-level figures may be incomplete.`);
    }
    const occ = rr.occupied + rr.notice;
    if (stated.occupied_units !== null && occ !== stated.occupied_units) {
      out.push(`${occ} units read as occupied, but the summary states ${stated.occupied_units}.`);
    }
    const rentCode = detail.rent_roll.charge_codes.find((c) => BASE_RENT_CODE.test(c.code));
    if (rentCode) {
      const unitRent = sum(detail.rent_roll.units.filter(isOccupied).map((u) => u.lease_rent ?? 0));
      if (!agrees(unitRent, rentCode.monthly_total)) {
        out.push(`Unit lease rents add up to ${money(unitRent)} a month; the charge summary says ${money(rentCode.monthly_total)}.`);
      }
    }
  }
  if (t12) {
    for (const l of detail.t12.lines) {
      if (l.total !== null && l.months.length === 12 && !agrees(sum(l.months), l.total)) {
        out.push(`"${l.label}": the months add up to ${money(sum(l.months))}, not the stated ${money(l.total)}.`);
      }
    }
    const expenseSum = EXPENSE_CATEGORIES.map((c) => t12.categories.find((r) => r.category === c)?.annual ?? 0);
    const hasExpenseLines = t12.categories.some((r) => EXPENSE_CATEGORIES.includes(r.category));
    if (hasExpenseLines && t12.total_expenses !== null && !agrees(sum(expenseSum), t12.total_expenses)) {
      out.push(`Expense categories add up to ${money(sum(expenseSum))}; total operating expenses are ${money(t12.total_expenses)}.`);
    }
    if (stated.noi !== null && t12.noi !== null && !agrees(t12.noi, stated.noi)) {
      out.push(`NOI line reads ${money(t12.noi)} but ${money(stated.noi)} was reported as the NOI.`);
    }
    if (stated.opex !== null && t12.total_expenses !== null && !agrees(t12.total_expenses, stated.opex)) {
      out.push(`Total expenses line reads ${money(t12.total_expenses)} but ${money(stated.opex)} was reported as opex.`);
    }
  }
  return out;
}

export type DocumentSummary = {
  rent_roll: RentRollSummary | null;
  t12: T12Summary | null;
  om: DocumentDetail["om"] | null;
  checks: string[];
};

export function summarizeDetail(
  detail: DocumentDetail,
  stated: { unit_count: number | null; occupied_units: number | null; noi: number | null; opex: number | null },
  now: Date = new Date(),
): DocumentSummary {
  const rr = summarizeRentRoll(detail.rent_roll, now);
  const t12 = summarizeT12(detail.t12);
  const om = detail.om.facts.length || detail.om.metrics.length || detail.om.amenities.length ? detail.om : null;
  return { rent_roll: rr, t12, om, checks: detailChecks(detail, rr, t12, stated) };
}

// ---------- splitting a long rent roll ----------

/**
 * Characters per transcription call. The edge runtime kills a request at 400 s
 * with no error and no log; one call transcribing Sugar Run (394 units, listed
 * on two sheets, 148k characters) was killed that way. ~30k characters is
 * ~150 rows, which Sonnet transcribes in well under two minutes, and the pieces
 * run in parallel.
 */
export const DETAIL_CHUNK_CHARS = 30_000;
/** Each continuation repeats its sheet's first lines so the columns stay named. */
const HEADER_LINES = 12;
/** Lines repeated across a cut, so a unit whose rows straddle it is whole on one side. */
const OVERLAP_LINES = 6;

/**
 * Split extracted document text into pieces for parallel transcription. Text is
 * divided at sheet / page markers ("=== ... ===") first; a section too long for
 * one piece is cut by lines, each continuation carrying the section's header
 * lines and a few lines of overlap. Short sections are packed together.
 */
export function chunkDocumentText(text: string, maxChars = DETAIL_CHUNK_CHARS): string[] {
  if (text.length <= maxChars) return [text];
  const sections: string[][] = [];
  for (const line of text.split("\n")) {
    if (/^=== .* ===$/.test(line) || !sections.length) sections.push([]);
    sections[sections.length - 1].push(line);
  }

  const pieces: string[] = [];
  for (const lines of sections) {
    const whole = lines.join("\n");
    if (whole.length <= maxChars) { pieces.push(whole); continue; }
    const header = lines.slice(0, HEADER_LINES);
    const headerText = `${header.join("\n")}\n[... continued ...]\n`;
    let start = HEADER_LINES;
    let first = true;
    while (start < lines.length) {
      const budget = maxChars - (first ? 0 : headerText.length);
      const out: string[] = first ? [...header] : [];
      let size = out.join("\n").length;
      let i = start;
      while (i < lines.length && (size + lines[i].length + 1 <= budget || i === start)) {
        size += lines[i].length + 1;
        out.push(lines[i]);
        i++;
      }
      pieces.push((first ? "" : headerText) + out.join("\n"));
      if (i >= lines.length) break;
      start = Math.max(i - OVERLAP_LINES, start + 1);
      first = false;
    }
  }

  // Pack small neighbours so a workbook of short sheets is not one call per sheet.
  const packed: string[] = [];
  for (const p of pieces) {
    const last = packed[packed.length - 1];
    if (last !== undefined && last.length + p.length + 2 <= maxChars) packed[packed.length - 1] = `${last}\n\n${p}`;
    else packed.push(p);
  }
  return packed;
}

const unitKey = (u: string) => u.trim().toUpperCase().replace(/\s+/g, " ");
const filled = (u: RentRollUnit) =>
  [u.type, u.beds, u.sqft, u.market_rent, u.lease_rent, u.lease_end, u.balance].filter((v) => v !== null).length;

/**
 * Merge rent-roll transcriptions of separate pieces. A unit seen twice — in the
 * overlap between pieces, or because the workbook lists every unit on two
 * sheets — is kept once, as the more complete of its readings, in the order it
 * first appeared. If this collapses units that are genuinely distinct (the same
 * number in two buildings), the stated-unit-count check reports the shortfall.
 */
export function mergeRentRollParts(parts: DocumentDetail["rent_roll"][]): DocumentDetail["rent_roll"] {
  const byUnit = new Map<string, RentRollUnit>();
  for (const part of parts) {
    for (const u of part.units) {
      const k = unitKey(u.unit);
      const seen = byUnit.get(k);
      if (!seen || filled(u) > filled(seen)) byUnit.set(k, seen ? { ...u, unit: seen.unit } : u);
    }
  }
  const codes = new Map<string, { code: string; monthly_total: number }>();
  for (const part of parts) for (const c of part.charge_codes) if (!codes.has(c.code)) codes.set(c.code, c);
  return {
    as_of: parts.find((p) => p.as_of)?.as_of ?? null,
    units: [...byUnit.values()],
    charge_codes: [...codes.values()],
  };
}
