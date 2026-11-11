/**
 * The internal pipeline tearsheet: same branded sheet as the partner one, but
 * for the team. No partner, so deals are grouped by stage instead of by fit,
 * and internal columns (CFO date, AI score, broker, off-market) are allowed.
 *
 * Pure module, shared by the HTML page and the PDF so both show the same rows.
 */
import type { Deal } from "@/hooks/useDeals";
import { DEAL_STATUSES, getStatus, type DealStatus } from "@/lib/dealStatus";
import { formatCfoDate } from "@/lib/cfo";

export const INTERNAL_BANNER = "Internal — not for distribution";
export const INTERNAL_FOOTER = "Ansonia Properties · Internal use only — do not forward";

export type StageGroup = { stage: DealStatus; deals: Deal[] };

export type InternalTotals = {
  count: number;
  units: number;
  totalCap: number;
  equity: number;
  unsized: number;
  offMarket: number;
};

/** Stage order as on the board; within a stage, highest AI score first. */
export function groupByStage(deals: Deal[]): StageGroup[] {
  return DEAL_STATUSES.map((stage) => ({
    stage,
    deals: deals
      .filter((d) => getStatus(d) === stage)
      .sort(
        (a, b) =>
          (scoreValue(b) ?? -1) - (scoreValue(a) ?? -1) ||
          (a.property_name ?? "").localeCompare(b.property_name ?? ""),
      ),
  })).filter((g) => g.deals.length > 0);
}

export function internalTotals(deals: Deal[]): InternalTotals {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const sized = deals.filter((d) => num(d.estimated_equity) != null);
  return {
    count: deals.length,
    units: deals.reduce((s, d) => s + (num(d.unit_count) ?? 0), 0),
    totalCap: deals.reduce((s, d) => s + (num(d.asking_price) ?? 0), 0),
    equity: sized.reduce((s, d) => s + (d.estimated_equity as number), 0),
    unsized: deals.length - sized.length,
    offMarket: deals.filter(isOffMarket).length,
  };
}

/** One line under the summary strip: what the totals leave out, and NDA exposure. */
export function summaryNote(t: InternalTotals): string | null {
  const parts: string[] = [];
  if (t.unsized > 0) {
    parts.push(`Equity total excludes ${t.unsized} deal${t.unsized === 1 ? "" : "s"} not yet sized.`);
  }
  if (t.offMarket > 0) {
    parts.push(`${t.offMarket} off-market deal${t.offMarket === 1 ? "" : "s"} included — may be under NDA.`);
  }
  return parts.length ? parts.join(" ") : null;
}

export const isOffMarket =(d: Deal) => d.marketed === false;

/** The AI score the pipeline shows; null when unscored or flagged insufficient. */
export function scoreValue(d: Deal): number | null {
  if (d.ai_score == null || d.score_confidence === "insufficient") return null;
  return d.ai_score;
}

export const scoreLabel = (d: Deal) => {
  const v = scoreValue(d);
  return v == null ? "—" : String(Math.round(v));
};

export const cfoLabel = (d: Deal) => (d.cfo_date ? formatCfoDate(d.cfo_date) : "—");

export const brokerLabel = (d: Deal) => (d.broker ?? "").trim() || "—";
