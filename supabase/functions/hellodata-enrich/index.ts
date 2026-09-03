import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mapHelloDataProperty } from "../_shared/hellodataMapping.ts";
import { logApiRequest } from "../_shared/logUsage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Intake-only fields from the shared mapper — captured on the New Deal form
// and NOT overwritten by the post-create enrichment run.
const INTAKE_ONLY_KEYS = new Set([
  "property_name", "street_address_raw", "city", "state", "zip",
  "unit_count", "vintage_year",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("HELLODATA_API_KEY");
    if (!apiKey) throw new Error("HELLODATA_API_KEY not configured");

    const { deal_id, hellodata_id, force } = await req.json();
    if (!deal_id || !hellodata_id) throw new Error("deal_id and hellodata_id required");

    const supabaseEarly = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- Freshness check: skip API call if last sync < 24h old --------------
    const TTL_MS = 24 * 60 * 60 * 1000;
    if (!force) {
      const { data: existing } = await supabaseEarly
        .from("deals")
        .select("*, hellodata_last_synced_at")
        .eq("id", deal_id)
        .maybeSingle();
      const syncedAt = existing?.hellodata_last_synced_at ? new Date(existing.hellodata_last_synced_at).getTime() : 0;
      const ageMs = syncedAt ? Date.now() - syncedAt : Infinity;
      if (existing && syncedAt && ageMs < TTL_MS) {
        return new Response(JSON.stringify({
          deal: existing,
          cached: true,
          age_seconds: Math.round(ageMs / 1000),
          synced_at: existing.hellodata_last_synced_at,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const res = await fetch(`https://api.hellodata.ai/property/${hellodata_id}`, {
      headers: { "x-api-key": apiKey },
    });
    try {
      await logApiRequest(supabaseEarly, { function_name: "hellodata-enrich", service: "hellodata", provider: "HelloData", deal_id, success: res.ok });
    } catch { /* noop */ }
    const text = await res.text();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: text, status: res.status }), {
        status: res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const p = JSON.parse(text);

    // Shared mapper produces the full field set; strip intake-only keys so we
    // never overwrite manually-entered property_name / address / units / etc.
    const { update: mapped, photoUrls, field_coverage: mappedCoverage } = mapHelloDataProperty(p);
    const update: Record<string, any> = { hellodata_last_synced_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(mapped)) {
      if (INTAKE_ONLY_KEYS.has(k)) continue;
      update[k] = v;
    }

    // Field coverage audit (intake-only fields excluded from the count)
    const field_coverage: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(mappedCoverage)) {
      if (INTAKE_ONLY_KEYS.has(k)) continue;
      field_coverage[k] = v;
    }
    const totalFields = Object.keys(field_coverage).length;
    const populated = Object.values(field_coverage).filter(Boolean).length;
    const missing = Object.entries(field_coverage).filter(([, v]) => !v).map(([k]) => k);
    console.log(`[hellodata-enrich] deal=${deal_id} photos=${photoUrls.length} coverage=${populated}/${totalFields} missing=[${missing.join(", ")}]`);


    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await supabase
      .from("deals")
      .update(update)
      .eq("id", deal_id)
      .select()
      .single();
    if (error) throw error;

    // Fire-and-forget: re-score now that hellodata enrichment has landed
    try {
      supabase.functions.invoke("deal-score", { body: { deal_id } })
        .then(({ error: scoreErr }) => {
          if (scoreErr) console.error("post-hellodata deal-score error:", scoreErr);
        });
    } catch (e) {
      console.error("post-hellodata deal-score invoke failed:", e);
    }

    return new Response(JSON.stringify({
      deal: data,
      cached: false,
      age_seconds: 0,
      synced_at: update.hellodata_last_synced_at,
      coverage: {
        populated,
        total: totalFields,
        missing,
        fields: field_coverage,
      },
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
