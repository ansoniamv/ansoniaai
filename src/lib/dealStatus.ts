import type { Database } from "@/integrations/supabase/types";

export type DealStatus = Database["public"]["Enums"]["deal_status"];

export const DEAL_STATUSES = [
  "New",
  "Screening",
  "On Hold/Tracking",
  "Underwriting",
  "B&F",
  "Under Contract",
  "Pass",
] as const;

/**
 * Kanban board layout split — derived from DEAL_STATUSES (single source of truth).
 * Presentational only: filters, dropdowns, exports, and charts keep using DEAL_STATUSES.
 */
export const BOARD_ARCHIVE_STAGES = ["Under Contract", "Pass"] as const satisfies readonly DealStatus[];
export const BOARD_PRIMARY_STAGES = DEAL_STATUSES.filter(
  (s) => !(BOARD_ARCHIVE_STAGES as readonly string[]).includes(s),
);

/** Counted in dashboard charts and top-line metrics. */
export const ACTIVE_STATUSES = [
  "New",
  "Screening",
  "On Hold/Tracking",
  "Underwriting",
  "B&F",
] as const;

/** Columns that genuinely flow into each other — the only ones with step conversion. */
export const PROGRESSION: DealStatus[] = [
  "New",
  "Screening",
  "Underwriting",
  "B&F",
  "Under Contract",
];

export const DEAL_STATUS_HEX: Record<DealStatus, string> = {
  "New": "#5B6472",
  "Screening": "#3B5A8C",
  "On Hold/Tracking": "#6B4EA8",
  "Underwriting": "#002752",
  "B&F": "#B7791F",
  "Under Contract": "#2E7D5B",
  "Pass": "#C0392B",
};

/** Every deal resolves to exactly one status. Never read pipeline_stage. */
export function getStatus(d: { status?: string | null }): DealStatus {
  const raw = (d.status ?? "").trim();
  return (DEAL_STATUSES as readonly string[]).includes(raw)
    ? (raw as DealStatus)
    : "New";
}
