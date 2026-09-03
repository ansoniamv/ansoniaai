// Census Building Permits Survey (BPS) — fetches trailing 12mo multifamily permits for a CBSA
// Free, no API key required. Docs: https://www.census.gov/construction/bps/
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { cbsa_code, cbsa_name } = await req.json();
    if (!cbsa_code) {
      return new Response(JSON.stringify({ error: "cbsa_code required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 12, 1);

    // Check cache first
    const { data: cached } = await supabase
      .from("permits_data")
      .select("*")
      .eq("cbsa_code", cbsa_code)
      .gte("year", cutoff.getFullYear())
      .order("year", { ascending: false })
      .order("month", { ascending: false });

    let permitRows = cached ?? [];

    // If we have <10 months of data, fetch fresh
    if (permitRows.length < 10) {
      const year = now.getFullYear();
      // Census BPS API: monthly metro-area permits
      // Variables: BLDPMT_5UN (permits in 5+ unit buildings), UNT_5UN (units), CBSA, NAME
      const url = `https://api.census.gov/data/${year - 1}/eits/bps?get=cell_value,data_type_code&for=metropolitan%20statistical%20area:${cbsa_code}&time=from+${year - 1}-01&category_code=APERMITS&seasonally_adj=no&data_type_code=5UNTS`;

      try {
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          // [headers, ...rows]
          const rows = (json as any[]).slice(1);
          for (const row of rows) {
            const [val, _dtc, time] = row;
            const [yr, mo] = String(time).split("-").map(Number);
            await supabase.from("permits_data").upsert({
              cbsa_code,
              cbsa_name: cbsa_name ?? null,
              year: yr,
              month: mo,
              total_units: Number(val) || 0,
              multifamily_permits: Number(val) || 0,
              raw: row,
            }, { onConflict: "cbsa_code,year,month" });
          }
          // re-read
          const { data: refreshed } = await supabase
            .from("permits_data").select("*").eq("cbsa_code", cbsa_code)
            .order("year", { ascending: false }).order("month", { ascending: false }).limit(12);
          permitRows = refreshed ?? [];
        }
      } catch (e) {
        console.error("BPS fetch error:", e);
      }
    }

    const trailing12 = permitRows.slice(0, 12);
    const total_permits_t12 = trailing12.reduce((s, r) => s + (r.multifamily_permits ?? 0), 0);

    return new Response(JSON.stringify({
      cbsa_code, cbsa_name,
      total_permits_t12,
      months_returned: trailing12.length,
      data: trailing12,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
