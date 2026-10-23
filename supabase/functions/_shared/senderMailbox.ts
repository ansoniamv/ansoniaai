// Outreach drafts belong in the sender's own Outlook, not a shared mailbox, so
// the mailbox is the one the signed-in user's app account is in. Only an
// address in the company's own domain can be one: anything else would be a
// Graph lookup that cannot succeed, or a mailbox we have no business writing to.

/** The sender's mailbox UPN, or null when their address can't be one of ours. */
export function senderMailboxUpn(email: string | null | undefined, domain: string): string | null {
  const e = (email ?? "").trim().toLowerCase();
  const d = domain.trim().toLowerCase();
  if (!d || !/^[^\s@]+@[^\s@]+$/.test(e)) return null;
  return e.endsWith(`@${d}`) ? e : null;
}
