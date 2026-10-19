/**
 * Deal-name matching for the map's search box.
 *
 * Case- and accent-insensitive, and whitespace-collapsed, so "the  reserve"
 * finds "The Reserve" and "cafe" finds "Café Lofts". Ranked so the deal you are
 * typing the start of comes first: whole name, then a name that starts with the
 * query, then a word inside the name that does, then anywhere in it. Ties keep
 * the caller's order, which for the map is newest first.
 */

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Lower is better; null means no match. */
function rank(name: string, q: string): number | null {
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(" " + q)) return 2;
  if (name.includes(q)) return 3;
  return null;
}

export function searchDealsByName<T extends { property_name: string | null }>(
  deals: readonly T[],
  query: string,
  limit = 8,
): T[] {
  const q = normalizeName(query);
  if (!q) return [];
  const hits: { deal: T; rank: number; order: number }[] = [];
  deals.forEach((deal, order) => {
    if (!deal.property_name) return;
    const r = rank(normalizeName(deal.property_name), q);
    if (r != null) hits.push({ deal, rank: r, order });
  });
  hits.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return hits.slice(0, limit).map((h) => h.deal);
}
