-- Remove the internal-partner concept.
--
-- The feature existed so Ansonia's own record could live in `partners` without
-- being treated as an outside capital source: it was hidden from partner lists,
-- matching, suggestions, tearsheets and every LLM prompt. That product decision
-- has been reversed. The record stays and is now an ordinary capital partner,
-- so the flag and everything keyed off it have nothing left to gate.
--
-- CONSEQUENCE, stated plainly: `Ansonia Properties, LLC` is from here on a
-- normal row. It appears in the partner list, is eligible for suggestions and
-- matching, can receive a tearsheet, and is passed to the model by chat's
-- query_table and by summarize-deal-denials. That is the intended outcome, not
-- an oversight.
--
-- No rows are deleted. Dropping the column loses only the flag itself.

DROP INDEX IF EXISTS public.partners_is_internal_idx;

ALTER TABLE public.partners
  DROP COLUMN IF EXISTS is_internal;

-- Pinning existed only for the Atlas Feed on the internal desk, which is gone.
-- Zero rows have ever been pinned, so this drops no data.
DROP INDEX IF EXISTS public.outlook_messages_pinned_at_idx;

ALTER TABLE public.outlook_messages
  DROP COLUMN IF EXISTS pinned_at;
