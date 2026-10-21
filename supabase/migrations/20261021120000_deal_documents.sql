-- Deal documents: upload the OM / rent roll / T12 to a deal, have the
-- parse-deal-document function read them, and review what it found before any
-- of it touches the deal.
--
-- Nothing the parser reads is written to public.deals directly. It lands in
-- deal_document_proposals as one row per field, and only
-- apply_deal_document_proposals() moves a value onto the deal — called from the
-- review panel on the deal page, with the proposals a person ticked. A misread
-- NOI that is silently written gets believed by the score; one that waits for a
-- click next to its source quote gets caught.

-- ---------- Storage ----------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('deal-documents', 'deal-documents', false, 52428800)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "deal-documents read"   ON storage.objects;
DROP POLICY IF EXISTS "deal-documents insert" ON storage.objects;
DROP POLICY IF EXISTS "deal-documents update" ON storage.objects;
DROP POLICY IF EXISTS "deal-documents delete" ON storage.objects;

CREATE POLICY "deal-documents read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'deal-documents' AND public.is_approved(auth.uid()));

CREATE POLICY "deal-documents insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'deal-documents' AND public.is_approved(auth.uid()));

CREATE POLICY "deal-documents update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'deal-documents' AND public.is_approved(auth.uid()))
  WITH CHECK (bucket_id = 'deal-documents' AND public.is_approved(auth.uid()));

CREATE POLICY "deal-documents delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'deal-documents' AND public.is_approved(auth.uid()));

-- ---------- Tables ----------
CREATE TABLE public.deal_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id           uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  storage_path      text NOT NULL UNIQUE,
  file_name         text NOT NULL,
  file_size         bigint,
  content_type      text,
  uploaded_by       uuid DEFAULT auth.uid(),
  -- What the parser decided the file is. NULL until parsed.
  doc_type          text CHECK (doc_type IN ('om', 'rent_roll', 't12', 'other')),
  -- As written in the document ("As of 9/30/2026", "T12 ending Aug 2026").
  doc_as_of         text,
  -- The property the document says it is about, shown next to the deal name so
  -- a file uploaded to the wrong deal is visible before anything is applied.
  doc_property_name text,
  parse_status      text NOT NULL DEFAULT 'pending'
                    CHECK (parse_status IN ('pending', 'parsing', 'parsed', 'failed')),
  parse_error       text,
  parse_notes       text,
  -- Lets a parse that died mid-run be retried: 'parsing' older than a few
  -- minutes is treated as abandoned rather than as a run still in flight.
  parse_started_at  timestamptz,
  parsed_at         timestamptz,
  model             text,
  extraction        jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX deal_documents_deal_idx ON public.deal_documents (deal_id, created_at DESC);

CREATE TABLE public.deal_document_proposals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id        uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  document_id    uuid NOT NULL REFERENCES public.deal_documents(id) ON DELETE CASCADE,
  field          text NOT NULL,
  value          jsonb NOT NULL,
  -- The deal's value when the proposal was made. Informational only; the review
  -- panel compares against the live deal row.
  previous_value jsonb,
  evidence       text,
  -- How much this document type is trusted for this field (rent roll beats OM
  -- for occupancy, T12 beats OM for NOI). The review panel preselects the
  -- highest-ranked candidate when two documents disagree.
  rank           smallint NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'applied', 'dismissed', 'superseded')),
  decided_by     uuid,
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX deal_document_proposals_pending_idx
  ON public.deal_document_proposals (deal_id, field)
  WHERE status = 'pending';

-- ---------- RLS: approved users, same as every other deal table ----------
DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['deal_documents', 'deal_document_proposals'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY "approved users can select" ON public.%I FOR SELECT TO authenticated USING (public.is_approved(auth.uid()))$p$, t);
    EXECUTE format($p$CREATE POLICY "approved users can insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()))$p$, t);
    EXECUTE format($p$CREATE POLICY "approved users can update" ON public.%I FOR UPDATE TO authenticated USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()))$p$, t);
    EXECUTE format($p$CREATE POLICY "approved users can delete" ON public.%I FOR DELETE TO authenticated USING (public.is_approved(auth.uid()))$p$, t);
  END LOOP;
END
$do$;

-- ---------- Apply ----------
-- Writes the chosen proposals onto their deals in one transaction and retires
-- every other pending candidate for the same field, so the panel does not offer
-- a value that was just passed over.
--
-- SECURITY INVOKER on purpose: the caller's RLS decides whether they may update
-- the deal, exactly as if they had edited the field by hand.
--
-- The field name is interpolated into the UPDATE, so it is checked against a
-- fixed list first. That list must match DEAL_DOCUMENT_FIELDS in
-- supabase/functions/_shared/dealDocuments.ts.
CREATE OR REPLACE FUNCTION public.apply_deal_document_proposals(_proposal_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  allowed CONSTANT text[] := ARRAY[
    'unit_count', 'vintage_year', 'total_sqft', 'occupancy_pct',
    'in_place_avg_rent', 'gross_scheduled_rent', 't12_noi', 't12_opex',
    'expense_ratio', 'asking_price'
  ];
  p        public.deal_document_proposals%ROWTYPE;
  col_type text;
  applied  integer := 0;
BEGIN
  IF NOT public.is_approved(auth.uid()) THEN
    RAISE EXCEPTION 'not approved' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF (SELECT count(*) FROM (
        SELECT deal_id, field FROM public.deal_document_proposals
        WHERE id = ANY(_proposal_ids)
        GROUP BY deal_id, field HAVING count(*) > 1
      ) dup) > 0 THEN
    RAISE EXCEPTION 'more than one proposal chosen for the same field' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR p IN
    SELECT * FROM public.deal_document_proposals
    WHERE id = ANY(_proposal_ids) AND status = 'pending'
    FOR UPDATE
  LOOP
    IF NOT (p.field = ANY(allowed)) THEN
      RAISE EXCEPTION 'field % cannot be applied from a document', p.field USING ERRCODE = 'invalid_parameter_value';
    END IF;

    SELECT format_type(a.atttypid, a.atttypmod) INTO col_type
    FROM pg_attribute a
    WHERE a.attrelid = 'public.deals'::regclass AND a.attname = p.field AND NOT a.attisdropped;

    EXECUTE format('UPDATE public.deals SET %I = ($1 #>> ''{}'')::%s WHERE id = $2', p.field, col_type)
      USING p.value, p.deal_id;

    UPDATE public.deal_document_proposals
       SET status = 'applied', decided_by = auth.uid(), decided_at = now()
     WHERE id = p.id;

    UPDATE public.deal_document_proposals
       SET status = 'superseded', decided_by = auth.uid(), decided_at = now()
     WHERE deal_id = p.deal_id AND field = p.field AND status = 'pending' AND id <> p.id;

    applied := applied + 1;
  END LOOP;

  RETURN applied;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_deal_document_proposals(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.apply_deal_document_proposals(uuid[]) TO authenticated;
