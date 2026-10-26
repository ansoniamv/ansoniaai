// Pure pieces of extract-partner-from-notes: the response schema, the prompt,
// and the clean-up of what the model returns. Kept free of Deno APIs so the
// vitest suite can import it.
//
// This extracts only who the firm is and who we talk to there. The mandate
// (geography, check size, strategy, product types) and the briefing are left to
// enrich-partner-from-notes, which runs on the saved note after the profile is
// created and records per-field provenance — doing it here too would mean two
// extractors that can disagree.

// Mirrors the options on the New Partner form (src/pages/NewPartner.tsx).
export const FIRM_TYPES = ["GP", "LP", "Family Office", "REIT", "Insurance", "Pension", "Endowment", "Fund of Funds", "Other"] as const;
export const WARMTH_LEVELS = ["Existing Partner", "Very Warm", "Warm", "Tepid", "Cold"] as const;

export const MAX_NOTES_CHARS = 30000;

// Empty string means "not in the notes": the API's structured output handles a
// plain string more reliably than a nullable one, and cleanDraft maps "" to null.
export const PARTNER_DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "firm_type", "headquarters", "website", "relationship_strength", "contacts"],
  properties: {
    name: { type: "string", description: "The firm's name as the notes write it, without the person's name. Empty if no firm is named." },
    firm_type: { type: "string", enum: [...FIRM_TYPES, ""] },
    headquarters: { type: "string", description: "City, State of the firm's HQ or main office. Empty if not stated." },
    website: { type: "string", description: "The firm's website domain if written in the notes or evident from an email address. Empty otherwise." },
    relationship_strength: {
      type: "string",
      enum: [...WARMTH_LEVELS, ""],
      description: "Only when the notes make it clear: an existing partner we have closed deals with, or how warm the relationship is. Empty when unsure.",
    },
    contacts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "role", "email", "phone", "linkedin_url", "firm_location"],
        properties: {
          name: { type: "string" },
          role: { type: "string", description: "Title, e.g. Managing Director" },
          email: { type: "string" },
          phone: { type: "string" },
          linkedin_url: { type: "string" },
          firm_location: { type: "string", description: "Office the person sits in, City, State" },
        },
      },
    },
  },
} as const;

export function buildPartnerDraftPrompt(notes: string): string {
  return `You are setting up a new capital partner (an equity investor, lender or LP firm) in a multifamily real-estate firm's CRM, from notes someone took about them.

Pull out who the firm is and the people at the firm. Use only what the notes say. Never invent a name, email, phone number or website; leave a field empty when the notes don't give it.

- name: the investor firm, not our own firm (Ansonia) and not a property.
- contacts: people who work at the investor firm. Skip Ansonia staff and anyone from a third party (brokers, lawyers). One entry per person.
- firm_type: GP = operator/sponsor; LP = passive equity investor fund; pick "Other" for a lender or anything that doesn't fit; empty if unclear.
- website: a domain like example.com. A firm email domain counts; a personal one (gmail.com, outlook.com, yahoo.com, icloud.com) does not.

NOTES:
${notes}`;
}

export type ContactDraft = {
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  firm_location: string | null;
};

export type PartnerDraft = {
  name: string | null;
  firm_type: string | null;
  headquarters: string | null;
  website: string | null;
  relationship_strength: string | null;
  contacts: ContactDraft[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function oneOf(v: unknown, allowed: readonly string[]): string | null {
  const s = str(v);
  return s && allowed.includes(s) ? s : null;
}

/** "https://www.Example.com/about" → "example.com". Anything without a dot is dropped. */
export function normalizeWebsite(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const host = s.toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#\s]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/**
 * Turn the model's answer into something safe to show and save: blanks become
 * null, enums outside the list are dropped, an email that isn't one is dropped,
 * and a contact with no name, email or phone is dropped. Contacts repeated by
 * email (or by name when there is no email) collapse into the first one.
 */
export function cleanDraft(raw: any): PartnerDraft {
  const seen = new Set<string>();
  const contacts: ContactDraft[] = [];
  for (const c of Array.isArray(raw?.contacts) ? raw.contacts : []) {
    const email = str(c?.email)?.toLowerCase() ?? null;
    const contact: ContactDraft = {
      name: str(c?.name) ?? "",
      role: str(c?.role),
      email: email && EMAIL_RE.test(email) ? email : null,
      phone: str(c?.phone),
      linkedin_url: str(c?.linkedin_url),
      firm_location: str(c?.firm_location),
    };
    if (!contact.name && !contact.email && !contact.phone) continue;
    const key = contact.email ?? contact.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    contacts.push(contact);
  }
  return {
    name: str(raw?.name),
    firm_type: oneOf(raw?.firm_type, FIRM_TYPES),
    headquarters: str(raw?.headquarters),
    website: normalizeWebsite(raw?.website),
    relationship_strength: oneOf(raw?.relationship_strength, WARMTH_LEVELS),
    contacts,
  };
}
