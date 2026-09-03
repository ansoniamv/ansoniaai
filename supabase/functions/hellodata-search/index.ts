import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logApiRequest } from "../_shared/logUsage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
      return new Response(JSON.stringify({ error: text, status: res.status }), {
        status: res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
