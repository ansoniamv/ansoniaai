ALTER TABLE public.partner_pipeline_exports ALTER COLUMN format SET DEFAULT 'pdf';
UPDATE public.partner_pipeline_exports SET format = 'pdf' WHERE format <> 'pdf';