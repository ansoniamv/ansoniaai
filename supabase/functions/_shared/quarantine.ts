// Invalidating derived outputs when enrichment inputs are withdrawn.
//
// WHY THIS EXISTS: the 2026-09-15 quarantine cleared the HelloData-derived
// columns on 13 deals matched to the wrong building — and left every conclusion
// drawn from them standing. All 13 kept an ai_score of 24-73 stamped
// score_confidence "high", still rendering in the pipeline list and on the deal
// page, computed from another property's census tract. Clearing inputs without
// clearing outputs is worse than doing nothing: the evidence disappears and the
// verdict remains, so nothing on screen looks wrong.
//
// RULE: any path that clears or quarantines enrichment inputs must apply this in
// the SAME update. Not a follow-up job, not a rescore queue — the same write, so
// the two cannot come apart.

export const INVALIDATED_DERIVED_FIELDS = {
  ai_score: null,
  ai_score_summary: null,
  analyst_grade: null,
  factor_scores: null,
  pillar_scores: null,
  score_coverage: null,
  total_score: null,
  deal_tier: null,
  value_add_upside: null,
  passes_hard_filters: null,
  hard_filter_failures: null,
  score_thesis_adjustment: null,
  last_scored_at: null,
  scored_at: null,
  // Deliberately not null. 'insufficient' is the vocabulary deal-score already
  // uses, and the deal list suppresses the score badge on it. Null would read as
  // "never scored" rather than "scored, then invalidated".
  score_confidence: "insufficient",
} as const;
