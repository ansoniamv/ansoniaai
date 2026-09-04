import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsFor, requireApprovedUser } from "../_shared/auth.ts";

// NCES ArcGIS Online services (free, public, no token required)
const DISTRICTS_URL =
  "https://services1.arcgis.com/Ua5sjt3LWTPigjyD/ArcGIS/rest/services/School_Districts_Current/FeatureServer/0";
const SCHOOLS_URL =
  "https://services1.arcgis.com/Ua5sjt3LWTPigjyD/ArcGIS/rest/services/School_Characteristics_Current/FeatureServer/1";

type LatLon = { lat: number; lon: number };
type School = {
  name: string;
  level: "elementary" | "middle" | "high" | "other";
  grade_low: string | null;
  grade_high: string | null;
  enrollment: number | null;
  distance_mi: number | null;
  lat: number | null;
  lon: number | null;
  niche_grade?: string | null;
  niche_url?: string | null;
  niche_status?: string | null;
};

function haversineMi(a: LatLon, b: LatLon) {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function classifyLevel(low: string | null, high: string | null): School["level"] {
  // Grade tokens: KG, PK, 01..12, UG. Treat KG/PK as 0.
  const toNum = (g: string | null): number | null => {
    if (!g) return null;
    const s = String(g).trim().toUpperCase();
    if (s === "KG" || s === "PK" || s === "K") return 0;
    if (s === "UG" || s === "N") return null;
    const n = parseInt(s, 10);
    return isNaN(n) ? null : n;
  };
  const lo = toNum(low);
  const hi = toNum(high);
  if (hi == null && lo == null) return "other";
  if (hi != null && hi <= 5) return "elementary";
  if (lo != null && lo >= 9) return "high";
  if (lo != null && lo >= 6 && hi != null && hi <= 8) return "middle";
  if (hi != null && hi >= 9 && lo != null && lo >= 6) return "high";
  if (hi != null && hi >= 6 && hi <= 8) return "middle";
  if (hi != null && hi >= 9) return "high";
  return "other";
}

async function findDistrict(point: LatLon) {
  const url = new URL(`${DISTRICTS_URL}/query`);
  url.searchParams.set("f", "json");
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set(
    "geometry",
    JSON.stringify({ x: point.lon, y: point.lat, spatialReference: { wkid: 4326 } }),
  );
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("returnGeometry", "false");
  const res = await fetch(url.toString());
  const json = await res.json();
  if (json?.error) throw new Error("NCES districts query: " + JSON.stringify(json.error));
  const feats = json?.features ?? [];
  // Prefer unified district if multiple (elementary + secondary overlap is rare in unified states)
  const f = feats[0];
  if (!f) return null;
  const a = f.attributes ?? {};
  return {
    leaid: a.GEOID ?? a.UNSDLEA ?? a.ELSDLEA ?? a.SCSDLEA ?? null,
    name: a.NAME ?? "Unknown District",
    state: a.STATEFP ?? null,
    grade_low: a.LOGRADE ?? null,
    grade_high: a.HIGRADE ?? null,
    raw: a,
  };
}

async function findSchoolsNearby(point: LatLon, leaid: string | null, radiusMi: number) {
  // Build envelope of ~radiusMi around point
  const dLat = radiusMi / 69;
  const dLon = radiusMi / (69 * Math.cos((point.lat * Math.PI) / 180));
  const url = new URL(`${SCHOOLS_URL}/query`);
  url.searchParams.set("f", "json");
  url.searchParams.set("geometryType", "esriGeometryEnvelope");
  url.searchParams.set(
    "geometry",
    JSON.stringify({
      xmin: point.lon - dLon,
      ymin: point.lat - dLat,
      xmax: point.lon + dLon,
      ymax: point.lat + dLat,
      spatialReference: { wkid: 4326 },
    }),
  );
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  // Filter to open/currently operational schools, optionally narrow to district.
  // NCES current School Characteristics reports open schools as STATUS='1' / SY_STATUS_TEXT='Open'.
  // The older "Currently operational" text returns zero rows on the current layer.
  const wheres: string[] = ["STATUS='1'"];
  // LEAID is a district code — must be digits only. Sanitize before interpolation to prevent
  // ArcGIS `where`-clause injection.
  if (leaid && /^\d+$/.test(String(leaid))) wheres.push(`LEAID='${leaid}'`);
  url.searchParams.set("where", wheres.join(" AND "));
  const res = await fetch(url.toString());
  const json = await res.json();
  if (json?.error) throw new Error("NCES schools query: " + JSON.stringify(json.error));
  const feats = json?.features ?? [];
  return feats.map((f: any): School => {
    const a = f.attributes ?? {};
    const g = f.geometry ?? {};
    const lat = g.y ?? a.LATCOD ?? null;
    const lon = g.x ?? a.LONCOD ?? null;
    const low = a.GSLO ?? null;
    const high = a.GSHI ?? null;
    // Prefer NCES SCHOOL_LEVEL if it's specific
    const lvlRaw = String(a.SCHOOL_LEVEL ?? "").toLowerCase();
    let level: School["level"] = classifyLevel(low, high);
    if (lvlRaw.includes("elementary")) level = "elementary";
    else if (lvlRaw.includes("middle")) level = "middle";
    else if (lvlRaw.includes("high") && !lvlRaw.includes("middle/high")) level = "high";
    return {
      name: a.SCH_NAME ?? "Unknown",
      level,
      grade_low: low,
      grade_high: high,
      enrollment: a.MEMBER ?? a.TOTAL ?? null,
      distance_mi: lat && lon ? Number(haversineMi(point, { lat, lon }).toFixed(2)) : null,
      lat,
      lon,
    };
  });
}

function pickByLevel(schools: School[], level: School["level"]): School | null {
  // Comprehensive grade ranges: elementary should start at PK/KG, middle at 6, high at 9
  const expectsLow: Record<string, string[]> = {
    elementary: ["PK", "KG", "K"],
    middle: ["06", "6"],
    high: ["09", "9"],
  };
  const wantLow = expectsLow[level] ?? [];
  const candidates = schools.filter((s) => s.level === level && s.distance_mi != null);
  // Prefer comprehensive (covers full level range) + larger enrollment, then nearest
  const comprehensive = candidates.filter((s) =>
    wantLow.length === 0 ? true : wantLow.includes(String(s.grade_low ?? "").toUpperCase()),
  );
  const pool = comprehensive.length > 0 ? comprehensive : candidates;
  pool.sort((a, b) => {
    // Penalize tiny enrollment (<100) heavily — likely alt programs
    const aSmall = (a.enrollment ?? 0) < 100 ? 1 : 0;
    const bSmall = (b.enrollment ?? 0) < 100 ? 1 : 0;
    if (aSmall !== bSmall) return aSmall - bSmall;
    return (a.distance_mi! - b.distance_mi!);
  });
  return pool[0] ?? null;
}

type NicheStatus = "ok" | "no_grade_on_page" | "no_page_found" | "no_api_key" | "scrape_failed";
type NicheResult = { url: string | null; grade: string | null; status: NicheStatus };

const VALID_GRADES = new Set([
  "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F",
]);

function normalizeGrade(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let g = String(raw).trim().toUpperCase();
  g = g.replace(/\s*MINUS$/i, "-").replace(/\s*PLUS$/i, "+").replace(/\s+/g, "");
  return VALID_GRADES.has(g) ? g : null;
}

function gradeFromMarkdown(md: string): string | null {
  const patterns: RegExp[] = [
    // letter BEFORE the caption (Niche renders the grade circle above the label)
    /([A-DF](?:[+-]|\s+(?:plus|minus))?)\s*(?:·|\|)?\s*Overall\s+(?:Niche\s+)?Grade/i,
    // letter AFTER the caption
    /Overall Niche Grade[^A-DF]{0,40}\b([A-DF](?:[+-]|\s+(?:plus|minus))?)\b/i,
    // district header variant
    /Overall\s+Grade[^A-DF]{0,15}([A-DF](?:[+-]|\s+(?:plus|minus))?)/i,
  ];
  for (const re of patterns) {
    const m = md.match(re);
    const g = normalizeGrade(m?.[1]);
    if (g) return g;
  }
  return null;
}

// Best-effort Niche scrape for a letter grade
async function scrapeNicheGrade(searchTerm: string, kind: "school" | "district"): Promise<NicheResult> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) return { url: null, grade: null, status: "no_api_key" };
  try {
    const searchRes = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `${searchTerm} site:niche.com ${kind === "district" ? "k12 school district" : "k12"}`,
        limit: 3,
      }),
    });
    const sj = await searchRes.json();
    const results = sj?.data?.web ?? sj?.data ?? [];
    const normalize = (value: string) =>
      value
        .toLowerCase()
        .replace(/\b(elementary|middle|high|school|district|county|public|schools?|nc|north|carolina|sc|south|ga|georgia|fl|florida|il|illinois|tx|texas|va|virginia)\b/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .split(/\s+/)
        .filter((token) => token.length > 2);
    const searchTokens = normalize(searchTerm);
    const isReasonableMatch = (r: any) => {
      const haystack = `${r.title ?? ""} ${r.url ?? ""} ${r.description ?? ""}`.toLowerCase();
      if (searchTokens.length === 0) return true;
      return searchTokens.some((token) => haystack.includes(token));
    };
    const hit = results.find((r: any) => {
      const u = String(r.url || "");
      if (!isReasonableMatch(r)) return false;
      return kind === "district"
        ? (u.includes("niche.com/k12/d/") || u.includes("/school-district/")) && !u.includes("/search/")
        : u.includes("niche.com/k12/") && !u.includes("/d/") && !u.includes("/search/");
    });
    if (!hit?.url) return { url: null, grade: null, status: "no_page_found" };
    const scrapeRes = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url: hit.url,
        onlyMainContent: true,
        formats: [
          "markdown",
          {
            type: "json",
            prompt:
              "Extract the Overall Niche Grade shown on this Niche page. Return { overall_grade, entity_name, entity_type } where overall_grade is the letter grade (one of A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F) or null if the page shows no overall grade. entity_type is 'school' or 'district'.",
          },
        ],
      }),
    });
    if (!scrapeRes.ok) {
      const body = await scrapeRes.text();
      console.log(`[niche] scrape failed ${scrapeRes.status} for ${hit.url}: ${body.slice(0, 200)}`);
      return { url: hit.url, grade: null, status: "scrape_failed" };
    }
    const data = await scrapeRes.json();
    const payload = data?.data ?? data;
    const jsonGrade = normalizeGrade(payload?.json?.overall_grade);
    const md: string = payload?.markdown ?? "";
    const grade = jsonGrade ?? gradeFromMarkdown(md);
    return { url: hit.url, grade, status: grade ? "ok" : "no_grade_on_page" };
  } catch (e) {
    console.log(`[niche] scrape error for "${searchTerm}": ${(e as Error).message}`);
    return { url: null, grade: null, status: "scrape_failed" };
  }
}


Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Cache misses cost a billed Firecrawl search + scrape.
  const authz = await requireApprovedUser(req);
  if (!authz.ok) return authz.response;

  try {
    const { deal_id, force } = await req.json();
    if (!deal_id) throw new Error("deal_id required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: enrichment, error: eErr } = await supabase
      .from("deal_enrichment")
      .select("*")
      .eq("deal_id", deal_id)
      .maybeSingle();
    if (eErr) throw eErr;
    if (!enrichment) throw new Error("Run demographics enrichment first (need lat/lon).");
    if (enrichment.lat == null || enrichment.lon == null) throw new Error("Missing lat/lon on enrichment row.");
    if (!force && enrichment.schools) {
      return new Response(JSON.stringify({ schools: enrichment.schools, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pull deal city/state for building deterministic Niche fallback URLs
    const { data: dealRow } = await supabase
      .from("deals")
      .select("city, state")
      .eq("id", deal_id)
      .maybeSingle();
    const dealCity = (dealRow?.city ?? "") as string;
    const dealState = (dealRow?.state ?? "") as string;
    const cityStateQuery = [dealCity, dealState].filter(Boolean).join(" ");
    // Niche's own /k12/search often 302s to the homepage without a bot-friendly session.
    // Google site: search reliably lands on the correct Niche school/district page.
    const nicheSearch = (q: string) =>
      `https://www.google.com/search?q=${encodeURIComponent(`site:niche.com/k12 ${q.trim().replace(/\s+/g, " ")}`)}`;
    const fallbackSchoolUrl = (name: string) => nicheSearch(`${name} ${cityStateQuery}`);
    const cityNicheUrl = cityStateQuery
      ? `https://www.google.com/search?q=${encodeURIComponent(`site:niche.com/places-to-live ${cityStateQuery}`)}`
      : null;
    const cityPublicSchoolsUrl = cityStateQuery
      ? nicheSearch(`best public schools ${cityStateQuery}`)
      : null;

    const point: LatLon = { lat: Number(enrichment.lat), lon: Number(enrichment.lon) };

    const district = await findDistrict(point);
    // Try district-filtered first, then progressively widen radius without the LEAID filter.
    let schools = await findSchoolsNearby(point, district?.leaid ?? null, 5);
    for (const r of [5, 10, 15, 25]) {
      const haveAll = ["elementary", "middle", "high"].every((lvl) =>
        schools.some((s) => s.level === lvl),
      );
      if (haveAll) break;
      const wider = await findSchoolsNearby(point, null, r);
      // Merge, dedupe by name+lat+lon
      const seen = new Set(schools.map((s) => `${s.name}|${s.lat}|${s.lon}`));
      for (const s of wider) {
        const k = `${s.name}|${s.lat}|${s.lon}`;
        if (!seen.has(k)) {
          seen.add(k);
          schools.push(s);
        }
      }
    }
    console.log(`[schools-enrich] deal=${deal_id} found ${schools.length} schools; levels=`,
      schools.reduce((acc: Record<string, number>, s) => { acc[s.level] = (acc[s.level] ?? 0) + 1; return acc; }, {}));

    const elementary = pickByLevel(schools, "elementary");
    const middle = pickByLevel(schools, "middle");
    const high = pickByLevel(schools, "high");
    const picks = [elementary, middle, high].filter(Boolean) as School[];

    // Best-effort Niche grades (parallel, swallow errors)
    const districtState = dealState ? `, ${dealState}` : "";
    const noKey = !Deno.env.get("FIRECRAWL_API_KEY");
    const grades: NicheResult[] = await Promise.all([
      ...picks.map((s) => scrapeNicheGrade(`${s.name}${districtState}`, "school")),
      district
        ? scrapeNicheGrade(`${district.name}${districtState}`, "district")
        : Promise.resolve({ url: null, grade: null, status: "no_page_found" } as NicheResult),
    ]);
    picks.forEach((s, i) => {
      s.niche_grade = grades[i].grade;
      s.niche_status = grades[i].status;
      // Keep the canonical Niche URL when we found the page; else deterministic search
      s.niche_url = grades[i].url ?? fallbackSchoolUrl(s.name);
      console.log(`[niche] school="${s.name}" url=${grades[i].url ?? "none"} status=${grades[i].status} grade=${grades[i].grade ?? "null"}`);
    });
    const districtNiche: NicheResult = grades[picks.length] ?? { url: null, grade: null, status: "no_page_found" };
    if (district) {
      console.log(`[niche] district="${district.name}" url=${districtNiche.url ?? "none"} status=${districtNiche.status} grade=${districtNiche.grade ?? "null"}`);
    }

    const result: any = {
      district: district
        ? {
            leaid: district.leaid,
            name: district.name,
            state: district.state,
            niche_grade: districtNiche.grade,
            niche_status: districtNiche.status,
            niche_url: districtNiche.url ?? fallbackSchoolUrl(`${district.name} school district`),
          }
        : null,
      elementary,
      middle,
      high,
      city_niche_url: cityPublicSchoolsUrl,
      city_places_url: cityNicheUrl,
      city_label: cityStateQuery || null,
      niche_status: noKey ? "no_api_key" : "ok",
      fetched_at: new Date().toISOString(),
    };

    // Never downgrade a known grade on refresh: carry forward prior grades for the same entity.
    const prior: any = enrichment.schools ?? null;
    const carry = (next: any, old: any) => {
      if (!next || !old) return;
      if (!next.niche_grade && old.niche_grade && old.name === next.name) {
        next.niche_grade = old.niche_grade;
        if (old.niche_url) next.niche_url = old.niche_url;
        next.niche_status = "ok";
      }
    };
    if (prior) {
      carry(result.district, prior.district);
      for (const lvl of ["elementary", "middle", "high"] as const) carry(result[lvl], prior[lvl]);
    }

    const { error: uErr } = await supabase
      .from("deal_enrichment")
      .update({ schools: result, updated_at: new Date().toISOString() })
      .eq("deal_id", deal_id);
    if (uErr) throw uErr;


    return new Response(JSON.stringify({ schools: result, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
