// Populates deals.population_growth_pct, deals.new_supply_pct_of_stock, deals.job_growth_pct
// Sources (all free, no user-supplied keys required):
//   - Population growth: Esri rings 5mi POPGRWCYFY (already stored by esri-enrich)
//   - New supply: Esri rings 5mi TOTHU_CY → TOTHU_FY (annualized housing-unit growth, 5-yr)
//   - Job growth: BLS SAE total nonfarm YoY, MSA resolved via Census TIGERweb from lat/lon
//
// Runs in-process from deal-score, not as a function-to-function HTTP call. That
// hop's failures (auth rejection, timeout) were swallowed by deal-score, so the
// figures silently never landed even when the Esri rings were sitting in the DB.
// The market-metrics-enrich function wraps this for direct callers.

const BLS_KEY = Deno.env.get("BLS_API_KEY"); // without it BLS allows ~25 requests/day per IP, shared across Supabase tenants

// Outside calls get a deadline: an unbounded BLS hang used to hold up the whole
// write, population growth included.
const FETCH_TIMEOUT_MS = 10_000;

// state 2-letter → FIPS (for BLS SM series area encoding)
const STATE_FIPS: Record<string, string> = {
  AL:"01",AK:"02",AZ:"04",AR:"05",CA:"06",CO:"08",CT:"09",DE:"10",DC:"11",FL:"12",GA:"13",HI:"15",
  ID:"16",IL:"17",IN:"18",IA:"19",KS:"20",KY:"21",LA:"22",ME:"23",MD:"24",MA:"25",MI:"26",MN:"27",
  MS:"28",MO:"29",MT:"30",NE:"31",NV:"32",NH:"33",NJ:"34",NM:"35",NY:"36",NC:"37",ND:"38",OH:"39",
  OK:"40",OR:"41",PA:"42",RI:"44",SC:"45",SD:"46",TN:"47",TX:"48",UT:"49",VT:"50",VA:"51",WA:"53",
  WV:"54",WI:"55",WY:"56",PR:"72",
};

type Outcome = { value: number | null; source: string | null; reason?: string };

async function resolveCbsa(lat: number, lon: number): Promise<{ cbsa: string; name: string } | null> {
  try {
    // TIGERweb layer 93 = Metropolitan Statistical Areas
    const tigerUrl =
      `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/93/query` +
      `?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects` +
      `&outFields=BASENAME,GEOID,NAME&returnGeometry=false&f=json`;
    const t = await fetch(tigerUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!t.ok) return null;
    const tj = await t.json();
    const feat = tj?.features?.[0]?.attributes;
    if (!feat?.GEOID) return null;
    return { cbsa: String(feat.GEOID), name: String(feat.NAME ?? feat.BASENAME ?? "") };
  } catch {
    return null;
  }
}

async function fetchBlsJobGrowth(stateCode: string, cbsa: string): Promise<{ value: number | null; reason?: string }> {
  const fips = STATE_FIPS[stateCode?.toUpperCase()];
  if (!fips) return { value: null, reason: `unknown state ${stateCode}` };
  // BLS SM series: SM + seasonal (U=not adj) + state FIPS(2) + area code(5, CBSA) + supersector(2) + industry(6) + datatype(2)
  // Total nonfarm all-employees:  supersector 00, industry 000000, datatype 01
  const seriesId = `SMU${fips}${cbsa}0000000001`;
  const endYear = new Date().getFullYear();
  const payload: any = { seriesid: [seriesId], startyear: String(endYear - 2), endyear: String(endYear) };
  if (BLS_KEY) payload.registrationkey = BLS_KEY;
  try {
    const r = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!r.ok) return { value: null, reason: `BLS HTTP ${r.status}` };
    const j = await r.json();
    // A refused request (daily limit, bad key) still comes back HTTP 200, with
    // the reason in `message` and no data. Say so instead of "no data".
    if (j?.status !== "REQUEST_SUCCEEDED") {
      return { value: null, reason: `BLS ${j?.status ?? "unknown status"}: ${(j?.message ?? []).join(" ")}`.trim() };
    }
    const rows: any[] = j?.Results?.series?.[0]?.data ?? [];
    // Rows are newest-first, monthly (M01–M12). Compare latest to 12 months prior.
    const monthly = rows.filter((d) => /^M\d\d$/.test(d.period) && d.period !== "M13");
    if (monthly.length < 13) return { value: null, reason: `BLS has ${monthly.length} months for ${seriesId}` };
    const latest = Number(monthly[0].value);
    const yearAgo = Number(monthly[12].value);
    if (!latest || !yearAgo) return { value: null, reason: `BLS values unusable for ${seriesId}` };
    return { value: ((latest - yearAgo) / yearAgo) * 100 };
  } catch (e) {
    return { value: null, reason: `BLS request failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Computes and writes the deal's market metrics. Throws only on a failed DB read or write. */
export async function enrichMarketMetrics(supabase: any, deal_id: string) {
  const [{ data: deal }, { data: enrichment }] = await Promise.all([
    supabase.from("deals").select("id, state, latitude, longitude").eq("id", deal_id).single(),
    supabase.from("deal_enrichment").select("rings").eq("deal_id", deal_id).maybeSingle(),
  ]);
  if (!deal) throw new Error("Deal not found");

  const rings = (enrichment?.rings ?? {}) as any;
  const r5 = rings["5mi"] ?? rings["3mi"] ?? rings["1mi"] ?? null;

  const update: Record<string, any> = {};
  const results: Record<string, Outcome> = {};

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
      if (jg.value != null) {
        update.job_growth_pct = Number(jg.value.toFixed(2));
        results.job_growth_pct = { value: update.job_growth_pct, source: `BLS SM ${cbsa.cbsa} (${cbsa.name})` };
      } else {
        results.job_growth_pct = { value: null, source: null, reason: jg.reason ?? `BLS returned no data for CBSA ${cbsa.cbsa}` };
      }
    } else {
      results.job_growth_pct = { value: null, source: null, reason: "could not resolve CBSA from lat/lon" };
    }
  } else {
    results.job_growth_pct = { value: null, source: null, reason: "missing lat/lon or state" };
  }

  for (const [field, r] of Object.entries(results)) {
    if (r.value == null) console.warn(`[market-metrics] ${deal_id} ${field}: ${r.reason}`);
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from("deals").update(update).eq("id", deal_id);
    if (error) throw error;
  }

  return { deal_id, updated: update, details: results };
}
