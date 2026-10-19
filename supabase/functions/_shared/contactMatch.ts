// Matching an email-derived person against a partner's existing contacts.
//
// Pure — imported by analyze-partner-emails, outlook-sync and the frontend's
// suggestion-apply path, so all three agree on when "Will Hutton <new address>"
// is the Will Hutton already on file (replace his email) and when it is a new
// person (add a row).

export type ContactLike = {
  id: string;
  name: string | null;
  email: string | null;
};

const NICKNAMES: Record<string, string[]> = {
  sarah: ["sara","sadie"], sara: ["sarah"],
  robert: ["bob","rob","bobby","robbie"], bob: ["robert"], rob: ["robert"],
  william: ["will","bill","billy","liam"], bill: ["william"], will: ["william"],
  michael: ["mike","mick","mickey"], mike: ["michael"],
  richard: ["rick","dick","rich","richie"], rick: ["richard"],
  thomas: ["tom","tommy"], tom: ["thomas"],
  james: ["jim","jimmy","jamie"], jim: ["james"],
  john: ["johnny","jack","jonathan"], jack: ["john","jackson"],
  charles: ["charlie","chuck"], chuck: ["charles"], charlie: ["charles"],
  daniel: ["dan","danny"], dan: ["daniel"],
  david: ["dave","davey"], dave: ["david"],
  christopher: ["chris"], chris: ["christopher","christina","christine"],
  matthew: ["matt","matty"], matt: ["matthew"],
  andrew: ["andy","drew"], andy: ["andrew"],
  anthony: ["tony"], tony: ["anthony"],
  joseph: ["joe","joey"], joe: ["joseph"],
  benjamin: ["ben","benji"], ben: ["benjamin"],
  nicholas: ["nick","nicky"], nick: ["nicholas"],
  alexander: ["alex","xander"], alex: ["alexander","alexandra","alexandria"],
  samuel: ["sam","sammy"], sam: ["samuel","samantha"],
  elizabeth: ["liz","beth","betsy","eliza","lizzy"], liz: ["elizabeth"], beth: ["elizabeth"],
  katherine: ["kate","katie","kathy","kat"], kate: ["katherine","kathryn"], katie: ["katherine","kathryn"],
  jennifer: ["jen","jenny"], jen: ["jennifer"],
  margaret: ["maggie","meg","peggy"], maggie: ["margaret"],
  patricia: ["pat","patty","tricia"], pat: ["patrick","patricia"],
  patrick: ["pat","paddy"],
  jonathan: ["jon","jonny","john"], jon: ["jonathan"],
  edward: ["ed","eddie","ted"], ed: ["edward"], ted: ["edward","theodore"],
  theodore: ["theo","ted","teddy"],
};

export function normalizeNameToken(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^\p{L}]/gu, "");
}

export function splitFullName(raw: string | null | undefined): { first: string; last: string } | null {
  if (!raw) return null;
  let cleaned = String(raw)
    .replace(/["'`]/g, "")
    .replace(/\b(mr|mrs|ms|miss|dr|prof|sir|jr|sr|ii|iii|iv|esq|phd|md|cfa)\.?\b/gi, "")
    .replace(/\s+/g, " ").trim();
  // "Smith, Payton Larson" → "Payton Larson Smith" (Outlook's Last, First display form).
  const comma = cleaned.match(/^([^,]+),\s*(.+)$/);
  if (comma) cleaned = `${comma[2]} ${comma[1]}`.trim();
  if (!cleaned) return null;
  const parts = cleaned.split(/\s+/).map(p => p.replace(/\.$/, "")).filter(p => p && !/^[A-Za-z]$/.test(p)); // drop single-letter middle initials
  if (parts.length === 0) return null;
  const first = normalizeNameToken(parts[0]);
  const last = normalizeNameToken(parts[parts.length - 1]);
  if (!first || !last) return null;
  return { first, last };
}

function firstNameMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // Explicit nickname table only — no bare prefix rule (e.g. "danielle" must not match "dan").
  const aliases = new Set([...(NICKNAMES[a] || []), ...(NICKNAMES[b] || [])]);
  return aliases.has(a) || aliases.has(b);
}

export function domainOfEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const d = email.slice(at + 1).toLowerCase().trim();
  return d || null;
}

export function findContactByEmail<T extends ContactLike>(contacts: T[], email: string | null | undefined): T | null {
  if (!email) return null;
  const e = email.toLowerCase().trim();
  return contacts.find(c => c.email && c.email.toLowerCase().trim() === e) || null;
}

/** The one contact this name refers to, or null when none or ambiguous. */
export function findContactByName<T extends ContactLike>(contacts: T[], name: string | null | undefined): T | null {
  const parsed = splitFullName(name);
  if (!parsed) return null;
  const candidates = contacts
    .map(c => ({ c, p: splitFullName(c.name) }))
    .filter(x => x.p && x.p.last === parsed.last && firstNameMatches(x.p.first, parsed.first));
  if (candidates.length === 1) return candidates[0].c;
  // If multiple last-name matches, prefer exact first-name match
  const exact = candidates.filter(x => x.p!.first === parsed.first);
  if (exact.length === 1) return exact[0].c;
  return null;
}

export type ContactResolution<T> =
  /** Same email already on file — any update must keep that email. */
  | { kind: "email"; contact: T }
  /** Same person by name; the proposed email (if any) replaces the stored one. */
  | { kind: "name"; contact: T }
  /** Name matches someone, but the new address is off the firm's domains — could be a different person. */
  | { kind: "lookalike"; contact: T }
  | { kind: "none" };

/**
 * Decide whether {name, email} is an existing contact.
 *
 * Email match wins. Otherwise a unique name match is the same person, and their
 * stored email gets replaced — provided the new address is on one of the
 * partner's firm domains (or the stored one's domain). An off-domain address on
 * a matching name stays a flagged add: a namesake at a gmail address is not
 * enough to overwrite a work email.
 */
export function resolveContact<T extends ContactLike>(
  contacts: T[],
  proposed: { name?: string | null; email?: string | null },
  firmDomains: Iterable<string>,
): ContactResolution<T> {
  const email = proposed.email ? proposed.email.trim().toLowerCase() : null;
  const byEmail = findContactByEmail(contacts, email);
  if (byEmail) return { kind: "email", contact: byEmail };

  const byName = findContactByName(contacts, proposed.name);
  if (!byName) return { kind: "none" };
  if (!email) return { kind: "name", contact: byName };

  const newDomain = domainOfEmail(email);
  const allowed = new Set([...firmDomains].map(d => d.toLowerCase()));
  const storedDomain = domainOfEmail(byName.email);
  if (storedDomain) allowed.add(storedDomain);
  return newDomain && allowed.has(newDomain)
    ? { kind: "name", contact: byName }
    : { kind: "lookalike", contact: byName };
}
