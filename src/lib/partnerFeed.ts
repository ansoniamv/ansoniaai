// Capital Partners activity feed: turns recent rows from several tables into
// one newest-first list. Pure so the merge/grouping rules are testable.

export type FeedKind = "email" | "note" | "logged" | "new_partner" | "new_contact" | "change";

export type ChangeSource = "user" | "system" | "suggestion" | "import";

export type ChangeRow = {
  id: string;
  partner_id: string;
  field: string;
  old_value: unknown;
  new_value: unknown;
  changed_by_label: string | null;
  source: ChangeSource;
  changed_at: string;
};

export type FieldChange = { field: string; label: string; from: string; to: string };

export type FeedItem = {
  key: string;
  kind: FeedKind;
  at: string;
  partnerId: string;
  title: string;
  byline?: string | null;
  snippet?: string | null;
  /** Notes keep their raw content so the UI can render rich text. */
  note?: { content: string; format: string };
  sent?: boolean;
  changes?: FieldChange[];
  /** True for changes written by a background job, not a person. */
  automated?: boolean;
};

export const FEED_KIND_LABEL: Record<FeedKind, string> = {
  email: "Emails",
  note: "Notes",
  logged: "Logged",
  new_partner: "New partners",
  new_contact: "New contacts",
  change: "Changes",
};

export const FIELD_LABEL: Record<string, string> = {
  name: "Name",
  firm_type: "Firm type",
  relationship_strength: "Warmth",
  ansonia_poc: "Ansonia POC",
  website: "Website",
  headquarters: "Headquarters",
  status: "Status",
  archived_at: "Archived",
  blacklisted_at: "Blacklisted",
  blacklist_reason: "Blacklist reason",
  capital_status: "Capital status",
  capital_status_detail: "Capital status detail",
  capital_available_from: "Capital available from",
  min_equity_m: "Min equity ($M)",
  max_equity_m: "Max equity ($M)",
  investor_type: "Investor type",
  investment_type: "Investment type",
  hold_period: "Hold period",
  product_types: "Product types",
  geography: "Geography",
  geography_avoid: "Avoided markets",
  urban_infill: "Urban infill",
  suburban: "Suburban",
  strategy_value_add: "Value-add",
  strategy_core_plus: "Core+",
  strategy_workforce: "Workforce",
  strategy_affordable: "Affordable",
  additional_notes: "Notes field",
};

/** Long free-text fields: say they changed, don't print both versions. */
const SUMMARY_ONLY = new Set(["additional_notes", "capital_status_detail"]);

export function formatFieldValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (field === "archived_at") return "Archived";
  if (field === "blacklisted_at") return "Blacklisted";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function describeChange(row: Pick<ChangeRow, "field" | "old_value" | "new_value">): FieldChange {
  const label = FIELD_LABEL[row.field] ?? row.field.replace(/_/g, " ");
  if (row.field === "archived_at") {
    return { field: row.field, label: "Archived", from: row.old_value ? "Archived" : "Active", to: row.new_value ? "Archived" : "Active" };
  }
  if (row.field === "blacklisted_at") {
    return { field: row.field, label: "Blacklisted", from: row.old_value ? "Yes" : "No", to: row.new_value ? "Yes" : "No" };
  }
  if (SUMMARY_ONLY.has(row.field)) return { field: row.field, label, from: "", to: "edited" };
  return { field: row.field, label, from: formatFieldValue(row.field, row.old_value), to: formatFieldValue(row.field, row.new_value) };
}

/**
 * One feed item per partner + actor + source + minute. A single save of the
 * edit dialog writes several fields at once; showing them as one entry reads
 * like what the person actually did.
 */
export function groupChanges(rows: ChangeRow[]): FeedItem[] {
  const groups = new Map<string, ChangeRow[]>();
  for (const r of rows) {
    const minute = r.changed_at.slice(0, 16);
    const key = `${r.partner_id}|${r.source}|${r.changed_by_label ?? ""}|${minute}`;
    const g = groups.get(key);
    if (g) g.push(r); else groups.set(key, [r]);
  }
  const out: FeedItem[] = [];
  for (const [key, g] of groups) {
    const latest = g.reduce((a, b) => (a.changed_at > b.changed_at ? a : b));
    const automated = latest.source === "system";
    // The same field can change twice inside the minute; keep the first "from"
    // and the last "to".
    const byField = new Map<string, ChangeRow[]>();
    for (const r of [...g].sort((a, b) => a.changed_at.localeCompare(b.changed_at))) {
      const list = byField.get(r.field);
      if (list) list.push(r); else byField.set(r.field, [r]);
    }
    const changes = Array.from(byField.values())
      .map((list) => describeChange({ field: list[0].field, old_value: list[0].old_value, new_value: list[list.length - 1].new_value }))
      .filter((c) => c.from !== c.to);
    if (!changes.length) continue;
    const who = latest.changed_by_label;
    const byline =
      latest.source === "system" ? "Automatic update"
      : latest.source === "import" ? `Warmth import${who ? ` by ${who}` : ""}`
      : latest.source === "suggestion" ? `Suggestion approved${who ? ` by ${who}` : ""}`
      : who ? `Edited by ${who}` : "Edited";
    out.push({
      key: `c-${key}`,
      kind: "change",
      at: latest.changed_at,
      partnerId: latest.partner_id,
      title: changes.length === 1 ? `${changes[0].label} updated` : `${changes.length} fields updated`,
      byline,
      changes,
      automated,
    });
  }
  return out;
}

export function sortFeed(items: FeedItem[]): FeedItem[] {
  return items
    .filter((i) => i.at && !Number.isNaN(new Date(i.at).getTime()))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/** Plain text for search: strips tags from rich-text notes. */
export function feedSearchText(i: FeedItem, partnerName: string): string {
  const parts = [partnerName, i.title, i.byline ?? "", i.snippet ?? "", i.note?.content.replace(/<[^>]+>/g, " ") ?? ""];
  for (const c of i.changes ?? []) parts.push(c.label, c.from, c.to);
  return parts.join(" ").toLowerCase();
}

/** "Today", "Yesterday", or a date, for the day headers. */
export function dayLabel(at: string, now = new Date()): string {
  const d = new Date(at);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
