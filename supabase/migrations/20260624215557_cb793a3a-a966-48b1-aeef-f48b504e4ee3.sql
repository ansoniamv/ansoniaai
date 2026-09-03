
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS score_confidence text,
  ADD COLUMN IF NOT EXISTS score_coverage jsonb;

INSERT INTO public.roadmap_items (title, description, phase, status, priority, completion_rule, sort_order)
VALUES (
  'Score coverage & confidence',
  'AI deal scores expose how much data they were built from (pillars covered, weight covered, confidence tier). LLM thesis adjustment is scaled by confidence; UI hides confident colors when data is thin.',
  'Deal Scoring Engine',
  'planned',
  'P0',
  '{"check":"scores_have_confidence","min":5}'::jsonb,
  9999
)
ON CONFLICT DO NOTHING;
