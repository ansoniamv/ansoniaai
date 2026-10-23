// Capital Feed: notes the team writes on capital partners, and changes to what
// a partner will invest in, as headline stories ("Skydeck raised their maximum
// equity check to $10M"). Pure so the rules are testable.
import { describeChange, type ChangeRow, type FieldChange } from "@/lib/partnerFeed";

export type StoryCategory = "note" | "criteria";

export const CATEGORY_LABEL: Record<StoryCategory, string> = {
  note: "Partner Note",
  criteria: "Criteria Change",
};

export const ALL_CATEGORIES = Object.keys(CATEGORY_LABEL) as StoryCategory[];

/** Fields that describe what a partner will invest in. Warmth, POC and the like are left out on purpose. */
export const CRITERIA_FIELDS = new Set([
  "capital_status", "capital_status_detail", "capital_available_from",
  "min_equity_m", "max_equity_m", "investor_type", "hold_period", "product_types",
  "geography", "geography_avoid", "urban_infill", "suburban",
  "strategy_value_add", "strategy_core_plus", "strategy_workforce", "strategy_affordable",
]);

/** A note from the notes table. Rows with neither author nor team member were written by a background job. */
export type NoteRow = {
  id: string;
  entity_id: string;
  content: string;
  content_format: string;
  classification_summary: string | null;
  author: string | null;
  team_member_id: string | null;
  created_at: string;
  team_members?: { full_name: string | null } | null;
};

/** A quick note typed on the partner page (partner_interactions, interaction_type 'note'). */
export type QuickNoteRow = {
  id: string;
  partner_id: string;
  content: string | null;
  author: string | null;
  interaction_date: string | null;
  created_at: string;
};

export type Story = {
  key: string;
  category: StoryCategory;
  at: string;
  partnerId: string;
  headline: string;
  /** One- or two-line standfirst under the headline. */
  dek?: string | null;
  /** Full note, rendered on expand. */
  note?: { content: string; format: string };
  changes?: FieldChange[];
  byline?: string | null;
  /** Written by Atlas from partner notes, not by a person. */
  automated?: boolean;
};

export const htmlToText = (s: string) =>
  s.replace(/<(br|\/p|\/li|\/div)[^>]*>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ").trim();

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function firstSentence(s: string, max = 120) {
  const m = s.match(/^.{20,}?[.!?](\s|$)/);
  return clip((m ? m[0] : s).trim(), max);
}

// ── Notes ────────────────────────────────────────────────────────────────────

export function storyFromNote(n: NoteRow, partnerName: string): Story | null {
  const who = n.team_members?.full_name || n.author;
  if (!who && !n.team_member_id) return null;
  const text = n.content_format === "html" ? htmlToText(n.content ?? "") : (n.content ?? "").trim();
  const summary = n.classification_summary?.trim();
  if (!text && !summary) return null;
  return {
    key: `n-${n.id}`,
    category: "note",
    at: n.created_at,
    partnerId: n.entity_id,
    headline: `${partnerName}: ${summary || firstSentence(text)}`,
    dek: (summary || text.length > 140) ? clip(text, 280) : null,
    note: { content: n.content, format: n.content_format },
    byline: who ? `Note by ${who}` : "Note",
  };
}

export function storyFromQuickNote(q: QuickNoteRow, partnerName: string): Story | null {
  const text = (q.content ?? "").trim();
  if (!text) return null;
  return {
    key: `i-${q.id}`,
    category: "note",
    at: q.interaction_date || q.created_at,
    partnerId: q.partner_id,
    headline: `${partnerName}: ${firstSentence(text)}`,
    dek: text.length > 140 ? clip(text, 280) : null,
    // "User" is the placeholder the quick-note box writes; it names no one.
    byline: q.author && q.author !== "User" ? `Note by ${q.author}` : "Quick note",
  };
}

// ── Criteria changes ─────────────────────────────────────────────────────────

const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === "string" && v.trim() ? [v.trim()] : [];

const isBlank = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** "A", "A and B", "A, B and C", "A, B, C and 2 more". */
export function joinList(xs: string[], max = 3): string {
  const shown = xs.length > max ? [...xs.slice(0, max), `${xs.length - max} more`] : xs;
  if (shown.length <= 1) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/** Equity fields are stored in $M. */
export function fmtEquityM(v: unknown): string | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  if (n < 1) return `$${Math.round(n * 1000)}K`;
  return `$${Number.isInteger(n) ? n : n.toFixed(1).replace(/\.0$/, "")}M`;
}

const LIST_PHRASES: Record<string, { add: (xs: string) => string; remove: (xs: string) => string; label: string }> = {
  geography: { add: (x) => `is now targeting ${x}`, remove: (x) => `is no longer targeting ${x}`, label: "target markets" },
  geography_avoid: { add: (x) => `now avoids ${x}`, remove: (x) => `no longer avoids ${x}`, label: "avoided markets" },
  product_types: { add: (x) => `added ${x} to their product types`, remove: (x) => `dropped ${x} from their product types`, label: "product types" },
};

const STRATEGY_NAMES: Record<string, string> = {
  strategy_value_add: "value-add",
  strategy_core_plus: "core-plus",
  strategy_workforce: "workforce",
  strategy_affordable: "affordable",
  urban_infill: "urban infill",
  suburban: "suburban",
};

type RawChange = { field: string; from: unknown; to: unknown };

/** Plain-English clauses ("raised their maximum equity check to $10M") for one save. */
export function criteriaClauses(changes: RawChange[]): string[] {
  const by = new Map(changes.map((c) => [c.field, c]));
  const out: string[] = [];

  const min = by.get("min_equity_m");
  const max = by.get("max_equity_m");
  if (min && max && !isBlank(min.to) && !isBlank(max.to)) {
    out.push(`changed their equity check size to ${fmtEquityM(min.to)}–${fmtEquityM(max.to)}`);
  } else {
    for (const [c, word] of [[min, "minimum"], [max, "maximum"]] as const) {
      if (!c) continue;
      const to = fmtEquityM(c.to);
      const from = Number(c.from);
      if (!to) out.push(`removed their ${word} equity check`);
      else if (Number.isFinite(from) && !isBlank(c.from)) out.push(`${Number(c.to) > from ? "raised" : "lowered"} their ${word} equity check to ${to}`);
      else out.push(`set their ${word} equity check at ${to}`);
    }
  }

  for (const field of Object.keys(LIST_PHRASES)) {
    const c = by.get(field);
    if (!c) continue;
    const p = LIST_PHRASES[field];
    const before = asList(c.from), after = asList(c.to);
    const norm = (s: string) => s.toLowerCase();
    const added = after.filter((x) => !before.some((b) => norm(b) === norm(x)));
    const removed = before.filter((x) => !after.some((a) => norm(a) === norm(x)));
    if (added.length) out.push(p.add(joinList(added)));
    if (removed.length) out.push(p.remove(joinList(removed)));
    if (!added.length && !removed.length) out.push(`updated their ${p.label}`);
  }

  const on: string[] = [], off: string[] = [];
  for (const [field, name] of Object.entries(STRATEGY_NAMES)) {
    const c = by.get(field);
    if (!c) continue;
    if (c.to === true) on.push(name);
    else if (c.from === true) off.push(name);
  }
  if (on.length) out.push(`is now open to ${joinList(on)} deals`);
  if (off.length) out.push(`is no longer pursuing ${joinList(off)} deals`);

  const simple: [string, (to: string) => string, string][] = [
    ["capital_status", (to) => `changed their capital status to ${to}`, "capital status"],
    ["capital_available_from", (to) => `expects capital to be available from ${to}`, "capital availability date"],
    ["hold_period", (to) => `changed their hold period to ${to}`, "hold period"],
    ["investor_type", (to) => `changed their investor type to ${to}`, "investor type"],
  ];
  for (const [field, phrase, label] of simple) {
    const c = by.get(field);
    if (!c) continue;
    out.push(isBlank(c.to) ? `cleared their ${label}` : phrase(asList(c.to).join(", ")));
  }
  if (by.has("capital_status_detail")) out.push("updated their capital status notes");
  return out;
}

export function criteriaHeadline(partnerName: string, changes: RawChange[]): string {
  const clauses = criteriaClauses(changes);
  if (!clauses.length) return `${partnerName} updated their investment criteria`;
  const head = clauses.slice(0, 2).join(" and ");
  const rest = clauses.length - 2;
  return `${partnerName} ${head}${rest > 0 ? `, plus ${rest} more change${rest === 1 ? "" : "s"}` : ""}`;
}

/**
 * Approved Atlas suggestions write capital_status as { status, detail }; split
 * it so the headline says the status and the detail runs underneath.
 */
function unwrapStatus(v: unknown): { value: unknown; detail: string | null } {
  if (v && typeof v === "object" && !Array.isArray(v) && "status" in v) {
    const o = v as { status?: unknown; detail?: unknown };
    return { value: o.status ?? null, detail: typeof o.detail === "string" && o.detail.trim() ? o.detail.trim() : null };
  }
  return { value: v, detail: null };
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * One story per partner + actor + source + minute: a single save of the edit
 * dialog writes several fields at once. Only criteria fields count; warmth,
 * imports and other bookkeeping never make a story.
 */
export function storiesFromChanges(rows: ChangeRow[], nameOf: (id: string) => string): Story[] {
  const groups = new Map<string, ChangeRow[]>();
  for (const r of rows) {
    if (!CRITERIA_FIELDS.has(r.field) || r.source === "import") continue;
    const key = `${r.partner_id}|${r.source}|${r.changed_by_label ?? ""}|${r.changed_at.slice(0, 16)}`;
    const g = groups.get(key);
    if (g) g.push(r); else groups.set(key, [r]);
  }
  const out: Story[] = [];
  for (const [key, g] of groups) {
    const sorted = [...g].sort((a, b) => a.changed_at.localeCompare(b.changed_at));
    const latest = sorted[sorted.length - 1];
    // The same field can change twice inside the minute; keep the first "from" and the last "to".
    const byField = new Map<string, RawChange>();
    for (const r of sorted) {
      const prev = byField.get(r.field);
      byField.set(r.field, { field: r.field, from: prev ? prev.from : r.old_value, to: r.new_value });
    }
    let detail: string | null = null;
    const raw = [...byField.values()]
      .map((c) => {
        if (c.field !== "capital_status") return c;
        const to = unwrapStatus(c.to);
        detail = to.detail;
        return { ...c, from: unwrapStatus(c.from).value, to: to.value };
      })
      .filter((c) => !sameValue(c.from, c.to) || (c.field === "capital_status" && detail));
    if (!raw.length) continue;
    const automated = latest.source === "system";
    const who = latest.changed_by_label;
    out.push({
      key: `c-${key}`,
      category: "criteria",
      at: latest.changed_at,
      partnerId: latest.partner_id,
      headline: criteriaHeadline(nameOf(latest.partner_id), raw),
      dek: detail,
      changes: raw.map((c) => describeChange({ field: c.field, old_value: c.from, new_value: c.to })),
      automated,
      byline: automated ? "Updated by Atlas from partner notes"
        : latest.source === "suggestion" ? `Atlas suggestion approved${who ? ` by ${who}` : ""}`
        : who ? `Updated by ${who}` : "Updated",
    });
  }
  return out;
}

// ── Assembly ─────────────────────────────────────────────────────────────────

export function buildStories(
  input: { notes: NoteRow[]; quickNotes: QuickNoteRow[]; changes: ChangeRow[] },
  nameOf: (id: string) => string,
): Story[] {
  const stories: Story[] = [];
  for (const n of input.notes) {
    const s = storyFromNote(n, nameOf(n.entity_id));
    if (s) stories.push(s);
  }
  for (const q of input.quickNotes) {
    const s = storyFromQuickNote(q, nameOf(q.partner_id));
    if (s) stories.push(s);
  }
  stories.push(...storiesFromChanges(input.changes, nameOf));
  return stories
    .filter((s) => s.at && !Number.isNaN(new Date(s.at).getTime()))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

export function storySearchText(s: Story): string {
  const parts = [s.headline, s.dek ?? "", s.byline ?? "", CATEGORY_LABEL[s.category]];
  for (const c of s.changes ?? []) parts.push(c.label, c.from, c.to);
  if (s.note) parts.push(htmlToText(s.note.content));
  return parts.join(" ").toLowerCase();
}
