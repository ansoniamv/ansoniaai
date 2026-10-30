// Who an outreach draft to one partner is addressed to.
//
// To: the contact the user picked, else the partner's default contact
// (is_primary), else the first contact with an email. CC: every other contact
// marked always_cc that has an email, plus OUTREACH_ALWAYS_CC on every draft.

export type OutreachContact = {
  id: string;
  name: string | null;
  email: string | null;
  is_primary: boolean;
  always_cc: boolean;
};

// CC'd on every outreach draft, whoever it goes to: Daniel, and Atlas so the
// thread syncs back into the app even when it's sent from a personal address.
export const OUTREACH_ALWAYS_CC = [
  { name: "Daniel Stevens", email: "dstevens@ansoniaproperties.com" },
  { name: "Atlas", email: "atlas@ansoniaproperties.com" },
] as const;

const hasEmail = (c: OutreachContact) => !!c.email?.trim();

export function outreachAddressees(
  contacts: OutreachContact[],
  pickedId?: string | null,
): { to: OutreachContact | null; cc: OutreachContact[] } {
  const mailable = contacts.filter(hasEmail);
  const to =
    mailable.find((c) => c.id === pickedId) ??
    mailable.find((c) => c.is_primary) ??
    mailable[0] ??
    null;
  const cc = mailable.filter((c) => c.always_cc && c.id !== to?.id);
  return { to, cc };
}

// The CC line for one draft: the partner's always_cc contacts, then
// OUTREACH_ALWAYS_CC, with no address twice and never the To address.
export function outreachCcEmails(to: string | null, cc: OutreachContact[]): string[] {
  const seen = new Set(to ? [to.trim().toLowerCase()] : []);
  const out: string[] = [];
  for (const email of [...cc.map((c) => c.email ?? ""), ...OUTREACH_ALWAYS_CC.map((c) => c.email)]) {
    const key = email.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(email.trim());
  }
  return out;
}
