
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS analyst_grade text
  CHECK (analyst_grade IS NULL OR analyst_grade IN ('A','B','C','Pass'));

INSERT INTO public.roadmap_items (title, description, phase, status, priority, completion_rule, sort_order)
VALUES (
  'Backtest score vs. known deals',
  'Compare ai_score against analyst_grade across the portfolio. Auto-completes once 10+ deals are graded.',
  'Deal Scoring Engine',
  'planned',
  'P1',
  '{"check":"backtest_available","min":10}'::jsonb,
  9999
)
ON CONFLICT DO NOTHING;

INSERT INTO public.roadmap_items (title, description, phase, status, priority, sort_order)
VALUES (
  'Calibrate pillar weights to outcomes',
  'Adjust pillar weights and signal thresholds based on backtest results. Manual sign-off when correlation looks right.',
  'Deal Scoring Engine',
  'planned',
  'P1',
  9999
)
ON CONFLICT DO NOTHING;
