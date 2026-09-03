
CREATE TABLE public.roadmap_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  phase text NOT NULL,
  status text NOT NULL DEFAULT 'idea' CHECK (status IN ('shipped','in_progress','planned','idea')),
  priority text NOT NULL DEFAULT 'P2' CHECK (priority IN ('P0','P1','P2','P3')),
  completion_rule jsonb,
  auto_completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.roadmap_items TO authenticated;
GRANT ALL ON public.roadmap_items TO service_role;

ALTER TABLE public.roadmap_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view roadmap_items" ON public.roadmap_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert roadmap_items" ON public.roadmap_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update roadmap_items" ON public.roadmap_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete roadmap_items" ON public.roadmap_items FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_roadmap_items_updated_at
  BEFORE UPDATE ON public.roadmap_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.roadmap_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid REFERENCES public.roadmap_items(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  detail text,
  actor text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.roadmap_events TO authenticated;
GRANT ALL ON public.roadmap_events TO service_role;

ALTER TABLE public.roadmap_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view roadmap_events" ON public.roadmap_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert roadmap_events" ON public.roadmap_events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update roadmap_events" ON public.roadmap_events FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete roadmap_events" ON public.roadmap_events FOR DELETE TO authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.roadmap_items;

-- Seed
INSERT INTO public.roadmap_items (title, description, phase, status, priority, sort_order) VALUES
('Outlook inbox ingestion & dedup','Pulls broker emails from the shared inbox, dedupes, threads by deal.','Acquisition Inbox','shipped','P0',1),
('Mandate qualification gate','Rules-first geo/asset-type screen; AI only on ambiguous emails.','Acquisition Inbox','shipped','P0',2),
('Fast field extraction','Property name, units, vintage parsed at ingest + LLM backfill.','Acquisition Inbox','shipped','P1',3),
('Filtered archive with restore','Screened-out deals are auditable and restorable.','Acquisition Inbox','shipped','P1',4),
('Automated inbox sync (cron)','Scheduled sync so the inbox updates without a manual click.','Acquisition Inbox','planned','P0',5),
('OM / attachment parsing','Extract units, vintage, financials from attached offering memos.','Acquisition Inbox','idea','P2',6),
('Define scoring thesis & methodology','What actually makes a deal good: the explicit framework we score against.','Deal Scoring Engine','planned','P0',7),
('Source & prioritize data','Supply, demand, demographics, vintage, value-add — decide which signals matter and where they come from.','Deal Scoring Engine','in_progress','P0',8),
('Wire & validate data feeds','ESRI, HelloData, Census permits — connected, mapped, and trusted.','Deal Scoring Engine','in_progress','P0',9),
('Calibrate pillar weights to outcomes','Tune weights against real deals instead of guesses.','Deal Scoring Engine','planned','P1',10),
('Backtest score vs. known deals','Validate the score reproduces good/bad calls we already know.','Deal Scoring Engine','idea','P1',11),
('Replace placeholder score with validated composite','Retire today''s placeholder; ship a statistic we trust.','Deal Scoring Engine','planned','P0',12),
('Standardize & clean partner data','Foundational: normalize mandates, criteria, and history into clean structured data.','Capital Partner Matching','planned','P0',13),
('Per-partner mandate model','Each partner''s buy-box: geography, size, strategy, return targets.','Capital Partner Matching','planned','P0',14),
('Deal-to-partner matching algorithm v2','Rank partner fit per deal on standardized criteria.','Capital Partner Matching','planned','P0',15),
('Personalized outreach at scale','Templated, deal-aware outreach that stays personal across many partners.','Capital Partner Matching','planned','P1',16),
('Process tracking per partner','Know exactly where we stand with each partner in the raise.','Capital Partner Matching','in_progress','P1',17),
('Customized pipeline sharing','Share a curated pipeline view filtered to each partner''s criteria.','Capital Partner Matching','idea','P1',18),
('Engagement analytics','Track opens, replies, and interest signals.','Capital Partner Matching','idea','P2',19),
('Field-level validation on ingested data','Catch bad/missing values before they reach scoring.','Data Quality & Validation','planned','P1',20),
('Automated tests for scoring & matching','Regression tests so changes don''t silently break results.','Data Quality & Validation','planned','P1',21),
('Staging QA before publish','Review changes in staging before they reach Phil & Chase.','Data Quality & Validation','idea','P1',22),
('Edge-function monitoring & alerts','Alert when sync/scoring functions fail.','Data Quality & Validation','idea','P2',23),
('Pipeline table with inline edit','Core columns, inline edit, status, $/unit, equity formulas.','Deal Pipeline','shipped','P0',24),
('Status filters & tracking','Multi-select status filter; Tracking added; Pass hidden by default.','Deal Pipeline','shipped','P1',25),
('Persisted per-user column views','Visibility + order saved per user across sessions/devices.','Deal Pipeline','shipped','P1',26),
('Capital Partners CRM','Full partner table with inline edit, warmth, equity range, filters.','Capital Partners','shipped','P0',27),
('Partner contacts & interactions','Sub-tables with full CRUD per partner.','Capital Partners','shipped','P1',28),
('Multi-note system on deals','Inline add, timestamped, pin, delete; surfaced in pipeline hover.','Notes & Tagging','shipped','P0',29),
('Universal tags','User-defined tags across deals, partners, raise cards w/ filters.','Notes & Tagging','planned','P1',30),
('Executive dashboard','Pipeline value, status breakdown, avg AI score, recent activity.','Dashboard & Export','in_progress','P1',31),
('CSV/Excel export','Export any table view with active filters and sort.','Dashboard & Export','planned','P1',32);

UPDATE public.roadmap_items SET completed_at = updated_at WHERE status = 'shipped';
