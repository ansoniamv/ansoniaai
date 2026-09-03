
-- Drop obsolete unique constraint (deal_emails is source of truth for messages now)
ALTER TABLE public.inbox_deals DROP CONSTRAINT IF EXISTS inbox_deals_email_message_id_key;

-- Backfill deal_emails from existing inbox_deals that have email content but no deal_emails row
INSERT INTO public.deal_emails (deal_id, email_message_id, subject, body, received_at, sender_email)
SELECT 
  d.id,
  d.email_message_id,
  COALESCE(d.email_subject, '(no subject)'),
  d.email_body,
  COALESCE(d.email_received_at, d.created_at),
  d.broker_contact_email
FROM public.inbox_deals d
WHERE d.email_message_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.deal_emails de WHERE de.email_message_id = d.email_message_id
  );

-- Update email_count to reflect actual deal_emails rows
UPDATE public.inbox_deals d
SET email_count = sub.cnt
FROM (SELECT deal_id, COUNT(*)::int AS cnt FROM public.deal_emails GROUP BY deal_id) sub
WHERE sub.deal_id = d.id;
