// One-off: re-map the already-fetched deals through the shared HelloData mapper.
//
// Makes ZERO HelloData API calls — it reads deals.hellodata_payload, which is
// already cached on every fetched deal, and runs the same pure mapper the edge
// function now uses. Nothing touches hellodata_status, so no cache is defeated.
//
//   deno run --allow-net --allow-env scripts/backfill-hellodata-remap.ts --dry-run
//   deno run --allow-net --allow-env scripts/backfill-hellodata-remap.ts --apply
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { mapHelloDataProperty, selectWritableFields } from "../supabase/functions/_shared/hellodataMapping.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APPLY = Deno.args.includes("--apply");

const REPORT = [
  "in_place_avg_rent", "avg_time_on_market", "floor_plans", "concessions_history",
  "active_concessions_summary", "avg_price_change", "avg_posting_duration",
  "management_company", "uses_rev_management", "property_phone", "photo_urls",
  "vacancy_rate_tract", "bachelors_pct_tract", "owner_occupied_pct_tract",
  "race_breakdown_tract", "review_avg_rating", "building_quality_score", "ami_limits",
];

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

function brief(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `array(${v.length})`;
  if (typeof v === "object") return `object(${Object.keys(v as object).length} keys)`;
  const s = String(v);
  return s.length > 40 ? s.slice(0, 37) + "..." : s;
}

const res = await fetch(
  `${URL_}/rest/v1/deals?select=*&hellodata_status=eq.fetched&hellodata_payload=not.is.null&order=property_name`,
  { headers: H },
);
if (!res.ok) { console.error("load failed", res.status, await res.text()); Deno.exit(1); }
const deals = await res.json();
console.log(`${deals.length} fetched deals with a cached payload\n`);

let changedDeals = 0, writeErrors = 0;
const fieldHits: Record<string, number> = {};

for (const deal of deals) {
  const { update: allFields } = mapHelloDataProperty(deal.hellodata_payload);

  const toWrite = selectWritableFields(allFields, deal);

  const diffs: string[] = [];
  for (const k of REPORT) {
    const before = deal[k] ?? null;
    const after = k in toWrite ? toWrite[k] : before;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      diffs.push(`      ${k.padEnd(28)} ${brief(before)}  ->  ${brief(after)}`);
      fieldHits[k] = (fieldHits[k] ?? 0) + 1;
    }
  }

  if (!diffs.length) { console.log(`  = ${deal.property_name ?? deal.id} — no change`); continue; }
  changedDeals++;
  console.log(`  * ${deal.property_name ?? deal.id}`);
  console.log(diffs.join("\n"));

  if (APPLY) {
    const w = await fetch(`${URL_}/rest/v1/deals?id=eq.${deal.id}`, {
      method: "PATCH",
      headers: { ...H, Prefer: "return=minimal" },
      body: JSON.stringify(toWrite),
    });
    if (!w.ok) { writeErrors++; console.log(`      WRITE FAILED ${w.status}: ${(await w.text()).slice(0, 200)}`); }
  }
}

console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"} — ${changedDeals}/${deals.length} deals would change, ${writeErrors} write errors`);
console.log("\nfields changed, by count:");
for (const [k, n] of Object.entries(fieldHits).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(30)} ${n}`);
}
