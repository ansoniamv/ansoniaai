-- Pricing rows for the models the platform actually runs on.
--
-- logUsage.ts looks up ai_model_pricing by the model id the API RETURNS, and a
-- miss logs cost_usd = 0 rather than erroring. That is silent under-counting,
-- and the budget guard reads these same numbers — so a missing row does not
-- merely misreport a bill, it makes spend invisible to the control meant to cap
-- it. Measured before this migration: 138 gate-deals calls on Haiku, 346,783
-- input tokens, logged at $0.0000.
--
-- BOTH the alias and the dated snapshot are inserted for Haiku, because the API
-- resolves `claude-haiku-4-5` and returns `claude-haiku-4-5-20251001`. It is the
-- returned id that gets logged and looked up, so an alias-only row would never
-- match. Sonnet 5 and Opus 5.5 return their bare ids and need only one row each.
--
-- Rates checked against the published pricing page rather than recalled:
--   Haiku 4.5    $1 / $5    per MTok   (cache read $0.10)
--   Opus 5.5     $4 / $20              (cache read $0.20)
-- Note claude-opus-5 is now LEGACY at $5/$25; 5.5 is both newer and cheaper,
-- which is why chat moved to it.

insert into public.ai_model_pricing
  (model, provider, input_per_mtok, output_per_mtok, cached_input_per_mtok, currency, notes)
values
  ('claude-haiku-4-5',          'anthropic', 1.00,  5.00, 0.10, 'USD',
   'List price. Alias row; the API returns the dated id, which has its own row.'),
  ('claude-haiku-4-5-20251001', 'anthropic', 1.00,  5.00, 0.10, 'USD',
   'List price. This is the id the API actually returns for claude-haiku-4-5.'),
  ('claude-opus-5-5',           'anthropic', 4.00, 20.00, 0.20, 'USD',
   'List price. Current Opus; claude-opus-5 is legacy at 5.00/25.00.')
on conflict (model) do update
  set input_per_mtok        = excluded.input_per_mtok,
      output_per_mtok       = excluded.output_per_mtok,
      cached_input_per_mtok = excluded.cached_input_per_mtok,
      provider              = excluded.provider,
      notes                 = excluded.notes,
      updated_at            = now();

-- Backfill cost_usd on rows already logged at 0 because the price was missing.
-- Only touches rows where the cost is provably wrong: a priced model, real
-- tokens, and a recorded cost of zero.
update public.ai_usage_log u
set cost_usd = round(
      (u.input_tokens  / 1000000.0) * p.input_per_mtok +
      (u.output_tokens / 1000000.0) * p.output_per_mtok
    , 6)
from public.ai_model_pricing p
where p.model = u.model
  and u.provider = 'anthropic'
  and coalesce(u.cost_usd, 0) = 0
  and (coalesce(u.input_tokens, 0) > 0 or coalesce(u.output_tokens, 0) > 0)
  and u.success;
