-- The computed read of a deal document: unit mix, loss-to-lease, expirations,
-- delinquency and other income for a rent roll; categories, T3 and totals for a
-- T12; facts, metrics and amenities for an OM; plus the cross-checks against
-- the document's own totals. Built by summarizeDetail() in
-- supabase/functions/_shared/dealDocumentDetail.ts and shown on the deal page.
--
-- Separate from `extraction` (the model's raw transcription) so the page reads
-- one small object instead of every unit row.
ALTER TABLE public.deal_documents ADD COLUMN IF NOT EXISTS summary jsonb;
