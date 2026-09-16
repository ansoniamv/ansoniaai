import { describe, it, expect } from "vitest";
import {
  EXTRACTABLE_FIELDS,
  coerceDealFields,
  preExtractFacts,
  firmFromEmailDomain,
  looksLikeYear,
  yearMax,
} from "../../supabase/functions/_shared/dealFields";

/**
 * The extractor writes into public.inbox_deals. This list is the column
 * contract: a name here that is not a real column fails the UPDATE, and because
 * the same list is interpolated into the preceding SELECT, it fails that too —
 * which silently disables the don't-overwrite guard. `price_guidance` did
 * exactly that, and asking_price was populated on 0 of 512 production rows.
 */
const INBOX_DEALS_COLUMNS = new Set([
  "accepted_deal_id", "address", "asking_price", "asset_class", "assigned_to", "avg_sf",
  "broker_contact_email", "broker_contact_name", "broker_firm", "created_at",
  "denial_category", "denial_reason", "denied", "denied_at", "denied_by", "email_body",
  "email_count", "email_message_id", "email_received_at", "email_subject",
  "email_thread_summary", "fit_rationale", "fit_score", "fit_tier", "gate_checked_at",
  "gate_content_hash", "gate_reason", "gate_status", "id", "location_city",
  "location_state", "msa", "occupancy_pct", "offers_due", "other_details",
  "property_name", "reviewed", "reviewed_at", "source", "strategy", "units",
  "updated_at", "year_built",
]);

describe("column contract", () => {
  it("every extractable field is a real inbox_deals column", () => {
    const notColumns = EXTRACTABLE_FIELDS.filter((f) => !INBOX_DEALS_COLUMNS.has(f));
    expect(notColumns).toEqual([]);
  });

  it("carries asking_price, not the non-existent price_guidance", () => {
    expect(EXTRACTABLE_FIELDS).toContain("asking_price");
    expect(EXTRACTABLE_FIELDS as readonly string[]).not.toContain("price_guidance");
  });
});

describe("Casata San Marcos — a year must not land in units", () => {
  // The real production row read units=2026, year_built=null. The old regex used
  // \s* between the number and "units", which crosses newlines, so a delivery
  // year ending one line and a "Units" label starting the next matched as one.
  const body = [
    "Casata San Marcos",
    "Build-to-rent community, delivery 2026",
    "Units: 288",
    "Avg SF 1,150",
    "San Marcos, TX",
  ].join("\n");

  it("does not capture the delivery year as a unit count", () => {
    const r = preExtractFacts("Casata San Marcos", body);
    expect(r.units).not.toBe(2026);
  });

  it("captures the real unit count from the labelled line", () => {
    const r = preExtractFacts("Casata San Marcos", body);
    expect(r.units).toBe(288);
  });

  it("rejects a bare year+units payload and says why", () => {
    const { fields, rejected } = coerceDealFields({ units: 2026 });
    expect(fields.units).toBeUndefined();
    expect(rejected).toEqual([
      { field: "units", value: 2026, reason: "looks like a calendar year, not a unit count" },
    ]);
  });
});

describe("Coffey Creek — a full payload lands key by key", () => {
  const payload = {
    property_name: "Coffey Creek Apartments",
    address: "8700 Coffey Creek Blvd",
    location_city: "Charlotte",
    location_state: "NC",
    msa: "Charlotte-Concord-Gastonia, NC-SC",
    units: "312",
    year_built: "2021",
    avg_sf: "1,045",
    occupancy_pct: "94.5",
    asset_class: "Multifamily",
    strategy: "Core-Plus",
    offers_due: "2026-10-02",
    broker_firm: "Newmark",
    asking_price: "$68.5M",
  };

  const { fields, rejected } = coerceDealFields(payload);

  it("rejects nothing from a clean payload", () => {
    expect(rejected).toEqual([]);
  });

  it.each([
    ["property_name", "Coffey Creek Apartments"],
    ["address", "8700 Coffey Creek Blvd"],
    ["location_city", "Charlotte"],
    ["location_state", "NC"],
    ["msa", "Charlotte-Concord-Gastonia, NC-SC"],
    ["asset_class", "Multifamily"],
    ["strategy", "Core-Plus"],
    ["offers_due", "2026-10-02"],
    ["broker_firm", "Newmark"],
    ["asking_price", "$68.5M"],
  ])("%s lands as %s", (key, expected) => {
    expect(fields[key as keyof typeof fields]).toBe(expected);
  });

  it("coerces the numerics to ints without crossing them", () => {
    expect(fields.units).toBe(312);
    expect(fields.year_built).toBe(2021);
    expect(fields.avg_sf).toBe(1045);
    expect(fields.occupancy_pct).toBe(94.5);
  });

  it("units and year_built are never the same value", () => {
    expect(fields.units).not.toBe(fields.year_built);
  });
});

describe("write-boundary guards", () => {
  it.each([
    [0, "outside 1-5000"],
    [5001, "outside 1-5000"],
    [-12, "outside 1-5000"],
  ])("rejects units %s", (v, reason) => {
    const { fields, rejected } = coerceDealFields({ units: v });
    expect(fields.units).toBeUndefined();
    expect(rejected[0].reason).toBe(reason);
  });

  it("accepts units at both ends of the range", () => {
    expect(coerceDealFields({ units: 1 }).fields.units).toBe(1);
    expect(coerceDealFields({ units: 5000 }).fields.units).toBe(5000);
  });

  it("accepts a future vintage up to current year + 3", () => {
    const now = new Date();
    expect(coerceDealFields({ year_built: yearMax(now) }, now).fields.year_built).toBe(yearMax(now));
  });

  it("rejects a vintage beyond current year + 3", () => {
    const now = new Date();
    const { fields, rejected } = coerceDealFields({ year_built: yearMax(now) + 1 }, now);
    expect(fields.year_built).toBeUndefined();
    expect(rejected[0].field).toBe("year_built");
  });

  it("rejects a pre-1900 vintage", () => {
    expect(coerceDealFields({ year_built: 1890 }).fields.year_built).toBeUndefined();
  });

  it("rejects non-numeric units rather than writing NaN", () => {
    const { fields, rejected } = coerceDealFields({ units: "TBD" });
    expect(fields.units).toBeUndefined();
    expect(rejected[0].reason).toBe("not an integer");
  });

  it("rejects an out-of-range occupancy", () => {
    expect(coerceDealFields({ occupancy_pct: 140 }).fields.occupancy_pct).toBeUndefined();
    expect(coerceDealFields({ occupancy_pct: 94 }).fields.occupancy_pct).toBe(94);
  });

  it("looksLikeYear spans 1900 to current year + 3", () => {
    const now = new Date();
    expect(looksLikeYear(1899, now)).toBe(false);
    expect(looksLikeYear(1900, now)).toBe(true);
    expect(looksLikeYear(2026, now)).toBe(true);
    expect(looksLikeYear(yearMax(now) + 1, now)).toBe(false);
  });
});

describe("broker_firm from the email domain", () => {
  // Contact name and email are written at ingest from the headers; broker_firm
  // was only ever written by the model, which is why the contact survived an
  // LLM outage and the firm did not.
  it.each([
    ["mgrant@cbre.com", "CBRE"],
    ["j.smith@jll.com", "JLL"],
    ["deals@nmrk.com", "Newmark"],
    ["broker@berkadia.com", "Berkadia"],
    ["a@greysteel.com", "Greysteel"],
    ["someone@lonestarrealty.net", "Lonestarrealty"],
  ])("%s -> %s", (email, firm) => {
    expect(firmFromEmailDomain(email)).toBe(firm);
  });

  it.each([
    ["broker@gmail.com"],
    ["x@crexi.com"],
    ["y@buildout.com"],
  ])("returns null for the generic domain %s", (email) => {
    expect(firmFromEmailDomain(email)).toBeNull();
  });

  it("handles a two-part public suffix", () => {
    expect(firmFromEmailDomain("a@savills.co.uk")).toBe("Savills");
  });

  it("returns null for junk input", () => {
    expect(firmFromEmailDomain(null)).toBeNull();
    expect(firmFromEmailDomain("not-an-email")).toBeNull();
    expect(firmFromEmailDomain("")).toBeNull();
  });
});
