/**
 * The deal page's Quick Underwrite: a back-of-envelope value from the T-12.
 *
 *   Quick NOI = T-12 NOI + the analyst's adjustment (taxes reassessed, a
 *               management fee normalised, ...), annual $
 *   Value     = Quick NOI ÷ cap rate
 *
 * The cap rate is the house 6% unless the deal carries its own
 * (deals.quick_cap_rate, in percent). Both edits are saved on the deal
 * (migration 20261106120000).
 */

/** The house cap rate, in percent. */
export const DEFAULT_QUICK_CAP_RATE = 6;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const positive = (v: unknown): v is number => isNum(v) && v > 0;

export type QuickUnderwrite = {
  /** Cap rate used, in percent. */
  capRate: number;
  capIsDefault: boolean;
  noi: number | null;
  value: number | null;
  valuePerUnit: number | null;
  /** Value minus asking price, $. Positive means the ask is below value. */
  vsAsk: number | null;
  vsAskPct: number | null;
  /** Why there is no value, in plain words; null when there is one. */
  missing: string | null;
};

export function quickUnderwrite(input: {
  t12Noi: unknown;
  adjustment: unknown;
  capRate: unknown;
  askingPriceM: unknown;
  unitCount: unknown;
}): QuickUnderwrite {
  const capIsDefault = !positive(input.capRate);
  const capRate = capIsDefault ? DEFAULT_QUICK_CAP_RATE : (input.capRate as number);
  const noi = isNum(input.t12Noi) ? input.t12Noi + (isNum(input.adjustment) ? input.adjustment : 0) : null;

  const value = positive(noi) ? noi / (capRate / 100) : null;
  const ask = positive(input.askingPriceM) ? input.askingPriceM * 1_000_000 : null;
  const vsAsk = value !== null && ask !== null ? value - ask : null;

  return {
    capRate,
    capIsDefault,
    noi,
    value,
    valuePerUnit: value !== null && positive(input.unitCount) ? value / input.unitCount : null,
    vsAsk,
    vsAskPct: vsAsk !== null && ask !== null ? (vsAsk / ask) * 100 : null,
    missing: noi === null ? "Needs T-12 NOI" : value === null ? "NOI is not positive" : null,
  };
}
