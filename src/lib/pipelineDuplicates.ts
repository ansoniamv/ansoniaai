/**
 * Spotting a suggested deal we already own.
 *
 * Matching is on property name alone, deliberately. Inbox deals often arrive
 * with no city or state at all, so requiring a location match would silently
 * miss the duplicates this exists to catch. Name-only is the looser rule, which
 * is the right trade when the output is an advisory badge and never a filter:
 * a false positive costs a glance, a false negative costs duplicated work.
 */

/** Lowercased, trimmed, inner whitespace collapsed. Null for anything empty. */
export function normalizePropertyName(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.trim().toLowerCase().replace(/\s+/g, " ");
  return n.length > 0 ? n : null;
}

/** The set of pipeline names to test against, normalised once per fetch. */
export function buildPipelineNameSet(rows: Array<{ property_name: string | null }>): Set<string> {
  const set = new Set<string>();
  for (const r of rows) {
    const n = normalizePropertyName(r.property_name);
    if (n) set.add(n);
  }
  return set;
}

export function isAlreadyInPipeline(
  name: string | null | undefined,
  pipelineNames: Set<string>,
): boolean {
  const n = normalizePropertyName(name);
  return n != null && pipelineNames.has(n);
}
