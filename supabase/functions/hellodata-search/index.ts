import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logApiRequest } from "../_shared/logUsage.ts";
import { corsFor, requireApprovedUser } from "../_shared/auth.ts";
import { errorResponse } from "../_shared/errors.ts";

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Every call is a billed HelloData search.
  const authz = await requireApprovedUser(req);
  if (!authz.ok) return authz.response;

  try {
    const apiKey = Deno.env.get("HELLODATA_API_KEY");
    if (!apiKey) throw new Error("HELLODATA_API_KEY not configured");

    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim();
    if (!q || q.length < 3) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch(
      `https://api.hellodata.ai/property/search?q=${encodeURIComponent(q)}`,
      { headers: { "x-api-key": apiKey } },
    );
    try {
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await logApiRequest(supabase, { function_name: "hellodata-search", service: "hellodata", provider: "HelloData", success: res.ok });
    } catch { /* never break the caller */ }
    const text = await res.text();
    if (!res.ok) {
      // Vendor error bodies echo request URLs, plan identifiers and quota state.
      return errorResponse(new Error(`hellodata ${res.status}: ${text}`), corsHeaders, {
        fn: "hellodata-search",
        status: res.status >= 500 ? 502 : 400,
        publicMessage: "Property search is unavailable right now.",
      });
    }
    const data = JSON.parse(text);
    return new Response(JSON.stringify({ results: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
