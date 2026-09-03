import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { ExportPipelineDialog } from "@/components/ExportPipelineDialog";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, ArrowUpDown, Settings2, Maximize2, Minimize2, GripVertical, Info, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ColumnManagerDialog } from "@/components/ColumnManagerDialog";

import { Checkbox } from "@/components/ui/checkbox";
import { DealStatusBadge } from "@/components/DealStatusBadge";
import { useDeals, useUpdateDeal } from "@/hooks/useDeals";
import type { Deal } from "@/hooks/useDeals";
import { useDealEnrichments, deriveMedianHHIncome, derivePopGrowth } from "@/hooks/useDealEnrichments";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useUserPreference } from "@/hooks/useUserPreference";
import { useAllDealNotes } from "@/hooks/useAllDealNotes";
import type { Note } from "@/hooks/useNotes";
import type { Database } from "@/integrations/supabase/types";
import {
  HiddenDealsNotice,
  INACTIVE_STATUSES as SHARED_INACTIVE_STATUSES,
  SHOW_INACTIVE_PREF_KEY,
} from "@/components/HiddenDealsNotice";
import { getTier, TIER_HEX, COLUMN_LABELS, SCORE_HELP } from "@/lib/dealStages";
import { DEAL_STATUSES, ACTIVE_STATUSES as SHARED_ACTIVE_STATUSES, type DealStatus } from "@/lib/dealStatus";
import { Badge } from "@/components/ui/badge";



type ValueAddLevel = Database["public"]["Enums"]["value_add_level"];
type InterestLevel = "High" | "Med" | "Low" | "TBD";

const dealStatuses: readonly DealStatus[] = DEAL_STATUSES;
const ACTIVE_STATUSES: readonly DealStatus[] = SHARED_ACTIVE_STATUSES;
const INACTIVE_STATUSES = SHARED_INACTIVE_STATUSES;
const valueAddLevels: ValueAddLevel[] = ["High", "Medium", "Low"];
const interestLevels: InterestLevel[] = ["High", "Med", "Low", "TBD"];
const analystGrades = ["A", "B", "C", "Pass"] as const;

const formatMillions = (value: number | null) =>
  value != null ? `$${Number(value).toFixed(1)}M` : "—";

const formatPerUnit = (askingPrice: number | null, unitCount: number | null) => {
  if (!askingPrice || !unitCount) return "—";
  const perUnitK = (askingPrice * 1000) / unitCount;
  return `$${perUnitK.toFixed(1)}K`;
};

type ColumnDef = {
  key: string;
  label: string;
  defaultVisible: boolean;
  sortKey?: string;
  render: (deal: Deal) => React.ReactNode;
  editable?: boolean;
  editType?: "text" | "number" | "select" | "switch" | "date";
  editOptions?: string[];
  fieldKey?: keyof Deal;
};

const AIScoreCell = ({ deal }: { deal: Deal }) => {
  const confidence = (deal as any).score_confidence as "high" | "medium" | "low" | "insufficient" | null | undefined;
  const coverage = (deal as any).score_coverage as { pillars_covered?: number; pillars_total?: number; weight_covered_pct?: number } | null | undefined;
  const coverageLine = coverage && coverage.pillars_total
    ? `Scored on ${coverage.pillars_covered ?? 0} of ${coverage.pillars_total} pillars (${Math.round((coverage.weight_covered_pct ?? 0) * 100)}% weight).`
    : "Coverage unavailable.";

  if (deal.ai_score == null || confidence === "insufficient") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-muted-foreground tabular-nums cursor-help inline-flex flex-col items-center leading-tight">
              <span>—</span>
              {confidence === "insufficient" ? (
                <span className="text-[9px] uppercase tracking-wide text-muted-foreground/70">Insufficient data</span>
              ) : null}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-xs text-xs">
            <p className="font-medium mb-1">Insufficient data to score</p>
            <p>{coverageLine}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const isLow = confidence === "low";
  const color = isLow
    ? "text-muted-foreground"
    : deal.ai_score >= 80 ? "text-tier-strong-fg"
    : deal.ai_score >= 50 ? "text-tier-medium-fg"
    : "text-destructive";
  const confLabel = confidence ? confidence.charAt(0).toUpperCase() + confidence.slice(1) + " confidence" : "Confidence unknown";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`font-serif-display tabular-nums text-[15px] font-medium ${color} cursor-help inline-flex items-center justify-center gap-1 w-full`}>
            {deal.ai_score}
            {isLow ? (
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Low confidence" />
            ) : (
              <Info className="h-3 w-3 text-muted-foreground/60" />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs text-xs">
          <p className="font-medium mb-1">AI Score: {deal.ai_score}/100 · {confLabel}</p>
          <p className="mb-1">{coverageLine}</p>
          <p className="mb-1">{deal.ai_score_summary || "LLM-adjusted score using buy-box pillar weights plus the buy-box thesis adjustment."}</p>
          <p className="text-muted-foreground">Distinct from the rules-based Buy Box Score — these are different measures.</p>
        </TooltipContent>

      </Tooltip>
    </TooltipProvider>
  );
};


function formatNoteTimestamp(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

const PropertyNameCell = ({ deal }: { deal: Deal }) => {
  const { data: notesByDeal } = useAllDealNotes();
  const notes: Note[] = notesByDeal?.[deal.id] ?? [];
  const link = (
    <Link
      to={`/deals/${deal.id}`}
      onClick={(e) => e.stopPropagation()}
      className="font-medium text-primary hover:underline inline-flex items-center gap-1.5"
    >
      {deal.property_name}
      {(deal as any).source === "pipeline" ? (
        <span
          className="text-[9px] uppercase tracking-[0.1em] font-semibold px-1.5 py-0.5 rounded border border-primary/30 bg-primary/10 text-primary"
          title="Accepted from Deal Inbox"
        >
          From Inbox
        </span>
      ) : null}
      {notes.length > 0 ? (
        <span className="text-[10px] text-muted-foreground">({notes.length})</span>
      ) : null}
    </Link>
  );
  if (notes.length === 0) return link;
  const preview = notes.slice(0, 4);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right" className="max-w-sm text-xs space-y-2">
          <p className="font-medium">{notes.length} note{notes.length === 1 ? "" : "s"}</p>
          {preview.map((n) => (
            <div key={n.id} className="border-l-2 border-primary/40 pl-2">
              <p className="text-[10px] text-muted-foreground">
                {n.author ? `${n.author} · ` : ""}{formatNoteTimestamp(n.created_at)}
              </p>
              <p className="whitespace-pre-wrap line-clamp-3">{n.content}</p>
            </div>
          ))}
          {notes.length > preview.length ? (
            <p className="text-[10px] text-muted-foreground">+{notes.length - preview.length} more</p>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

function StatusSelectCell({ deal }: { deal: Deal }) {
  const updateDeal = useUpdateDeal();
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Select
        value={deal.status}
        onValueChange={(v) => {
          updateDeal.mutate(
            { id: deal.id, status: v as DealStatus },
            {
              onError: (err) =>
                toast.error("Status not saved: " + err.message, { duration: 15000 }),
            }
          );
        }}
      >
        <SelectTrigger className="h-7 text-xs w-full border-0 bg-transparent hover:bg-muted/50 focus:ring-1 px-1 [&>svg]:opacity-50">
          <SelectValue asChild>
            <DealStatusBadge status={deal.status} />
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {dealStatuses.map((s) => (
            <SelectItem key={s} value={s}>{s}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const COLUMNS: ColumnDef[] = [
  {
    key: "property_name", label: "Property", defaultVisible: true,
    sortKey: "property_name",
    render: (d) => <PropertyNameCell deal={d} />,
  },
  {
    key: "created_at", label: "Date Added", defaultVisible: true,
    sortKey: "created_at",
    render: (d) => {
      if (!d.created_at) return "—";
      const date = new Date(d.created_at);
      return date.toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "2-digit" });
    },
  },
  {
    key: "cfo_date", label: "CFO", defaultVisible: true,
    sortKey: "cfo_date",
    render: (d) => {
      if (!d.cfo_date) return "—";
      const [y, m, day] = d.cfo_date.split("-");
      return `${Number(m)}/${Number(day)}/${y.slice(-2)}`;
    },
    editable: true, editType: "date", fieldKey: "cfo_date",
  },
  {
    key: "ai_score", label: COLUMN_LABELS.ai_score, defaultVisible: true,
    sortKey: "ai_score",
    render: (d) => <AIScoreCell deal={d} />,
  },
  {
    key: "total_score", label: COLUMN_LABELS.total_score, defaultVisible: true,
    sortKey: "total_score",
    render: (d) => {
      const v = (d as any).total_score as number | null;
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="font-serif-display tabular-nums text-[15px] font-medium cursor-help">
                {v == null ? <span className="text-muted-foreground font-sans text-sm">—</span> : Math.round(v)}
              </span>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs text-xs">
              <p>{SCORE_HELP.total_score}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    },
  },
  {
    key: "deal_tier", label: COLUMN_LABELS.deal_tier, defaultVisible: true,
    sortKey: "deal_tier",
    render: (d) => {
      const tier = getTier(d as any);
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-[10px] cursor-help" style={{ borderColor: TIER_HEX[tier], color: TIER_HEX[tier] }}>
                {tier}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs text-xs">
              <p>{SCORE_HELP.deal_tier}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    },
  },

  {
    key: "analyst_grade", label: "Grade", defaultVisible: true,
    sortKey: "analyst_grade" as keyof Deal,
    render: (d) => {
      const v = ((d as any).analyst_grade as string | null) || null;
      if (!v) return <span className="text-muted-foreground">—</span>;
      const cls =
        v === "A" ? "text-tier-strong-fg font-semibold"
        : v === "B" ? "text-tier-medium-fg font-semibold"
        : v === "C" ? "text-muted-foreground font-semibold"
        : "text-destructive font-semibold";
      return <span className={cls}>{v}</span>;
    },
    editable: true, editType: "select",
    editOptions: analystGrades as unknown as string[],
    fieldKey: "analyst_grade" as keyof Deal,
  },
  {
    key: "broker", label: "Broker", defaultVisible: true,
    render: (d) => d.broker || "—",
    editable: true, editType: "text", fieldKey: "broker",
  },
  {
    key: "city", label: "City", defaultVisible: true,
    sortKey: "city",
    render: (d) => d.city || "—",
    editable: true, editType: "text", fieldKey: "city",
  },
  {
    key: "state", label: "State", defaultVisible: true,
    render: (d) => d.state || "—",
    editable: true, editType: "text", fieldKey: "state",
  },
  {
    key: "status", label: "Status", defaultVisible: true,
    sortKey: "status",
    render: (d) => <StatusSelectCell deal={d} />,
  },
  {
    key: "interest_level", label: "Interest", defaultVisible: true,
    sortKey: "interest_level",
    render: (d) => {
      const v = ((d as any).interest_level as InterestLevel) || "TBD";
      const cls =
        v === "High" ? "text-tier-strong-fg font-semibold"
        : v === "Med" ? "text-tier-medium-fg font-semibold"
        : v === "Low" ? "text-destructive font-semibold"
        : "text-muted-foreground";
      return <span className={cls}>{v}</span>;
    },
    editable: true, editType: "select", editOptions: interestLevels as unknown as string[],
    fieldKey: "interest_level" as keyof Deal,
  },
  {
    key: "marketed", label: "Marketed?", defaultVisible: true,
    render: (d) => <span className="tabular-nums">{d.marketed ? "Y" : "N"}</span>,
    editable: true, editType: "switch", fieldKey: "marketed",
  },
  {
    key: "unit_count", label: "Units", defaultVisible: true,
    sortKey: "unit_count",
    render: (d) => <span className="tabular-nums">{d.unit_count ?? "—"}</span>,
    editable: true, editType: "number", fieldKey: "unit_count",
  },
  {
    key: "asking_price", label: "Asking Price ($M)", defaultVisible: true,
    sortKey: "asking_price",
    render: (d) => <span className="font-serif-display tabular-nums">{formatMillions(d.asking_price)}</span>,
    editable: true, editType: "number", fieldKey: "asking_price",
  },
  {
    key: "estimated_equity", label: "Est. Equity ($M)", defaultVisible: true,
    sortKey: "estimated_equity",
    render: (d) => <span className="font-serif-display tabular-nums">{formatMillions(d.estimated_equity)}</span>,
    editable: true, editType: "number", fieldKey: "estimated_equity",
  },
  {
    key: "price_per_unit", label: "$/Unit", defaultVisible: true,
    render: (d) => <span className="font-serif-display tabular-nums">{formatPerUnit(d.asking_price, d.unit_count)}</span>,
  },
  {
    key: "vintage_year", label: "Year Built", defaultVisible: true,
    render: (d) => <span className="tabular-nums">{d.vintage_year ?? "—"}</span>,
    editable: true, editType: "number", fieldKey: "vintage_year",
  },
  {
    key: "affordable", label: "Affordable", defaultVisible: false,
    render: (d) => d.affordable ? "Yes" : "No",
    editable: true, editType: "switch", fieldKey: "affordable",
  },
  {
    key: "value_add_potential", label: "Value-Add", defaultVisible: false,
    render: (d) => d.value_add_potential || "—",
    editable: true, editType: "select", editOptions: valueAddLevels, fieldKey: "value_add_potential",
  },
  {
    key: "area_median_income", label: COLUMN_LABELS.area_median_income, defaultVisible: false,
    render: (d) => d.area_median_income || "—",
    editable: true, editType: "text", fieldKey: "area_median_income",
  },
  {
    key: "area_median_income_1mi", label: COLUMN_LABELS.area_median_income_1mi, defaultVisible: false,
    sortKey: "area_median_income_1mi",
    render: (d) => {
      const v = (d as any).area_median_income_1mi as number | null;
      return <span className="tabular-nums">{v == null ? "—" : `$${Math.round(v).toLocaleString()}`}</span>;
    },
  },
  {
    key: "annual_population_growth", label: COLUMN_LABELS.annual_population_growth, defaultVisible: false,
    render: (d) => d.annual_population_growth || "—",
    editable: true, editType: "text", fieldKey: "annual_population_growth",
  },

  {
    key: "notes", label: "Notes", defaultVisible: false,
    render: (d) => d.notes ? (d.notes.length > 40 ? d.notes.slice(0, 40) + "…" : d.notes) : "—",
    editable: true, editType: "text", fieldKey: "notes",
  },
];

// Default: show ALL columns. Users customize and their view persists per-account.
const DEFAULT_VISIBLE = COLUMNS.map((c) => c.key);
const DEFAULT_ORDER = COLUMNS.map((c) => c.key);
// Pinned first column — the table has hardcoded sticky positioning keyed to it.
const PINNED_COLUMN = "property_name";


// Inline edit cell component — single-click to edit, double-click to navigate
function InlineEditCell({
  deal,
  column,
  onSave,
  onNavigate,
  isActive,
  onActivate,
  onMove,
}: {
  deal: Deal;
  column: ColumnDef;
  onSave: (dealId: string, field: string, value: any) => void;
  onNavigate: () => void;
  isActive: boolean;
  onActivate: () => void;
  onMove: (dir: string, ctrl: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<any>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const cellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Focus the cell wrapper when it becomes active
  useEffect(() => {
    if (isActive && !editing && cellRef.current) {
      cellRef.current.focus();
    }
  }, [isActive, editing]);

  const startEdit = () => {
    if (!column.editable || !column.fieldKey) return;
    const raw = deal[column.fieldKey];
    // Boolean columns have no meaningful "edit mode" — a single click/Enter flips them.
    if (column.editType === "switch") {
      onSave(deal.id, column.fieldKey, !raw);
      return;
    }
    setValue(raw ?? "");
    setEditing(true);
  };


  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (editing) return;
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      onActivate();
      startEdit();
      clickTimerRef.current = null;
    }, 200);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    onNavigate();
  };

  const save = () => {
    if (!column.fieldKey) return;
    const raw = deal[column.fieldKey];
    let parsed: any = value;
    if (column.editType === "number") {
      parsed = value === "" || value === null ? null : Number(value);
      if (parsed !== null && isNaN(parsed)) { setEditing(false); return; }
    }
    if (parsed !== raw) {
      onSave(deal.id, column.fieldKey, parsed === "" ? null : parsed);
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (editing) {
      if (e.key === "Enter") { save(); return; }
      if (e.key === "Escape") { setEditing(false); return; }
      if (e.key === "Tab") {
        e.preventDefault();
        save();
        onMove(e.shiftKey ? "left" : "right", false);
        return;
      }
      // Don't intercept other keys while editing
      return;
    }
    // Non-editing active cell keyboard nav
    if (e.key === "Tab") {
      e.preventDefault();
      onMove(e.shiftKey ? "left" : "right", false);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onMove("right", e.ctrlKey || e.metaKey);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      onMove("left", e.ctrlKey || e.metaKey);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      onMove("down", e.ctrlKey || e.metaKey);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      onMove("up", e.ctrlKey || e.metaKey);
    } else if (e.key === "Enter") {
      e.preventDefault();
      startEdit();
    } else if (e.key === "F2") {
      e.preventDefault();
      startEdit();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && column.editable && column.fieldKey) {
      if (column.editType === "switch") {
        const k = e.key.toLowerCase();
        if (k === "y" || k === "n") {
          e.preventDefault();
          onSave(deal.id, column.fieldKey, k === "y");
        }
        return;
      }
      // Printable character — start editing with that character as initial value
      if (column.editType === "text" || column.editType === "number") {
        e.preventDefault();
        setValue(e.key);
        setEditing(true);
      }
    }
  };


  if (editing && column.editable) {
    if (column.editType === "select" && column.editOptions) {
      return (
        <Select
          defaultValue={String(value || "")}
          onValueChange={(v) => {
            onSave(deal.id, column.fieldKey!, v);
            setEditing(false);
          }}
          open={true}
          onOpenChange={(open) => { if (!open) setEditing(false); }}
        >
          <SelectTrigger className="h-7 text-xs w-full" onClick={(e) => e.stopPropagation()}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {column.editOptions.map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (column.editType === "switch") {
      return (
        <div onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={!!value}
            onCheckedChange={(checked) => {
              onSave(deal.id, column.fieldKey!, checked);
              setEditing(false);
            }}
          />
        </div>
      );
    }
    if (column.editType === "date") {
      return (
        <Input
          ref={inputRef}
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
          className="h-7 text-xs px-1.5 w-full min-w-[60px]"
        />
      );
    }
    return (
      <Input
        ref={inputRef}
        type={column.editType === "number" ? "number" : "text"}
        step={column.editType === "number" ? "any" : undefined}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        className="h-7 text-xs px-1.5 w-full min-w-[60px]"
      />
    );
  }

  // Boolean columns: an explicit toggle pill that flips instantly on a single
  // click (no click-delay, no double-click navigation swallowing the click).
  if (column.editable && column.editType === "switch" && column.fieldKey) {
    const on = !!deal[column.fieldKey];
    return (
      <button
        ref={cellRef as unknown as React.RefObject<HTMLButtonElement>}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onActivate();
          onSave(deal.id, column.fieldKey!, !on);
        }}
        onKeyDown={handleKeyDown}
        title="Click to toggle"
        className={`inline-flex min-w-[2.75rem] items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium transition-colors outline-none ${
          on
            ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
            : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
        } ${isActive ? "ring-2 ring-primary/50" : ""}`}
      >
        {on ? "Yes" : "No"}
      </button>
    );
  }

  return (
    <div
      ref={cellRef}
      tabIndex={0}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      className={`cursor-text rounded px-1 -mx-1 transition-colors outline-none ${
        isActive ? "ring-2 ring-primary/50 bg-primary/5" : "hover:bg-muted/50"
      }`}
    >
      {column.render(deal)}
    </div>
  );
}
// Multi-select status filter component
function StatusMultiSelect({
  selected,
  onChange,
}: {
  selected: DealStatus[];
  onChange: (statuses: DealStatus[]) => void;
}) {
  const toggleStatus = (status: DealStatus) => {
    if (selected.includes(status)) {
      onChange(selected.filter((s) => s !== status));
    } else {
      onChange([...selected, status]);
    }
  };

  const label = selected.length === 0
    ? "All Statuses"
    : selected.length === 1
    ? selected[0]
    : `${selected.length} statuses`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-[200px] justify-start text-sm font-normal">
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <button
          onClick={() => onChange([])}
          className="w-full text-left text-sm py-1.5 px-2 rounded hover:bg-muted/50 text-muted-foreground"
        >
          All Statuses
        </button>
        <div className="my-1 border-t" />
        {dealStatuses.map((status) => (
          <label
            key={status}
            className="flex items-center gap-2 text-sm py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer"
          >
            <Checkbox
              checked={selected.includes(status)}
              onCheckedChange={() => toggleStatus(status)}
            />
            <DealStatusBadge status={status} />
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export default function Index() {
  const { data: deals, isLoading } = useDeals();
  const { data: enrichmentsMap } = useDealEnrichments();
  const updateDeal = useUpdateDeal();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DealStatus[]>([]);
  const [showInactive, setShowInactive] = useUserPreference<boolean>(SHOW_INACTIVE_PREF_KEY, false);
  const [sortKey, setSortKey] = useState<string>("created_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [visibleColumnsRaw, setVisibleColumns] = useUserPreference<string[]>(
    "pipeline.visibleColumns",
    DEFAULT_VISIBLE,
  );
  const [columnOrderRaw, setColumnOrder] = useUserPreference<string[]>(
    "pipeline.columnOrder",
    DEFAULT_ORDER,
  );
  const [columnWidths, setColumnWidths] = useUserPreference<Record<string, number>>(
    "pipeline.columnWidths",
    {},
  );

  // Reconcile saved prefs with current column set (handle added/removed columns over time)
  const allKeys = useMemo(() => COLUMNS.map((c) => c.key), []);
  const visibleColumns = useMemo(() => {
    const set = new Set(allKeys);
    const list = (visibleColumnsRaw || []).filter((k) => set.has(k));
    // Property is pinned and can never be hidden
    return list.includes(PINNED_COLUMN) ? list : [PINNED_COLUMN, ...list];
  }, [visibleColumnsRaw, allKeys]);
  const columnOrder = useMemo(() => {
    const valid = (columnOrderRaw || []).filter((k) => allKeys.includes(k));
    const missing = allKeys.filter((k) => !valid.includes(k));
    const merged = [...valid, ...missing].filter((k) => k !== PINNED_COLUMN);
    return [PINNED_COLUMN, ...merged];
  }, [columnOrderRaw, allKeys]);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [columnManagerOpen, setColumnManagerOpen] = useState(false);

  const [draggedCol, setDraggedCol] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const resizingRef = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null);




  const handleInlineSave = useCallback(
    (dealId: string, field: string, value: any) => {
      const payload: any = { id: dealId, [field]: value };

      if (field === "asking_price" && value != null) {
        payload.estimated_equity = parseFloat((Number(value) * 0.35).toFixed(1));
      }

      if (field === "estimated_equity" && value == null) {
        const deal = deals?.find((d) => d.id === dealId);
        if (deal?.asking_price) {
          payload.estimated_equity = parseFloat((Number(deal.asking_price) * 0.35).toFixed(1));
        }
      }

      updateDeal.mutate(payload, {
        // Stays on screen: a silently-reverting edit is worse than a loud one.
        onError: (err) =>
          toast.error(`"${field}" not saved: ${err.message}`, { duration: 15000 }),
      });
    },
    [updateDeal, deals]
  );

  const filtered = useMemo(() => {
    if (!deals) return [];
    // Inject derived demographics (Avg HH Income / Pop Growth) from enrichment when manual fields are empty
    let result: Deal[] = deals.map((d) => {
      const enrich = enrichmentsMap?.get(d.id);
      const merged: any = { ...d };
      if (!merged.area_median_income) {
        const v = deriveMedianHHIncome(enrich);
        if (v) merged.area_median_income = v;
      }
      if (!merged.annual_population_growth) {
        const v = derivePopGrowth(enrich);
        if (v) merged.annual_population_growth = v;
      }
      return merged as Deal;
    });
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.property_name.toLowerCase().includes(q) ||
          d.city?.toLowerCase().includes(q) ||
          d.broker?.toLowerCase().includes(q)
      );
    }
    if (statusFilter.length > 0) {
      result = result.filter((d) => statusFilter.includes(d.status));
    } else if (!showInactive) {
      // Hide past/inactive deals by default
      result = result.filter((d) => !INACTIVE_STATUSES.includes(d.status));
    }

    const interestRank: Record<string, number> = { High: 0, Med: 1, Low: 2, TBD: 3 };

    result = [...result].sort((a, b) => {
      // Primary: active deals always on top
      const aActive = ACTIVE_STATUSES.includes(a.status) ? 0 : 1;
      const bActive = ACTIVE_STATUSES.includes(b.status) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;

      // Secondary: user-selected sort
      let aVal: any = (a as any)[sortKey];
      let bVal: any = (b as any)[sortKey];
      if (sortKey === "interest_level") {
        aVal = interestRank[(aVal as string) || "TBD"] ?? 3;
        bVal = interestRank[(bVal as string) || "TBD"] ?? 3;
      }
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (typeof aVal === "string" && typeof bVal === "string")
        return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return sortAsc ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
    });
    return result;
  }, [deals, enrichmentsMap, search, statusFilter, showInactive, sortKey, sortAsc]);

  // How many rows this view is currently suppressing (surfaced inline, never silent)
  const hiddenInactiveCount = useMemo(() => {
    if (!deals || statusFilter.length > 0) return 0;
    const q = search.toLowerCase();
    return deals.filter((d) => {
      if (!INACTIVE_STATUSES.includes(d.status)) return false;
      if (!q) return true;
      return (
        d.property_name.toLowerCase().includes(q) ||
        d.city?.toLowerCase().includes(q) ||
        d.broker?.toLowerCase().includes(q)
      );
    }).length;
  }, [deals, search, statusFilter]);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  // Operates on the reconciled set and persists the complete list.
  const toggleColumn = (key: string) => {
    if (key === PINNED_COLUMN) return; // pinned column can't be hidden
    const next = visibleColumns.includes(key)
      ? visibleColumns.filter((k) => k !== key)
      : [...visibleColumns, key];
    setVisibleColumns(next);
  };

  // Single source of truth for reordering (header drag AND column manager).
  const moveColumn = (sourceKey: string | null, targetKey: string) => {
    if (!sourceKey || sourceKey === targetKey) return;
    if (sourceKey === PINNED_COLUMN || targetKey === PINNED_COLUMN) return;
    const order = [...columnOrder]; // reconciled, always complete
    const fromIdx = order.indexOf(sourceKey);
    const toIdx = order.indexOf(targetKey);
    if (fromIdx === -1 || toIdx === -1) return;
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, sourceKey);
    setColumnOrder(order); // persist the complete list
  };

  const resetColumns = () => {
    setColumnOrder([...DEFAULT_ORDER]);
    setVisibleColumns([...DEFAULT_VISIBLE]);
  };


  // Column ordering: filter visible, then sort by columnOrder
  const activeColumns = useMemo(() => {
    const visible = COLUMNS.filter((c) => visibleColumns.includes(c.key));
    return visible.sort((a, b) => columnOrder.indexOf(a.key) - columnOrder.indexOf(b.key));
  }, [visibleColumns, columnOrder]);






  const handleCellMove = useCallback(
    (dir: string, ctrl: boolean, rowIdx: number, colIdx: number) => {
      const rowCount = filtered.length;
      const colCount = activeColumns.length;
      let r = rowIdx;
      let c = colIdx;
      switch (dir) {
        case "right": c = ctrl ? colCount - 1 : Math.min(c + 1, colCount - 1); break;
        case "left": c = ctrl ? 0 : Math.max(c - 1, 0); break;
        case "down": r = ctrl ? rowCount - 1 : Math.min(r + 1, rowCount - 1); break;
        case "up": r = ctrl ? 0 : Math.max(r - 1, 0); break;
      }
      setActiveCell({ row: r, col: c });
    },
    [filtered.length, activeColumns.length]
  );

  const handleDragStart = (e: React.DragEvent<HTMLTableCellElement>, key: string) => {
    setDraggedCol(key);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", key);
    // Use a small drag image so it doesn't obscure drop targets
    const el = e.currentTarget;
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.style.cssText = "position:absolute;top:-9999px;opacity:0.8;background:hsl(var(--primary));color:white;padding:4px 12px;border-radius:6px;font-size:13px;white-space:nowrap;";
    ghost.textContent = COLUMNS.find(c => c.key === key)?.label || key;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  };
  const handleDragOver = (e: React.DragEvent<HTMLTableCellElement>, targetKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (targetKey !== draggedCol) {
      setDragOverCol(targetKey);
    }
  };
  const handleDragLeave = () => {
    setDragOverCol(null);
  };
  const handleDrop = (e: React.DragEvent<HTMLTableCellElement>, targetKey: string) => {
    e.preventDefault();
    setDragOverCol(null);
    const sourceKey = e.dataTransfer.getData("text/plain") || draggedCol;
    setDraggedCol(null);
    moveColumn(sourceKey, targetKey);
  };

  const handleDragEnd = () => {
    setDraggedCol(null);
    setDragOverCol(null);
  };

  // Column resize handlers
  const handleResizeStart = (e: React.MouseEvent, key: string, currentWidth: number) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { key, startX: e.clientX, startW: currentWidth };
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const diff = ev.clientX - resizingRef.current.startX;
      const newWidth = Math.max(60, resizingRef.current.startW + diff);
      setColumnWidths((prev) => ({ ...prev, [resizingRef.current!.key]: newWidth }));
    };
    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const SortHeader = ({ label, sortKeyName }: { label: string; sortKeyName?: string }) =>
    sortKeyName ? (
      <button
        onClick={() => toggleSort(sortKeyName)}
        className="flex items-center gap-1 hover:text-foreground transition-colors"
      >
        {label}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    ) : (
      <span>{label}</span>
    );

  const containerClass = isFullscreen
    ? "fixed inset-0 z-50 bg-background p-6 overflow-auto flex flex-col"
    : "space-y-6";

  // Institutional summary stats — computed from the loaded (unfiltered) deals
  const summary = useMemo(() => {
    const all = deals ?? [];
    const total = all.length;
    const active = all.filter((d) => ACTIVE_STATUSES.includes(d.status)).length;
    const totalAsking = all.reduce((acc, d) => acc + (Number(d.asking_price) || 0), 0);
    const scored = all.filter((d) => d.ai_score != null);
    const avgScore = scored.length
      ? Math.round(scored.reduce((a, d) => a + (d.ai_score as number), 0) / scored.length)
      : null;
    const askingLabel =
      totalAsking >= 1000 ? `$${(totalAsking / 1000).toFixed(2)}B` : `$${totalAsking.toFixed(1)}M`;
    return { total, active, askingLabel, avgScore };
  }, [deals]);

  return (
    <div className={containerClass}>
      <div className="border-b border-hairline pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-foreground">Pipeline</h1>
            <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground tabular-nums">
              <span>{summary.total} deals</span>
              <span className="mx-2 text-hairline">·</span>
              <span>{summary.active} active</span>
              <span className="mx-2 text-hairline">·</span>
              <span>{summary.askingLabel} total</span>
              <span className="mx-2 text-hairline">·</span>
              <span>avg score {summary.avgScore ?? "—"}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="border-hairline"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <Button
              variant="outline"
              className="border-hairline"
              onClick={() => setExportOpen(true)}
            >
              <Download className="mr-2 h-4 w-4" />
              Export Pipeline
            </Button>
            <Button asChild>
              <Link to="/deals/new">
                <Plus className="mr-2 h-4 w-4" />
                New Deal
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <ExportPipelineDialog open={exportOpen} onOpenChange={setExportOpen} deals={filtered} />

      <div className="flex items-center gap-3">

        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search properties, cities, brokers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 border-hairline"
          />
        </div>
        <StatusMultiSelect selected={statusFilter} onChange={setStatusFilter} />
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
          <Switch
            checked={showInactive}
            onCheckedChange={(v) => setShowInactive(v)}
          />
          Show past/inactive
        </label>
        <Button
          variant="outline"
          size="sm"
          className="border-hairline"
          onClick={() => setColumnManagerOpen(true)}
        >
          <Settings2 className="mr-2 h-4 w-4" /> Columns
        </Button>
        <ColumnManagerDialog
          open={columnManagerOpen}
          onOpenChange={setColumnManagerOpen}
          columns={COLUMNS.map((c) => ({ key: c.key, label: c.label }))}
          order={columnOrder}
          visible={visibleColumns}
          onMove={moveColumn}
          onToggle={toggleColumn}
          onReset={resetColumns}
          pinnedKey={PINNED_COLUMN}
        />

      </div>

      <HiddenDealsNotice
        hiddenCount={hiddenInactiveCount}
        showInactive={showInactive}
        onToggle={setShowInactive}
      />



      {isLoading ? (
        <div className="surface-card overflow-x-auto">
          <Table style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i} className="border-hairline">
                  {activeColumns.map((_, j) => (
                    <TableCell key={j} className="py-2"><Skeleton className="h-4 w-20" /></TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : filtered.length === 0 ? (
        <div className="surface-card border-dashed p-16 text-center">
          <Search className="h-8 w-8 mx-auto text-muted-foreground mb-3" strokeWidth={1.5} />
          <p className="text-sm text-foreground font-medium">
            {deals?.length === 0 ? "No deals yet" : "No deals match your filters"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {deals?.length === 0
              ? "Create your first deal to get started."
              : "Try adjusting search, status, or the inactive toggle."}
          </p>
        </div>
      ) : (
        <div className={`surface-card overflow-x-scroll ${isFullscreen ? "flex-1 mt-4" : ""}`}>
          <Table style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
            <colgroup>
              {activeColumns.map((col) => (
                <col key={col.key} style={{ width: columnWidths[col.key] ? `${columnWidths[col.key]}px` : undefined, minWidth: 60 }} />
              ))}
            </colgroup>
            <TableHeader>
              <TableRow className="border-hairline hover:bg-transparent">
                 {activeColumns.map((col) => {
                  const isDragged = draggedCol === col.key;
                  const isDropTarget = dragOverCol === col.key && draggedCol && draggedCol !== col.key;
                  const draggedIdx = draggedCol ? columnOrder.indexOf(draggedCol) : -1;
                  const targetIdx = columnOrder.indexOf(col.key);
                  const dropSide = draggedIdx < targetIdx ? "right" : "left";
                  const isPinned = col.key === "property_name";
                  return (
                    <TableHead
                      key={col.key}
                      className={`relative select-none group transition-all duration-150 h-9 text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground ${col.key !== "property_name" ? "text-center" : "text-left"} ${isDragged ? "opacity-30 scale-95" : ""} ${isDropTarget ? "bg-primary/10" : ""} ${isPinned ? "sticky left-0 z-20 bg-card shadow-[1px_0_0_0_hsl(var(--hairline))]" : ""}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, col.key)}
                      onDragOver={(e) => handleDragOver(e, col.key)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, col.key)}
                      onDragEnd={handleDragEnd}
                    >
                      {isDropTarget && (
                        <div className={`absolute top-1 bottom-1 w-0.5 bg-primary rounded-full z-20 ${dropSide === "left" ? "left-0" : "right-0"}`} />
                      )}
                      <div className={`flex items-center gap-1 ${col.key !== "property_name" ? "justify-center" : ""}`}>
                        <GripVertical className={`h-3 w-3 shrink-0 transition-colors ${isDragged ? "text-primary" : "text-muted-foreground/30 group-hover:text-muted-foreground cursor-grab"}`} />
                        <SortHeader label={col.label} sortKeyName={col.sortKey} />
                      </div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30 z-10"
                        onMouseDown={(e) => {
                          const th = (e.target as HTMLElement).parentElement;
                          handleResizeStart(e, col.key, th?.offsetWidth || 120);
                        }}
                      />
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((deal, thisRow) => (
                <TableRow key={deal.id} className="border-hairline cursor-pointer group/row hover:bg-muted/40">
                  {activeColumns.map((col, colIdx) => {
                    const isPinned = col.key === "property_name";
                    return (
                      <TableCell
                        key={col.key}
                        className={`py-1.5 overflow-hidden text-ellipsis text-[13px] ${col.key !== "property_name" ? "text-center" : "text-left"} ${isPinned ? "sticky left-0 z-10 bg-card group-hover/row:bg-muted/40 shadow-[1px_0_0_0_hsl(var(--hairline))]" : ""}`}
                      >
                        <InlineEditCell
                          deal={deal}
                          column={col}
                          onSave={handleInlineSave}
                          onNavigate={() => navigate(`/deals/${deal.id}`)}
                          isActive={activeCell?.row === thisRow && activeCell?.col === colIdx}
                          onActivate={() => setActiveCell({ row: thisRow, col: colIdx })}
                          onMove={(dir, ctrl) => handleCellMove(dir, ctrl, thisRow, colIdx)}
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        Click any cell to edit · Double-click to open deal · Arrow keys / Tab to navigate · Drag headers to reorder
      </p>

    </div>
  );
}

