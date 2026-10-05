/**
 * Spotting a suggested deal next door to something we already operate.
 *
 * Adjacency is cheap and strong: a known submarket, management already on the
 * ground, possible operating leverage. Four deals in the pipeline today sit in
 * towns where Ansonia owns a building, and nothing surfaced that.
 *
 * Matching is town-level (city + state), not radius. A real radius needs
 * coordinates on both sides, and inbox deals frequently arrive with no address
 * at all — several have neither city nor state. City+state is the strongest
 * comparison the data actually supports, and both halves are required: "Arlington"
 * alone would pair Arlington TX with Arlington Heights IL.
 *
 * Sold assets count. Having operated a building in a town leaves the submarket
 * knowledge behind even after the exit, which is exactly what this flags.
 */

export type OwnedProperty = {
  name: string;
  city: string | null;
  state: string | null;
  status?: string | null;
};

/** city + state, lowercased and whitespace-collapsed. Null unless BOTH are present. */
export function placeKey(
  city: string | null | undefined,
  state: string | null | undefined,
): string | null {
  const c = city?.trim().toLowerCase().replace(/\s+/g, " ");
  const s = state?.trim().toLowerCase().replace(/\s+/g, " ");
  if (!c || !s) return null;
  return `${c}|${s}`;
}

/** Map of place -> the owned properties there, built once per fetch. */
export function buildOwnedPlaceMap(rows: OwnedProperty[]): Map<string, OwnedProperty[]> {
  const map = new Map<string, OwnedProperty[]>();
  for (const r of rows) {
    const key = placeKey(r.city, r.state);
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(r);
    else map.set(key, [r]);
  }
  return map;
}

/** The owned properties in the same town as this deal, or [] for none. */
export function ownedNearby(
  city: string | null | undefined,
  state: string | null | undefined,
  owned: Map<string, OwnedProperty[]>,
): OwnedProperty[] {
  const key = placeKey(city, state);
  if (!key) return [];
  return owned.get(key) ?? [];
}
