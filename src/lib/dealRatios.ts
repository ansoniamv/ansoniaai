/**
 * The line under the deal page's In-Place Cap and GRM figures.
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

export function grmHint(grossScheduledRent: unknown, askingPriceM: unknown): string {
  const missing: string[] = [];
  if (!positive(grossScheduledRent)) missing.push("gross sched. rent");
  if (!positive(askingPriceM)) missing.push("asking price");
  return hint(missing, "Asking price ÷ gross sched. rent");
}
