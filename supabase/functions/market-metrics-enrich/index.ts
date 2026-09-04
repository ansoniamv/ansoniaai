// Populates deals.population_growth_pct, deals.new_supply_pct_of_stock, deals.job_growth_pct
// Sources (all free, no user-supplied keys required):
//   - Population growth: Esri rings 5mi POPGRWCYFY (already stored by esri-enrich)
//   - New supply: Esri rings 5mi TOTHU_CY → TOTHU_FY (annualized housing-unit growth, 5-yr)
//   - Job growth: BLS SAE total nonfarm YoY, MSA resolved via Census FCC geocoder from lat/lon
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsFor, requireUserOrService } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BLS_KEY = Deno.env.get("BLS_API_KEY"); // optional — raises daily limit

// state 2-letter → FIPS (for BLS SM series area encoding)
const STATE_FIPS: Record<string, string> = {
  AL:"01",AK:"02",AZ:"04",AR:"05",CA:"06",CO:"08",CT:"09",DE:"10",DC:"11",FL:"12",GA:"13",HI:"15",
  ID:"16",IL:"17",IN:"18",IA:"19",KS:"20",KY:"21",LA:"22",ME:"23",MD:"24",MA:"25",MI:"26",MN:"27",
  MS:"28",MO:"29",MT:"30",NE:"31",NV:"32",NH:"33",NJ:"34",NM:"35",NY:"36",NC:"37",ND:"38",OH:"39",
  OK:"40",OR:"41",PA:"42",RI:"44",SC:"45",SD:"46",TN:"47",TX:"48",UT:"49",VT:"50",VA:"51",WA:"53",
  WV:"54",WI:"55",WY:"56",PR:"72",
};

async function resolveCbsa(lat: number, lon: number): Promise<{ cbsa: string; name: string } | null> {
  try {
    // TIGERweb layer 93 = Metropolitan Statistical Areas
    const tigerUrl =
      `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/93/query` +
      `?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects` +
      `&outFields=BASENAME,GEOID,NAME&returnGeometry=false&f=json`;
    const t = await fetch(tigerUrl);
    if (!t.ok) return null;
    const tj = await t.json();
    const feat = tj?.features?.[0]?.attributes;
    if (!feat?.GEOID) return null;
    return { cbsa: String(feat.GEOID), name: String(feat.NAME ?? feat.BASENAME ?? "") };
  } catch {
    return null;
  }
}

async function fetchBlsJobGrowth(stateCode: string, cbsa: string): Promise<number | null> {
  const fips = STATE_FIPS[stateCode?.toUpperCase()];
  if (!fips) return null;
  // BLS SM series: SM + seasonal (U=not adj) + state FIPS(2) + area code(5, CBSA) + supersector(2) + industry(6) + datatype(2)
  // Total nonfarm all-employees:  supersector 00, industry 000000, datatype 01
  const seriesId = `SMU${fips}${cbsa}0000000001`;
  const now = new Date();
  const endYear = now.getFullYear();
  const startYear = endYear - 2;
  const payload: any = { seriesid: [seriesId], startyear: String(startYear), endyear: String(endYear) };
  if (BLS_KEY) payload.registrationkey = BLS_KEY;
  try {
    const r = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const rows: any[] = j?.Results?.series?.[0]?.data ?? [];
    if (rows.length < 13) return null;
    // Rows are newest-first, monthly (M01–M12). Compare latest to 12 months prior.
    const monthly = rows.filter((d) => /^M\d\d$/.test(d.period) && d.period !== "M13");
    if (monthly.length < 13) return null;
    const latest = Number(monthly[0].value);
    const yearAgo = Number(monthly[12].value);
    if (!latest || !yearAgo) return null;
    return ((latest - yearAgo) / yearAgo) * 100;
  } catch {
    return null;
  }
}

serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Invoked by deal-score, which forwards the service-role key.
  const authz = await requireUserOrService(req);
  if (authz && !authz.ok) return authz.response;

  try {
    const { deal_id } = await req.json();
    if (!deal_id) {
      return new Response(JSON.stringify({ error: "deal_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const [{ data: deal }, { data: enrichment }] = await Promise.all([
      supabase.from("deals").select("id, state, latitude, longitude").eq("id", deal_id).single(),
      supabase.from("deal_enrichment").select("rings").eq("deal_id", deal_id).maybeSingle(),
    ]);
    if (!deal) throw new Error("Deal not found");

    const rings = (enrichment?.rings ?? {}) as any;
    const r5 = rings["5mi"] ?? rings["3mi"] ?? rings["1mi"] ?? null;

    const update: Record<string, any> = {};
    const results: Record<string, any> = {};

    // 1) Population growth — annualized 5-yr, from Esri POPGRWCYFY (already annualized %)
    if (r5 && typeof r5.POPGRWCYFY === "number") {
      update.population_growth_pct = Number(r5.POPGRWCYFY.toFixed(2));
      results.population_growth_pct = { value: update.population_growth_pct, source: "esri.rings.5mi.POPGRWCYFY" };
    } else if (r5 && typeof r5.TOTPOP_CY === "number" && typeof r5.TOTPOP_FY === "number" && r5.TOTPOP_CY > 0) {
      const ann = (Math.pow(r5.TOTPOP_FY / r5.TOTPOP_CY, 1 / 5) - 1) * 100;
      update.population_growth_pct = Number(ann.toFixed(2));
      results.population_growth_pct = { value: update.population_growth_pct, source: "esri.rings.5mi.TOTPOP" };
    } else {
      results.population_growth_pct = { value: null, source: null, reason: "no esri enrichment" };
    }

    // 2) New supply — annualized 5-yr forward housing-unit growth in 5mi ring
    if (r5 && typeof r5.TOTHU_CY === "number" && typeof r5.TOTHU_FY === "number" && r5.TOTHU_CY > 0) {
      const ann = (Math.pow(r5.TOTHU_FY / r5.TOTHU_CY, 1 / 5) - 1) * 100;
      update.new_supply_pct_of_stock = Number(ann.toFixed(2));
      results.new_supply_pct_of_stock = { value: update.new_supply_pct_of_stock, source: "esri.rings.5mi.TOTHU" };
    } else {
      results.new_supply_pct_of_stock = { value: null, source: null, reason: "no esri enrichment" };
    }

    // 3) Job growth — BLS SAE YoY total nonfarm at MSA level
    if (deal.latitude && deal.longitude && deal.state) {
      const cbsa = await resolveCbsa(Number(deal.latitude), Number(deal.longitude));
      if (cbsa?.cbsa) {
        const jg = await fetchBlsJobGrowth(deal.state, cbsa.cbsa);
        if (jg != null) {
          update.job_growth_pct = Number(jg.toFixed(2));
          results.job_growth_pct = { value: update.job_growth_pct, source: `BLS SM ${cbsa.cbsa} (${cbsa.name})` };
        } else {
          results.job_growth_pct = { value: null, source: null, reason: `BLS returned no data for CBSA ${cbsa.cbsa}` };
        }
      } else {
        results.job_growth_pct = { value: null, source: null, reason: "could not resolve CBSA from lat/lon" };
      }
    } else {
      results.job_growth_pct = { value: null, source: null, reason: "missing lat/lon or state" };
    }

    if (Object.keys(update).length > 0) {
      const { error } = await supabase.from("deals").update(update).eq("id", deal_id);
      if (error) throw error;
    }

    return new Response(JSON.stringify({ deal_id, updated: update, details: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
