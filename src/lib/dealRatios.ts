/**
 * Ratios the deal page derives from figures already on the deal.
 *
 * Computed at render, not stored. deals has in_place_cap_rate and grm columns,
 * but nothing has ever written them (both were empty on every deal checked on
 * 2026-10-21), and a stored ratio goes stale the moment someone edits the price
 * or the NOI. Deriving them keeps them in step with their inputs.
 *
 * deals.asking_price is in MILLIONS ("Asking Price ($M)"); NOI and gross
 * scheduled rent are annual dollars.
 */

export type DerivedRatio = {
  /** null when an input is missing; the hint then says which. */
  value: number | null;
  hint: string;
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Names the missing inputs in plain words, e.g. "Needs T-12 NOI and asking price". */
function needs(missing: string[]): DerivedRatio {
  return { value: null, hint: `Needs ${missing.join(" and ")}` };
}

/** In-place cap rate, in percent: T-12 NOI / asking price. A negative NOI gives a negative cap. */
export function inPlaceCapRate(t12Noi: unknown, askingPriceM: unknown): DerivedRatio {
  const missing: string[] = [];
  if (!isNum(t12Noi)) missing.push("T-12 NOI");
  if (!isNum(askingPriceM) || askingPriceM <= 0) missing.push("asking price");
  if (missing.length) return needs(missing);
  return {
    value: ((t12Noi as number) / ((askingPriceM as number) * 1_000_000)) * 100,
    hint: "T-12 NOI ÷ asking price",
  };
}

/** Gross rent multiplier: asking price / annual gross scheduled rent. */
export function grossRentMultiplier(grossScheduledRent: unknown, askingPriceM: unknown): DerivedRatio {
  const missing: string[] = [];
  if (!isNum(grossScheduledRent) || grossScheduledRent <= 0) missing.push("gross sched. rent");
  if (!isNum(askingPriceM) || askingPriceM <= 0) missing.push("asking price");
  if (missing.length) return needs(missing);
  return {
    value: ((askingPriceM as number) * 1_000_000) / (grossScheduledRent as number),
    hint: "Asking price ÷ gross sched. rent",
  };
}
