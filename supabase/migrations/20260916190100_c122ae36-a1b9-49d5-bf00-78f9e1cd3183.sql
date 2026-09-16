-- Pricing for the models Atlas runs on, so /api-status can cost the usage that
-- logAiUsage records against provider 'anthropic'.
--
-- input/output are Anthropic's published list prices. cached_input is the
-- standard 10% cache-read rate rather than a separately published figure — the
-- notes column says so, because the system prompt is now sent with
-- cache_control, which makes the cached-read rate the one that dominates the
-- bill on a busy thread. Confirm it against the pricing page before trusting a
-- cost report to the cent.
--
-- Upsert on the primary key so re-running is safe and a rate correction is a
-- one-line edit to this file.

INSERT INTO public.ai_model_pricing
  (model, provider, input_per_mtok, output_per_mtok, cached_input_per_mtok, currency, notes)
VALUES
  ('claude-opus-5',   'anthropic', 5.00, 25.00, 0.50,
   'List price. cached_input assumes the standard 10% cache-read rate — confirm against Anthropic pricing.'),
  ('claude-sonnet-5', 'anthropic', 2.00, 10.00, 0.20,
   'List price. cached_input assumes the standard 10% cache-read rate — confirm against Anthropic pricing.')
ON CONFLICT (model) DO UPDATE SET
  provider              = EXCLUDED.provider,
  input_per_mtok        = EXCLUDED.input_per_mtok,
  output_per_mtok       = EXCLUDED.output_per_mtok,
  cached_input_per_mtok = EXCLUDED.cached_input_per_mtok,
  currency              = EXCLUDED.currency,
  notes                 = EXCLUDED.notes,
  updated_at            = now();
