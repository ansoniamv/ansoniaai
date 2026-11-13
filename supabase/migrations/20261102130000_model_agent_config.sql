-- Where the model-run agent lives on Anthropic.
--
-- generate-model's admin "setup" action creates the environment, the
-- full-underwrite skill and the agent with the platform's own Anthropic key
-- (which only exists as a function secret), and records their ids here. Each
-- part carries the hash of the bundled definition it was made from, so setup
-- only touches what changed. The probe columns hold the latest container check.

CREATE TABLE public.model_agent_config (
  id                smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  environment_id    text,
  environment_hash  text,
  skill_id          text,
  skill_version     text,
  skill_hash        text,
  agent_id          text,
  agent_hash        text,
  probe_session_id  text,
  probe_started_at  timestamptz,
  updated_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.model_agent_config FROM anon;
GRANT SELECT ON public.model_agent_config TO authenticated;
GRANT ALL ON public.model_agent_config TO service_role;
ALTER TABLE public.model_agent_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "approved users can select" ON public.model_agent_config
  FOR SELECT TO authenticated USING (public.is_approved(auth.uid()));
