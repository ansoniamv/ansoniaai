-- Generated pro forma models: the platform's run of the full-underwrite skill.
--
-- The generate-model function sends a deal's rent roll, T12 and OM (plus an
-- optional HelloData comps export) with the pro forma template and the
-- Novogradac workbook from Brain to an Anthropic Managed Agents session, which
-- builds the model in a container over roughly 20 minutes. The same function,
-- polled by the deal page, collects the finished .xlsx and its QC report into
-- the deal-models bucket. Only the function writes these rows and files.

-- ---------- Brain: the template and the affordability workbook ----------
-- Two Brain categories the model run reads files from: the newest file in each
-- is the one used. Like the outreach template they are not facts about the
-- firm, so the app keeps them out of the Company Brief.
ALTER TABLE public.data_room_sources DROP CONSTRAINT IF EXISTS data_room_sources_category_check;
ALTER TABLE public.data_room_sources ADD CONSTRAINT data_room_sources_category_check
  CHECK (category IN ('company', 'strategy', 'pro_forma', 'investor_deck',
                      'track_record', 'market', 'operations', 'partner_outreach',
                      'model_template', 'affordability', 'other'));

-- ---------- Storage ----------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('deal-models', 'deal-models', false, 52428800)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "deal-models read" ON storage.objects;
CREATE POLICY "deal-models read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'deal-models' AND public.is_approved(auth.uid()));

-- ---------- Table ----------
CREATE TABLE public.deal_models (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id          uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  -- starting: files going up and the session being created.
  -- running:  the agent is working; progress holds its latest PROGRESS: line.
  -- done / failed: final. A run capped by its budget ends 'done' with
  --   complete = false when it saved a model, else 'failed'.
  status           text NOT NULL DEFAULT 'starting'
                   CHECK (status IN ('starting', 'running', 'done', 'failed')),
  -- false when the agent skipped a step (result.json) or the run stopped early.
  complete         boolean,
  progress         text,
  error            text,
  -- What the run was given: {rent_roll, t12, om, comps} deal_documents ids and
  -- {template, affordability} data_room_sources ids, each with its file name.
  inputs           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The user's answers for the run: renovation_level, notes.
  options          jsonb NOT NULL DEFAULT '{}'::jsonb,
  session_id       text,
  -- Files uploaded to Anthropic for the session, deleted once the run ends.
  anthropic_file_ids text[] NOT NULL DEFAULT '{}',
  -- Event polling: the page cursor the last poll read from and the newest event
  -- id seen, so each poll reads only what is new.
  events_page      text,
  last_event_id    text,
  -- What the events said so far: {stopReason, terminated, lastMessage, errors}.
  event_state      jsonb,
  storage_path     text,
  file_name        text,
  qc_report        text,
  skipped          jsonb,
  -- The session's list cost (USD), as Anthropic reports it.
  cost_usd         numeric,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  checked_at       timestamptz
);

CREATE INDEX deal_models_deal_idx ON public.deal_models (deal_id, created_at DESC);

-- One run at a time per deal: a second click while one runs would pay twice.
CREATE UNIQUE INDEX deal_models_one_active
  ON public.deal_models (deal_id)
  WHERE status IN ('starting', 'running');

-- ---------- RLS: approved users read; only the function writes ----------
REVOKE ALL ON public.deal_models FROM anon;
GRANT SELECT ON public.deal_models TO authenticated;
GRANT ALL ON public.deal_models TO service_role;
ALTER TABLE public.deal_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "approved users can select" ON public.deal_models
  FOR SELECT TO authenticated USING (public.is_approved(auth.uid()));
