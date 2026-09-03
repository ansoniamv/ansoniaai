// fetch-hellodata: one-call-per-deal HelloData ingest.
// - Idempotent: skips API call when hellodata_status='fetched' and payload exists.
// - Caches the full raw response on deals.hellodata_payload.
// - Never throws to the client; failures land in hellodata_status='failed'.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logApiRequest } from "../_shared/logUsage.ts";
import { requireApprovedUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HELLODATA_KEY = Deno.env.get("HELLODATA_API_KEY")!;
const HD_BASE = "https://api.hellodata.ai";

async function hd(path: string) {
  const res = await fetch(`${HD_BASE}${path}`, { headers: { "x-api-key": HELLODATA_KEY } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HelloData ${path} → ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { throw new Error(`HelloData ${path} returned non-JSON`); }
}

// Resilient fetch for the property endpoint: 20s timeout + retry on 429/5xx and network/timeout.
// Does NOT retry on 4xx like 401/404.
async function hdPropertyResilient(hdId: string) {
  const path = `/property/${encodeURIComponent(hdId)}`;
  const url = `${HD_BASE}${path}`;
  const maxAttempts = 3;
  const backoffMs = [1000, 2000, 4000];
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let nonRetriable = false;
    try {
      const res = await fetch(url, {
        headers: { "x-api-key": HELLODATA_KEY },
        signal: controller.signal,
      });
      const text = await res.text();

      if (res.ok) {
        try { return JSON.parse(text); }
        catch { throw new Error(`HelloData ${path} attempt ${attempt} returned non-JSON (status ${res.status})`); }
      }

      const retriable = res.status === 429 || (res.status >= 500 && res.status < 600);
      const msg = `HelloData ${path} attempt ${attempt}/${maxAttempts} → ${res.status}: ${text.slice(0, 300)}`;
      if (!retriable) {
        nonRetriable = true;
        throw new Error(msg);
      }
      lastErr = new Error(msg);
      console.warn(`[hellodata] retriable failure: ${msg}`);
    } catch (e: any) {
      if (nonRetriable) throw e;
      const isAbort = e?.name === "AbortError";
      lastErr = isAbort
        ? new Error(`HelloData ${path} attempt ${attempt}/${maxAttempts} → timeout after 20s`)
        : new Error(`HelloData ${path} attempt ${attempt}/${maxAttempts} → network error: ${e?.message ?? String(e)}`);
      console.warn(`[hellodata] ${lastErr.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, backoffMs[attempt - 1]));
    }
  }
  throw lastErr ?? new Error(`HelloData ${path} failed after ${maxAttempts} attempts`);
}

function buildAddressQuery(deal: any): string | null {
  const parts = [deal.address, deal.city, deal.state, deal.zip].filter(Boolean);
  if (parts.length) return parts.join(", ");
  if (deal.property_name && deal.city && deal.state) {
    return `${deal.property_name}, ${deal.city}, ${deal.state}`;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireApprovedUser(req);
  if (!auth.ok) return auth.response;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  let dealId: string | null = null;

  try {
    // --- Connector kill switch ----------------------------------------------
    const { data: connector } = await supabase
      .from("connectors")
      .select("enabled")
      .eq("key", "hellodata")
      .maybeSingle();
    if (connector && connector.enabled === false) {
      console.log("hellodata connector disabled, skipping");
      return new Response(JSON.stringify({ skipped: true, reason: "connector_disabled" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!HELLODATA_KEY) throw new Error("HELLODATA_API_KEY not configured");
    const body = await req.json().catch(() => ({}));
    dealId = body?.deal_id ?? null;
    const force: boolean = body?.force === true;
    if (!dealId) {
      return new Response(JSON.stringify({ error: "deal_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    const { data: deal, error: loadErr } = await supabase
      .from("deals").select("*").eq("id", dealId).maybeSingle();
    if (loadErr) throw loadErr;
    if (!deal) {
      return new Response(JSON.stringify({ error: "deal not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Resolve payload: reuse cached unless force ------------------------
    let payload: any = null;
    let hdId: string | null = deal.hellodata_id ?? null;
    const hasCache = deal.hellodata_status === "fetched" && deal.hellodata_payload;

    if (hasCache && !force) {
      payload = deal.hellodata_payload;
    } else {
      if (!hdId) {
        const q = buildAddressQuery(deal);
        if (!q) throw new Error("deal has no address/city/state to search HelloData");
        const search = await hd(`/property/search?q=${encodeURIComponent(q)}`);
        try { await logApiRequest(supabase, { function_name: "fetch-hellodata", service: "hellodata", provider: "HelloData", deal_id: dealId }); } catch { /* noop */ }
        const results = Array.isArray(search) ? search : (search?.results ?? []);
        const top = results[0];
        hdId = top?.id ?? top?.property_id ?? top?.hellodata_id ?? null;
        if (!hdId) throw new Error(`no HelloData match for "${q}"`);
      }
      payload = await hdPropertyResilient(hdId);
      try { await logApiRequest(supabase, { function_name: "fetch-hellodata", service: "hellodata", provider: "HelloData", deal_id: dealId }); } catch { /* noop */ }
    }

    // --- Map raw payload → flat deal columns used by the UI -----------------
    const demo = payload?.demographics ?? {};
    const bq = payload?.building_quality ?? {};
    const rev = payload?.review_analysis ?? {};
    const floorPlans = Array.isArray(payload?.floor_plans)
      ? payload.floor_plans
      : Array.isArray(payload?.unit_mix)
      ? payload.unit_mix
      : null;

    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const pct = (v: unknown) => {
      const n = num(v);
      if (n === null) return null;
      // demographics percentages arrive as 0..1 fractions → convert to 0..100
      return n <= 1 ? +(n * 100).toFixed(2) : +n.toFixed(2);
    };

    // Aggregate floor-plan level rent + DOM if present
    let inPlaceAvgRent: number | null = null;
    let avgDom: number | null = null;
    if (Array.isArray(floorPlans) && floorPlans.length) {
      let rentNum = 0, rentDen = 0, domNum = 0, domDen = 0;
      for (const fp of floorPlans) {
        const units = num(fp?.unit_count) ?? 1;
        const rent = num(fp?.avg_rent);
        const dom = num(fp?.avg_days_on_market);
        if (rent !== null) { rentNum += rent * units; rentDen += units; }
        if (dom !== null) { domNum += dom * units; domDen += units; }
      }
      if (rentDen > 0) inPlaceAvgRent = Math.round(rentNum / rentDen);
      if (domDen > 0) avgDom = Math.round(domNum / domDen);
    }

    const mapped: Record<string, unknown> = {
      msa: payload?.msa ?? null,
      vintage_year: num(payload?.year_built),
      is_lease_up: typeof payload?.is_lease_up === "boolean" ? payload.is_lease_up : null,
      property_website: payload?.building_website ?? null,
      property_address: payload?.street_address ?? null,
      ami_limits: payload?.ami_limits ?? null,
      building_quality_score:
        num(bq?.property_overall_quality) !== null
          ? Math.round((bq.property_overall_quality as number) * 100)
          : null,
      median_income_tract: num(demo?.median_income),
      median_rent_tract: num(demo?.median_rent),
      median_age_tract: num(demo?.median_age),
      vacancy_rate_tract: pct(demo?.vacant_housing_units_perc),
      bachelors_pct_tract: pct(demo?.bachelors_degree_perc),
      owner_occupied_pct_tract: pct(demo?.owner_occupied_housing_units_perc),
      population_density_tract: num(demo?.pop_density),
      review_avg_rating:
        num(rev?.avg_score) !== null ? +((rev.avg_score as number) * 5).toFixed(2) : null,
      review_count: num(rev?.count_reviews),
      floor_plans: floorPlans,
      in_place_avg_rent: inPlaceAvgRent,
      avg_time_on_market: avgDom,
    };

    // Strip nulls so we don't overwrite existing manual values with blanks.
    for (const k of Object.keys(mapped)) {
      if (mapped[k] === null || mapped[k] === undefined) delete mapped[k];
    }

    // --- Cache + mark fetched -----------------------------------------------
    const { error: updErr } = await supabase.from("deals").update({
      hellodata_id: String(hdId),
      hellodata_payload: payload,
      hellodata_raw: payload,
      hellodata_status: "fetched",
      hellodata_last_synced_at: new Date().toISOString(),
      hellodata_error: null,
      ...mapped,
    }).eq("id", dealId);
    if (updErr) throw updErr;

    return new Response(JSON.stringify({
      deal_id: dealId, status: "fetched", hellodata_id: hdId, cached: false,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    let msg: string;
    if (e instanceof Error) msg = e.message + (e.stack ? `\n${e.stack.split("\n").slice(0, 3).join("\n")}` : "");
    else { try { msg = JSON.stringify(e); } catch { msg = String(e); } }
    console.error(`[fetch-hellodata] deal=${dealId} FAILED: ${msg}`);
    if (dealId) {
      await supabase.from("deals").update({
        hellodata_status: "failed",
        hellodata_error: msg.slice(0, 1000),
      }).eq("id", dealId);
    }
    // Never throw to the client — return 200 with generic status; keep detail server-side.
    return new Response(JSON.stringify({ deal_id: dealId, status: "failed", error: "HelloData fetch failed" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
