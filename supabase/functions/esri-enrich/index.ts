import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logApiRequest } from "../_shared/logUsage.ts";
import { getArcGISToken } from "../_shared/arcgisToken.ts";
import { corsFor, requireUserOrService } from "../_shared/auth.ts";
import { isAddressLevel, GEOCODE_COUNTRY } from "../_shared/esriMatch.ts";

const RING_LABELS = ["1mi", "3mi", "5mi"];
const GEOCODE_CONFIDENCE_THRESHOLD = 85;

/**
 * Esri GeoEnrichment data collections requested per ring.
 * NOTE: "AtRisk" and "Policy" were removed as unused (not read by the UI or
 * scoring) — re-add either here if a future feature consumes them.
 */
const ESRI_DATA_COLLECTIONS = [
  "KeyUSFacts",
  "HouseholdsByIncome",
  "educationalattainment",
  "raceandhispanicorigin",
  "Tapestry",
  "housingunittotals",
  "crime",
];

function arcgisErrorMessage(context: string, error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: number }).code : undefined;
  // The raw ArcGIS body, the name of the secret, and its restriction posture are
  // operator detail: they belong in the log, never in a value that reaches the
  // client (this string is surfaced to the browser via the catch handler below).
  console.error(`[esri-enrich] ${context} raw:`, JSON.stringify(error));
  if (code === 498 || code === 499) {
    return `${context} error: upstream credential rejected (code ${code}). See function logs.`;
  }
  return `${context} error: upstream request failed.`;
}

const DEFAULT_MONTHLY_CAP_USD = 250;
const DEFAULT_WARN_THRESHOLD_PCT = 0.8;

/**
 * Reads the configurable Esri budget settings (connectors row key='esri')
 * and sums this calendar month's Esri spend from ai_usage_log.
 */
async function getEsriBudget(supabase: any) {
  const { data: cfgRow } = await supabase
    .from("connectors")
    .select("config")
    .eq("key", "esri")
    .maybeSingle();
  const cfg = (cfgRow?.config ?? {}) as Record<string, unknown>;
  const cap = Number(cfg.monthly_cap_usd);
  const warnPct = Number(cfg.warn_threshold_pct);
  const monthlyCap = Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_MONTHLY_CAP_USD;
  const warnThresholdPct = Number.isFinite(warnPct) && warnPct > 0 && warnPct <= 1
    ? warnPct
    : DEFAULT_WARN_THRESHOLD_PCT;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const { data: rows } = await supabase
    .from("ai_usage_log")
    .select("cost_usd")
    .like("service", "esri%")
    .gte("created_at", monthStart);

  const spend = (rows ?? []).reduce(
    (sum: number, r: { cost_usd: number | null }) => sum + Number(r.cost_usd ?? 0),
    0,
  );

  return {
    spend: Math.round(spend * 100) / 100,
    monthlyCap,
    warnThresholdPct,
    overCap: spend >= monthlyCap,
    nearCap: spend >= monthlyCap * warnThresholdPct,
  };
}



// --- Access token selection ------------------------------------------------
// Delegated to ../_shared/arcgisToken.ts so the api-status probe exercises the
// exact same credential selection as this production path.


// --- Resilient fetch -------------------------------------------------------
// 20s AbortController timeout, up to 3 attempts with 1s/2s/4s backoff on
// 429 / 5xx / network/timeout errors. 4xx (except 429) fails immediately.
async function arcgisFetch(url: string, init: RequestInit, label: string): Promise<Response> {
  const maxAttempts = 3;
  const backoffMs = [1000, 2000, 4000];
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let nonRetriable = false;
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      // ArcGIS often returns 200 with an error body; let callers parse JSON
      // and decide. Retry only on transport-level retriable statuses here.
      if (res.ok) return res;

      const retriable = res.status === 429 || (res.status >= 500 && res.status < 600);
      const txt = await res.text().catch(() => "");
      const msg = `ArcGIS ${label} attempt ${attempt}/${maxAttempts} → ${res.status}: ${txt.slice(0, 300)}`;
      if (!retriable) {
        nonRetriable = true;
        throw new Error(msg);
      }
      lastErr = new Error(msg);
      console.warn(`[esri-enrich] retriable: ${msg}`);
    } catch (e: any) {
      if (nonRetriable) throw e;
      const isAbort = e?.name === "AbortError";
      lastErr = isAbort
        ? new Error(`ArcGIS ${label} attempt ${attempt}/${maxAttempts} → timeout after 20s`)
        : new Error(`ArcGIS ${label} attempt ${attempt}/${maxAttempts} → network error: ${e?.message ?? String(e)}`);
      console.warn(`[esri-enrich] ${lastErr.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, backoffMs[attempt - 1]));
    }
  }
  throw lastErr ?? new Error(`ArcGIS ${label} failed after ${maxAttempts} attempts`);
}


async function geocode(address: string, token: string) {
  const url = new URL("https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates");
  url.searchParams.set("SingleLine", address);
  url.searchParams.set("f", "json");
  url.searchParams.set("maxLocations", "1");
  url.searchParams.set("outFields", "Score,Match_addr,Addr_type"); // ensure Score is returned
  // Restrict to the United States. Without this the World geocoder is free to
  // match a property NAME anywhere on earth: "K Square" returned a London POI at
  // 51.4762/-0.2145 with a score of 100, and that is how a Chicago deal came to
  // be stored in south-west London. countryCode is the documented parameter for
  // findAddressCandidates — confirmed against the service metadata, which lists
  // the supported country codes — and a live call with countryCode=USA no longer
  // returns the London match.
  url.searchParams.set("countryCode", GEOCODE_COUNTRY);
  url.searchParams.set("token", token);
  const res = await arcgisFetch(url.toString(), {}, "Geocode");
  const json = await res.json();
  if (json?.error) throw new Error(arcgisErrorMessage("Geocode", json.error));
  const cand = json?.candidates?.[0];
  if (!cand) throw new Error("Geocoding failed: no candidate found");
  const score = typeof cand.score === "number"
    ? cand.score
    : (typeof cand.attributes?.Score === "number" ? cand.attributes.Score : null);
  const matchAddr = cand.address ?? cand.attributes?.Match_addr ?? null;
  const addrType: string | null = cand.attributes?.Addr_type ?? null;
  return { lat: cand.location.y, lon: cand.location.x, matchAddr, score, addrType };
}

async function enrich(lat: number, lon: number, token: string) {
  const studyAreas = [{
    geometry: { x: lon, y: lat, spatialReference: { wkid: 4326 } },
    areaType: "RingBuffer",
    bufferUnits: "Miles",
    bufferRadii: [1, 3, 5],
  }];
  const dataCollections = ESRI_DATA_COLLECTIONS;

  const url = "https://geoenrich.arcgis.com/arcgis/rest/services/World/geoenrichmentserver/GeoEnrichment/enrich";
  const body = new URLSearchParams();
  body.set("studyAreas", JSON.stringify(studyAreas));
  body.set("dataCollections", JSON.stringify(dataCollections));
  body.set("useData", JSON.stringify({ sourceCountry: "US" }));
  body.set("returnGeometry", "false");
  body.set("f", "json");
  body.set("token", token);

  const res = await arcgisFetch(url, { method: "POST", body }, "enrich");
  const json = await res.json();
  if (json.error) throw new Error(arcgisErrorMessage("ArcGIS enrich", json.error));

  const features = json?.results?.[0]?.value?.FeatureSet?.[0]?.features ?? [];
  const rings: Record<string, any> = {};
  features.forEach((f: any, i: number) => {
    if (RING_LABELS[i]) rings[RING_LABELS[i]] = f.attributes;
  });
  return { rings, raw: json };
}

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Consumes metered ArcGIS credits and rewrites deal enrichment + coordinates.
  // Accepts an approved user (the UI) or a trusted service caller, the same
    // pattern as geocode-deals, score-deals and deal-score. A backfill cannot
    // present a user JWT, and geocode_only exists to be run as one.
    const authz = await requireUserOrService(req);
    if (authz && !authz.ok) return authz.response;

  try {
    const { token, source: tokenSource } = await getArcGISToken(
      (u, i) => arcgisFetch(u, i, "OAuth token"),
    );
    console.log(`[esri-enrich] credential in use: ${tokenSource}`);

    const { deal_id, address, force, geocode_only } = await req.json();
    if (!deal_id || !address) throw new Error("deal_id and address required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Cache check: enrich each deal at most once. Once a deal_enrichment row
    // exists with non-empty rings, always return it as cached regardless of age
    // — never auto re-pull. Only `force: true` bypasses the cache.
    if (!force) {
      const { data: existing } = await supabase
        .from("deal_enrichment")
        .select("*")
        .eq("deal_id", deal_id)
        .maybeSingle();
      if (existing && existing.rings) {
        const syncedAt = existing.updated_at ? new Date(existing.updated_at).getTime() : 0;
        const ageSeconds = syncedAt ? Math.round((Date.now() - syncedAt) / 1000) : null;
        return new Response(JSON.stringify({
          enrichment: existing,
          cached: true,
          age_seconds: ageSeconds,
          synced_at: existing.updated_at,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // --- Monthly spend ceiling (cached returns above are never blocked) -----
    const budget = await getEsriBudget(supabase);
    if (budget.overCap) {
      const message = `Monthly Esri budget reached ($${budget.spend.toFixed(2)} of $${budget.monthlyCap.toFixed(2)}). Enrichment paused — raise the cap to continue.`;
      console.warn(`[esri-enrich] deal=${deal_id} blocked: ${message}`);
      await logApiRequest(supabase, {
        function_name: "esri-enrich",
        service: "esri_credit",
        provider: "Esri",
        deal_id,
        units: 0,
        success: false,
      });
      return new Response(JSON.stringify({
        error: message,
        budget_blocked: true,
        month_spend_usd: budget.spend,
        monthly_cap_usd: budget.monthlyCap,
      }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const budgetWarning = budget.nearCap
      ? `Esri spend is at $${budget.spend.toFixed(2)} of the $${budget.monthlyCap.toFixed(2)} monthly cap (${Math.round((budget.spend / budget.monthlyCap) * 100)}%). Enrichment will pause when the cap is reached.`
      : null;

    // --- Geocode (paid) ----------------------------------------------------

    let geo;
    try {
      geo = await geocode(address, token);
    } catch (err) {
      await logApiRequest(supabase, {
        function_name: "esri-enrich",
        service: "esri_geocode",
        provider: "Esri",
        deal_id,
        units: 0,
        success: false,
      });
      throw err;
    }
    const { lat, lon, matchAddr, score, addrType } = geo;
    await logApiRequest(supabase, {
      function_name: "esri-enrich",
      service: "esri_geocode",
      provider: "Esri",
      deal_id,
      units: 1,
    });

    // Stop BEFORE the paid enrichment when the point is not a property.
    //
    // Both of these used to only warn, and the enrichment ran anyway — which is
    // how rings and a crime index came to be measured around a city centroid and
    // stored as though they described the asset. Each of those calls costs ~40
    // ArcGIS credits, so proceeding on a bad point buys a wrong answer at full
    // price. No coordinates are written either: a wrong pin is worse than none.
    //
    // The type check is the one that matters. Locality, Postal, POI and
    // StreetName all score at or above the 85 threshold on live calls, so score
    // alone cannot separate a rooftop from a city centre.
    if (!isAddressLevel(addrType)) {
      const message =
        `Geocode matched "${matchAddr}" as ${addrType ?? "an unknown type"}, which is not an address-level ` +
        `result (need PointAddress, StreetAddress or Subaddress). Add a street address to this deal. ` +
        `Enrichment was not run and no coordinates were stored.`;
      console.warn(`[esri-enrich] deal=${deal_id} rejected addr_type=${addrType} input="${address}"`);
      await supabase.from("deals").update({ esri_addr_type: addrType }).eq("id", deal_id);
      return new Response(JSON.stringify({ error: message, addr_type: addrType, matched: matchAddr }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (score !== null && score < GEOCODE_CONFIDENCE_THRESHOLD) {
      const message =
        `Geocode confidence ${score} is below ${GEOCODE_CONFIDENCE_THRESHOLD}. Matched "${matchAddr}" ` +
        `for input "${address}". Enrichment was not run and no coordinates were stored.`;
      console.warn(`[esri-enrich] deal=${deal_id} low confidence score=${score} input="${address}"`);
      return new Response(JSON.stringify({ error: message, score, matched: matchAddr }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // geocode_only: coordinates without the paid GeoEnrichment.
    //
    // For an address the free Census geocoder cannot match but Esri can — its
    // address-range coverage is wider. 555 Elm St, Fort Worth is the case that
    // prompted this: Census returns no match, Esri returns PointAddress at 100.
    // Only the geocode is billed (1 request), not the ~40 credits a ring pull
    // costs, and it has already passed the match-type and confidence gates above.
    if (geocode_only) {
      const { error: gErr } = await supabase.from("deals").update({
        latitude: lat,
        longitude: lon,
        esri_latitude: lat,
        esri_longitude: lon,
        esri_addr_type: addrType,
        geocode_source: "esri",
        geocode_error: null,
        geocoded_at: new Date().toISOString(),
        geocode_address: address,
      }).eq("id", deal_id);
      if (gErr) throw gErr;
      return new Response(JSON.stringify({
        ok: true, mode: "geocode_only", lat, lon, addr_type: addrType, score, matched: matchAddr,
        note: "Coordinates only. No GeoEnrichment was run, so rings and crime are unchanged.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // --- GeoEnrichment (paid, billed per data attribute returned) ----------
    let enriched;
    try {
      enriched = await enrich(lat, lon, token);
    } catch (err) {
      await logApiRequest(supabase, {
        function_name: "esri-enrich",
        service: "esri_credit",
        provider: "Esri",
        deal_id,
        units: 0,
        success: false,
      });
      throw err;
    }
    const { rings, raw } = enriched;

    // Esri bills GeoEnrichment at ~10 ArcGIS credits per 1,000 data attributes
    // returned. Count attributes across all rings and convert to credits; the
    // per-credit USD price lives in the pricing table (service `esri_credit`).
    const totalAttributes = Object.values(rings).reduce(
      (sum: number, ringAttrs: any) =>
        sum + (ringAttrs && typeof ringAttrs === "object" ? Object.keys(ringAttrs).length : 0),
      0,
    );
    const credits = Math.ceil(totalAttributes / 1000) * 10;
    await logApiRequest(supabase, {
      function_name: "esri-enrich",
      service: "esri_credit",
      provider: "Esri",
      deal_id,
      units: credits,
    });


    const payload = {
      deal_id,
      source: "esri",
      address_used: address,
      matched_address: matchAddr,
      lat,
      lon,
      rings,
      raw_response: raw,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("deal_enrichment")
      .upsert(payload, { onConflict: "deal_id" })
      .select()
      .single();
    if (error) throw error;

    // Best-effort: mirror lat/lon onto the deal row so the client can render
    // satellite thumbnails without a separate join. Don't fail enrichment if
    // this write errors.
    try {
      // Never overwrite a point that geocode-deals verified against the US
      // Census. Esri is the paid source but not reliably the better one here:
      // 28 of 50 of its points sat more than half a mile from the address on
      // the deal. The filter makes this a no-op on a census row rather than a
      // silent downgrade.
      const { error: coordErr } = await supabase
        .from("deals")
        .update({
          latitude: lat,
          longitude: lon,
          esri_latitude: lat,
          esri_longitude: lon,
          esri_addr_type: addrType,
          geocode_source: "esri",
          enriched_at: payload.updated_at,
        })
        .eq("id", deal_id)
        // NOT .neq(): in SQL, NULL != 'census' is NULL, not true, so a plain
        // .neq would silently exclude every row whose geocode_source is still
        // unset — the paid enrichment would run and the coordinates would never
        // be written, with no error anywhere.
        .or("geocode_source.is.null,geocode_source.neq.census");
      if (coordErr) console.warn("[esri-enrich] deal coord update failed:", coordErr.message);
    } catch (e) {
      console.warn("[esri-enrich] deal coord update threw:", (e as Error).message);
    }

    // Fire-and-forget: re-score now that enrichment has landed
    try {
      supabase.functions.invoke("deal-score", { body: { deal_id } })
        .then(({ error: scoreErr }) => {
          if (scoreErr) console.error("post-enrich deal-score error:", scoreErr);
        });
    } catch (e) {
      console.error("post-enrich deal-score invoke failed:", e);
    }

    return new Response(JSON.stringify({
      enrichment: data,
      token_source: tokenSource,
      cached: false,
      age_seconds: 0,
      synced_at: payload.updated_at,
      geocode_score: score,
      matched_address: matchAddr,
      month_spend_usd: budget.spend,
      monthly_cap_usd: budget.monthlyCap,
      ...(budgetWarning ? { budget_warning: budgetWarning } : {}),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
