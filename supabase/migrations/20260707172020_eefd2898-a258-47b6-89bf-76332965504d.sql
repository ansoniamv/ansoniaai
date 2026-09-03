
-- Enums
CREATE TYPE public.raise_engagement_stage AS ENUM (
  'initial_reachout','materials_shared','discussion_scheduled','serious_interest','committed','passed'
);
CREATE TYPE public.deal_raise_status AS ENUM (
  'not_started','raising','fully_committed','closed'
);

-- Deals additions
ALTER TABLE public.deals
  ADD COLUMN raise_status public.deal_raise_status NOT NULL DEFAULT 'not_started',
  ADD COLUMN target_raise numeric,
  ADD COLUMN total_committed numeric NOT NULL DEFAULT 0;

-- Engagements table
CREATE TABLE public.capital_raise_engagements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  stage public.raise_engagement_stage NOT NULL DEFAULT 'initial_reachout',
  initial_reachout_date date,
  materials_shared_date date,
  materials_shared_items text,
  discussion_scheduled_date timestamptz,
  serious_interest boolean NOT NULL DEFAULT false,
  indicated_amount numeric,
  committed_amount numeric,
  passed boolean NOT NULL DEFAULT false,
  pass_price_surmountable boolean,
  pass_feedback text,
  last_contact_date date,
  next_action text,
  next_action_date date,
  owner text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, partner_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.capital_raise_engagements TO authenticated;
GRANT ALL ON public.capital_raise_engagements TO service_role;

ALTER TABLE public.capital_raise_engagements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all read access" ON public.capital_raise_engagements FOR SELECT USING (true);
CREATE POLICY "Allow all insert access" ON public.capital_raise_engagements FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update access" ON public.capital_raise_engagements FOR UPDATE USING (true);
CREATE POLICY "Allow all delete access" ON public.capital_raise_engagements FOR DELETE USING (true);

CREATE TRIGGER update_capital_raise_engagements_updated_at
  BEFORE UPDATE ON public.capital_raise_engagements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_cre_deal_id ON public.capital_raise_engagements(deal_id);
CREATE INDEX idx_cre_partner_id ON public.capital_raise_engagements(partner_id);
