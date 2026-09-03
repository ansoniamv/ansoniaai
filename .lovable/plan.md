## Buy Box Rewire — Weighted Pillars + Thesis + Auto-Scoring

### 1. Database (single migration)

**New tables:**

- `buy_box_pillars` — the 6 weighted pillars
  - `key` (text, unique: `market_demand`, `market_supply`, `location`, `asset_quality`, `value_add`, `deal_economics`)
  - `name`, `description`, `weight` (int, % — should sum to 100), `sort_order`, `is_active`
  - Seeded with the 6 pillars at 20/25/10/15/20/10

- `buy_box_signals` — sub-signals inside each pillar (data-driven scoring rules)
  - `pillar_id` FK → `buy_box_pillars`
  - `name`, `description`
  - `field_source` (text — e.g. `deals.in_place_avg_rent`, `deal_enrichment.rings.demographics.pop_growth_5yr`, `permits.permits_per_1k_units`)
  - `scoring_method` (`higher_better` | `lower_better` | `range_optimal` | `boolean`)
  - `min_value`, `max_value`, `optimal_min`, `optimal_max` (numerics, nullable)
  - `weight_within_pillar` (int — % of pillar's score)
  - `is_active`
  - Seeded with ~20 sensible defaults

- `buy_box_thesis` — singleton free-text investment thesis
  - `id`, `content` (text), `last_updated_by`, `updated_at`
  - One row, edited inline

- `permits_data` — Census BPS cache (per CBSA, monthly)
  - `cbsa_code`, `cbsa_name`, `year`, `month`, `multifamily_permits`, `total_units`, `created_at`
  - Unique on (cbsa_code, year, month)

**Drop:** `buy_box_criteria` table (and its UI). Confirmed by user.

**New deal columns:** `pillar_scores jsonb` (per-pillar 0-100 + sub-signal contributions, for transparency), `score_thesis_adjustment int` (the LLM nudge), `last_scored_at timestamptz`

All RLS = public (matches current project pattern).

### 2. Edge functions

- `permits-enrich` — fetch Census BPS data for a CBSA, cache in `permits_data`. Free, no API key needed. Called on demand by `deal-score`.
- `deal-score` — the brain:
  1. Ensures `esri-enrich`, `hellodata-enrich`, `schools-enrich`, `permits-enrich` have run for the deal
  2. Loads pillars + signals + thesis from DB
  3. Computes each sub-signal score (0-100) from the deal's enriched data using the scoring method
  4. Aggregates → pillar scores → weighted final score
  5. Sends thesis + deal summary + pillar breakdown to Lovable AI (`google/gemini-3-flash-preview`) → returns narrative + adjustment (-10 to +10)
  6. Writes `ai_score`, `ai_score_summary`, `pillar_scores`, `score_thesis_adjustment`, `last_scored_at` back to `deals`

### 3. Auto-scoring triggers

- **On creation:** `NewDeal.tsx` invokes `deal-score` after `createDeal` succeeds (fire-and-forget, toast on failure).
- **Nightly:** pg_cron job at 3am UTC iterates all deals and POSTs to `deal-score` (sequential to avoid rate limits). Setup via insert tool, not migration.
- **Manual:** "Re-score" button on Deal Detail page.

### 4. Frontend rewrite — `BuyBoxPage.tsx`

Three sections:

```text
┌─ Investment Thesis ─────────────────────────┐
│ [large textarea — narrative of what we      │
│  want, edge cases, deal-breakers, etc.]     │
│                              [Save thesis]  │
└─────────────────────────────────────────────┘

┌─ Pillar Weights (must total 100%) ──────────┐
│ Market Demand & Demographics      [20] %    │
│ Market Supply & Rent Dynamics     [25] %    │
│ Location & Accessibility          [10] %    │
│ Asset Quality & Vintage           [15] %    │
│ Value-Add Opportunity             [20] %    │
│ Deal Economics                    [10] %    │
│ ──────────────────────────────────────────  │
│ Total: 100% ✓               [Save weights]  │
└─────────────────────────────────────────────┘

┌─ Signals (collapsed per pillar) ────────────┐
│ ▶ Market Demand & Demographics              │
│   • Population growth (5yr)  higher_better  │
│     min:0  max:15  weight:25%               │
│   • Median income            higher_better  │
│   ... [Add signal]                          │
└─────────────────────────────────────────────┘
```

Live total indicator turns red when weights don't sum to 100. Each signal row is editable inline (same pattern as current criteria rows). A "Re-score all deals" button at the top triggers the nightly job on demand.

### 5. Deal Detail score breakdown

Add a small "Score Breakdown" card on `DealDetail.tsx` that reads `pillar_scores` jsonb and shows each pillar's score + the AI narrative. Lets you see *why* a deal scored what it did.

### Files

**Created:**
- `supabase/functions/permits-enrich/index.ts`
- `supabase/functions/deal-score/index.ts`
- `src/hooks/useBuyBoxPillars.ts`
- `src/hooks/useBuyBoxThesis.ts`
- `src/components/ScoreBreakdown.tsx`
- migration file (tables + seeds)

**Edited:**
- `src/pages/BuyBoxPage.tsx` — full rewrite
- `src/pages/NewDeal.tsx` — trigger `deal-score` after create
- `src/pages/DealDetail.tsx` — add ScoreBreakdown + Re-score button
- `src/hooks/useBuyBoxCriteria.ts` — delete

**Deleted:**
- `buy_box_criteria` table (after migration)

### Sequence

1. Run migration (tables + seeds) — needs your approval
2. Insert pg_cron schedule (separate insert call, contains project-specific URL)
3. Build edge functions
4. Rewrite BuyBoxPage + add hooks
5. Wire auto-scoring into NewDeal
6. Add ScoreBreakdown to DealDetail

This is a big rewire — about 30-45 min of work. Approving the plan kicks it off, starting with the migration.