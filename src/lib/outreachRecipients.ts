// Who an outreach draft to one partner is addressed to.
//
// To: the contact the user picked, else the partner's default contact
// (is_primary), else the first contact with an email. CC: every other contact
// marked always_cc that has an email.

export type OutreachContact = {
  id: string;
  name: string | null;
  email: string | null;
  is_primary: boolean;
  always_cc: boolean;
};

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
