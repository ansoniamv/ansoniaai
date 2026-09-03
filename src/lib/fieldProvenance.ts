export function ageLabel(as_of: string): string {
  const then = new Date(as_of).getTime();
  if (!Number.isFinite(then)) return "—";
  const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  if (days === 0) return "today";
  if (days < 31) return `${days}d`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years}y ${rem}mo` : `${years}y`;
}

export type FieldSource = "manual" | "email" | "denial" | "notes" | "import";

export type FieldProvenance = {
  source: FieldSource;
  /** When the INFORMATION is true as of — the email/note/pass date, NOT the write time. */
  as_of: string;
  /** When the row was actually written. */
  written_at: string;
  set_by?: string | null;
  message_ids?: string[];
  note_ids?: string[];
  deal_id?: string | null;
};

export type ProvenanceMap = Record<string, FieldProvenance>;

/**
 * Read a field's provenance, tolerating all three legacy shapes already in the
 * database. Returns null when there is nothing to show — callers must render
 * nothing rather than inventing a date.
 */
export function readProvenance(raw: any, field: string): FieldProvenance | null {
  const m = raw?.[field];
  if (!m || typeof m !== "object") return null;
  const as_of = m.as_of ?? m.approved_at ?? m.extracted_at ?? null;
  if (!as_of) return null;
  const source: FieldSource =
    m.source === "manual" || m.source === "email" || m.source === "denial" ||
    m.source === "notes" || m.source === "import"
      ? m.source
      : (m.source_note_ids ? "notes" : "email");
  return {
    source,
    as_of,
    written_at: m.written_at ?? as_of,
    set_by: m.approved_by ?? m.set_by ?? null,
    message_ids: Array.isArray(m.message_ids) ? m.message_ids : undefined,
    note_ids: Array.isArray(m.source_note_ids) ? m.source_note_ids
            : Array.isArray(m.note_ids) ? m.note_ids : undefined,
    deal_id: m.deal_id ?? null,
  };
}

/** Fields decay at very different rates. Tune these as experience dictates. */
export const STALE_DAYS: Record<string, number> = {
  capital_status: 90,
  relationship_strength: 120,
  min_equity_m: 270,
  max_equity_m: 270,
  geography: 365,
  geography_avoid: 365,
  product_types: 365,
  hold_period: 365,
  strategy_value_add: 365,
  strategy_core_plus: 365,
  strategy_workforce: 365,
  strategy_affordable: 365,
  investor_type: 545,
};
export const DEFAULT_STALE_DAYS = 365;

export function isStale(p: FieldProvenance | null, field: string): boolean {
  if (!p?.as_of) return false;
  const t = new Date(p.as_of).getTime();
  if (!Number.isFinite(t)) return false;
  const days = (Date.now() - t) / 86_400_000;
  return days > (STALE_DAYS[field] ?? DEFAULT_STALE_DAYS);
}

export const SOURCE_LABEL: Record<FieldSource, string> = {
  manual: "MANUAL", email: "EMAIL", denial: "DENIAL", notes: "NOTES", import: "IMPORT",
};

/** Count fields whose provenance is stale, for the profile rollup. */
export function countStale(raw: any, fields: readonly string[]): number {
  let n = 0;
  for (const f of fields) if (isStale(readProvenance(raw, f), f)) n++;
  return n;
}
