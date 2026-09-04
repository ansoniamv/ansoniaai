import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mapHelloDataProperty } from "../_shared/hellodataMapping.ts";
import { logApiRequest } from "../_shared/logUsage.ts";
import { corsFor, requireApprovedUser } from "../_shared/auth.ts";
import { errorResponse } from "../_shared/errors.ts";

async function fetchWithRetry(url: string, apiKey: string): Promise<Response> {
  const maxAttempts = 2; // one retry
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, {
        headers: { "x-api-key": apiKey },
        signal: controller.signal,
      });
      const retriable = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (res.ok || !retriable) return res;
      lastErr = new Error(`HelloData ${res.status}`);
    } catch (e: any) {
      lastErr = e?.name === "AbortError" ? new Error("HelloData timeout after 15s") : e;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 1500));
  }
  throw lastErr ?? new Error("HelloData request failed");
}

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Each call is up to two billed HelloData lookups.
  const authz = await requireApprovedUser(req);
  if (!authz.ok) return authz.response;

  try {
    const apiKey = Deno.env.get("HELLODATA_API_KEY");
    if (!apiKey) throw new Error("HELLODATA_API_KEY not configured");

    const { hellodata_id } = await req.json();
    if (!hellodata_id) throw new Error("hellodata_id required");

    const res = await fetchWithRetry(`https://api.hellodata.ai/property/${hellodata_id}`, apiKey);
    try {
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await logApiRequest(supabase, { function_name: "hellodata-detail", service: "hellodata", provider: "HelloData", success: res.ok });
    } catch { /* noop */ }
    const text = await res.text();
    if (!res.ok) {
      return errorResponse(new Error(`hellodata ${res.status}: ${text}`), corsHeaders, {
        fn: "hellodata-detail",
        status: res.status >= 500 ? 502 : 400,
        publicMessage: "Property lookup is unavailable right now.",
      });
    }
    const p = JSON.parse(text);
    const { update } = mapHelloDataProperty(p);

    // Fields the intake form can consume. Broker / asking price / est equity
    // intentionally omitted — those are broker-supplied.
    const fields = {
      property_name: update.property_name,
      property_address: update.property_address,
      street_address: update.street_address_raw,
      city: update.city,
      state: update.state,
      zip: update.zip,
      msa: update.msa,
      unit_count: update.unit_count,
      vintage_year: update.vintage_year,
      management_company: update.management_company,
      in_place_avg_rent: update.in_place_avg_rent,
      building_quality_score: update.building_quality_score,
      review_avg_rating: update.review_avg_rating,
      review_count: update.review_count,
      photo_urls: update.photo_urls,
    };

    return new Response(JSON.stringify({ fields }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
