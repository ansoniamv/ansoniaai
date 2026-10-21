/**
 * The AI outreach draft marks what it could not fill as [[CFO date]]. None of
 * those may reach a partner, so the dialog lists them and holds the drafts
 * until each one is filled in or removed.
 */
export function unfilledPlaceholders(...texts: string[]): string[] {
  const found = new Set<string>();
  for (const t of texts) {
    for (const m of t.matchAll(/\[\[([^\]\n]*)\]\]/g)) found.add(m[1].trim() || "(blank)");
  }
  return [...found];
}
