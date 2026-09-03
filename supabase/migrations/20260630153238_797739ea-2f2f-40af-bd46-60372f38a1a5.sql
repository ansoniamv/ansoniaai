
CREATE TABLE public.connectors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.connectors TO authenticated;
GRANT ALL ON public.connectors TO service_role;

ALTER TABLE public.connectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view connectors"
  ON public.connectors FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can insert connectors"
  ON public.connectors FOR INSERT
  TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update connectors"
  ON public.connectors FOR UPDATE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete connectors"
  ON public.connectors FOR DELETE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER connectors_set_updated_at
  BEFORE UPDATE ON public.connectors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.connectors (key, name, enabled)
VALUES ('hellodata', 'HelloData', true)
ON CONFLICT (key) DO NOTHING;

-- Update trigger to honor the per-connector enabled flag
CREATE OR REPLACE FUNCTION public.trigger_fetch_hellodata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _enabled BOOLEAN;
BEGIN
  SELECT enabled INTO _enabled FROM public.connectors WHERE key = 'hellodata';
  IF COALESCE(_enabled, true) = false THEN
    RETURN NEW;
  END IF;

  IF NEW.hellodata_status IS DISTINCT FROM 'fetched' THEN
    PERFORM net.http_post(
      url := 'https://fmodmsxhujqzkibjnggo.supabase.co/functions/v1/fetch-hellodata',
      headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtb2Rtc3hodWpxemtpYmpuZ2dvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MjQ1NTksImV4cCI6MjA5MDMwMDU1OX0.PTR7zuyvuN5HfdUjxZGZUfTxaLtE-yjGp9VvJRJV0gU", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtb2Rtc3hodWpxemtpYmpuZ2dvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MjQ1NTksImV4cCI6MjA5MDMwMDU1OX0.PTR7zuyvuN5HfdUjxZGZUfTxaLtE-yjGp9VvJRJV0gU"}'::jsonb,
      body := jsonb_build_object('deal_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$function$;
