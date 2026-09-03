import { CAPITAL_STATUS_OPTIONS } from "@/components/CapitalStatusCard";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";
import { useNavigate, Link } from "react-router-dom";
import { Plus, Search, ArrowUpDown, Settings2, Maximize2, Minimize2, GripVertical, Filter, X, Eye, LayoutGrid, Table as TableIcon, Merge } from "lucide-react";
import { MergeDuplicatePartnersDialog } from "@/components/MergeDuplicatePartnersDialog";
import { PartnerQuickView } from "@/components/PartnerQuickView";
import { PartnerCardsView } from "@/components/PartnerCardsView";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { readProvenance } from "@/lib/fieldProvenance";
import { PROFILE_COMPLETENESS_FIELDS } from "@/hooks/usePartners";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CheckSizeFilter,
  DEFAULT_CHECK_SIZE_FILTER,
  isCheckSizeActive,
  matchesCheckSize,
  type CheckSizeFilterState,
} from "@/components/CheckSizeFilter";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { WarmthBadge } from "@/components/WarmthBadge";
import { usePartners, useUpdatePartner, useRestorePartner } from "@/hooks/usePartners";
import { useAuth } from "@/hooks/useAuth";
import type { Partner } from "@/hooks/usePartners";

const warmthLevels = ["Existing Partner", "Very Warm", "Warm", "Tepid", "Cold"];
const warmthRank: Record<string, number> = { "Existing Partner": 1, "Very Warm": 2, "Warm": 3, "Tepid": 4, "Cold": 5 };
const warmthDisplay = (v: string) => { const r = warmthRank[v]; return r ? `${r}. ${v}` : v; };
const firmTypes = ["GP", "LP", "Family Office", "REIT", "Insurance", "Pension", "Endowment", "Fund of Funds", "Other"];

const formatEquityRange = (min: number | null, max: number | null) => {
  if (min == null && max == null) return "—";
  if (min != null && max != null) return `$${min}M – $${max}M`;
  if (min != null) return `$${min}M+`;
  return `Up to $${max}M`;
};

const getStrategies = (p: Partner) => {
  const s: string[] = [];
  if (p.strategy_value_add) s.push("VA");
  if (p.strategy_core_plus) s.push("C+");
  if (p.strategy_workforce) s.push("WF");
  if (p.strategy_affordable) s.push("Aff");
  return s;
};

type ColumnDef = {
  key: string;
  label: string;
  defaultVisible: boolean;
  sortKey?: string;
  render: (p: Partner) => React.ReactNode;
  editable?: boolean;
  editType?: "text" | "number" | "select" | "switch";
  editOptions?: string[];
  fieldKey?: keyof Partner;
  filterType?: "text" | "select" | "multiselect";
  filterOptions?: string[];
  getValue?: (p: Partner) => string;
};

const COLUMNS: ColumnDef[] = [
  {
    key: "name", label: "Firm", defaultVisible: true, sortKey: "name",
    render: (p) => (
      <div className="flex items-center gap-1.5 min-w-0" onClick={(e) => e.stopPropagation()}>
        <PartnerQuickView
          partner={p}
          trigger={
            <button
              className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
              title="Quick view"
              aria-label={`Quick view ${p.name}`}
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          }
        />
        <Link
          to={`/partners/${p.id}`}
          className="font-medium text-primary hover:underline truncate"
        >
          {p.name}
        </Link>
      </div>
    ),
    filterType: "text",
  },
  {
    key: "firm_type", label: "Type", defaultVisible: true, sortKey: "firm_type",
    render: (p) => (
      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-muted border text-muted-foreground">
        {p.firm_type || "—"}
      </span>
    ),
    editable: true, editType: "select", editOptions: firmTypes, fieldKey: "firm_type",
    filterType: "select", filterOptions: firmTypes,
    getValue: (p) => p.firm_type || "",
  },
  {
    key: "relationship_strength", label: "Warmth", defaultVisible: true, sortKey: "relationship_strength",
    render: (p) => <WarmthBadge strength={p.relationship_strength} />,
    editable: true, editType: "select", editOptions: warmthLevels, fieldKey: "relationship_strength",
    filterType: "select", filterOptions: warmthLevels,
    getValue: (p) => p.relationship_strength || "",
  },
  {
    key: "capital_status", label: "Capital Status", defaultVisible: true, sortKey: "capital_status",
    render: (p) => {
      if (!p.capital_status) return <span className="text-xs text-muted-foreground">—</span>;
      const tight = p.capital_status === "Out of Capital" || p.capital_status === "Constrained";
      return <span className={`text-xs ${tight ? "text-amber-700" : ""}`}>{p.capital_status}</span>;
    },
    editable: true, editType: "select", editOptions: CAPITAL_STATUS_OPTIONS as unknown as string[],
    fieldKey: "capital_status",
    filterType: "select", filterOptions: CAPITAL_STATUS_OPTIONS as unknown as string[],
    getValue: (p) => p.capital_status || "",
  },
  {
    key: "min_equity_m", label: "Min Equity ($M)", defaultVisible: true, sortKey: "min_equity_m",
    render: (p) => <span className="font-mono text-xs text-muted-foreground">{p.min_equity_m != null ? `$${p.min_equity_m}M` : "—"}</span>,
    editable: true, editType: "number", fieldKey: "min_equity_m",
    filterType: "select",
    getValue: (p) => p.min_equity_m != null ? String(p.min_equity_m) : "",
  },
  {
    key: "max_equity_m", label: "Max Equity ($M)", defaultVisible: true, sortKey: "max_equity_m",
    render: (p) => <span className="font-mono text-xs text-muted-foreground">{p.max_equity_m != null ? `$${p.max_equity_m}M` : "—"}</span>,
    editable: true, editType: "number", fieldKey: "max_equity_m",
    filterType: "select",
    getValue: (p) => p.max_equity_m != null ? String(p.max_equity_m) : "",
  },
  {
    key: "geography", label: "Geography", defaultVisible: true,
    render: (p) => (
      <div className="flex gap-1 justify-center flex-wrap max-w-[220px] mx-auto">
        {p.geography?.length ? p.geography.map((g) => (
          <span key={g} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted border text-muted-foreground whitespace-normal break-words">{g}</span>
        )) : <span className="text-muted-foreground text-xs">—</span>}
      </div>
    ),
    filterType: "text",
    getValue: (p) => (p.geography || []).join(", "),
  },
  {
    key: "strategy", label: "Strategy", defaultVisible: true,
    render: (p) => {
      const strats = getStrategies(p);
      return (
        <div className="flex gap-1 justify-center flex-wrap max-w-[180px] mx-auto">
          {strats.length ? strats.map((s) => (
            <span key={s} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 text-primary whitespace-normal break-words">{s}</span>
          )) : <span className="text-muted-foreground text-xs">—</span>}
        </div>
      );
    },
    filterType: "select",
    filterOptions: ["Value-Add", "Core+", "Workforce", "Affordable"],
    getValue: (p) => getStrategies(p).join(", "),
  },
  {
    key: "investor_type", label: "Investor Type", defaultVisible: true,
    render: (p) => (
      <div className="flex gap-1 justify-center flex-wrap max-w-[200px] mx-auto">
        {p.investor_type?.length ? p.investor_type.map((t) => (
          <span key={t} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted border text-muted-foreground whitespace-normal break-words">{t}</span>
        )) : <span className="text-muted-foreground text-xs">—</span>}
      </div>
    ),
    filterType: "select",
    getValue: (p) => (p.investor_type || []).join(", "),
  },
  {
    key: "ansonia_poc", label: "POC", defaultVisible: true, sortKey: "ansonia_poc",
    render: (p) => <span className="text-xs text-muted-foreground">{p.ansonia_poc || "—"}</span>,
    editable: true, editType: "text", fieldKey: "ansonia_poc",
    filterType: "text",
  },
  {
    key: "status", label: "Status", defaultVisible: false, sortKey: "status",
    render: (p) => <span className="text-xs">{p.status || "—"}</span>,
    editable: true, editType: "select", editOptions: ["Active", "Inactive", "Prospect"], fieldKey: "status",
    filterType: "select", filterOptions: ["Active", "Inactive", "Prospect"],
    getValue: (p) => p.status || "",
  },
  {
    key: "urban_infill", label: "Urban Infill", defaultVisible: false,
    render: (p) => p.urban_infill ? "Yes" : "No",
    editable: true, editType: "switch", fieldKey: "urban_infill",
  },
  {
    key: "suburban", label: "Suburban", defaultVisible: false,
    render: (p) => p.suburban ? "Yes" : "No",
    editable: true, editType: "switch", fieldKey: "suburban",
  },
  {
    key: "additional_notes", label: "Notes", defaultVisible: false,
    render: (p) => p.additional_notes ? (p.additional_notes.length > 40 ? p.additional_notes.slice(0, 40) + "…" : p.additional_notes) : "—",
    editable: true, editType: "text", fieldKey: "additional_notes",
    filterType: "text",
  },
  {
    key: "last_edited_at", label: "Last Edited", defaultVisible: true, sortKey: "last_edited_at",
    render: (p) => {
      if (!p.last_edited_at) return <span className="text-muted-foreground text-xs">—</span>;
      const d = new Date(p.last_edited_at);
      return (
        <span className="text-xs text-muted-foreground" title={d.toLocaleString()}>
          {formatDistanceToNow(d, { addSuffix: true })}
        </span>
      );
    },
    getValue: (p) => p.last_edited_at || "",
  },
];

const DEFAULT_VISIBLE = COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);

// Inline edit cell — mirrors deal pipeline behavior
function InlineEditCell({
  partner, column, onSave, onNavigate, isActive, onActivate, onMove,
}: {
  partner: Partner; column: ColumnDef;
  onSave: (id: string, field: string, value: any) => void;
  onNavigate: () => void; isActive: boolean; onActivate: () => void;
  onMove: (dir: string, ctrl: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [selectOpen, setSelectOpen] = useState(true);
  const [value, setValue] = useState<any>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const cellRef = useRef<HTMLDivElement>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [editing]);

  useEffect(() => {
    if (isActive && !editing && cellRef.current) cellRef.current.focus();
  }, [isActive, editing]);

  const startEdit = () => {
    if (!column.editable || !column.fieldKey) return;
    setValue(partner[column.fieldKey] ?? "");
    setSelectOpen(true);
    setEditing(true);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (editing) return;
    onActivate();
    // Delay edit to allow double-click to fire first
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => { startEdit(); }, 250);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
    setEditing(false);
    onNavigate();
  };

  const save = () => {
    if (!column.fieldKey) return;
    const raw = partner[column.fieldKey];
    let parsed: any = value;
    if (column.editType === "number") {
      parsed = value === "" || value === null ? null : Number(value);
      if (parsed !== null && isNaN(parsed)) { setEditing(false); return; }
    }
    if (parsed !== raw) onSave(partner.id, column.fieldKey, parsed === "" ? null : parsed);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (editing) {
      if (e.key === "Enter") { save(); return; }
      if (e.key === "Escape") { setEditing(false); return; }
      if (e.key === "Tab") { e.preventDefault(); save(); onMove(e.shiftKey ? "left" : "right", false); return; }
      return;
    }
    if (e.key === "Tab") { e.preventDefault(); onMove(e.shiftKey ? "left" : "right", false); }
    else if (e.key === "ArrowRight") { e.preventDefault(); onMove("right", e.ctrlKey || e.metaKey); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); onMove("left", e.ctrlKey || e.metaKey); }
    else if (e.key === "ArrowDown") { e.preventDefault(); onMove("down", e.ctrlKey || e.metaKey); }
    else if (e.key === "ArrowUp") { e.preventDefault(); onMove("up", e.ctrlKey || e.metaKey); }
    else if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); startEdit(); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && column.editable && column.fieldKey) {
      if (column.editType === "text" || column.editType === "number") {
        e.preventDefault(); setValue(e.key); setEditing(true);
      }
    }
  };

  if (editing && column.editable) {
    if (column.editType === "select" && column.editOptions) {
      return (
        <Select
          value={String(value || "")}
          onValueChange={(v) => {
            setValue(v);
            onSave(partner.id, column.fieldKey!, v);
            setSelectOpen(false);
          }}
          open={selectOpen}
          onOpenChange={(o) => { setSelectOpen(o); if (!o) setEditing(false); }}>
          <SelectTrigger className="h-7 text-xs w-full" onClick={(e) => e.stopPropagation()}><SelectValue /></SelectTrigger>
          <SelectContent>
            {column.editOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    if (column.editType === "switch") {
      return (
        <div onClick={(e) => e.stopPropagation()}>
          <Switch checked={!!value} onCheckedChange={(checked) => { onSave(partner.id, column.fieldKey!, checked); setEditing(false); }} />
        </div>
      );
    }
    return (
      <Input ref={inputRef} type={column.editType === "number" ? "number" : "text"}
        step={column.editType === "number" ? "any" : undefined}
        value={value} onChange={(e) => setValue(e.target.value)}
        onBlur={save} onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        className="h-7 text-xs px-1.5 w-full min-w-[60px]" />
    );
  }

  return (
    <div ref={cellRef} tabIndex={0} onClick={handleClick} onDoubleClick={handleDoubleClick} onKeyDown={handleKeyDown}
      className={`cursor-text rounded px-1 -mx-1 transition-colors outline-none ${isActive ? "ring-2 ring-primary/50 bg-primary/5" : "hover:bg-muted/50"}`}>
      {column.render(partner)}
    </div>
  );
}

export default function PartnersPage() {
  const [showArchived, setShowArchived] = useState<boolean>(() => {
    try { return localStorage.getItem("partners-show-archived") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("partners-show-archived", showArchived ? "1" : "0"); } catch {}
  }, [showArchived]);
  const { data: partners, isLoading } = usePartners({ includeArchived: showArchived });
  const updatePartner = useUpdatePartner();
  const restorePartner = useRestorePartner();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string>("last_edited_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const [checkSize, setCheckSize] = useState<CheckSizeFilterState>(DEFAULT_CHECK_SIZE_FILTER);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    try { const s = localStorage.getItem("partners-visible-columns"); if (s) return JSON.parse(s); } catch {}
    return DEFAULT_VISIBLE;
  });
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const allKeys = COLUMNS.map((c) => c.key);
    try { const s = localStorage.getItem("partners-column-order"); if (s) { const p: string[] = JSON.parse(s); const m = allKeys.filter((k) => !p.includes(k)); return [...p.filter((k) => allKeys.includes(k)), ...m]; } } catch {}
    return allKeys;
  });
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    try { const s = localStorage.getItem("partners-column-widths"); if (s) return JSON.parse(s); } catch {}
    return {};
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSeed, setMergeSeed] = useState<{ primaryId?: string; duplicateId?: string }>({});
  const duplicateNameCount = useMemo(() => {
    if (!partners) return 0;
    const map = new Map<string, number>();
    partners.forEach((p) => {
      if (p.archived_at) return;
      const k = p.name.trim().toLowerCase();
      if (!k) return;
      map.set(k, (map.get(k) || 0) + 1);
    });
    return Array.from(map.values()).filter((n) => n > 1).length;
  }, [partners]);
  const [view, setView] = useState<"cards" | "table">(() => {
    try {
      const s = localStorage.getItem("partners-view");
      if (s === "table" || s === "cards") return s;
    } catch {}
    return "cards";
  });
  useEffect(() => {
    try { localStorage.setItem("partners-view", view); } catch {}
  }, [view]);
  const [draggedCol, setDraggedCol] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const resizingRef = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null);

  const handleInlineSave = useCallback(
    (id: string, field: string, value: any) => {
      const patch: Record<string, any> = { id, [field]: value };
      if (field === "relationship_strength") {
        const current = partners?.find((p) => p.id === id);
        const existing = Array.isArray(current?.manual_fields) ? current!.manual_fields : [];
        if (!existing.includes("relationship_strength")) {
          patch.manual_fields = [...existing, "relationship_strength"];
        }
      }
      updatePartner.mutate(patch as any, {
        onError: (err) => toast.error("Failed to update: " + err.message),
      });
    },
    [updatePartner, partners]
  );


  // Collect unique values per column for filter options
  const columnUniqueValues = useMemo(() => {
    if (!partners) return {} as Record<string, string[]>;
    const result: Record<string, string[]> = {};
    for (const col of COLUMNS) {
      const valSet = new Set<string>();
      let hasBlank = false;
      for (const p of partners) {
        if (col.key === "strategy") {
          if (p.strategy_value_add) valSet.add("Value-Add");
          if (p.strategy_core_plus) valSet.add("Core+");
          if (p.strategy_workforce) valSet.add("Workforce");
          if (p.strategy_affordable) valSet.add("Affordable");
        } else if (col.key === "investor_type") {
          if (!p.investor_type || p.investor_type.length === 0) hasBlank = true;
          else (p.investor_type).forEach((t) => valSet.add(t));
        } else if (col.key === "geography") {
          if (!p.geography || p.geography.length === 0) hasBlank = true;
          else (p.geography).forEach((g) => valSet.add(g));
        } else if (col.key === "urban_infill" || col.key === "suburban") {
          valSet.add("Yes");
          valSet.add("No");
        } else if (col.getValue) {
          const v = col.getValue(p);
          if (v) valSet.add(v);
          else hasBlank = true;
        } else if (col.fieldKey) {
          const v = p[col.fieldKey];
          if (v != null && v !== "") valSet.add(String(v));
          else hasBlank = true;
        }
      }
      let sorted: string[];
      if (col.key === "relationship_strength") {
        sorted = Array.from(valSet).sort((a, b) => (warmthRank[a] ?? 99) - (warmthRank[b] ?? 99));
      } else if (col.key === "min_equity_m" || col.key === "max_equity_m") {
        sorted = Array.from(valSet).sort((a, b) => Number(a) - Number(b));
      } else {
        sorted = Array.from(valSet).sort();
      }
      if (hasBlank) sorted.push("(Blank)");
      result[col.key] = sorted;
    }
    return result;
  }, [partners]);

  const filtered = useMemo(() => {
    if (!partners) return [];
    let result = partners;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.firm_type?.toLowerCase().includes(q) ||
        p.geography?.some((g) => g.toLowerCase().includes(q)) ||
        p.ansonia_poc?.toLowerCase().includes(q) ||
        p.additional_notes?.toLowerCase().includes(q)
      );
    }
    // Column-specific multi-select filters
    for (const [colKey, filterVals] of Object.entries(columnFilters)) {
      if (!filterVals || filterVals.length === 0) continue;
      const col = COLUMNS.find((c) => c.key === colKey);
      if (!col) continue;
      if (col.key === "strategy") {
        const stratMap: Record<string, keyof Partner> = { "Value-Add": "strategy_value_add", "Core+": "strategy_core_plus", "Workforce": "strategy_workforce", "Affordable": "strategy_affordable" };
        result = result.filter((p) => filterVals.some((fv) => { const field = stratMap[fv]; return field && p[field] === true; }));
      } else if (col.key === "investor_type") {
        result = result.filter((p) => {
          const hasBlankFilter = filterVals.includes("(Blank)");
          const otherVals = filterVals.filter((v) => v !== "(Blank)");
          const isEmpty = !p.investor_type || p.investor_type.length === 0;
          if (hasBlankFilter && isEmpty) return true;
          if (otherVals.length > 0 && otherVals.some((fv) => (p.investor_type || []).includes(fv))) return true;
          return false;
        });
      } else if (col.key === "geography") {
        result = result.filter((p) => {
          const hasBlankFilter = filterVals.includes("(Blank)");
          const otherVals = filterVals.filter((v) => v !== "(Blank)");
          const isEmpty = !p.geography || p.geography.length === 0;
          if (hasBlankFilter && isEmpty) return true;
          if (otherVals.length > 0 && otherVals.some((fv) => (p.geography || []).includes(fv))) return true;
          return false;
        });
      } else if (col.key === "urban_infill" || col.key === "suburban") {
        result = result.filter((p) => {
          const v = p[col.fieldKey as keyof Partner] ? "Yes" : "No";
          return filterVals.includes(v);
        });
      } else {
        result = result.filter((p) => {
          const v = col.getValue ? col.getValue(p) : col.fieldKey ? String(p[col.fieldKey] ?? "") : "";
          if (filterVals.includes("(Blank)") && (!v || v === "")) return true;
          return filterVals.includes(v);
        });
      }
    }
    // Equity check-size filter
    if (isCheckSizeActive(checkSize)) {
      result = result.filter((p) => matchesCheckSize(p, checkSize));
    }
    // Sort
    if (sortKey) {
      result = [...result].sort((a, b) => {
        // Profile freshness: oldest `as_of` across the profile fields first.
        // Partners with no provenance at all sort last — unknown is not stale.
        if (sortKey === "profile_freshness") {
          const oldest = (p: any) => {
            let t = Infinity;
            for (const f of PROFILE_COMPLETENESS_FIELDS) {
              const prov = readProvenance(p.enriched_fields, f);
              if (!prov) continue;
              const v = new Date(prov.as_of).getTime();
              if (Number.isFinite(v) && v < t) t = v;
            }
            return t;
          };
          const aT = oldest(a); const bT = oldest(b);
          if (aT === Infinity && bT === Infinity) return 0;
          if (aT === Infinity) return 1;
          if (bT === Infinity) return -1;
          return sortAsc ? aT - bT : bT - aT;
        }
        // Custom rank-based sorting for warmth
        if (sortKey === "relationship_strength") {
          const aRank = warmthRank[(a as any).relationship_strength] ?? 99;
          const bRank = warmthRank[(b as any).relationship_strength] ?? 99;
          return sortAsc ? aRank - bRank : bRank - aRank;
        }
        const aVal = (a as any)[sortKey];
        const bVal = (b as any)[sortKey];
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        if (typeof aVal === "string" && typeof bVal === "string")
          return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        return sortAsc ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
      });
    }
    return result;
  }, [partners, search, columnFilters, checkSize, sortKey, sortAsc]);

  const activeColumns = useMemo(() => {
    const visible = COLUMNS.filter((c) => visibleColumns.includes(c.key));
    return visible.sort((a, b) => columnOrder.indexOf(a.key) - columnOrder.indexOf(b.key));
  }, [visibleColumns, columnOrder]);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const toggleColumn = (key: string) => {
    setVisibleColumns((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      localStorage.setItem("partners-visible-columns", JSON.stringify(next));
      return next;
    });
  };

  const handleCellMove = useCallback(
    (dir: string, ctrl: boolean, rowIdx: number, colIdx: number) => {
      const rowCount = filtered.length;
      const colCount = activeColumns.length;
      let r = rowIdx, c = colIdx;
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

  // Drag & drop column reorder
  const handleDragStart = (e: React.DragEvent<HTMLTableCellElement>, key: string) => {
    setDraggedCol(key);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", key);
    const ghost = e.currentTarget.cloneNode(true) as HTMLElement;
    ghost.style.cssText = "position:absolute;top:-9999px;opacity:0.8;background:hsl(var(--primary));color:white;padding:4px 12px;border-radius:6px;font-size:13px;white-space:nowrap;";
    ghost.textContent = COLUMNS.find(c => c.key === key)?.label || key;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  };
  const handleDragOver = (e: React.DragEvent<HTMLTableCellElement>, targetKey: string) => {
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
    if (targetKey !== draggedCol) setDragOverCol(targetKey);
  };
  const handleDragLeave = () => setDragOverCol(null);
  const handleDrop = (e: React.DragEvent<HTMLTableCellElement>, targetKey: string) => {
    e.preventDefault(); setDragOverCol(null);
    const sourceKey = e.dataTransfer.getData("text/plain") || draggedCol;
    if (!sourceKey || sourceKey === targetKey) { setDraggedCol(null); return; }
    setColumnOrder((prev) => {
      const order = [...prev];
      const fromIdx = order.indexOf(sourceKey);
      const toIdx = order.indexOf(targetKey);
      if (fromIdx === -1 || toIdx === -1) return prev;
      order.splice(fromIdx, 1);
      order.splice(toIdx, 0, sourceKey);
      localStorage.setItem("partners-column-order", JSON.stringify(order));
      return order;
    });
    setDraggedCol(null);
  };
  const handleDragEnd = () => { setDraggedCol(null); setDragOverCol(null); };

  // Column resize
  const handleResizeStart = (e: React.MouseEvent, key: string, currentWidth: number) => {
    e.preventDefault(); e.stopPropagation();
    resizingRef.current = { key, startX: e.clientX, startW: currentWidth };
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const diff = ev.clientX - resizingRef.current.startX;
      const newWidth = Math.max(60, resizingRef.current.startW + diff);
      setColumnWidths((prev) => {
        const next = { ...prev, [resizingRef.current!.key]: newWidth };
        localStorage.setItem("partners-column-widths", JSON.stringify(next));
        return next;
      });
    };
    const onUp = () => { resizingRef.current = null; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const toggleColumnFilter = (colKey: string, value: string) => {
    setColumnFilters((prev) => {
      const current = prev[colKey] || [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...prev, [colKey]: next };
    });
  };

  const clearColumnFilter = (colKey: string) => {
    setColumnFilters((prev) => ({ ...prev, [colKey]: [] }));
  };

  const activeFilterCount =
    Object.values(columnFilters).filter((v) => v && v.length > 0).length +
    (isCheckSizeActive(checkSize) ? 1 : 0);

  const SortHeader = ({ label, sortKeyName }: { label: string; sortKeyName?: string }) =>
    sortKeyName ? (
      <button onClick={() => toggleSort(sortKeyName)} className="flex items-center gap-1 hover:text-foreground transition-colors">
        {label}
        <ArrowUpDown className={`h-3 w-3 ${sortKey === sortKeyName ? "text-primary" : ""}`} />
      </button>
    ) : <span>{label}</span>;

  const containerClass = isFullscreen
    ? "fixed inset-0 z-50 bg-background p-6 overflow-auto flex flex-col"
    : "mx-auto w-full max-w-6xl px-6 py-6 space-y-6";


  return (
    <div className={containerClass}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Capital Partners</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {partners?.length ?? 0} firms{filtered.length !== (partners?.length ?? 0) ? ` · ${filtered.length} shown` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(v) => { if (v === "cards" || v === "table") setView(v); }}
            className="border rounded-md"
          >
            <ToggleGroupItem value="cards" aria-label="Cards view" className="h-8 px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              <LayoutGrid className="h-3.5 w-3.5 mr-1.5" /> Cards
            </ToggleGroupItem>
            <ToggleGroupItem value="table" aria-label="Table view" className="h-8 px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              <TableIcon className="h-3.5 w-3.5 mr-1.5" /> Table
            </ToggleGroupItem>
          </ToggleGroup>
          {view === "table" && (
            <Button variant="outline" size="icon" onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          )}
          {isAdmin && (
            <Button variant="outline" onClick={() => navigate("/admin/warmth-import")} className="gap-1.5">
              Import warmth
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => { setMergeSeed({}); setMergeOpen(true); }}
            className="gap-1.5"
            title="Merge duplicate partner records"
          >
            <Merge className="h-4 w-4" /> Merge duplicates
            {duplicateNameCount > 0 && (
              <span className="ml-1 rounded-full bg-amber-500/20 text-amber-900 dark:text-amber-200 px-1.5 py-0.5 text-[10px] font-semibold">
                {duplicateNameCount}
              </span>
            )}
          </Button>
          <Button onClick={() => navigate("/partners/new")} className="gap-1.5">
            <Plus className="h-4 w-4" /> Add Firm
          </Button>
        </div>
      </div>

      <MergeDuplicatePartnersDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        partners={partners ?? []}
        initialPrimaryId={mergeSeed.primaryId}
        initialDuplicateId={mergeSeed.duplicateId}
      />



      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search firms, geography, POC..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>

        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} />
          Show archived
        </label>

        {view === "table" && (
          <CheckSizeFilter value={checkSize} onChange={setCheckSize} />
        )}

        <Select
          value={sortKey === "profile_freshness" ? "profile_freshness" : "default"}
          onValueChange={(v) => {
            if (v === "profile_freshness") { setSortKey("profile_freshness"); setSortAsc(true); }
            else { setSortKey("last_edited_at"); setSortAsc(false); }
          }}
        >
          <SelectTrigger className="h-9 w-[190px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Sort: Last edited</SelectItem>
            <SelectItem value="profile_freshness">Sort: Profile freshness</SelectItem>
          </SelectContent>
        </Select>

        {view === "table" && activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setColumnFilters({}); setCheckSize(DEFAULT_CHECK_SIZE_FILTER); }}
            className="text-xs text-muted-foreground"
          >
            <X className="h-3 w-3 mr-1" /> Clear {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}
          </Button>
        )}


        {/* Column visibility — table view only */}
        {view === "table" && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Settings2 className="mr-2 h-4 w-4" /> Columns
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56">
              <p className="text-xs font-medium text-muted-foreground mb-2">Toggle columns</p>
              <div className="space-y-1">
                {COLUMNS.map((col) => (
                  <label key={col.key} className="flex items-center gap-2 text-sm py-1 px-1 rounded hover:bg-muted/50 cursor-pointer">
                    <Checkbox checked={visibleColumns.includes(col.key)} onCheckedChange={() => toggleColumn(col.key)} />
                    {col.label}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {view === "cards" ? (
        <PartnerCardsView partners={partners ?? []} search={search} />
      ) : (
      <>


      <div className={`rounded-lg border bg-card overflow-auto ${isFullscreen ? "flex-1 mt-4" : "max-h-[calc(100vh-320px)]"}`}>
        <Table style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
          <colgroup>
            {activeColumns.map((col) => (
              <col key={col.key} style={{ width: columnWidths[col.key] ? `${columnWidths[col.key]}px` : undefined, minWidth: 60 }} />
            ))}
          </colgroup>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              {activeColumns.map((col) => {
                const isDragged = draggedCol === col.key;
                const isDropTarget = dragOverCol === col.key && draggedCol && draggedCol !== col.key;
                const draggedIdx = draggedCol ? columnOrder.indexOf(draggedCol) : -1;
                const targetIdx = columnOrder.indexOf(col.key);
                const dropSide = draggedIdx < targetIdx ? "right" : "left";
                return (
                  <TableHead key={col.key}
                    className={`relative select-none group transition-all duration-150 ${col.key !== "name" ? "text-center" : "text-left"} ${isDragged ? "opacity-30 scale-95" : ""} ${isDropTarget ? "bg-primary/10" : ""}`}
                    draggable onDragStart={(e) => handleDragStart(e, col.key)}
                    onDragOver={(e) => handleDragOver(e, col.key)} onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, col.key)} onDragEnd={handleDragEnd}>
                    {isDropTarget && <div className={`absolute top-1 bottom-1 w-0.5 bg-primary rounded-full z-20 ${dropSide === "left" ? "left-0" : "right-0"}`} />}
                    <div className={`flex items-center gap-1 ${col.key !== "name" ? "justify-center" : ""}`}>
                      <GripVertical className={`h-3.5 w-3.5 shrink-0 transition-colors ${isDragged ? "text-primary" : "text-muted-foreground/40 group-hover:text-muted-foreground cursor-grab"}`} />
                      <SortHeader label={col.label} sortKeyName={col.sortKey} />
                      {/* Per-column multi-select filter */}
                      {columnUniqueValues[col.key]?.length > 0 && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className={`ml-0.5 p-0.5 rounded transition-colors ${(columnFilters[col.key]?.length || 0) > 0 ? "text-primary" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
                              onClick={(e) => e.stopPropagation()}>
                              <Filter className="h-3 w-3" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-52 p-2 max-h-64 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-medium text-muted-foreground">Filter {col.label}</span>
                              {(columnFilters[col.key]?.length || 0) > 0 && (
                                <button className="text-[10px] text-primary hover:underline" onClick={() => clearColumnFilter(col.key)}>Clear</button>
                              )}
                            </div>
                            <div className="space-y-0.5">
                              {columnUniqueValues[col.key].map((val) => (
                                <label key={val} className="flex items-center gap-2 text-xs py-1 px-1.5 rounded hover:bg-muted/50 cursor-pointer">
                                  <Checkbox
                                    checked={(columnFilters[col.key] || []).includes(val)}
                                    onCheckedChange={() => toggleColumnFilter(col.key, val)}
                                    className="h-3.5 w-3.5"
                                  />
                                  <span className="truncate">{col.key === "relationship_strength" ? warmthDisplay(val) : (col.key === "min_equity_m" || col.key === "max_equity_m") && val !== "(Blank)" ? `$${val}M` : val}</span>
                                </label>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                    <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30 z-10"
                      onMouseDown={(e) => { const th = (e.target as HTMLElement).parentElement; handleResizeStart(e, col.key, th?.offsetWidth || 120); }} />
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <TableRow key={i}>
                  {activeColumns.map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={activeColumns.length} className="text-center py-12 text-muted-foreground">
                  No partners found
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((p, rowIdx) => (
                <TableRow key={p.id} className="cursor-pointer">
                  {activeColumns.map((col, colIdx) => (
                    <TableCell key={col.key} className={`overflow-hidden text-ellipsis ${col.key !== "name" ? "text-center" : "text-left"}`}>
                      <InlineEditCell partner={p} column={col} onSave={handleInlineSave}
                        onNavigate={() => navigate(`/partners/${p.id}`)}
                        isActive={activeCell?.row === rowIdx && activeCell?.col === colIdx}
                        onActivate={() => setActiveCell({ row: rowIdx, col: colIdx })}
                        onMove={(dir, ctrl) => handleCellMove(dir, ctrl, rowIdx, colIdx)} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground mt-2">Click the eye icon for a quick preview + notes without leaving the list. Click the firm name to open the full detail page. Any other cell edits in place. Arrow keys, Tab/Shift-Tab, Ctrl+Arrow to navigate. Drag column headers to reorder.</p>
      </>
      )}
    </div>
  );
}
