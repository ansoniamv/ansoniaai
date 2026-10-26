/**
 * The line under the deal page's cap rate and GRM figures, plus the derived
 * pricing figures (equity check, $ / sq ft, T-3 NOI).
 *
 * The figures themselves come from deals.in_place_cap_rate and deals.grm,
 * which the database generates from NOI, gross scheduled rent and asking price
 * (migration 20261021190000) — one formula, so the page, the pipeline list,
 * exports and Ask Atlas all show the same number. This module only says how a
 * figure was made, or which input it is waiting for.
 */

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const positive = (v: unknown) => isNum(v) && v > 0;

/** Names the missing inputs in plain words, e.g. "Needs T-12 NOI and asking price". */
function hint(missing: string[], formula: string): string {
  return missing.length ? `Needs ${missing.join(" and ")}` : formula;
}

export function capRateHint(t12Noi: unknown, askingPriceM: unknown): string {
  const missing: string[] = [];
  if (!isNum(t12Noi)) missing.push("T-12 NOI");
  if (!positive(askingPriceM)) missing.push("asking price");
  return hint(missing, "T-12 NOI ÷ asking price");
}

/**
 * deals.grm is the annual multiple: price over a year's gross scheduled rent.
 * The monthly multiple is price over one month's rent, so annual × 12.
 */
export function grmHint(
  grossScheduledRent: unknown,
  askingPriceM: unknown,
  period: "annual" | "monthly" = "annual",
): string {
  const missing: string[] = [];
  if (!positive(grossScheduledRent)) missing.push("gross sched. rent");
  if (!positive(askingPriceM)) missing.push("asking price");
  return hint(
    missing,
    period === "annual" ? "Asking price ÷ annual gross sched. rent" : "Asking price ÷ monthly rent (annual × 12)",
  );
}

export function monthlyGrm(annualGrm: unknown): number | null {
  return isNum(annualGrm) ? annualGrm * 12 : null;
}

/** The equity check assumed until a deal has a real capital stack: 35% of ask. */
export const EQUITY_CHECK_SHARE = 0.35;

export function equityCheck(askingPriceM: unknown): number | null {
  return positive(askingPriceM) ? (askingPriceM as number) * 1_000_000 * EQUITY_CHECK_SHARE : null;
}

/**
 * $ / sq ft. The stored figure wins when a broker or document supplied one;
 * otherwise it is asking price over rentable square feet, which most deals
 * have and the stored column mostly does not.
 */
export function pricePerSqft(
  stored: unknown,
  askingPriceM: unknown,
  totalSqft: unknown,
): { value: number | null; hint?: string } {
  if (positive(stored)) return { value: stored as number };
  if (positive(askingPriceM) && positive(totalSqft))
    return { value: ((askingPriceM as number) * 1_000_000) / (totalSqft as number), hint: "Asking price ÷ rentable SF" };
  const missing: string[] = [];
  if (!positive(askingPriceM)) missing.push("asking price");
  if (!positive(totalSqft)) missing.push("rentable SF");
  return { value: null, hint: hint(missing, "") };
}

type T3Source = {
  doc_type: string | null;
  parse_status: string;
  doc_as_of: string | null;
  created_at: string;
  summary: { t12: { period: string | null; t3_noi: number | null } | null } | null;
};

/**
 * T-3 NOI (last three months × 4) from the newest parsed T12 that has one.
 * It lives in the document's summary, not on the deal row. Newest by the
 * statement's own date, then by upload.
 */
export function latestT3Noi(docs: T3Source[]): { value: number; period: string | null } | null {
  const withT3 = docs
    .filter((d) => d.doc_type === "t12" && d.parse_status === "parsed" && isNum(d.summary?.t12?.t3_noi))
    .sort(
      (a, b) =>
        (b.doc_as_of ?? "").localeCompare(a.doc_as_of ?? "") || b.created_at.localeCompare(a.created_at),
    );
  const t12 = withT3[0]?.summary?.t12;
  return t12 ? { value: t12.t3_noi as number, period: t12.period } : null;
}
