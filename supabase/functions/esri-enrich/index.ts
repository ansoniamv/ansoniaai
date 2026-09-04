import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logApiRequest } from "../_shared/logUsage.ts";
import { getArcGISToken } from "../_shared/arcgisToken.ts";
import { corsFor, requireApprovedUser } from "../_shared/auth.ts";

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
  return { lat: cand.location.y, lon: cand.location.x, matchAddr, score };
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
  const authz = await requireApprovedUser(req);
  if (!authz.ok) return authz.response;

  try {
    const { token, source: tokenSource } = await getArcGISToken(
      (u, i) => arcgisFetch(u, i, "OAuth token"),
    );
    console.log(`[esri-enrich] credential in use: ${tokenSource}`);

    const { deal_id, address, force } = await req.json();
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
    const { lat, lon, matchAddr, score } = geo;
    await logApiRequest(supabase, {
      function_name: "esri-enrich",
      service: "esri_geocode",
      provider: "Esri",
      deal_id,
      units: 1,
    });

    // Low-confidence geocode: still enrich, but flag it in the response so
    // callers know the location may be wrong.
    const lowConfidence = score !== null && score < GEOCODE_CONFIDENCE_THRESHOLD;
    if (lowConfidence) {
      console.warn(`[esri-enrich] deal=${deal_id} low geocode confidence score=${score} matched="${matchAddr}" input="${address}"`);
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
      const { error: coordErr } = await supabase
        .from("deals")
        .update({ latitude: lat, longitude: lon, enriched_at: payload.updated_at })
        .eq("id", deal_id);
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

      low_geocode_confidence: lowConfidence,
      ...(lowConfidence ? {
        warning: `Low geocode confidence (score ${score} < ${GEOCODE_CONFIDENCE_THRESHOLD}). Matched "${matchAddr}" for input "${address}". Enrichment proceeded — verify the location.`,
      } : {}),
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
