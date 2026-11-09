-- Deal agents: sign a deal's CA on the firm's behalf, and bring its OM / rent
-- roll / T12 onto the deal.
--
-- Accepting an inbox deal into the pipeline starts a CA run (deal-agents
-- function). The run finds the CA link in the deal's emails and hands it to an
-- Anthropic Managed Agents session, which opens the page in a headless browser,
-- reads the agreement, signs it as the signer profile below when its terms are
-- standard, and downloads the deal room's documents. A CA with unusual terms is
-- not signed: the run stops at 'needs_approval' with the clauses quoted, and
-- only a person's Approve continues it.
--
-- Separately, underwriting files attached to a pipeline deal's emails are copied
-- onto the deal (deal_document_imports keeps that idempotent).

-- ---------- Who signs ----------
-- One row. Portal passwords are NOT here: they live in an Anthropic vault and
-- are substituted into the browser's login request at egress, so neither this
-- database nor the agent's sandbox ever holds them. portal_logins lists only
-- the non-secret half (which portal, which username, which hosts).
CREATE TABLE public.ca_signer_profile (
  id              smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  full_name       text NOT NULL,
  title           text,
  company         text NOT NULL,
  email           text NOT NULL,
  phone           text,
  address_line    text,
  city            text,
  state           text,
  zip             text,
  -- Image of the signature, in the agent-files bucket. Used only by portals
  -- that ask for an uploaded or drawn signature; most take a typed name.
  signature_path  text,
  -- Off until someone turns it on. Accepting a deal then still records the run,
  -- but it waits instead of signing.
  enabled         boolean NOT NULL DEFAULT false,
  portal_logins   jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid
);

INSERT INTO public.ca_signer_profile (full_name, company, email, address_line, city, state, zip)
VALUES ('Daniel Stevens', 'Ansonia Properties, LLC', 'dstevens@ansoniaproperties.com',
        '815 W Van Buren St, Suite 550', 'Chicago', 'IL', '60607')
ON CONFLICT (id) DO NOTHING;

-- ---------- Agent ids on Anthropic ----------
CREATE TABLE public.deal_agent_config (
  id               smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  agent_id         text,
  agent_version    integer,
  agent_hash       text,
  environment_id   text,
  environment_hash text,
  vault_id         text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid
);
INSERT INTO public.deal_agent_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------- CA runs ----------
CREATE TABLE public.deal_ca_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id          uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'starting'
                   CHECK (status IN ('starting', 'running', 'needs_approval', 'needs_attention',
                                     'done', 'failed', 'cancelled', 'disabled', 'no_link')),
  ca_url           text,
  platform         text,
  deal_room_urls   jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The email the link came from (deal_emails.id).
  source_email_id  uuid,
  session_id       text,
  progress         text,
  -- What the agent found in the agreement.
  ca_standard      boolean,
  ca_summary       text,
  ca_flags         jsonb NOT NULL DEFAULT '[]'::jsonb,
  ca_text_path     text,
  signed_copy_path text,
  -- Who the agreement was signed as, copied at signing time.
  signed_as        jsonb,
  signed_at        timestamptz,
  documents_found  integer NOT NULL DEFAULT 0,
  documents_added  integer NOT NULL DEFAULT 0,
  attention        text,
  error            text,
  agent_notes      text,
  cost_usd         numeric(10, 4),
  -- Event-reading state between checks (see generate-model for the pattern).
  events_page      text,
  last_event_id    text,
  event_state      jsonb,
  checked_at       timestamptz,
  approved_by      uuid,
  approved_at      timestamptz,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz
);

CREATE INDEX deal_ca_runs_deal_idx ON public.deal_ca_runs (deal_id, created_at DESC);
-- One open run per deal; a second Accept or a double click finds the first.
CREATE UNIQUE INDEX deal_ca_runs_one_open_idx ON public.deal_ca_runs (deal_id)
  WHERE status IN ('starting', 'running', 'needs_approval');

-- ---------- Imported files ----------
CREATE TABLE public.deal_document_imports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id       uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  source        text NOT NULL CHECK (source IN ('email', 'portal')),
  -- Graph message id + attachment id, or the agent session's file id.
  source_ref    text NOT NULL,
  content_hash  text NOT NULL,
  file_name     text NOT NULL,
  document_id   uuid REFERENCES public.deal_documents(id) ON DELETE SET NULL,
  ca_run_id     uuid REFERENCES public.deal_ca_runs(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, source_ref),
  -- The same OM attached to three emails, or downloaded and also emailed, is one document.
  UNIQUE (deal_id, content_hash)
);

-- ---------- RLS ----------
-- Everyone approved can see runs and imports; only the deal-agents function
-- (service role) writes them. The signer profile is readable by approved users
-- and editable by admins.
DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['deal_ca_runs', 'deal_document_imports', 'ca_signer_profile', 'deal_agent_config'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY "approved users can select" ON public.%I FOR SELECT TO authenticated USING (public.is_approved(auth.uid()))$p$, t);
  END LOOP;
END
$do$;

GRANT UPDATE ON public.ca_signer_profile TO authenticated;
CREATE POLICY "admins can update" ON public.ca_signer_profile FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------- Storage: the signature image ----------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('agent-files', 'agent-files', false, 5242880)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "agent-files read"   ON storage.objects;
DROP POLICY IF EXISTS "agent-files write"  ON storage.objects;
DROP POLICY IF EXISTS "agent-files update" ON storage.objects;
DROP POLICY IF EXISTS "agent-files delete" ON storage.objects;
CREATE POLICY "agent-files read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'agent-files' AND public.is_approved(auth.uid()));
CREATE POLICY "agent-files write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'agent-files' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "agent-files update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'agent-files' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'agent-files' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "agent-files delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'agent-files' AND public.has_role(auth.uid(), 'admin'));
