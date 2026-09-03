import { useMemo, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Download,
  Flag,
  GripVertical,
  Minus,
  RefreshCw,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useDeals, useUpdateDeal, useRescoreAllDeals, type Deal } from "@/hooks/useDeals";
import { ExportPipelineDialog } from "@/components/ExportPipelineDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CHART_HEX } from "@/lib/tier";
import { DealThumbnail } from "@/components/DealThumbnail";
import {
  HiddenDealsNotice,
  INACTIVE_STATUSES,
  SHOW_INACTIVE_PREF_KEY,
} from "@/components/HiddenDealsNotice";
import { useUserPreference } from "@/hooks/useUserPreference";
import {
  TIERS,
  getTier,
  COLUMN_LABELS,
  SCORE_HELP,
  type Tier,
} from "@/lib/dealStages";
import {
  DEAL_STATUSES,
  ACTIVE_STATUSES,
  PROGRESSION,
  DEAL_STATUS_HEX,
  BOARD_PRIMARY_STAGES,
  BOARD_ARCHIVE_STAGES,
  getStatus,
  type DealStatus,
} from "@/lib/dealStatus";

const ARCHIVE_PREF_KEY = "pipeline.board.archiveExpanded";


const TIER_HEX_LOCAL: Record<Tier, string> = {
  "Strong Fit": CHART_HEX.navy,
  Possible: "#B7791F",
  Pass: CHART_HEX.slate,
};

const STALE_DAYS = 14;

const axisProps = {
  tick: { fill: CHART_HEX.slate, fontSize: 11, fontFamily: "Inter" },
  tickLine: false,
  axisLine: { stroke: CHART_HEX.hairline },
} as const;

const tooltipProps = {
  contentStyle: {
    background: "#FFFFFF",
    border: `1px solid ${CHART_HEX.hairline}`,
    borderRadius: 6,
    fontSize: 12,
    fontFamily: "Inter",
    color: CHART_HEX.ink,
    boxShadow: "0 4px 12px rgba(16,24,40,0.08)",
  },
  cursor: { fill: "rgba(31,56,100,0.04)" },
} as const;

// ---------- helpers ----------
function rentLagPct(d: Deal): number | null {
  const payload = d.hellodata_payload as Record<string, unknown> | null;
  const inPlace = d.in_place_avg_rent;
  if (!payload || typeof inPlace !== "number") return null;
  const market =
    (payload.market_rent_per_unit as number | null) ??
    (payload.avg_market_rent as number | null) ??
    (payload.market_rent as number | null) ?? null;
  if (typeof market !== "number" || market <= 0) return null;
  return ((market - inPlace) / market) * 100;
}

interface HardFilters {
  rentLag: boolean | null;
  supply: boolean | null;
  populationGrowth: boolean | null;
  income: boolean | null;
}
function hardFilterChecks(d: Deal): HardFilters {
  const lag = rentLagPct(d);
  return {
    rentLag: lag == null ? null : lag >= 10,
    supply: d.new_supply_pct_of_stock == null ? null : d.new_supply_pct_of_stock < 5,
    populationGrowth: d.population_growth_pct == null ? null : d.population_growth_pct > 0,
    income: d.area_median_income_1mi == null ? null : d.area_median_income_1mi >= 45000,
  };
}
function passesAllHardFilters(d: Deal): boolean {
  return Object.values(hardFilterChecks(d)).every((v) => v === true);
}
function daysBetween(a: string | Date, b: string | Date): number {
  const da = typeof a === "string" ? new Date(a) : a;
  const db = typeof b === "string" ? new Date(b) : b;
  return Math.max(0, Math.floor((db.getTime() - da.getTime()) / 86_400_000));
}
function isMissingData(d: Deal): string | null {
  const missing: string[] = [];
  if (d.hellodata_status !== "fetched") missing.push("HelloData");
  if (d.population_growth_pct == null) missing.push("Population growth");
  if (d.area_median_income_1mi == null) missing.push(COLUMN_LABELS.area_median_income_1mi);
  if (d.in_place_avg_rent == null) missing.push("In-place rent");
  return missing.length ? missing.join(", ") : null;
}
function fmtPct(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

// ---------- page ----------
export default function PipelineDashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: deals, isLoading } = useDeals();
  const updateDeal = useUpdateDeal();
  const rescore = useRescoreAllDeals();


  const [marketFilter, setMarketFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState<"all" | DealStatus>("all");
  const [tierFilter, setTierFilter] = useState<"all" | Tier>("all");
  const [search, setSearch] = useState("");
  const [trendMode, setTrendMode] = useState<"weekly" | "monthly">("weekly");
  const [dragging, setDragging] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [dragOverStage, setDragOverStage] = useState<DealStatus | null>(null);
  const [showInactive, setShowInactive] = useUserPreference<boolean>(SHOW_INACTIVE_PREF_KEY, false);
  const [archiveExpanded, setArchiveExpanded] = useUserPreference<DealStatus[]>(ARCHIVE_PREF_KEY, []);
  const hoverExpandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleArchive = useCallback(
    (stage: DealStatus) => {
      setArchiveExpanded(
        archiveExpanded.includes(stage)
          ? archiveExpanded.filter((s) => s !== stage)
          : [...archiveExpanded, stage],
      );
    },
    [archiveExpanded, setArchiveExpanded],
  );

  /** Auto-expand a collapsed archive header after ~600ms of hover during drag. */
  const armHoverExpand = useCallback(
    (stage: DealStatus) => {
      if (archiveExpanded.includes(stage)) return;
      if (hoverExpandTimer.current) clearTimeout(hoverExpandTimer.current);
      hoverExpandTimer.current = setTimeout(() => {
        setArchiveExpanded((prev: DealStatus[]) =>
          prev.includes(stage) ? prev : [...prev, stage],
        );
      }, 600);
    },
    [archiveExpanded, setArchiveExpanded],
  );
  const cancelHoverExpand = useCallback(() => {
    if (hoverExpandTimer.current) {
      clearTimeout(hoverExpandTimer.current);
      hoverExpandTimer.current = null;
    }
  }, []);

  const markets = useMemo(() => {
    const set = new Set<string>();
    (deals ?? []).forEach((d) => d.msa && set.add(d.msa));
    return Array.from(set).sort();
  }, [deals]);

  const matchesBaseFilters = useCallback(
    (d: Deal) => {
      if (marketFilter !== "all" && d.msa !== marketFilter) return false;
      if (stageFilter !== "all" && getStatus(d) !== stageFilter) return false;
      if (tierFilter !== "all" && getTier(d) !== tierFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !d.property_name?.toLowerCase().includes(q) &&
          !d.city?.toLowerCase().includes(q) &&
          !d.msa?.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    },
    [marketFilter, stageFilter, tierFilter, search],
  );

  const filtered = useMemo(() => {
    return (deals ?? []).filter(
      (d) => matchesBaseFilters(d) && (showInactive || !INACTIVE_STATUSES.includes(d.status)),
    );
  }, [deals, matchesBaseFilters, showInactive]);

  // Rows this view is suppressing, surfaced inline (same rule as List View)
  const hiddenInactiveCount = useMemo(
    () =>
      (deals ?? []).filter((d) => INACTIVE_STATUSES.includes(d.status) && matchesBaseFilters(d))
        .length,
    [deals, matchesBaseFilters],
  );

  /** Kanban shows every matching deal, including archival columns, so cards can be dragged back out. */
  const kanbanDeals = useMemo(
    () => (deals ?? []).filter(matchesBaseFilters),
    [deals, matchesBaseFilters],
  );

  /** Summary charts + top-line metrics exclude Under Contract and Pass. */
  const chartDeals = useMemo(
    () => kanbanDeals.filter((d) => (ACTIVE_STATUSES as readonly string[]).includes(getStatus(d))),
    [kanbanDeals],
  );

  const kpis = useMemo(() => {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86_400_000);

    const active = chartDeals;
    const newThisWeek = filtered.filter((d) => new Date(d.created_at) >= oneWeekAgo).length;
    const newPrevWeek = filtered.filter((d) => {
      const c = new Date(d.created_at);
      return c >= twoWeeksAgo && c < oneWeekAgo;
    }).length;
    const passingHard = active.filter(passesAllHardFilters).length;
    const passingPct = active.length ? (passingHard / active.length) * 100 : 0;
    const daysInStage = active.map((d) => daysBetween(d.updated_at, now));
    const avgDays = daysInStage.length ? daysInStage.reduce((a, b) => a + b, 0) / daysInStage.length : 0;
    const closed = kanbanDeals.filter((d) => ["Under Contract", "Pass"].includes(getStatus(d)));
    const won = closed.filter((d) => getStatus(d) === "Under Contract").length;
    const winRate = closed.length ? (won / closed.length) * 100 : 0;

    return {
      active: active.length,
      newThisWeek,
      newPrevWeek,
      passingHard,
      passingPct,
      avgDays,
      winRate,
      closed: closed.length,
    };
  }, [filtered, chartDeals, kanbanDeals]);

  const byStage = useMemo(() => {
    const g = Object.fromEntries(DEAL_STATUSES.map((s) => [s, [] as Deal[]])) as Record<DealStatus, Deal[]>;
    kanbanDeals.forEach((d) => g[getStatus(d)].push(d));
    return g;
  }, [kanbanDeals]);

  /** Step conversion only across progressing columns; parked states are plain tiles. */
  const funnelData = useMemo(() => {
    return DEAL_STATUSES.map((s) => {
      const count = byStage[s].length;
      const pi = PROGRESSION.indexOf(s);
      let conversion: number | null = null;
      if (pi > 0) {
        const prev = byStage[PROGRESSION[pi - 1]].length;
        conversion = prev > 0 ? (count / prev) * 100 : null;
      }
      return { stage: s, count, conversion, progressing: pi >= 0 };
    });
  }, [byStage]);


  const tierDistribution = useMemo(() => {
    const counts: Record<Tier, number> = { "Strong Fit": 0, Possible: 0, Pass: 0 };
    chartDeals.forEach((d) => counts[getTier(d)]++);
    return TIERS.map((t) => ({ name: t, value: counts[t], color: TIER_HEX_LOCAL[t] }));
  }, [chartDeals]);

  const stateBars = useMemo(() => {
    const counts = new Map<string, number>();
    chartDeals.forEach((d) => {
      const k = (d.state ?? "").trim().toUpperCase() || "Unknown";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [chartDeals]);

  const marketBars = useMemo(() => {
    const counts = new Map<string, number>();
    chartDeals.forEach((d) => {
      const k = d.msa ?? d.state ?? "Unknown";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [chartDeals]);

  const sourceBars = useMemo(() => {
    const counts = new Map<string, number>();
    chartDeals.forEach((d) => {
      const k = d.source ?? "Unknown";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    return Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
  }, [chartDeals]);

  const actionQueue = useMemo(() => {
    const now = new Date();
    type Row = { deal: Deal; reason: string; severity: number };
    const rows: Row[] = [];
    filtered.forEach((d) => {
      if (!(ACTIVE_STATUSES as readonly string[]).includes(getStatus(d))) return;
      const stale = daysBetween(d.updated_at, now);
      if (stale >= STALE_DAYS) rows.push({ deal: d, reason: `Stale — no update in ${stale}d`, severity: 100 - stale });
      const missing = isMissingData(d);
      if (missing) rows.push({ deal: d, reason: `Missing: ${missing}`, severity: 50 });
      const stage = getStatus(d);
      if ((stage === "Screening" || stage === "Underwriting") && !d.assigned_to) {
        rows.push({ deal: d, reason: "Pending review — no owner assigned", severity: 60 });
      }
    });
    return rows.sort((a, b) => b.severity - a.severity).slice(0, 20);
  }, [filtered]);

  const handleDrop = useCallback(
    async (stage: DealStatus, dealId: string) => {
      setDragging(null);
      const deal = deals?.find((d) => d.id === dealId);
      if (!deal || getStatus(deal) === stage) return;
      queryClient.setQueryData<Deal[]>(["deals"], (old) =>
        old?.map((d) => (d.id === dealId ? { ...d, status: stage } : d)),
      );
      try {
        // Same mutation path as the Status dropdown in the Pipeline table.
        await updateDeal.mutateAsync({ id: dealId, status: stage });
        toast.success(`Moved to ${stage}`);
      } catch {
        toast.error("Failed to update status");
        queryClient.invalidateQueries({ queryKey: ["deals"] });
      }
    },
    [deals, queryClient, updateDeal],
  );

  /** Shared kanban card — used by both primary columns and expanded archive sections. */
  const renderCard = useCallback(
    (d: Deal, stage: DealStatus) => {
      const tier = getTier(d);
      return (
        <div
          key={d.id}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("text/plain", d.id);
            setDragging(d.id);
          }}
          onDragEnd={() => {
            setDragging(null);
            setDragOverStage(null);
            cancelHoverExpand();
          }}
          onClick={() => navigate(`/deals/${d.id}`)}
          className={cn(
            "bg-card border border-hairline rounded-sm cursor-grab active:cursor-grabbing hover:border-primary/40 transition-colors overflow-hidden",
            dragging === d.id && "opacity-50",
          )}
          style={{ borderLeftWidth: 3, borderLeftColor: DEAL_STATUS_HEX[stage] }}
        >
          <div className="flex items-start gap-2 p-1.5">
            <GripVertical className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div
                className="text-xs font-semibold text-foreground line-clamp-2 leading-snug"
                title={d.property_name ?? undefined}
              >
                {d.property_name}
              </div>
              <div className="text-[10px] text-muted-foreground truncate">
                {[d.city, d.state].filter(Boolean).join(", ") || d.msa || "—"}
              </div>
              <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                <Badge variant="outline" className="text-[9px] py-0 px-1 h-4 tabular-nums border-hairline">
                  {d.unit_count ?? "—"}u
                </Badge>
                <Badge
                  variant="outline"
                  className="text-[9px] py-0 px-1 h-4"
                  style={{ borderColor: TIER_HEX_LOCAL[tier], color: TIER_HEX_LOCAL[tier] }}
                >
                  {tier}
                </Badge>
                <Badge
                  variant="outline"
                  className="text-[9px] py-0 px-1 h-4 font-semibold"
                  style={{ borderColor: DEAL_STATUS_HEX[stage], color: DEAL_STATUS_HEX[stage], backgroundColor: `${DEAL_STATUS_HEX[stage]}12` }}
                >
                  {stage}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-1 mt-1.5 pb-0.5">
                <button
                  onClick={(e) => { e.stopPropagation(); handleDrop("Under Contract", d.id); }}
                  className="text-[9px] font-semibold px-1.5 py-0.5 rounded-sm border transition-colors hover:opacity-80"
                  style={{ borderColor: DEAL_STATUS_HEX["Under Contract"], color: DEAL_STATUS_HEX["Under Contract"], backgroundColor: `${DEAL_STATUS_HEX["Under Contract"]}12` }}
                >
                  Under Contract
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDrop("Pass", d.id); }}
                  className="text-[9px] font-semibold px-1.5 py-0.5 rounded-sm border transition-colors hover:opacity-80"
                  style={{ borderColor: DEAL_STATUS_HEX.Pass, color: DEAL_STATUS_HEX.Pass, backgroundColor: `${DEAL_STATUS_HEX.Pass}12` }}
                >
                  Pass
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    },
    [dragging, handleDrop, navigate, cancelHoverExpand],
  );


  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="surface-card h-28 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <SectionHeader
        title="Pipeline Dashboard"
        subtitle={`Live view · ${filtered.length} of ${deals?.length ?? 0} deals`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search property…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-[180px] border-hairline"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-hairline"
              onClick={() => setExportOpen(true)}
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Export Pipeline
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-hairline"
              disabled={rescore.isPending}
              onClick={() => {
                rescore.mutate(undefined, {
                  onSuccess: ({ scored, tierCounts }) => {
                    const strong = tierCounts["Tier 1 – Strong Fit"] ?? 0;
                    const fit = tierCounts["Tier 2 – Fit"] ?? 0;
                    toast.success(`Rescored ${scored} deals · ${strong} strong, ${fit} fit`);
                  },
                  onError: (e: unknown) => {
                    toast.error("Rescore failed: " + (e instanceof Error ? e.message : String(e)));
                  },
                });
              }}
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", rescore.isPending && "animate-spin")} />
              Rescore all
            </Button>
            <Select value={marketFilter} onValueChange={setMarketFilter}>
              <SelectTrigger className="h-9 w-[160px] border-hairline"><SelectValue placeholder="Market" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All markets</SelectItem>
                {markets.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={stageFilter} onValueChange={(v) => setStageFilter(v as any)}>
              <SelectTrigger className="h-9 w-[140px] border-hairline"><SelectValue placeholder="Stage" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stages</SelectItem>
                {DEAL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={tierFilter} onValueChange={(v) => setTierFilter(v as any)}>
              <SelectTrigger className="h-9 w-[140px] border-hairline"><SelectValue placeholder="Buy Box Tier" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Buy Box tiers</SelectItem>
                {TIERS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        }
      />

      <ExportPipelineDialog open={exportOpen} onOpenChange={setExportOpen} deals={filtered} />

      <HiddenDealsNotice
        hiddenCount={hiddenInactiveCount}
        showInactive={showInactive}
        onToggle={setShowInactive}
      />



      {/* KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard label="Active deals" value={kpis.active} prior={null} emphasis />
        <KpiCard label="New this week" value={kpis.newThisWeek} prior={kpis.newPrevWeek} />
        <KpiCard label="Passing hard filters" value={kpis.passingHard} prior={null} sub={`${fmtPct(kpis.passingPct)} of active`} />
        <KpiCard label="Avg days in stage" value={kpis.avgDays} prior={null} format="decimal" suffix="d" />
        <KpiCard label="Win rate" value={kpis.winRate} prior={null} format="pct" sub={`${kpis.closed} closed`} />
      </div>

      {/* Funnel */}
      <div>
        <SubsectionHeader title="Funnel" subtitle="Stage volumes & step conversion" />
        <div className="surface-card p-5 mt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">

            {funnelData.map((f) => (
              <div key={f.stage} className="space-y-2">
                <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
                  {f.stage}
                </div>
                <div
                  className="rounded-sm px-3 py-3 text-white"
                  style={{ background: CHART_HEX.navy }}
                >
                  <div className="font-serif-display text-[28px] font-medium leading-none tabular-nums">
                    {f.count}
                  </div>
                </div>
                {f.progressing && (
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {f.conversion == null ? "—" : `${f.conversion.toFixed(0)}% step →`}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Kanban */}
      <div>
        <SubsectionHeader title="Kanban" subtitle="Drag to change status" />
        <div className="surface-card p-4 mt-4">
          {/* Primary row — the five working stages share full width evenly. */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {BOARD_PRIMARY_STAGES.map((stage) => (
              <div
                key={stage}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain");
                  if (id) handleDrop(stage, id);
                }}
                className="bg-muted/30 rounded-sm border border-hairline min-h-[280px] flex flex-col"
              >
                <div
                  className="text-[10px] uppercase tracking-[0.12em] text-white font-semibold px-2.5 py-1.5 rounded-t-sm flex items-center justify-between"
                  style={{ background: CHART_HEX.navy }}
                >
                  <span>{stage}</span>
                  <span className="font-serif-display text-[13px] tabular-nums font-medium">
                    {byStage[stage].length}
                  </span>
                </div>
                <div className="p-2 space-y-2 flex-1 overflow-y-auto max-h-[420px]">
                  {byStage[stage].map((d) => renderCard(d, stage))}
                  {byStage[stage].length === 0 && (
                    <div className="text-[11px] text-muted-foreground text-center py-6">Empty</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Archive row — collapsed by default, but still a drop target. */}
          <div className="mt-4 pt-3 border-t border-hairline space-y-2">
            {BOARD_ARCHIVE_STAGES.map((stage) => {
              const expanded = archiveExpanded.includes(stage);
              const stageDeals = byStage[stage];
              return (
                <div key={stage}>
                  <button
                    type="button"
                    onClick={() => toggleArchive(stage)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverStage(stage);
                      armHoverExpand(stage);
                    }}
                    onDragLeave={() => {
                      setDragOverStage((s) => (s === stage ? null : s));
                      cancelHoverExpand();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverStage(null);
                      cancelHoverExpand();
                      const id = e.dataTransfer.getData("text/plain");
                      if (id) handleDrop(stage, id);
                    }}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 rounded-sm border border-hairline bg-muted/30 hover:bg-muted/50 transition-colors text-left",
                      dragOverStage === stage && "ring-2 ring-primary/50 border-primary/40",
                    )}
                  >
                    {expanded ? (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span
                      className="h-2 w-2 rounded-sm shrink-0"
                      style={{ background: DEAL_STATUS_HEX[stage] }}
                    />
                    <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-foreground">
                      {stage}
                    </span>
                    <span className="font-serif-display text-[13px] tabular-nums font-medium text-muted-foreground">
                      ({stageDeals.length})
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {expanded ? "Collapse" : "Expand"}
                    </span>
                  </button>
                  {expanded && (
                    <div className="mt-2 max-h-[420px] overflow-y-auto rounded-sm border border-hairline bg-muted/20 p-2">
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                        {stageDeals.map((d) => renderCard(d, stage))}
                      </div>
                      {stageDeals.length === 0 && (
                        <div className="text-[11px] text-muted-foreground text-center py-6">Empty</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>





      {/* Buy Box Tier + Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Buy Box Tiers" subtitle="Click legend to filter">
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={tierDistribution}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={45}
                  outerRadius={70}
                  onClick={(d: any) => setTierFilter(d.name as Tier)}
                  cursor="pointer"
                >
                  {tierDistribution.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip {...tooltipProps} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-1 px-1">
            {tierDistribution.map((t) => (
              <button
                key={t.name}
                onClick={() => setTierFilter(t.name as Tier)}
                className={cn(
                  "flex items-center gap-2 text-xs px-2 py-1 rounded-sm hover:bg-muted/50 transition-colors",
                  tierFilter === t.name && "bg-muted",
                )}
              >
                <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: t.color }} />
                <span className="text-foreground font-medium">{t.name}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">
                  <span className="font-serif-display text-[15px] text-foreground font-medium">{t.value}</span>
                </span>
              </button>
            ))}
            {tierFilter !== "all" && (
              <button
                onClick={() => setTierFilter("all")}
                className="text-[11px] text-muted-foreground underline w-full text-center mt-1"
              >
                Clear tier filter
              </button>
            )}
          </div>
        </ChartCard>

        <ChartCard
          className="lg:col-span-2"
          title="New Deals by State"
          subtitle={`${stateBars.length} state${stateBars.length === 1 ? "" : "s"}`}
        >
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stateBars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_HEX.gridline} vertical={false} />
                <XAxis dataKey="name" {...axisProps} />
                <YAxis {...axisProps} />
                <Tooltip {...tooltipProps} />
                <Bar dataKey="count" fill={CHART_HEX.navy} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* Markets + Sources */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Deals by Market" subtitle="Top 8 MSAs">
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={marketBars} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_HEX.gridline} horizontal={false} />
                <XAxis type="number" {...axisProps} />
                <YAxis type="category" dataKey="name" width={110} {...axisProps} />
                <Tooltip {...tooltipProps} />
                <Bar dataKey="count" fill={CHART_HEX.navy} radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Deals by Source" subtitle="Broker, referral, direct, etc.">
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sourceBars} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_HEX.gridline} vertical={false} />
                <XAxis dataKey="name" {...axisProps} />
                <YAxis {...axisProps} />
                <Tooltip {...tooltipProps} />
                <Bar dataKey="count" fill={CHART_HEX.bronze} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* Hard filter audit */}
      <div>
        <SubsectionHeader title="Hard Filter Audit" subtitle={`${filtered.length} deals`} />
        <div className="surface-card mt-4 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold border-b border-hairline">
                <tr>
                  <th className="text-left px-4 py-3">Property</th>
                  <th className="text-left px-4 py-3" title={SCORE_HELP.deal_tier}>Buy Box Tier</th>
                  <th className="text-center px-4 py-3">Rent ≥10% lag</th>
                  <th className="text-center px-4 py-3">Supply &lt;5%</th>
                  <th className="text-center px-4 py-3">Pop Growth</th>
                  <th className="text-center px-4 py-3">1-mi Median Income ≥$45K</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 25).map((d) => {
                  const c = hardFilterChecks(d);
                  const tier = getTier(d);
                  return (
                    <tr
                      key={d.id}
                      onClick={() => navigate(`/deals/${d.id}`)}
                      className="border-b border-hairline last:border-0 hover:bg-muted/40 cursor-pointer"
                    >
                      <td className="px-4 py-2.5 font-medium text-foreground">{d.property_name}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" style={{ borderColor: TIER_HEX_LOCAL[tier], color: TIER_HEX_LOCAL[tier] }}>
                          {tier}
                        </Badge>
                      </td>
                      <FilterCell ok={c.rentLag} />
                      <FilterCell ok={c.supply} />
                      <FilterCell ok={c.populationGrowth} />
                      <FilterCell ok={c.income} />
                    </tr>
                  );
                })}
                {filtered.length > 25 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-3 text-center text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      Showing 25 of {filtered.length} · use filters to narrow
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Action queue */}
      <div>
        <SubsectionHeader
          title="Action Queue"
          subtitle={`${actionQueue.length} flagged`}
          right={<AlertTriangle className="h-4 w-4 text-tier-medium-fg" strokeWidth={1.75} />}
        />
        <div className="surface-card mt-4 overflow-hidden">
          {actionQueue.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-10">
              Nothing flagged. Pipeline is clean.
            </div>
          ) : (
            <div className="divide-y divide-hairline">
              {actionQueue.map((row, i) => {
                const icon = row.reason.startsWith("Stale") ? (
                  <Clock className="h-3.5 w-3.5 text-tier-medium-fg" strokeWidth={1.75} />
                ) : row.reason.startsWith("Missing") ? (
                  <Database className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} />
                ) : (
                  <Flag className="h-3.5 w-3.5 text-destructive" strokeWidth={1.75} />
                );
                return (
                  <button
                    key={`${row.deal.id}-${i}`}
                    onClick={() => navigate(`/deals/${row.deal.id}`)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 text-left"
                  >
                    {icon}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">{row.deal.property_name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{row.reason}</div>
                    </div>
                    <Badge variant="outline" className="text-[10px] border-hairline">{getStatus(row.deal)}</Badge>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Subcomponents ----------------------------- */

function SectionHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">{title}</h1>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1 uppercase tracking-[0.12em] font-medium">
            {subtitle}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}

function SubsectionHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between border-b border-hairline pb-2">
      <div>
        <h2 className="font-display text-base font-semibold text-foreground">{title}</h2>
        {subtitle && (
          <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-[0.12em] font-medium">
            {subtitle}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}

function KpiCard({
  label,
  value,
  prior,
  sub,
  emphasis,
  format = "int",
  suffix,
}: {
  label: string;
  value: number | null;
  prior: number | null;
  sub?: string;
  emphasis?: boolean;
  format?: "int" | "pct" | "decimal";
  suffix?: string;
}) {
  const display =
    value == null
      ? "—"
      : format === "pct"
      ? `${value.toFixed(0)}%`
      : format === "decimal"
      ? value.toFixed(1)
      : value.toLocaleString();

  let delta: number | null = null;
  let pct: number | null = null;
  if (value != null && prior != null) {
    delta = value - prior;
    if (prior !== 0) pct = (delta / prior) * 100;
  }
  const positive = delta != null && delta > 0;
  const negative = delta != null && delta < 0;
  const Arrow = delta == null || delta === 0 ? Minus : positive ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="surface-card p-5">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
        {label}
      </div>
      <div
        className={cn(
          "mt-3 font-serif-display font-medium leading-none tabular-nums text-[40px]",
          emphasis ? "text-primary" : "text-foreground",
        )}
      >
        {display}
        {suffix && <span className="text-[20px] text-muted-foreground ml-1">{suffix}</span>}
      </div>
      {delta != null ? (
        <div className="mt-3 flex items-center gap-1.5 text-xs">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-medium tabular-nums",
              positive && "text-tier-strong-fg bg-tier-strong-bg",
              negative && "text-destructive bg-destructive/10",
              !positive && !negative && "text-muted-foreground bg-muted",
            )}
          >
            <Arrow className="h-3 w-3" strokeWidth={2} />
            {pct != null ? `${Math.abs(pct).toFixed(0)}%` : Math.abs(delta).toLocaleString()}
          </span>
          <span className="text-muted-foreground">vs. prior wk</span>
        </div>
      ) : sub ? (
        <div className="mt-3 text-[11px] text-muted-foreground tabular-nums">{sub}</div>
      ) : null}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  className,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("surface-card p-5", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-[15px] font-semibold text-foreground">{title}</h3>
          {subtitle && (
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-medium mt-1">
              {subtitle}
            </p>
          )}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function FilterCell({ ok }: { ok: boolean | null }) {
  if (ok === null) {
    return <td className="px-4 py-2.5 text-center text-muted-foreground text-xs">—</td>;
  }
  return (
    <td className="px-4 py-2.5 text-center">
      {ok ? (
        <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-tier-strong-bg text-tier-strong-fg text-xs font-semibold">
          ✓
        </span>
      ) : (
        <Flag className="h-3.5 w-3.5 text-destructive inline" strokeWidth={2} />
      )}
    </td>
  );
}
