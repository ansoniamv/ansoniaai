-- Add 'Tracking' to deal_status enum
ALTER TYPE public.deal_status ADD VALUE IF NOT EXISTS 'Tracking';

-- Create interest_level enum
DO $$ BEGIN
  CREATE TYPE public.interest_level AS ENUM ('High','Med','Low','TBD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add interest_level column to deals (default TBD, applies to existing rows)
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS interest_level public.interest_level NOT NULL DEFAULT 'TBD';
