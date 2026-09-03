ALTER TABLE public.deals ADD COLUMN marketed boolean DEFAULT false;
ALTER TABLE public.deals ADD COLUMN ai_score integer DEFAULT NULL;
ALTER TABLE public.deals ADD COLUMN ai_score_summary text DEFAULT NULL;