// Dry-run harness: what does the quarantine do to scores? NO WRITES.
//   npx vitest run scripts/quarantine-dryrun.test.ts
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { it, expect } from "vitest";
import { scoreDeal } from "../src/lib/dealScoring";

const URL_ = process.env.SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Columns the quarantine clears. hellodata_payload is deliberately NOT here —
// it is the evidence of what was matched.
const CLEARED = [
  "median_income_tract", "median_rent_tract", "median_age_tract",
  "vacancy_rate_tract", "bachelors_pct_tract", "owner_occupied_pct_tract",
  "population_density_tract", "race_breakdown_tract", "building_quality_score",
  "review_avg_rating", "review_count", "review_positive_count", "review_negative_count",
  "msa", "ami_limits", "property_website", "property_address",
  "in_place_avg_rent", "avg_time_on_market", "avg_price_change",
  "avg_posting_duration", "floor_plans", "concessions_history",
  "active_concessions_summary", "uses_rev_management", "property_phone",
  "photo_urls", "is_lease_up",
];

const QUARANTINE_IDS = [
  "fb2735eb-0ccf-4b21-94dd-599a3d0fba50", // Allston Pointe
  "cf0c1258-36da-4d73-b3f2-b32bc1626548", // Avery Pointe
  "be99f9d3-78cc-4008-b34b-f1646b25299e", // Avita Alamo Heights
  "4a589ecc-16ce-408b-9581-b15f8ed209a9", // Hilliard Station Apartments
  "51985bc3-84ed-4a10-a933-08d5df12eeaf", // Link at Plano
  "8927719c-ee62-47dc-9e67-620b007b391f", // NoCa Blue
  "9165e579-68c5-497e-bae7-d3ff23e782ff", // Northpark Place
  "b9680b03-ee22-4bcc-8ac0-0f0e54e73296", // One Superior
  "d01ef0f4-6278-4ea7-a617-77bf7b93ca4b", // River Grove Station I
  "fc90ffd5-db18-4f09-9307-2f843efd95ae", // Summit Ridge
  "aa03c322-f536-42fe-853a-094cdac7711e", // The KC High Line & Quality House
  "51c58e13-a836-434f-a063-b009d696d808", // Woodlake Apartments
];

const pad = (s: unknown, n: number) => String(s ?? "").slice(0, n).padEnd(n);
const num = (v: unknown) => (typeof v === "number" ? v.toFixed(1) : String(v ?? "-"));

it("quarantine dry run", async () => {
  const res = await fetch(`${URL_}/rest/v1/deals?select=*&id=in.(${QUARANTINE_IDS.join(",")})`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const deals = await res.json();
  expect(Array.isArray(deals)).toBe(true);

  const countable = (f: Record<string, unknown> | null | undefined) =>
    f ? Object.values(f).filter((v) => v !== null && v !== undefined).length : 0;

  let crossings = 0;
  const lines: string[] = [];
  const meaningless: string[] = [];

  for (const d of deals) {
    const after = { ...d };
    for (const c of CLEARED) after[c] = null;

    const b = scoreDeal(d as any);
    const a = scoreDeal(after as any);

    const bFac = countable((b as any).factor_scores);
    const aFac = countable((a as any).factor_scores);
    const crossed = b.deal_tier !== a.deal_tier;
    if (crossed) crossings++;
    if (aFac <= 2) meaningless.push(`${d.property_name} (${aFac} computable pillar${aFac === 1 ? "" : "s"})`);

    lines.push(
      `  ${pad(d.property_name, 28)} ${pad(num(b.total_score), 6)}->${pad(num(a.total_score), 7)} ` +
      `${pad(b.deal_tier, 20)}->${pad(a.deal_tier, 20)} ${crossed ? "MOVED" : ""} ` +
      `pillars ${bFac}->${aFac} conf ${num((b as any).score_confidence)}->${num((a as any).score_confidence)} ` +
      `cov ${num((b as any).score_coverage)}->${num((a as any).score_coverage)}`,
    );
  }

  console.log(`\n=== quarantine dry run: ${deals.length} deals, NO WRITES ===\n`);
  console.log(lines.join("\n"));
  console.log(`\n  tier crossings: ${crossings} of ${deals.length}`);
  console.log(`\n  scores built on <=2 computable pillars (report as meaningless, not as a number):`);
  console.log(meaningless.length ? meaningless.map((m) => "    - " + m).join("\n") : "    none");
});
