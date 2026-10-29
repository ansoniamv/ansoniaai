import { describe, it, expect } from "vitest";
import {
  partnerToForm, formToPartnerFields, buildPartnerUpdate, diffContacts, emptyPartnerForm,
} from "@/lib/partnerForm";
import type { Partner, PartnerContact } from "@/hooks/usePartners";

const partner = {
  id: "p1",
  name: "Pearlmark",
  website: null,
  relationship_strength: "Warm",
  ansonia_poc: null,
  headquarters: "Chicago, IL",
  min_equity_m: 5,
  max_equity_m: 25,
  investor_type: ["Family Office"],
  investment_type: ["JV Equity"],
  hold_period: [],
  product_types: ["Multifamily"],
  geography: ["Texas"],
  geography_avoid: [],
  urban_infill: null,
  suburban: true,
  strategy_value_add: true,
  strategy_core_plus: null,
  strategy_workforce: false,
  strategy_affordable: false,
  capital_status: null,
  capital_available_from: null,
  capital_status_detail: null,
  additional_notes: null,
  manual_fields: ["geography"],
  enriched_fields: { hold_period: { source: "notes", as_of: "2026-01-01" } },
} as unknown as Partner;

const contact = (over: Partial<PartnerContact> = {}): PartnerContact => ({
  id: "c1", partner_id: "p1", name: "Jane Doe", email: "jane@pm.com", phone: null, role: "MD",
  linkedin_url: null, firm_location: null, ansonia_poc: null, is_primary: true, always_cc: false,
  created_at: "", updated_at: "", ...over,
});

const fieldsOf = (f: ReturnType<typeof partnerToForm>) => {
  const r = formToPartnerFields(f);
  if ("error" in r) throw new Error(r.error);
  return r.fields;
};

describe("buildPartnerUpdate", () => {
  it("is empty when nothing changed, including null booleans read back as false", () => {
    const { changed, update } = buildPartnerUpdate(partner, fieldsOf(partnerToForm(partner)), "me@x.com");
    expect(changed).toEqual([]);
    expect(update).toEqual({});
  });

  it("sends and locks only the fields that changed", () => {
    const form = { ...partnerToForm(partner), investment_type: ["JV Equity", "Preferred Equity"], headquarters: "Dallas, TX" };
    const { changed, update } = buildPartnerUpdate(partner, fieldsOf(form), "me@x.com", "NOW");
    expect(changed.sort()).toEqual(["headquarters", "investment_type"]);
    expect(update.investment_type).toEqual(["JV Equity", "Preferred Equity"]);
    expect(update.headquarters).toBe("Dallas, TX");
    expect(update.name).toBeUndefined();
    // headquarters is not an enriched field, so only investment_type gets a lock.
    expect(update.manual_fields).toEqual(["geography", "investment_type"]);
    const enriched = update.enriched_fields as Record<string, { source: string }>;
    expect(enriched.investment_type.source).toBe("manual");
    // Untouched provenance is left alone.
    expect(enriched.hold_period.source).toBe("notes");
  });

  it("re-stamps the capital confirmation date when capital status changes", () => {
    const form = { ...partnerToForm(partner), capital_status: "Selective" };
    const { update } = buildPartnerUpdate(partner, fieldsOf(form), null, "NOW");
    expect(update.capital_status).toBe("Selective");
    expect(update.capital_status_as_of).toBe("NOW");
    expect(update.manual_fields).toContain("capital_status");
  });

  it("does not lock anything for a non-enriched field", () => {
    const form = { ...partnerToForm(partner), additional_notes: "<p>Hi</p>" };
    const { update } = buildPartnerUpdate(partner, fieldsOf(form), null);
    expect(update.manual_fields).toBeUndefined();
    expect(update.enriched_fields).toBeUndefined();
  });
});

describe("formToPartnerFields", () => {
  it("rejects a missing name and a bad equity number", () => {
    expect(formToPartnerFields(emptyPartnerForm())).toEqual({ error: "Firm name is required" });
    expect(formToPartnerFields({ ...emptyPartnerForm(), name: "X", min_equity_m: "5m" })).toEqual({
      error: "Min equity must be a number",
    });
  });
});

describe("diffContacts", () => {
  it("finds new, edited and removed contacts and skips blank rows", () => {
    const original = [contact(), contact({ id: "c2", name: "Bob", email: null })];
    const form = partnerToForm(partner, original);
    form.contacts[0] = { ...form.contacts[0], phone: "212" };
    const [, bob] = form.contacts;
    form.contacts = [form.contacts[0], { name: "New", role: "", email: "", phone: "", linkedin_url: "", firm_location: "" },
      { name: "", role: "", email: "", phone: "", linkedin_url: "", firm_location: "" }];
    form.removed_contacts = [bob];
    const d = diffContacts(original, form);
    expect(d.updates).toEqual([expect.objectContaining({ id: "c1", phone: "212" })]);
    expect(d.inserts).toEqual([expect.objectContaining({ name: "New", email: null })]);
    expect(d.deletes).toEqual(["c2"]);
  });

  it("reports nothing for an untouched list", () => {
    const original = [contact()];
    const d = diffContacts(original, partnerToForm(partner, original));
    expect(d).toEqual({ inserts: [], updates: [], deletes: [] });
  });
});
