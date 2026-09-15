// fetch-hellodata: one-call-per-deal HelloData ingest.
// - Idempotent: skips API call when hellodata_status='fetched' and payload exists.
// - Caches the full raw response on deals.hellodata_payload.
// - Never throws to the client; failures land in hellodata_status='failed'.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logApiRequest } from "../_shared/logUsage.ts";
import { mapHelloDataProperty, selectWritableFields } from "../_shared/hellodataMapping.ts";
import {
  hdSearch,
  hdPropertyResilient,
  buildAddressQuery,
  pickBestMatch,
} from "../_shared/hellodataClient.ts";
import { requireApprovedUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HELLODATA_KEY = Deno.env.get("HELLODATA_API_KEY")!;
const HD_BASE = "https://api.hellodata.ai";

// HTTP client, retry/backoff and the match gate all live in
// _shared/hellodataClient.ts so fetch-hellodata and the scheduled drain cannot drift.

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
    let matchEvidence: Record<string, unknown> | null = null;
    let matchConfidence: number | null = null;
    const hasCache = deal.hellodata_status === "fetched" && deal.hellodata_payload;

    if (hasCache && !force) {
      payload = deal.hellodata_payload;
    } else {
      if (!hdId) {
        // Refuse rather than guess. A city-level query cannot identify a
        // building; accepting results[0] from one is what produced a ~44%
        // mismatch rate across the already-enriched deals.
        const q = buildAddressQuery(deal);
        if (!q.ok) {
          await supabase.from("deals").update({
            hellodata_status: "unmatched",
            hellodata_error: q.reason,
            hellodata_match_confidence: null,
            hellodata_match_evidence: { refused: true, reason: q.reason, at: new Date().toISOString() },
          }).eq("id", dealId);
          return new Response(JSON.stringify({ deal_id: dealId, status: "unmatched", reason: q.reason }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const search = await hdSearch(q.query);
        try { await logApiRequest(supabase, { function_name: "fetch-hellodata", service: "hellodata", provider: "HelloData", deal_id: dealId }); } catch { /* noop */ }
        const results = Array.isArray(search) ? search : (search?.results ?? []);

        // Score every candidate; never fall back to a low-confidence one.
        const { candidate, evidence } = pickBestMatch(deal, results);
        if (!candidate) {
          await supabase.from("deals").update({
            hellodata_status: "unmatched",
            hellodata_error: `No confident HelloData match: ${evidence.reason}`,
            hellodata_match_confidence: evidence.confidence,
            hellodata_match_evidence: { ...evidence, query: q.query, candidates_considered: results.length, at: new Date().toISOString() },
          }).eq("id", dealId);
          return new Response(JSON.stringify({ deal_id: dealId, status: "unmatched", reason: evidence.reason, confidence: evidence.confidence }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        hdId = candidate?.id ?? candidate?.property_id ?? candidate?.hellodata_id ?? null;
        matchEvidence = { ...evidence, query: q.query, candidates_considered: results.length, at: new Date().toISOString() };
        matchConfidence = evidence.confidence;
        if (!hdId) throw new Error("matched candidate carried no id");
      }
      payload = await hdPropertyResilient(hdId);
      try { await logApiRequest(supabase, { function_name: "fetch-hellodata", service: "hellodata", provider: "HelloData", deal_id: dealId }); } catch { /* noop */ }
    }

    // --- Map raw payload → flat deal columns used by the UI -----------------
    // The inline mapper that used to live here read payload.floor_plans ??
    // payload.unit_mix. Neither key exists on any HelloData payload (0/27 in
    // production), so floor_plans — and in_place_avg_rent / avg_time_on_market,
    // which were derived only from it — were written as null on every run, and
    // the null-strip below made that silent. The shared mapper reads
    // building_availability, which is present on 27/27.
    const { update: allFields } = mapHelloDataProperty(payload);

    // Null-strip, fill-if-null protection, and column existence all live in the
    // shared helper so every write path gets the same rules.
    const mapped = selectWritableFields(allFields, deal as Record<string, unknown>);

    // --- Cache + mark fetched -----------------------------------------------
    const { error: updErr } = await supabase.from("deals").update({
      hellodata_id: String(hdId),
      hellodata_payload: payload,
      hellodata_raw: payload,
      hellodata_status: "fetched",
      hellodata_last_synced_at: new Date().toISOString(),
      hellodata_error: null,
      ...(matchConfidence !== null ? { hellodata_match_confidence: matchConfidence } : {}),
      ...(matchEvidence ? { hellodata_match_evidence: matchEvidence } : {}),
      ...mapped,
    }).eq("id", dealId);
    if (updErr) throw updErr;

    return new Response(JSON.stringify({
      deal_id: dealId, status: "fetched", hellodata_id: hdId, cached: false,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    // The generic response below is correct, but hellodata_error is rendered in
    // the browser (src/pages/DealDetail.tsx), so writing a stack trace to it
    // routed Deno file paths and internal function names around that response
    // via the database. Full detail goes to the log under a correlation id; the
    // column gets only the reference.
    const correlationId = crypto.randomUUID();
    const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    console.error(JSON.stringify({ correlationId, fn: "fetch-hellodata", dealId, detail }));
    if (dealId) {
      await supabase.from("deals").update({
        hellodata_status: "failed",
        hellodata_error: `Enrichment failed (ref ${correlationId})`,
      }).eq("id", dealId);
    }
    // Never throw to the client — return 200 with generic status; keep detail server-side.
    return new Response(JSON.stringify({ deal_id: dealId, status: "failed", error: "HelloData fetch failed" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
