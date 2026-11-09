/**
 * Capital Intelligence: our best capital sources per strategy, deal-agnostic.
 *
 * Three inputs, weighted so the notes lead:
 *  - What the notes say (read-partner-strategies). A dedicated vehicle is the
 *    strongest evidence of money for a strategy; it is why a partner with a
 *    Core+ fund outranks one that only has the Core+ box ticked.
 *  - The strategy checkbox. Ticked generously so nobody is left out of a deal
 *    search, so it is worth little on its own here.
 *  - Relationship warmth. How easy the call is.
 * Capital status then moves a partner up or down, as it does on the deal match.
 */
import {
  BUCKET_LABEL,
  STRATEGY_BUCKETS,
  type BucketRead,
  type Level,
  type StrategyBucket,
  type StrategyReads,
} from "../../supabase/functions/_shared/strategyRead";
import { scoreCapitalStatus } from "@/lib/partnerMatching";

export { BUCKET_LABEL, STRATEGY_BUCKETS };
export type { StrategyBucket, Level };

export const EVIDENCE_POINTS: Record<Level, number> = {
  dedicated: 50,
  active: 35,
  open: 15,
  none: 0,
  avoids: -40,
};

export const BOX_POINTS = 15;

export const WARMTH_POINTS: Record<string, number> = {
  "Existing Partner": 25,
  "Very Warm": 20,
  Warm: 14,
  Tepid: 7,
  Cold: 0,
};

export const LEVEL_LABEL: Record<Level, string> = {
  dedicated: "Dedicated vehicle",
  active: "Active",
  open: "Open to it",
  none: "Box only",
  avoids: "Notes say no",
};

/** Opportunistic has no checkbox; the notes are its only evidence. */
export const BUCKET_BOX_FIELD: Record<StrategyBucket, string | null> = {
  core_plus: "strategy_core_plus",
  value_add: "strategy_value_add",
  opportunistic: null,
  workforce: "strategy_workforce",
  affordable: "strategy_affordable",
};

export interface IntelPartner {
  id: string;
  name: string;
  relationship_strength: string | null;
  capital_status: string | null;
  capital_available_from: string | null;
  min_equity_m: number | null;
  max_equity_m: number | null;
  archived_at: string | null;
  blacklisted_at: string | null;
  strategy_core_plus?: boolean | null;
  strategy_value_add?: boolean | null;
  strategy_workforce?: boolean | null;
  strategy_affordable?: boolean | null;
}

/** A partner's stored read: null = never read; reads {} = read, but no notes. */
export type ReadRow = { reads: Partial<StrategyReads>; read_at: string } | null;

export interface RankedSource {
  partner: IntelPartner;
  score: number;
  read: BucketRead | null;
  /** Notes have not been read yet, so the evidence column is unknown. */
  unread: boolean;
  boxChecked: boolean;
  warmthPoints: number;
  capitalPoints: number;
  needsReconfirmation: boolean;
}

export function boxChecked(p: IntelPartner, bucket: StrategyBucket): boolean {
  const f = BUCKET_BOX_FIELD[bucket];
  return f ? (p as unknown as Record<string, unknown>)[f] === true : false;
}

/**
 * Everyone who belongs on a bucket's list, best first. A partner is on it when
 * the box is ticked or the notes show at least openness. "Notes say no" with
 * the box ticked stays on the list, at the bottom, because the conflict is
 * worth someone fixing.
 */
export function rankBucket(
  bucket: StrategyBucket,
  partners: IntelPartner[],
  readsById: Map<string, ReadRow>,
  now: Date = new Date(),
): RankedSource[] {
  const out: RankedSource[] = [];
  for (const p of partners) {
    if (p.archived_at || p.blacklisted_at) continue;
    const row = readsById.get(p.id) ?? null;
    const read = row?.reads?.[bucket] ?? null;
    const level: Level = read?.level ?? "none";
    const box = boxChecked(p, bucket);
    if (!box && !(level === "dedicated" || level === "active" || level === "open")) continue;

    const warmthPoints = WARMTH_POINTS[p.relationship_strength ?? ""] ?? 0;
    const cap = scoreCapitalStatus(p, now);
    const score = EVIDENCE_POINTS[level] + (box ? BOX_POINTS : 0) + warmthPoints + cap.adjustment;
    out.push({
      partner: p,
      score,
      read: read && read.level !== "none" ? read : null,
      unread: row == null,
      boxChecked: box,
      warmthPoints,
      capitalPoints: cap.adjustment,
      needsReconfirmation: cap.needsReconfirmation,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.partner.name.localeCompare(b.partner.name));
}

/** Evidence groups for the summary strip: how deep each bucket's money really is. */
export function evidenceCounts(rows: RankedSource[]): Record<Level, number> {
  const c: Record<Level, number> = { dedicated: 0, active: 0, open: 0, none: 0, avoids: 0 };
  for (const r of rows) c[r.read?.level ?? "none"]++;
  return c;
}
