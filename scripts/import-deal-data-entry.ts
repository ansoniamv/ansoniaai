// Importer for deal-data-entry.csv — the consolidated intake round trip.
//
//   deno run --allow-net --allow-env --allow-read scripts/import-deal-data-entry.ts deal-data-entry.csv
//   deno run --allow-net --allow-env --allow-read scripts/import-deal-data-entry.ts deal-data-entry.csv --apply
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Rules, all deliberate:
//  - street_address writes to deals.address, NEVER to deals.property_address.
//    property_address is written by HelloData; keeping the human value and the
//    vendor value in separate columns permanently is what stops the gate going
//    circular (verifying a HelloData match against a HelloData-supplied address).
//  - Nothing is guessed or inferred. A blank cell leaves the column untouched.
//  - Every rejection is reported with its reason. Silence is the failure mode
//    this codebase has been unwinding all week.

const URL_ = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APPLY = Deno.args.includes("--apply");
const FILE = Deno.args.find((a) => !a.startsWith("--")) ?? "deal-data-entry.csv";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REGULATORY = new Set(["green", "yellow", "red"]);

/** Same bar the match gate applies: a number and a name. "Columbus, OH" fails. */
function hasStreetAddress(s: string): boolean {
  return /\d+\s+\S*[A-Za-z]{2,}/.test(s.trim());
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v !== ""));
}

const text = await Deno.readTextFile(FILE);
const rows = parseCsv(text);
const head = rows[0].map((h) => h.trim());
const idx = (name: string) => head.indexOf(name);

for (const required of ["id", "street_address", "classic_units_remaining", "market_cap_rate", "regulatory_risk"]) {
  if (idx(required) < 0) { console.error(`CSV is missing the "${required}" column`); Deno.exit(1); }
}

type Skip = { row: number; id: string; field: string; value: string; why: string };
const skips: Skip[] = [];
const updates: Array<{ id: string; name: string; patch: Record<string, unknown> }> = [];
let blankRows = 0;

for (let r = 1; r < rows.length; r++) {
  const cells = rows[r];
  const id = (cells[idx("id")] ?? "").trim();
  const name = (cells[idx("property_name")] ?? "").trim();
  if (!UUID_RE.test(id)) { skips.push({ row: r + 1, id, field: "id", value: id, why: "not a UUID" }); continue; }

  const patch: Record<string, unknown> = {};

  const street = (cells[idx("street_address")] ?? "").trim();
  if (street) {
    if (!hasStreetAddress(street)) {
      skips.push({ row: r + 1, id, field: "street_address", value: street, why: "no street number + name — a city-level value cannot identify a building" });
    } else {
      patch.address = street;
    }
  }

  const classic = (cells[idx("classic_units_remaining")] ?? "").trim();
  if (classic) {
    const n = Number(classic);
    if (!Number.isFinite(n) || n < 0) skips.push({ row: r + 1, id, field: "classic_units_remaining", value: classic, why: "not a non-negative number" });
    else patch.classic_units_remaining = n;
  }

  const cap = (cells[idx("market_cap_rate")] ?? "").trim();
  if (cap) {
    const n = Number(cap.replace("%", ""));
    // Percent form only. 0.055 is a finite number in a plausible range, so a
    // bare > 0 check accepts it and stores a 0.055% cap rate — the reading
    // "valid number" is not the reading "valid cap rate". Real cap rates do not
    // sit below 1%, so anything under 1 is the decimal form and is rejected
    // rather than silently reinterpreted.
    if (!Number.isFinite(n) || n < 1 || n > 20) {
      skips.push({
        row: r + 1, id, field: "market_cap_rate", value: cap,
        why: n > 0 && n < 1
          ? "looks like decimal form — enter 5.5, not 0.055"
          : "expected a percentage between 1 and 20, e.g. 5.5",
      });
    }
    else patch.market_cap_rate = n;
  }

  const reg = (cells[idx("regulatory_risk")] ?? "").trim().toLowerCase();
  if (reg) {
    if (!REGULATORY.has(reg)) skips.push({ row: r + 1, id, field: "regulatory_risk", value: reg, why: "must be green, yellow or red" });
    else patch.regulatory_risk = reg;
  }

  if (Object.keys(patch).length === 0) { blankRows++; continue; }
  updates.push({ id, name, patch });
}

console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${FILE}\n`);
console.log(`rows read:            ${rows.length - 1}`);
console.log(`rows with no values:  ${blankRows} (left untouched)`);
console.log(`rows to update:       ${updates.length}`);
console.log(`values rejected:      ${skips.length}\n`);

if (skips.length) {
  console.log("rejected values — nothing written for these, and nothing guessed:");
  for (const s of skips) console.log(`  row ${String(s.row).padStart(3)}  ${s.field.padEnd(24)} "${s.value}"  → ${s.why}`);
  console.log();
}

const byField: Record<string, number> = {};
for (const u of updates) for (const k of Object.keys(u.patch)) byField[k] = (byField[k] ?? 0) + 1;
console.log("values accepted, by column:");
for (const [k, n] of Object.entries(byField).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(26)} ${n}`);

if (!APPLY) { console.log("\nDry run — nothing written. Re-run with --apply."); Deno.exit(0); }

let ok = 0, failed = 0;
for (const u of updates) {
  const res = await fetch(`${URL_}/rest/v1/deals?id=eq.${u.id}`, {
    method: "PATCH",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(u.patch),
  });
  if (res.ok) ok++;
  else { failed++; console.log(`  WRITE FAILED ${u.name} (${u.id}): ${res.status} ${(await res.text()).slice(0, 160)}`); }
}
console.log(`\nwritten: ${ok}   failed: ${failed}`);
