-- Free-text companion to cfo_date: off-market deals have no call for offers,
-- and the Pipeline CFO cell should say so ("Off Market", "TBD — broker to
-- advise") instead of showing a bare dash. cfo_date stays a real date so the
-- column still sorts chronologically.
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS cfo_note text;
