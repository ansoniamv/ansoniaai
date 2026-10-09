// Free coordinates for deals nobody paid Esri to enrich.
//
// latitude/longitude are otherwise written only by esri-enrich, which spends
// ArcGIS credits, so an un-enriched deal cannot be plotted at all. The US Census
// geocoder is free and unauthenticated and also returns the 2020 tract GEOID,
// which is the other field a map needs.
//
// It never competes with Esri. Esri geocodes to rooftop; Census may interpolate
// along an address range, so a Census result is strictly the weaker of the two
// and is only ever written where there is nothing already.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsFor, requireUserOrService } from "../_shared/auth.ts";

// The parameter values are NOT "Current". The API rejects that outright with
// {"errors":["Invalid benchmark in request"],"status":"400"} — verified live.
// These are the values the service advertises on /benchmarks and /vintages, and
// Census2020_Current is the vintage that yields a 2020 tract GEOID.
const BENCHMARK = "Public_AR_Current";
const VINTAGE = "Census2020_Current";
const GEOCODER =
  "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";

// The service is rate-limited and unauthenticated; there is no quota to raise.
// Small batches with a pause between calls keep a backfill well inside what it
// tolerates, at the cost of wall-clock time nobody is waiting on.
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const DELAY_MS = 350;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The address Census is asked about, or null when there is not enough to ask. */
export function oneLineAddress(deal: {
  address?: string | null;
  property_address?: string | null;
  city?: string | null;
  state?: string | null;
}): string | null {
  const street = (deal.address ?? deal.property_address ?? "").trim();
  const city = (deal.city ?? "").trim();
  const state = (deal.state ?? "").trim();
  // A street number is what the geocoder matches on. City+state alone returns
  // zero matches rather than a city centroid — confirmed against the live API —
  // so asking without a street is a guaranteed miss and a wasted request.
  if (!street) return null;
  if (!city && !state) return null;
  return [street, city, state].filter(Boolean).join(", ");
}

type GeocodeHit = { lat: number; lon: number; tract: string | null; matched: string };

async function geocode(address: string): Promise<GeocodeHit | { error: string }> {
  const url = new URL(GEOCODER);
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", BENCHMARK);
  url.searchParams.set("vintage", VINTAGE);
  url.searchParams.set("format", "json");

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  } catch (e) {
    return { error: `network: ${(e as Error).message}` };
  }
  if (!res.ok) return { error: `HTTP ${res.status}` };

  let body: Record<string, any>;
  try {
    body = await res.json();
  } catch {
    return { error: "non-JSON response" };
  }
  if (Array.isArray(body?.errors) && body.errors.length) {
    return { error: String(body.errors[0]) };
  }

  const match = body?.result?.addressMatches?.[0];
  if (!match) return { error: "no match for this address" };

  const lon = Number(match?.coordinates?.x);
  const lat = Number(match?.coordinates?.y);
  // A coordinate that is not a finite number, or that is exactly 0,0, is not a
  // result. Null Island sits off the coast of Africa: it would plot happily and
  // poison every distance calculation downstream, so it is treated as a miss.
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { error: "non-numeric coordinates" };
  }
  if (lat === 0 && lon === 0) return { error: "geocoder returned 0,0" };

  const tract = match?.geographies?.["Census Tracts"]?.[0]?.GEOID ?? null;
  return {
    lat,
    lon,
    tract: tract ? String(tract) : null,
    matched: String(match.matchedAddress ?? address),
  };
}

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Called by the UI when a deal is created or its address edited, and as a
  // backfill by a trusted caller — the same dual-caller pattern as the other
  // functions in _shared/auth.ts.
  const authz = await requireUserOrService(req);
  if (authz && !authz.ok) return authz.response;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json().catch(() => ({}));
    const dealId: string | undefined = body.deal_id;
    const force: boolean = body.force === true;
    const limit = Math.min(Number(body.limit) || DEFAULT_LIMIT, MAX_LIMIT);

    let q = supabase
      .from("deals")
      .select(
        "id,property_name,address,property_address,city,state,latitude,longitude,geocode_source,geocode_address",
      );

    if (dealId) {
      q = q.eq("id", dealId);
    } else {
      // Backfill: only rows with no coordinates. A row Esri has already placed is
      // never a candidate — the cheaper source does not overwrite the better one.
      q = q.is("latitude", null).limit(limit);
    }

    const { data: deals, error } = await q;
    if (error) throw error;

    const results: Array<Record<string, unknown>> = [];
    let geocoded = 0;
    let failed = 0;
    let skipped = 0;

    for (const d of deals ?? []) {
      const addr = oneLineAddress(d as Record<string, string | null>);
      const alreadyPlaced = d.latitude != null && d.longitude != null;
      // Both sides may be null — a deal with no street address has no address to
      // record — and null === null, so "no address last time, still no address"
      // counts as unchanged and is skipped like any other settled row.
      const sameAddress = (d.geocode_address ?? null) === addr;

      // Skip anything already settled: placed by Esri, or already attempted on
      // this exact address. An edited address changes `addr` and so retries.
      //
      // This check MUST come before the no-address branch below. With it after,
      // a deal with no street address was rewritten as 'failed' on every pass
      // instead of being skipped, so the backfill query kept returning the same
      // rows and never reached the deals that did have an address.
      if (!force && (alreadyPlaced || (d.geocode_source === "failed" && sameAddress))) {
        skipped++;
        results.push({
          deal: d.property_name,
          status: "skipped",
          reason: alreadyPlaced ? `already placed by ${d.geocode_source ?? "another source"}` : "address unchanged since last attempt",
        });
        continue;
      }

      if (!addr) {
        // Nothing to ask with. Recorded as failed, once, so it stops being
        // retried and shows up on the list of addresses a human needs to fill
        // in. The skip above keeps it from being rewritten on every later pass.
        await supabase.from("deals").update({
          geocode_source: "failed",
          geocode_error: "no street address on the deal",
          geocoded_at: new Date().toISOString(),
          geocode_address: null,
        }).eq("id", d.id);
        failed++;
        results.push({ deal: d.property_name, status: "failed", reason: "no street address" });
        continue;
      }

      const hit = await geocode(addr);
      await sleep(DELAY_MS);

      if ("error" in hit) {
        // No coordinates are written. The row keeps NULL lat/lng and carries the
        // reason, so it stays distinguishable from one never attempted.
        await supabase.from("deals").update({
          geocode_source: "failed",
          geocode_error: hit.error,
          geocoded_at: new Date().toISOString(),
          geocode_address: addr,
        }).eq("id", d.id);
        failed++;
        results.push({ deal: d.property_name, status: "failed", address: addr, reason: hit.error });
        continue;
      }

      const update: Record<string, unknown> = {
        latitude: hit.lat,
        longitude: hit.lon,
        geocode_source: "census",
        geocode_error: null,
        geocoded_at: new Date().toISOString(),
        geocode_address: addr,
      };
      // Only fill the tract when Census returned one; an absent GEOID is left
      // alone rather than blanked, in case Esri already supplied it.
      if (hit.tract) update.census_tract_id = hit.tract;

      const { error: updErr } = await supabase.from("deals").update(update).eq("id", d.id);
      if (updErr) {
        failed++;
        results.push({
          deal: d.property_name,
          status: "failed",
          address: addr,
          reason: `write failed: ${updErr.message}`,
        });
        continue;
      }

      geocoded++;
      results.push({
        deal: d.property_name,
        status: "geocoded",
        address: addr,
        matched: hit.matched,
        lat: hit.lat,
        lon: hit.lon,
        tract: hit.tract,
      });
    }

    return new Response(JSON.stringify({ ok: true, geocoded, failed, skipped, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[geocode-deals]", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
