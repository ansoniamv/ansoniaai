import { cn } from "@/lib/utils";

export type TierKey = "strong" | "medium" | "maybe" | "skip";

export const TIER_ORDER: Record<TierKey, number> = { strong: 0, medium: 1, maybe: 2, skip: 3 };
export const ALL_TIERS: TierKey[] = ["strong", "medium", "maybe", "skip"];

export const TIER_LABEL: Record<TierKey, string> = {
  strong: "Strong",
  medium: "Medium",
  maybe: "Maybe",
  skip: "Skip",
};

/** Token-driven chip classes — never use raw hex in components. */
export const TIER_CHIP: Record<TierKey, string> = {
  strong: "bg-tier-strong-bg text-tier-strong-fg border-tier-strong-fg/20",
  medium: "bg-tier-medium-bg text-tier-medium-fg border-tier-medium-fg/20",
  maybe: "bg-tier-maybe-bg text-tier-maybe-fg border-hairline",
  skip: "bg-tier-skip-bg text-tier-skip-fg border-hairline",
};

/** Hex values for chart series (Recharts needs literal colors, not Tailwind classes). */
export const TIER_HEX: Record<TierKey, string> = {
  strong: "#2E7D5B",
  medium: "#B7791F",
  maybe: "#5B6472",
  skip: "#98A2B3",
};

/** Institutional chart palette — Ansonia brand blues. Use for non-tier series. */
export const CHART_HEX = {
  navy: "#002752",
  navyMid: "#3B5A8C",
  bronze: "#6aa3d8",
  green: "#2E7D5B",
  slate: "#5B6472",
  gridline: "#EAECF0",
  hairline: "#E4E7EC",
  ink: "#1A1F2B",
};

export const tierKey = (t: string | null | undefined): TierKey => {
  const v = (t ?? "").toLowerCase();
  if (v === "strong" || v === "medium" || v === "maybe" || v === "skip") return v as TierKey;
  return "maybe";
};

export const tierChip = (t: TierKey) =>
  cn("chip-tier", TIER_CHIP[t]);
