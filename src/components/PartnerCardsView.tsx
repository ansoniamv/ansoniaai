import { useMemo, useState, useEffect } from "react";
import { ChevronDown, MapPin, User2, Filter, X, Users, StickyNote, Pin, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { WarmthBadge } from "@/components/WarmthBadge";
import { useRestorePartner, type Partner } from "@/hooks/usePartners";
import type { Note } from "@/hooks/useNotes";
import { useAllPartnerNotes } from "@/hooks/useAllPartnerNotes";
import { useAllPartnerContactCounts } from "@/hooks/useAllPartnerContactCounts";
import { PartnerDetailSheet } from "@/components/PartnerDetailSheet";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";

import {
  CheckSizeFilter,
  DEFAULT_CHECK_SIZE_FILTER,
  isCheckSizeActive,
  matchesCheckSize,
  type CheckSizeFilterState,
} from "@/components/CheckSizeFilter";

function stripHtml(html: string) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(s: string, n = 80) {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

const WARMTH_ORDER = [
  "Existing Partner",
  "Very Warm",
  "Warm",
  "Tepid",
  "Cold",
] as const;

const UNRATED = "Unrated";
const DEFAULT_COLLAPSED = new Set<string>(["Cold", UNRATED]);

const FIRM_TYPES = [
  "GP",
  "LP",
  "Family Office",
  "REIT",
  "Insurance",
  "Pension",
  "Endowment",
  "Fund of Funds",
  "Other",
];

function formatEquityRange(min: number | null, max: number | null) {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `$${min}M – $${max}M`;
  if (min != null) return `$${min}M+`;
  return `Up to $${max}M`;
}

function getStrategies(p: Partner) {
  const s: string[] = [];
  if (p.strategy_value_add) s.push("VA");
  if (p.strategy_core_plus) s.push("C+");
  if (p.strategy_workforce) s.push("WF");
  if (p.strategy_affordable) s.push("Aff");
  return s;
}

// MultiSelectFilter now lives in @/components/MultiSelectFilter (shared).


function PartnerCard({
  partner,
  contactCount,
  notes,
  onOpen,
  onRestore,
}: {
  partner: Partner;
  contactCount: number;
  notes: Note[];
  onOpen: (p: Partner) => void;
  onRestore?: (p: Partner) => void;
}) {
  const strategies = getStrategies(partner);
  const equity = formatEquityRange(partner.min_equity_m, partner.max_equity_m);
  const geos = partner.geography ?? [];
  const geoShown = geos.slice(0, 2);
  const geoOverflow = geos.length - geoShown.length;
  const noteCount = notes.length;
  const isArchived = !!partner.archived_at;
  const pinnedSnippet = useMemo(() => {
    const pinned = notes.find((n) => n.is_pinned);
    if (!pinned) return null;
    const text = stripHtml(pinned.content || "");
    return text ? truncate(text, 80) : null;
  }, [notes]);

  return (
    <button
      type="button"
      onClick={() => onOpen(partner)}
      className={`group text-left block w-full h-full rounded-lg border border-hairline bg-card shadow-sm hover:border-primary/40 hover:shadow-md transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${isArchived ? "opacity-60" : ""}`}
    >
      <Card className="border-0 shadow-none bg-transparent h-full">
        <CardContent className="p-4 space-y-3">

          {/* Header row */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-sm leading-tight group-hover:text-primary transition-colors line-clamp-2">
              {partner.name}
            </h3>
            <div className="flex items-center gap-1 shrink-0">
              {isArchived && (
                <Badge variant="outline" className="text-[9px] uppercase tracking-wide border-muted-foreground/40 text-muted-foreground">
                  Archived
                </Badge>
              )}
              <WarmthBadge strength={partner.relationship_strength} />
            </div>
          </div>

          {partner.capital_status && (
            <div
              className={`text-[11px] uppercase tracking-[0.12em] ${
                partner.capital_status === "Out of Capital" || partner.capital_status === "Constrained"
                  ? "text-amber-700"
                  : "text-muted-foreground"
              }`}
            >
              {partner.capital_status}
            </div>
          )}



          {isArchived && onRestore && (
            <div>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[10px] gap-1"
                onClick={(e) => { e.stopPropagation(); onRestore(partner); }}
              >
                <ArchiveRestore className="h-3 w-3" /> Restore
              </Button>
            </div>
          )}

          {/* Firm type + equity */}
          <div className="flex items-center gap-2 flex-wrap">
            {partner.firm_type && (
              <Badge variant="outline" className="text-[10px] font-mono">
                {partner.firm_type}
              </Badge>
            )}
            {equity && (
              <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
                {equity}
              </span>
            )}
          </div>

          {/* Strategy chips */}
          {strategies.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {strategies.map((s) => (
                <span
                  key={s}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 text-primary"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          {/* Geography */}
          {geos.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap text-[11px] text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" />
              {geoShown.map((g) => (
                <span
                  key={g}
                  className="px-1.5 py-0.5 rounded bg-muted border border-hairline"
                >
                  {g}
                </span>
              ))}
              {geoOverflow > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-muted border border-hairline">
                  +{geoOverflow}
                </span>
              )}
            </div>
          )}

          {/* Footer: POC + contacts + notes */}
          <div className="flex items-center justify-between pt-1 text-[11px] text-muted-foreground border-t border-hairline">
            <div className="flex items-center gap-1 min-w-0">
              <User2 className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {partner.ansonia_poc || "No POC"}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {contactCount > 0 && (
                <div className="flex items-center gap-1" title={`${contactCount} contact${contactCount === 1 ? "" : "s"}`}>
                  <Users className="h-3 w-3" />
                  <span className="tabular-nums">{contactCount}</span>
                </div>
              )}
              {noteCount > 0 && (
                <div className="flex items-center gap-1" title={`${noteCount} note${noteCount === 1 ? "" : "s"}`}>
                  <StickyNote className="h-3 w-3" />
                  <span className="tabular-nums">{noteCount}</span>
                </div>
              )}
            </div>
          </div>

          {/* Pinned note snippet */}
          {pinnedSnippet && (
            <div className="flex items-start gap-1.5 rounded bg-amber-50 dark:bg-amber-500/10 border border-amber-200/70 dark:border-amber-500/20 px-2 py-1.5 text-[11px] text-amber-900 dark:text-amber-100 leading-snug">
              <Pin className="h-3 w-3 shrink-0 mt-[1px] text-amber-600 dark:text-amber-400" />
              <span className="line-clamp-2">{pinnedSnippet}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </button>
  );
}

export function PartnerCardsView({
  partners,
  search,
}: {
  partners: Partner[];
  search: string;
}) {
  const { data: notesByPartner } = useAllPartnerNotes();
  const { data: contactCounts } = useAllPartnerContactCounts();
  const restore = useRestorePartner();
  const handleRestore = (p: Partner) => {
    restore.mutate(p.id, {
      onSuccess: () => toast.success(`${p.name} restored`),
      onError: (err: any) => toast.error("Restore failed: " + (err?.message ?? err)),
    });
  };
  const [warmthFilter, setWarmthFilter] = useState<string[]>([]);
  const [firmTypeFilter, setFirmTypeFilter] = useState<string[]>([]);
  const [checkSize, setCheckSize] = useState<CheckSizeFilterState>(DEFAULT_CHECK_SIZE_FILTER);
  const [activePartner, setActivePartner] = useState<Partner | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("partners-cards-collapsed");
      if (raw) return new Set(JSON.parse(raw));
    } catch {}
    return new Set(DEFAULT_COLLAPSED);
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        "partners-cards-collapsed",
        JSON.stringify(Array.from(collapsed)),
      );
    } catch {}
  }, [collapsed]);

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filtered = useMemo(() => {
    let result = partners;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.firm_type?.toLowerCase().includes(q) ||
          p.geography?.some((g) => g.toLowerCase().includes(q)) ||
          p.ansonia_poc?.toLowerCase().includes(q) ||
          p.additional_notes?.toLowerCase().includes(q),
      );
    }

    if (warmthFilter.length) {
      result = result.filter((p) =>
        warmthFilter.includes(p.relationship_strength || UNRATED),
      );
    }

    if (firmTypeFilter.length) {
      result = result.filter((p) =>
        firmTypeFilter.includes(p.firm_type || ""),
      );
    }

    if (isCheckSizeActive(checkSize)) {
      result = result.filter((p) => matchesCheckSize(p, checkSize));
    }

    return result;
  }, [partners, search, warmthFilter, firmTypeFilter, checkSize]);

  const grouped = useMemo(() => {
    const buckets = new Map<string, Partner[]>();
    for (const key of WARMTH_ORDER) buckets.set(key, []);
    buckets.set(UNRATED, []);
    for (const p of filtered) {
      const key = (p.relationship_strength as string) || UNRATED;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(p);
    }
    return buckets;
  }, [filtered]);

  const activeFilters =
    warmthFilter.length + firmTypeFilter.length + (isCheckSizeActive(checkSize) ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <MultiSelectFilter
          label="Warmth"
          options={[...WARMTH_ORDER, UNRATED]}
          selected={warmthFilter}
          onToggle={(v) =>
            setWarmthFilter((prev) =>
              prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
            )
          }
          onClear={() => setWarmthFilter([])}
        />
        <MultiSelectFilter
          label="Firm Type"
          options={FIRM_TYPES}
          selected={firmTypeFilter}
          onToggle={(v) =>
            setFirmTypeFilter((prev) =>
              prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
            )
          }
          onClear={() => setFirmTypeFilter([])}
        />
        <CheckSizeFilter value={checkSize} onChange={setCheckSize} />
        {activeFilters > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setWarmthFilter([]);
              setFirmTypeFilter([]);
              setCheckSize(DEFAULT_CHECK_SIZE_FILTER);
            }}
            className="text-xs text-muted-foreground"
          >
            <X className="h-3 w-3 mr-1" /> Clear {activeFilters} filter
            {activeFilters > 1 ? "s" : ""}
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {filtered.length} of {partners.length} firms
        </span>
      </div>

      {/* Groups */}
      <div className="space-y-3">
        {[...WARMTH_ORDER, UNRATED].map((key) => {
          const items = grouped.get(key) ?? [];
          if (items.length === 0) return null;
          const isOpen = !collapsed.has(key);
          return (
            <Collapsible
              key={key}
              open={isOpen}
              onOpenChange={() => toggleGroup(key)}
            >
              <CollapsibleTrigger className="flex items-center gap-3 w-full text-left group px-1 py-2 rounded hover:bg-muted/40 transition-colors">
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`}
                />
                <WarmthBadge
                  strength={key === UNRATED ? null : (key as string)}
                />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {items.length} firm{items.length === 1 ? "" : "s"}
                </span>
                <div className="flex-1 h-px bg-hairline ml-2" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch pt-3">
                  {items.map((p) => (
                    <PartnerCard
                      key={p.id}
                      partner={p}
                      contactCount={contactCounts?.[p.id] ?? 0}
                      notes={notesByPartner?.[p.id] ?? []}
                      onOpen={setActivePartner}
                      onRestore={handleRestore}
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-16 text-sm text-muted-foreground">
            No partners match your filters.
          </div>
        )}
      </div>

      <PartnerDetailSheet
        partner={activePartner}
        open={!!activePartner}
        onOpenChange={(v) => { if (!v) setActivePartner(null); }}
      />
    </div>
  );
}
