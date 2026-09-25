// HubSpot-style record panels for the partner detail page: a property list for
// the left column, a highlights strip and a merged activity timeline for the
// middle, and the AI profile summary for the right.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { Building2, ChevronDown, ChevronRight, Inbox, Mail, MessageSquare, Pencil, RefreshCw, Search, Send, Sparkles, StickyNote } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { WarmthBadge } from "@/components/WarmthBadge";
import { NoteContent } from "@/components/NoteContent";
import { PipelineSharedLine } from "@/components/PipelineSharedLine";
import { safeExternalUrl } from "@/lib/safeUrl";
import { countStale, readProvenance, isStale } from "@/lib/fieldProvenance";
import { usePartnerCurrency, PROFILE_COMPLETENESS_FIELDS, type Partner, type PartnerInteraction } from "@/hooks/usePartners";
import type { OutlookMessage } from "@/hooks/useOutlook";
import type { Note } from "@/hooks/useNotes";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";

/** Deal ids an activity is about: a note's deal links (or deal owner), an email's deal. */
export function noteDealIds(n: Note): string[] {
  const ids = (n.note_links ?? []).filter((l) => l.linked_type === "deal").map((l) => l.linked_id);
  if (n.entity_type === "deal") ids.push(n.entity_id);
  return Array.from(new Set(ids));
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────────────────────

export function partnerHostname(website: string | null): string | null {
  if (!website) return null;
  try { return new URL(website).hostname.replace(/^www\./, ""); } catch { return website; }
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

/** Collapsible card with a chevron title, like HubSpot's record-page sections. */
export function RecordSection({
  title,
  actions,
  defaultOpen = true,
  children,
  className,
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between space-y-0 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-sm font-semibold text-left min-w-0"
        >
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <span className="truncate">{title}</span>
        </button>
        {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
      </CardHeader>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function relAge(iso: string): string {
  const d = daysSince(iso);
  if (d <= 0) return "Today";
  if (d < 45) return `${d}d ago`;
  const m = Math.floor(d / 30);
  if (m < 24) return `${m}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Left column — "About this partner" property list
// ─────────────────────────────────────────────────────────────────────────────

function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm break-words">{children}</div>
    </div>
  );
}

const Empty = () => <span className="text-muted-foreground">--</span>;

function Chips({ values, tone = "secondary" }: { values: string[] | null | undefined; tone?: "secondary" | "outline" }) {
  if (!values || values.length === 0) return <Empty />;
  return (
    <div className="flex flex-wrap gap-1 pt-0.5">
      {values.map((v) => (
        <Badge key={v} variant={tone} className="font-normal">{v}</Badge>
      ))}
    </div>
  );
}

export function AboutPartnerCard({ partner, onEdit }: { partner: Partner; onEdit: () => void }) {
  const host = partnerHostname(partner.website);
  const href = safeExternalUrl(partner.website);
  const strategies = [
    partner.strategy_value_add && "Value-add",
    partner.strategy_core_plus && "Core-plus",
    partner.strategy_workforce && "Workforce",
    partner.strategy_affordable && "Affordable",
  ].filter(Boolean) as string[];
  const locations = [partner.urban_infill && "Urban infill", partner.suburban && "Suburban"].filter(Boolean) as string[];
  const equity =
    partner.min_equity_m != null || partner.max_equity_m != null
      ? `$${partner.min_equity_m ?? "?"}M – $${partner.max_equity_m ?? "?"}M`
      : null;

  return (
    <RecordSection
      title="About this partner"
      actions={
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} aria-label="Edit partner details">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      }
    >
      <div className="space-y-4">
        <Property label="Website">
          {host && href ? (
            <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline">{host}</a>
          ) : <Empty />}
        </Property>
        <Property label="Firm type">{partner.firm_type || <Empty />}</Property>
        <Property label="Relationship warmth"><WarmthBadge strength={partner.relationship_strength} /></Property>
        <Property label="Ansonia POC">{partner.ansonia_poc || <Empty />}</Property>
        <Property label="Headquarters">{partner.headquarters || <Empty />}</Property>
        <Property label="Investor type"><Chips values={partner.investor_type} /></Property>
        <Property label="Equity check">{equity || <Empty />}</Property>
        <Property label="Hold period"><Chips values={partner.hold_period} /></Property>
        <Property label="Strategy"><Chips values={strategies} /></Property>
        <Property label="Product types"><Chips values={partner.product_types} /></Property>
        <Property label="Location type"><Chips values={locations} /></Property>
        <Property label="Target geography"><Chips values={partner.geography} /></Property>
        <Property label="Avoided markets"><Chips values={partner.geography_avoid} tone="outline" /></Property>
        <Property label="Capital status">{partner.capital_status || <Empty />}</Property>
        <Property label="Data source">{partner.data_source || <Empty />}</Property>
        <Property label="Created">{format(new Date(partner.created_at), "MM/dd/yyyy")}</Property>
      </div>
    </RecordSection>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Middle column — Data highlights
// ─────────────────────────────────────────────────────────────────────────────

/** Which `?highlight=` token owns a given profile field (see PartnerSummaryCards). */
const FIELD_TO_HIGHLIGHT: Record<string, string> = {
  min_equity_m: "equity",
  max_equity_m: "equity",
  geography: "geography",
  product_types: "product_types",
  strategy_value_add: "strategy",
  strategy_core_plus: "strategy",
  strategy_workforce: "strategy",
  strategy_affordable: "strategy",
};

function Highlight({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="text-center space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("text-sm tabular-nums", className)}>{children}</div>
    </div>
  );
}

export type DealTagSummary = { tagged: number; interested: number; committed: number; passed: number };

export function DataHighlightsCard({
  partner,
  onOpenSuggestions,
  deals,
}: {
  partner: Partner;
  onOpenSuggestions: () => void;
  deals?: DealTagSummary;
}) {
  const { data } = usePartnerCurrency(partner.id);
  const [, setSearchParams] = useSearchParams();
  const staleCount = partner.enriched_fields ? countStale(partner.enriched_fields, PROFILE_COMPLETENESS_FIELDS) : 0;
  const firstStaleField = partner.enriched_fields
    ? PROFILE_COMPLETENESS_FIELDS.find((f) => isStale(readProvenance(partner.enriched_fields, f), f))
    : undefined;

  const contactDays = data?.lastContactAt ? daysSince(data.lastContactAt) : null;
  const contactTone =
    contactDays == null ? "" : contactDays > 120 ? "text-destructive" : contactDays > 60 ? "text-amber-700" : "";

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm font-semibold">Data highlights</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Highlight label="Last contact" className={contactTone}>
            {data?.lastContactAt ? relAge(data.lastContactAt) : "--"}
          </Highlight>
          <Highlight label="Warmth">
            <div className="flex justify-center"><WarmthBadge strength={partner.relationship_strength} /></div>
          </Highlight>
          <Highlight label="Profile">
            {data ? `${data.fieldsFilled}/${data.fieldsTotal} fields` : "--"}
          </Highlight>
          <Highlight label="Last updated">
            {data?.lastUpdatedAt ? format(new Date(data.lastUpdatedAt), "MM/dd/yyyy") : "--"}
          </Highlight>
        </div>
        {(data?.pendingSuggestions || staleCount > 0) ? (
          <div className="flex flex-wrap items-center justify-center gap-2 border-t pt-3">
            {!!data?.pendingSuggestions && (
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={onOpenSuggestions}>
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                {data.pendingSuggestions} pending suggestion{data.pendingSuggestions > 1 ? "s" : ""}
              </Button>
            )}
            {staleCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs text-amber-700"
                onClick={() => {
                  const token = firstStaleField ? FIELD_TO_HIGHLIGHT[firstStaleField] : undefined;
                  if (token) setSearchParams((prev) => { prev.set("highlight", token); return prev; }, { replace: true });
                }}
              >
                {staleCount} field{staleCount > 1 ? "s" : ""} stale
              </Button>
            )}
          </div>
        ) : null}
        {deals && deals.tagged > 0 && (
          <div className="flex flex-wrap justify-center gap-2 text-xs font-medium">
            <span className="rounded-full border bg-muted px-2.5 py-0.5">{deals.tagged} deal{deals.tagged === 1 ? "" : "s"} tagged</span>
            {deals.interested > 0 && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">{deals.interested} serious interest</span>
            )}
            {deals.committed > 0 && (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">{deals.committed} committed</span>
            )}
            {deals.passed > 0 && (
              <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">{deals.passed} passed</span>
            )}
          </div>
        )}
        <div className="flex justify-center"><PipelineSharedLine partnerId={partner.id} /></div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Middle column — Activity timeline (notes + emails + logged interactions)
// ─────────────────────────────────────────────────────────────────────────────

type ActivityKind = "note" | "email" | "logged";

type Activity = {
  key: string;
  kind: ActivityKind;
  at: string;
  title: string;
  byline?: string | null;
  body?: React.ReactNode;
  onOpen?: () => void;
  dealIds: string[];
};

const KIND_LABEL: Record<ActivityKind, string> = { note: "Notes", email: "Emails", logged: "Logged" };

function ActivityIcon({ kind, sent }: { kind: ActivityKind; sent?: boolean }) {
  const Icon = kind === "note" ? StickyNote : kind === "email" ? (sent ? Send : Mail) : MessageSquare;
  return (
    <div className="h-7 w-7 rounded-full border bg-background flex items-center justify-center shrink-0">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
    </div>
  );
}

export function ActivityTimeline({
  notes,
  emails,
  interactions,
  onOpenEmail,
  limit,
  onViewAll,
  headerActions,
  dealNames,
}: {
  /** deal id → name, for the deal chips and the deal filter. */
  dealNames?: Record<string, string>;
  notes: Note[] | undefined;
  emails: OutlookMessage[] | undefined;
  interactions: PartnerInteraction[] | undefined;
  onOpenEmail: (m: OutlookMessage) => void;
  /** Overview preview: show only the N most recent and hide the filters. */
  limit?: number;
  onViewAll?: () => void;
  headerActions?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<Set<ActivityKind>>(new Set(["note", "email", "logged"]));
  const [dealFilter, setDealFilter] = useState<string>("all");

  const all = useMemo<(Activity & { sent?: boolean; text: string })[]>(() => {
    const out: (Activity & { sent?: boolean; text: string })[] = [];
    for (const n of notes ?? []) {
      out.push({
        key: `n-${n.id}`,
        kind: "note",
        at: n.created_at,
        title: "Note",
        byline: n.team_members?.full_name ?? n.author,
        body: <NoteContent content={n.content} format={n.content_format} className="text-sm line-clamp-6" />,
        text: n.content,
        dealIds: noteDealIds(n),
      });
    }
    for (const m of emails ?? []) {
      const sent = /sent/i.test(m.folder ?? "");
      out.push({
        key: `e-${m.id}`,
        kind: "email",
        sent,
        at: (m.received_at ?? m.sent_at ?? "") as string,
        title: m.subject || "(no subject)",
        byline: sent ? "Sent" : `From ${m.from_name || m.from_email || "unknown sender"}`,
        body: m.preview ? <p className="text-sm text-muted-foreground line-clamp-2">{m.preview}</p> : null,
        onOpen: () => onOpenEmail(m),
        dealIds: m.deal_id ? [m.deal_id] : [],
        text: `${m.subject ?? ""} ${m.preview ?? ""} ${m.from_name ?? ""} ${m.from_email ?? ""}`,
      });
    }
    for (const i of interactions ?? []) {
      out.push({
        key: `i-${i.id}`,
        kind: "logged",
        at: i.interaction_date || i.created_at,
        title: i.fact_category ? `${i.interaction_type} · ${i.fact_category}` : i.interaction_type,
        byline: i.author ?? i.source,
        body: <p className="text-sm whitespace-pre-wrap line-clamp-4">{i.content}</p>,
        text: i.content,
        dealIds: [],
      });
    }
    return out.filter((a) => a.at).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [notes, emails, interactions, onOpenEmail]);

  const counts = useMemo(() => {
    const c: Record<ActivityKind, number> = { note: 0, email: 0, logged: 0 };
    for (const a of all) c[a.kind]++;
    return c;
  }, [all]);

  const q = query.trim().toLowerCase();
  // Only deals that actually appear on an activity are worth a filter chip.
  const dealsInTimeline = useMemo(() => {
    const seen = new Map<string, number>();
    for (const a of all) for (const id of a.dealIds) seen.set(id, (seen.get(id) ?? 0) + 1);
    return Array.from(seen.entries()).sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, count }));
  }, [all]);

  let shown = all.filter((a) =>
    kinds.has(a.kind) &&
    (dealFilter === "all" || a.dealIds.includes(dealFilter)) &&
    (!q || a.text.toLowerCase().includes(q) || a.title.toLowerCase().includes(q)));
  if (limit) shown = shown.slice(0, limit);

  // Group by month, like HubSpot's timeline.
  const groups: { month: string; items: typeof shown }[] = [];
  for (const a of shown) {
    const month = format(new Date(a.at), "MMMM yyyy");
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.items.push(a);
    else groups.push({ month, items: [a] });
  }

  const toggle = (k: ActivityKind) =>
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next.size === 0 ? new Set(["note", "email", "logged"]) : next;
    });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 py-3">
        <CardTitle className="text-sm font-semibold inline-flex items-center gap-2">
          <Inbox className="h-4 w-4" /> {limit ? "Recent activities" : `Activities (${all.length})`}
        </CardTitle>
        <div className="flex items-center gap-2">
          {headerActions}
          {limit && onViewAll && all.length > 0 && (
            <Button variant="link" size="sm" className="h-7 px-0" onClick={onViewAll}>View all ({all.length})</Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {!limit && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search activities" className="h-8 pl-8 text-sm" />
            </div>
            {(Object.keys(KIND_LABEL) as ActivityKind[]).map((k) => (
              <Button
                key={k}
                type="button"
                size="sm"
                variant={kinds.has(k) ? "secondary" : "outline"}
                className="h-8 text-xs"
                onClick={() => toggle(k)}
              >
                {KIND_LABEL[k]} ({counts[k]})
              </Button>
            ))}
          </div>
        )}
        {!limit && dealsInTimeline.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground mr-1">Deal:</span>
            {[{ id: "all", count: all.length }, ...dealsInTimeline].map((d) => (
              <Button
                key={d.id}
                type="button"
                size="sm"
                variant={dealFilter === d.id ? "default" : "outline"}
                className="h-7 rounded-full text-xs"
                onClick={() => setDealFilter(d.id)}
              >
                {d.id === "all" ? "All" : dealNames?.[d.id] ?? "Deal"} ({d.count})
              </Button>
            ))}
          </div>
        )}

        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {all.length === 0 ? "No activity yet. Add a note, send an email, or sync Outlook." : "No activities match."}
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.month} className="space-y-2">
              <div className="text-sm font-medium">{g.month}</div>
              {g.items.map((a) => (
                <div key={a.key} className="flex gap-3">
                  <ActivityIcon kind={a.kind} sent={a.sent} />
                  <div
                    role={a.onOpen ? "button" : undefined}
                    tabIndex={a.onOpen ? 0 : undefined}
                    onClick={a.onOpen}
                    onKeyDown={(e) => { if (a.onOpen && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); a.onOpen(); } }}
                    className={cn(
                      "flex-1 min-w-0 rounded-md border p-3 space-y-1.5",
                      a.onOpen && "cursor-pointer hover:bg-muted/40 transition-colors",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-sm font-semibold truncate first-letter:uppercase">{a.title}</span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(a.at), "MMM d, yyyy 'at' h:mm a")}
                      </span>
                    </div>
                    {a.byline && <div className="text-xs text-muted-foreground truncate">{a.byline}</div>}
                    {a.body}
                    {a.dealIds.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {a.dealIds.map((id) => (
                          <Link
                            key={id}
                            to={`/deals/${id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20"
                          >
                            <Building2 className="h-3 w-3" /> {dealNames?.[id] ?? "Deal"}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Right column — AI profile summary (HubSpot's "Record summary")
// ─────────────────────────────────────────────────────────────────────────────

export function ProfileSummaryCard({
  partner,
  onRegenerate,
  regenerating,
}: {
  partner: Partner;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  return (
    <RecordSection
      title={<span className="inline-flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-primary" /> Profile summary</span>}
      actions={
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onRegenerate}
          disabled={regenerating}
          aria-label="Regenerate summary"
          title="Regenerate summary"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", regenerating && "animate-spin")} />
        </Button>
      }
    >
      <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-2">
        {partner.profile_summary ? (
          <>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{partner.profile_summary}</p>
            {partner.profile_summary_updated_at && (
              <p className="text-[11px] text-muted-foreground">
                Generated {format(new Date(partner.profile_summary_updated_at), "MMM d, yyyy")}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No summary yet. Use the refresh button to generate one from this partner's profile and notes.
          </p>
        )}
      </div>
    </RecordSection>
  );
}
