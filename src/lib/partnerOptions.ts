// Shared option lists for the capital-partner form (Add and Edit use the same one).

export const WARMTH_LEVELS = ["Existing Partner", "Very Warm", "Warm", "Tepid", "Cold"];

// Who the partner is.
export const INVESTOR_TYPES = [
  "Individual",
  "Family Office",
  "RIA",
  "Syndicator",
  "Fund",
  "Institution",
  "Pension",
  "Endowment",
  "Insurance",
  "Sovereign",
];

// How the partner invests with us. Kept separate from INVESTOR_TYPES: a family
// office can write JV equity or pref, so the two are different questions.
export const INVESTMENT_TYPES = [
  "JV Equity",
  "Large JV",
  "Preferred Equity",
  "GP Equity",
  "LP Equity",
  "Passive Co-Invest",
  "GP Co-Invest",
  "Sidecar",
];

/** The option list plus any stored values not in it, so editors can still show and clear them. */
export function withCurrent(options: readonly string[], current: readonly string[] | null | undefined): string[] {
  return [...options, ...(current ?? []).filter((v) => !options.includes(v))];
}

export const HOLD_PERIODS = ["Short (<3 yr)", "Medium (3–7 yr)", "Long (7–10 yr)", "Perpetual"];

export const PRODUCT_TYPES = [
  "Multifamily",
  "Office",
  "Industrial",
  "Retail",
  "Mixed-Use",
  "Hospitality",
  "Student Housing",
  "Senior Living",
  "Self-Storage",
];

export const GEOGRAPHY_QUICK_ADDS = ["All Markets"];
