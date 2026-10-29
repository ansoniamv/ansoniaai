// State and save logic for the capital-partner form. Add Partner and Edit
// Partner render the same form; this file turns a stored partner into form
// state and works out what a save changes.

import type { Partner, PartnerContact } from "@/hooks/usePartners";

export type ContactDraft = {
  /** Set for a contact already on file; absent for one added in this form. */
  id?: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  linkedin_url: string;
  firm_location: string;
};

export type PartnerFormState = {
  name: string;
  website: string;
  relationship_strength: string;
  ansonia_poc: string;
  headquarters: string;
  min_equity_m: string;
  max_equity_m: string;
  investor_type: string[];
  investment_type: string[];
  hold_period: string[];
  product_types: string[];
  geography: string[];
  geography_avoid: string[];
  urban_infill: boolean;
  suburban: boolean;
  strategy_value_add: boolean;
  strategy_core_plus: boolean;
  strategy_workforce: boolean;
  strategy_affordable: boolean;
  capital_status: string;
  capital_available_from: string;
  capital_status_detail: string;
  additional_notes: string;
  /** Add only: saved as the first timeline note. */
  initial_note: string;
  contacts: ContactDraft[];
  /** Edit only: contacts on file the user removed; deleted on save. */
  removed_contacts: ContactDraft[];
};

export const emptyContact = (): ContactDraft => ({
  name: "", role: "", email: "", phone: "", linkedin_url: "", firm_location: "",
});

export const emptyPartnerForm = (): PartnerFormState => ({
  name: "",
  website: "",
  relationship_strength: "",
  ansonia_poc: "",
  headquarters: "",
  min_equity_m: "",
  max_equity_m: "",
  investor_type: [],
  investment_type: [],
  hold_period: [],
  product_types: [],
  geography: [],
  geography_avoid: [],
  urban_infill: false,
  suburban: false,
  strategy_value_add: false,
  strategy_core_plus: false,
  strategy_workforce: false,
  strategy_affordable: false,
  capital_status: "",
  capital_available_from: "",
  capital_status_detail: "",
  additional_notes: "",
  initial_note: "",
  contacts: [emptyContact()],
  removed_contacts: [],
});

function contactToDraft(c: PartnerContact): ContactDraft {
  return {
    id: c.id,
    name: c.name ?? "",
    role: c.role ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    linkedin_url: c.linkedin_url ?? "",
    firm_location: c.firm_location ?? "",
  };
}

export function partnerToForm(p: Partner, contacts: PartnerContact[] = []): PartnerFormState {
  return {
    name: p.name ?? "",
    website: p.website ?? "",
    relationship_strength: p.relationship_strength ?? "",
    ansonia_poc: p.ansonia_poc ?? "",
    headquarters: p.headquarters ?? "",
    min_equity_m: p.min_equity_m?.toString() ?? "",
    max_equity_m: p.max_equity_m?.toString() ?? "",
    investor_type: p.investor_type ?? [],
    investment_type: p.investment_type ?? [],
    hold_period: p.hold_period ?? [],
    product_types: p.product_types ?? [],
    geography: p.geography ?? [],
    geography_avoid: p.geography_avoid ?? [],
    urban_infill: !!p.urban_infill,
    suburban: !!p.suburban,
    strategy_value_add: !!p.strategy_value_add,
    strategy_core_plus: !!p.strategy_core_plus,
    strategy_workforce: !!p.strategy_workforce,
    strategy_affordable: !!p.strategy_affordable,
    capital_status: p.capital_status ?? "",
    capital_available_from: p.capital_available_from ?? "",
    capital_status_detail: p.capital_status_detail ?? "",
    additional_notes: p.additional_notes ?? "",
    initial_note: "",
    contacts: contacts.length ? contacts.map(contactToDraft) : [emptyContact()],
    removed_contacts: [],
  };
}

/** The partners-row columns the form writes, as they would be stored. */
export type PartnerFields = Pick<
  Partner,
  | "name" | "website" | "relationship_strength" | "ansonia_poc" | "headquarters"
  | "min_equity_m" | "max_equity_m" | "investor_type" | "investment_type" | "hold_period" | "product_types"
  | "geography" | "geography_avoid" | "urban_infill" | "suburban"
  | "strategy_value_add" | "strategy_core_plus" | "strategy_workforce" | "strategy_affordable"
  | "capital_status" | "capital_available_from" | "capital_status_detail" | "additional_notes"
>;

const orNull = (s: string) => s.trim() || null;

/** Form state → stored values, or an error message for the first bad input. */
export function formToPartnerFields(f: PartnerFormState): { fields: PartnerFields } | { error: string } {
  if (!f.name.trim()) return { error: "Firm name is required" };
  const min = f.min_equity_m.trim() === "" ? null : Number(f.min_equity_m);
  const max = f.max_equity_m.trim() === "" ? null : Number(f.max_equity_m);
  if (min != null && !Number.isFinite(min)) return { error: "Min equity must be a number" };
  if (max != null && !Number.isFinite(max)) return { error: "Max equity must be a number" };
  return {
    fields: {
      name: f.name.trim(),
      website: orNull(f.website),
      relationship_strength: orNull(f.relationship_strength),
      ansonia_poc: orNull(f.ansonia_poc),
      headquarters: orNull(f.headquarters),
      min_equity_m: min,
      max_equity_m: max,
      investor_type: f.investor_type,
      investment_type: f.investment_type,
      hold_period: f.hold_period,
      product_types: f.product_types,
      geography: f.geography,
      geography_avoid: f.geography_avoid,
      urban_infill: f.urban_infill,
      suburban: f.suburban,
      strategy_value_add: f.strategy_value_add,
      strategy_core_plus: f.strategy_core_plus,
      strategy_workforce: f.strategy_workforce,
      strategy_affordable: f.strategy_affordable,
      capital_status: orNull(f.capital_status),
      capital_available_from: orNull(f.capital_available_from),
      capital_status_detail: orNull(f.capital_status_detail),
      additional_notes: orNull(f.additional_notes),
    } as PartnerFields,
  };
}

/**
 * Fields the notes enricher fills (enrich-partner-from-notes FIELDS) plus
 * warmth. A human edit to one of these locks it from the enricher.
 * geography_avoid is manual-only, so it never needs a lock.
 */
export const LOCKABLE_FIELDS = [
  "geography", "investor_type", "investment_type", "hold_period", "product_types", "min_equity_m", "max_equity_m",
  "strategy_value_add", "strategy_core_plus", "strategy_workforce", "strategy_affordable",
  "urban_infill", "suburban", "relationship_strength",
] as const;

const CAPITAL_FIELDS = ["capital_status", "capital_available_from", "capital_status_detail"] as const;

function sameValue(before: unknown, after: unknown): boolean {
  if (Array.isArray(before) || Array.isArray(after)) {
    const a = (before as unknown[] | null) ?? [];
    const b = (after as unknown[] | null) ?? [];
    if (a.length !== b.length) return false;
    const s = new Set(a);
    return b.every((x) => s.has(x));
  }
  // Booleans are stored nullable; an unset flag reads as false in the form.
  if (typeof after === "boolean") return !!before === after;
  return (before ?? null) === (after ?? null);
}

/**
 * The update for an edit: only the columns that changed, plus the AI locks.
 * Only fields the user actually changed get locked and stamped as manual, so
 * saving one edit does not freeze every other field against enrichment.
 * A capital-status change re-stamps its confirmation date, as the old card did.
 */
export function buildPartnerUpdate(
  partner: Partner,
  fields: PartnerFields,
  setBy: string | null,
  now = new Date().toISOString(),
): { changed: string[]; update: Record<string, unknown> } {
  const changed = (Object.keys(fields) as (keyof PartnerFields)[]).filter(
    (k) => !sameValue((partner as any)[k], fields[k]),
  );
  if (changed.length === 0) return { changed, update: {} };

  const update: Record<string, unknown> = {};
  for (const k of changed) update[k] = fields[k];

  const lockKeys: string[] = changed.filter((k) => (LOCKABLE_FIELDS as readonly string[]).includes(k));
  if (changed.some((k) => (CAPITAL_FIELDS as readonly string[]).includes(k))) {
    lockKeys.push("capital_status");
    update.capital_status_as_of = now;
  }
  if (lockKeys.length) {
    const enriched: Record<string, unknown> = { ...((partner.enriched_fields as Record<string, unknown>) ?? {}) };
    for (const k of lockKeys) enriched[k] = { source: "manual", as_of: now, written_at: now, set_by: setBy };
    update.manual_fields = Array.from(new Set([...(partner.manual_fields ?? []), ...lockKeys]));
    update.enriched_fields = enriched;
  }
  return { changed, update };
}

const CONTACT_KEYS = ["name", "role", "email", "phone", "linkedin_url", "firm_location"] as const;

export const isBlankContact = (c: ContactDraft) => !c.name.trim() && !c.email.trim() && !c.phone.trim();

function contactRow(c: ContactDraft) {
  return {
    name: c.name.trim() || "(unnamed)",
    role: orNull(c.role),
    email: orNull(c.email),
    phone: orNull(c.phone),
    linkedin_url: orNull(c.linkedin_url),
    firm_location: orNull(c.firm_location),
  };
}

export type ContactRow = ReturnType<typeof contactRow>;

/** What a save does to the contacts: new rows, edited rows, removed ids. Blank new rows are skipped. */
export function diffContacts(original: PartnerContact[], f: PartnerFormState) {
  const byId = new Map(original.map((c) => [c.id, c]));
  const inserts: ContactRow[] = [];
  const updates: (ContactRow & { id: string })[] = [];
  for (const c of f.contacts) {
    if (!c.id) {
      if (!isBlankContact(c)) inserts.push(contactRow(c));
      continue;
    }
    const before = byId.get(c.id);
    if (!before) continue;
    const row = contactRow(c);
    if (CONTACT_KEYS.some((k) => (before[k] ?? null) !== row[k])) updates.push({ id: c.id, ...row });
  }
  const deletes = f.removed_contacts.map((c) => c.id).filter((id): id is string => !!id && byId.has(id));
  return { inserts, updates, deletes };
}
