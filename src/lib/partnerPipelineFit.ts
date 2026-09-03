/**
 * Inverse of the partner-matching engine: one partner → the whole pipeline.
 *
 * Pure module. No React, no network, no app state — same discipline as
 * `partnerMatching.ts`, and unit-testable for the client-facing copy it emits.
 *
 * IMPORTANT: everything produced here can end up on a page a capital partner
 * reads. `buildWhyLine` is composed from STRUCTURED pillar results only, never
 * from `match.reasons` / `match.misses` / `match.gateReason`, which are
 * internal analyst copy.
 */

import {
  partnerBand,
  scorePartnerMatch,
  defaultDealStrategies,
  STRATEGY_LABEL,
  PARTNER_STRATEGY_FIELD,
  TIER_THRESHOLDS,
  type MatchablePartner,
  type MatchableDeal,
  type PartnerMatch,
  type MatchTier,
  type Confidence,
  type GateKey,
  type StrategyKey,
} from "@/lib/partnerMatching";
import type { Deal } from "@/hooks/useDeals";

export interface DealFit {
  deal: Deal;
  score: number;
  tier: MatchTier;
  confidence: Confidence;
  gated: boolean;
  gateKey?: GateKey;
  /** Client-safe sentence. Built from structured pillars, NEVER from match.reasons/misses. */
  why: string;
}

export interface PartnerPipeline {
  strong: DealFit[];
  moderate: DealFit[];
  weak: DealFit[];
  outside: DealFit[];
  unrated: DealFit[];
}

export type BandKey = keyof PartnerPipeline;

export const BAND_TITLES: Record<BandKey, string> = {
  strong: "Strong fit",
  moderate: "Worth a look",
  weak: "Lower priority",
  outside: "Outside your current box",
  unrated: "Not yet sized",
};

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers (shared with the tearsheet and the Excel export)
// ─────────────────────────────────────────────────────────────────────────────

export const fmtMoneyM = (v: number | null | undefined): string =>
  typeof v === "number" && Number.isFinite(v)
    ? v >= 1000
      ? `$${(v / 1000).toFixed(2)}B`
      : `$${v.toFixed(1)}M`
    : "—";

const plainM = (v: number): string =>
  Number.isInteger(v) ? `$${v}M` : `$${v.toFixed(1)}M`;

/** Human band label, e.g. "$10M–$25M", "$66M", "$10M+", "up to $25M". */
export function bandLabel(partner: MatchablePartner): string | null {
  const { min, max } = partnerBand(partner);
  if (min != null && max != null) {
    if (min === max) return plainM(min);
    return `${plainM(min)}–${plainM(max)}`;
  }
  if (min != null) return `${plainM(min)}+`;
  if (max != null) return `up to ${plainM(max)}`;
  return null;
}

/** "Columbus, OH", falling back to the MSA, then "—". */
export function marketLabel(deal: {
  city?: string | null;
  state?: string | null;
  msa?: string | null;
}): string {
  const city = (deal.city ?? "").trim();
  const state = (deal.state ?? "").trim();
  if (city && state) return `${city}, ${state}`;
  if (city) return city;
  if (deal.msa) return deal.msa.trim();
  if (state) return state;
  return "—";
}

/** Business plan derived from real deal fields, Title Case. */
export function businessPlanLabel(deal: {
  value_add_potential?: string | null;
  affordable?: boolean | null;
}): string {
  const parts: string[] = [];
  if (deal.value_add_potential && ["High", "Medium"].includes(deal.value_add_potential)) {
    parts.push("Value-Add");
  }
  if (deal.affordable) parts.push("Affordable");
  if (!parts.length) parts.push("Core-Plus");
  return parts.join(" / ");
}

function partnerStrategyLabels(partner: MatchablePartner): string[] {
  return (Object.keys(PARTNER_STRATEGY_FIELD) as StrategyKey[])
    .filter((k) => partner[PARTNER_STRATEGY_FIELD[k]] === true)
    .map((k) => STRATEGY_LABEL[k]);
}


const NATIONAL_RE = /\b(national|nationwide|nation-?wide|all markets)\b/i;

// ─────────────────────────────────────────────────────────────────────────────
// The client-safe "why"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 90–160 characters, one sentence, second person, no internal jargon, no
 * avoid-list terms, no note content, no score talk.
 */
export function buildWhyLine(
  match: PartnerMatch,
  deal: Deal,
  partner: MatchablePartner,
): string {
  // Hard gates short-circuit — say the least that is true.
  if (match.gated) {
    if (match.gateKey === "avoid_list") return "Outside your stated target markets.";
    return "Outside your stated check size.";
  }

  const clauses: string[] = [];
  const band = bandLabel(partner);
  const equity = typeof deal.estimated_equity === "number" ? deal.estimated_equity : null;

  // Check size
  if (equity == null) {
    clauses.push("equity requirement not yet sized");
  } else if (band) {
    const { min, max } = partnerBand(partner);
    const below = min != null && equity < min;
    const above = max != null && equity > max;
    if (below) clauses.push(`${plainM(equity)} equity is below your stated ${band} range`);
    else if (above) clauses.push(`${plainM(equity)} equity is above your stated ${band} range`);
    else clauses.push(`${plainM(equity)} equity fits your ${band} range`);
  } else {
    clauses.push(`${plainM(equity)} equity requirement`);
  }

  // Geography
  const geos = (partner.geography ?? []).filter(Boolean);
  const geoPillar = match.pillars.find((p) => p.key === "geography");
  const market = marketLabel(deal);
  if (geos.some((g) => NATIONAL_RE.test(g))) {
    clauses.push("within your national mandate");
  } else if (geoPillar && geoPillar.points != null && geoPillar.points > 0 && market !== "—") {
    clauses.push(`${market} sits in your stated footprint`);
  } else if (market !== "—" && geos.length) {
    clauses.push(`${market} is outside the markets you have shared with us`);
  }

  // Strategy
  const dealStrategies = defaultDealStrategies(deal);
  const partnerStrategies = partnerStrategyLabels(partner);
  const strategyPillar = match.pillars.find((p) => p.key === "strategy");
  if (strategyPillar && strategyPillar.points != null && strategyPillar.points > 0 && partnerStrategies.length) {
    const overlap = (Object.keys(PARTNER_STRATEGY_FIELD) as StrategyKey[])
      .filter((k) => dealStrategies.has(k) && partner[PARTNER_STRATEGY_FIELD[k]] === true)
      .map((k) => STRATEGY_LABEL[k].toLowerCase());
    if (overlap.length) {
      clauses.push(`${overlap.join(" and ")} business plan matches your mandate`);
    }
  }

  // Missing partner-side data is stated once in the table footnote, never per row.

  // Positive notes signal only. A negative one says nothing at all.
  if (match.notesAdjustment > 0) {
    clauses.push("lines up with preferences you have shared with us");
  }

  if (!clauses.length) return "Shared for your review.";
  const joined = clauses.slice(0, 2).join("; ");
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ranking
// ─────────────────────────────────────────────────────────────────────────────

function toMatchable(deal: Deal): MatchableDeal {
  return {
    state: deal.state ?? null,
    city: deal.city ?? null,
    msa: deal.msa ?? null,
    estimated_equity: (deal.estimated_equity as number | null) ?? null,
    school_rating: (deal.school_rating as number | null) ?? null,
  };
}

function sortFits(a: DealFit, b: DealFit): number {
  if (b.score !== a.score) return b.score - a.score;
  const au = (a.deal.unit_count as number | null) ?? 0;
  const bu = (b.deal.unit_count as number | null) ?? 0;
  if (bu !== au) return bu - au;
  return (a.deal.property_name ?? "").localeCompare(b.deal.property_name ?? "");
}

export function rankDealsForPartner(
  partner: MatchablePartner,
  deals: readonly Deal[],
  notesByDeal: Record<string, { content: string }[]>,
): PartnerPipeline {
  const out: PartnerPipeline = { strong: [], moderate: [], weak: [], outside: [], unrated: [] };

  for (const deal of deals) {
    const notesText = [
      deal.notes ?? "",
      ...(notesByDeal[deal.id] ?? []).map((n) => n.content ?? ""),
    ]
      .filter(Boolean)
      .join("\n");

    const match = scorePartnerMatch(
      toMatchable(deal),
      partner,
      notesText,
      defaultDealStrategies(deal),
    );

    const fit: DealFit = {
      deal,
      score: match.score,
      tier: match.tier,
      confidence: match.confidence,
      gated: match.gated,
      gateKey: match.gateKey,
      why: buildWhyLine(match, deal, partner),
    };

    // An unpriced deal is not a bad fit — we just have not sized it yet.
    if (match.gated) {
      out.outside.push(fit);
    } else if (deal.estimated_equity == null || match.confidence === "insufficient") {
      out.unrated.push(fit);
    } else if (match.score >= TIER_THRESHOLDS.strong) {
      out.strong.push(fit);
    } else if (match.score >= TIER_THRESHOLDS.moderate) {
      out.moderate.push(fit);
    } else {
      out.weak.push(fit);
    }
  }

  (Object.keys(out) as BandKey[]).forEach((k) => out[k].sort(sortFits));
  return out;
}
