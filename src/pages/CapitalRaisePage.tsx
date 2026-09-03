import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, TrendingUp, Users, Target, Wallet, CircleDot, Gauge, AlertCircle, Archive, RotateCcw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRestoreRaise } from "@/hooks/useCapitalRaise";


const fmtUSD = (n: number | null | undefined, compact = false) => {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    notation: compact ? "compact" : "standard",
  }).format(n);
};

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

function csvEscape(v: any) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCSV(filename: string, rows: (string | number | null)[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type RaisingDealRow = {
  id: string;
  property_name: string;
  city: string | null;
  state: string | null;
  unit_count: number | null;
  target_raise: number | null;
  committed: number;
  softCircled: number;
  engaged: number;
  serious: number;
  passed: number;
  earliestReachout: string | null;
  raise_archived_at?: string | null;
  raise_archived_by?: string | null;
  raise_archive_note?: string | null;
};

const DEAL_SELECT =
  "id, property_name, city, state, unit_count, target_raise, total_committed, raise_status, created_at";


// Coverage color tier: green ≥100, amber ≥50, red below
function coverageTier(pct: number | null): "green" | "amber" | "red" | "none" {
  if (pct == null) return "none";
  if (pct >= 100) return "green";
  if (pct >= 50) return "amber";
  return "red";
}

const tierText: Record<string, string> = {
  green: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-red-600 dark:text-red-400",
  none: "text-muted-foreground",
};

const tierBar: Record<string, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  none: "bg-muted-foreground/40",
};

function KpiTile({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  valueClassName,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: any;
  accent?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-start text-center px-3 py-5 border-r border-hairline last:border-r-0 min-w-0">
      <div className="flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold whitespace-nowrap">
        <Icon className="h-3 w-3 shrink-0" strokeWidth={2.25} />
        <span>{label}</span>
      </div>
      <div
        className={`mt-2 font-display font-semibold tabular-nums leading-none ${
          valueClassName ?? (accent ? "text-primary text-2xl" : "text-foreground text-2xl")
        }`}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11px] text-muted-foreground tabular-nums min-h-[16px] px-1 truncate max-w-full">
        {sub ?? ""}
      </div>
    </div>
  );
}

function CoverageBar({ pct }: { pct: number | null }) {
  const tier = coverageTier(pct);
  const clamped = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  return (
    <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
      <div
        className={`h-full ${tierBar[tier]} transition-all`}
        style={{ width: `${clamped}%` }}
        aria-label={pct == null ? "No target" : `${clamped.toFixed(0)}% covered`}
      />
    </div>
  );
}

const VIEW_KEY = "capital-raise-view";

export default function CapitalRaisePage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [priceOnly, setPriceOnly] = useState(false);
  const restoreRaise = useRestoreRaise();
  const [view, setView] = useState<"active" | "archived">(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "archived" ? "archived" : "active";
    } catch {
      return "active";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {}
  }, [view]);
  const archivedView = view === "archived";

  const { data: deals, isLoading: dealsLoading } = useQuery({
    queryKey: ["capital-raise-page", "deals-raising"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("deals")
        .select(DEAL_SELECT)
        .eq("raise_status", "raising")
        .is("raise_archived_at", null);
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: archivedDeals, isLoading: archivedLoading } = useQuery({
    queryKey: ["capital-raise-page", "deals-archived"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("deals")
        .select(`${DEAL_SELECT}, raise_archived_at, raise_archived_by, raise_archive_note`)
        .not("raise_archived_at", "is", null)
        .order("raise_archived_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });


  const { data: engagements, isLoading: engLoading } = useQuery({
    queryKey: ["capital-raise-page", "engagements-all"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("capital_raise_engagements")
        .select(
          "id, deal_id, partner_id, stage, serious_interest, passed, pass_price_surmountable, pass_feedback, indicated_amount, committed_amount, initial_reachout_date, last_contact_date, partners(name), deals(property_name)"
        );
      if (error) throw error;
      return data as any[];
    },
  });

  const buildRows = useMemo(() => {
    return (source: any[] | undefined, applySearch = true): RaisingDealRow[] => {
      if (!source || !engagements) return [];
      return source
        .map((d) => {
          const engs = engagements.filter((e) => e.deal_id === d.id);
          const earliest = engs.reduce<string | null>((acc, e) => {
            if (!e.initial_reachout_date) return acc;
            if (!acc || e.initial_reachout_date < acc) return e.initial_reachout_date;
            return acc;
          }, null);
          const engCommitted = engs.reduce((s, e) => s + (Number(e.committed_amount) || 0), 0);
          const committed = engCommitted > 0 ? engCommitted : Number(d.total_committed) || 0;
          const softCircled = engs
            .filter((e) => !e.passed && !(Number(e.committed_amount) > 0))
            .reduce((s, e) => s + (Number(e.indicated_amount) || 0), 0);
          return {
            id: d.id,
            property_name: d.property_name,
            city: d.city,
            state: d.state,
            unit_count: d.unit_count,
            target_raise: d.target_raise,
            committed,
            softCircled,
            engaged: engs.length,
            serious: engs.filter((e) => e.serious_interest || e.stage === "serious_interest").length,
            passed: engs.filter((e) => e.passed || e.stage === "passed").length,
            earliestReachout: earliest,
            raise_archived_at: d.raise_archived_at ?? null,
            raise_archived_by: d.raise_archived_by ?? null,
            raise_archive_note: d.raise_archive_note ?? null,
          };
        })
        .filter((r) => !applySearch || r.property_name.toLowerCase().includes(search.toLowerCase()));
    };
  }, [engagements, search]);

  const rows: RaisingDealRow[] = useMemo(() => buildRows(deals), [buildRows, deals]);
  const archivedRows: RaisingDealRow[] = useMemo(() => buildRows(archivedDeals), [buildRows, archivedDeals]);

  const coverageOf = (r: RaisingDealRow) =>
    r.target_raise && r.target_raise > 0 ? ((r.softCircled + r.committed) / r.target_raise) * 100 : null;

  // Archived topline — deliberately separate from the active KPI strip.
  const archivedPortfolio = useMemo(() => {
    const all = buildRows(archivedDeals, false);
    const covs = all.map(coverageOf).filter((c): c is number => c != null);
    return {
      count: (archivedDeals ?? []).length,
      totalTarget: all.reduce((s, r) => s + (Number(r.target_raise) || 0), 0),
      totalCommitted: all.reduce((s, r) => s + r.committed, 0),
      avgCoverage: covs.length ? covs.reduce((s, c) => s + c, 0) / covs.length : null,
    };
  }, [buildRows, archivedDeals]);


  // Portfolio KPIs (across all raising deals, ignore search filter for topline)
  const portfolio = useMemo(() => {
    if (!deals || !engagements) return null;
    const dealIds = new Set(deals.map((d) => d.id));
    const relevantEngs = engagements.filter((e) => dealIds.has(e.deal_id));
    const totalTarget = deals.reduce((s, d) => s + (Number(d.target_raise) || 0), 0);
    const dealsWithTarget = deals.filter((d) => Number(d.target_raise) > 0).length;

    // Portfolio committed: per-deal (sum engagements else fallback to total_committed)
    let totalCommitted = 0;
    let totalSoftCircled = 0;
    const partnersSoftCircled = new Set<string>();
    for (const d of deals) {
      const engs = relevantEngs.filter((e) => e.deal_id === d.id);
      const engCommitted = engs.reduce((s, e) => s + (Number(e.committed_amount) || 0), 0);
      totalCommitted += engCommitted > 0 ? engCommitted : Number(d.total_committed) || 0;
      for (const e of engs) {
        if (!e.passed && !(Number(e.committed_amount) > 0)) {
          const amt = Number(e.indicated_amount) || 0;
          if (amt > 0) {
            totalSoftCircled += amt;
            if (e.partner_id) partnersSoftCircled.add(e.partner_id);
          }
        }
      }
    }

    const uniquePartners = new Set(relevantEngs.map((e) => e.partner_id)).size;
    const serious = relevantEngs.filter((e) => e.serious_interest || e.stage === "serious_interest").length;
    const reApproach = relevantEngs.filter((e) => e.passed && e.pass_price_surmountable).length;
    const coveragePct = totalTarget > 0 ? ((totalSoftCircled + totalCommitted) / totalTarget) * 100 : null;

    return {
      dealsRaising: deals.length,
      dealsWithTarget,
      totalTarget,
      totalCommitted,
      totalSoftCircled,
      lpsIndicated: partnersSoftCircled.size,
      pctCommitted: totalTarget > 0 ? (totalCommitted / totalTarget) * 100 : 0,
      coveragePct,
      lpsEngaged: uniquePartners,
      serious,
      reApproach,
    };
  }, [deals, engagements]);

  // Re-approach targets must be live: a partner who passed on a raise that has
  // since been archived is not someone to call back about that deal.
  const archivedDealIds = useMemo(
    () => new Set((archivedDeals ?? []).map((d) => d.id)),
    [archivedDeals],
  );
  const passedOnPrice = useMemo(() => {
    if (!engagements) return [];
    return engagements.filter(
      (e) => e.passed === true && e.pass_price_surmountable === true && !archivedDealIds.has(e.deal_id),
    );
  }, [engagements, archivedDealIds]);


  const daysSince = (d: string | null) => {
    if (!d) return null;
    return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000));
  };

  const exportDeals = () => {
    const header = [
      "Deal",
      "Location",
      "Units",
      "Target Raise",
      "Soft-Circled",
      "Committed",
      "Coverage %",
      "# Engaged",
      "# Serious",
      "# Passed",
      "Days in Raise",
      ...(archivedView ? ["Archived Date", "Archived By", "Note"] : []),
    ];
    const source = archivedView ? archivedRows : rows;
    const body = source.map((r) => {
      const cov = r.target_raise && r.target_raise > 0
        ? (((r.softCircled + r.committed) / r.target_raise) * 100).toFixed(1) + "%"
        : "";
      return [
        r.property_name,
        [r.city, r.state].filter(Boolean).join(", "),
        r.unit_count ?? "",
        r.target_raise ?? "",
        r.softCircled || "",
        r.committed || "",
        cov,
        r.engaged,
        r.serious,
        r.passed,
        daysSince(r.earliestReachout) ?? "",
        ...(archivedView
          ? [
              r.raise_archived_at ? new Date(r.raise_archived_at).toISOString().slice(0, 10) : "",
              r.raise_archived_by ?? "",
              r.raise_archive_note ?? "",
            ]
          : []),
      ];
    });
    const name = archivedView ? "capital-raise-archived" : "capital-raise";
    downloadCSV(`${name}-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...body]);
  };


  const exportPriceOnly = () => {
    const header = ["Deal", "Partner", "Indicated Amount", "Pass Feedback", "Last Contact"];
    const body = passedOnPrice.map((e) => [
      e.deals?.property_name ?? "",
      e.partners?.name ?? "",
      e.indicated_amount ?? "",
      e.pass_feedback ?? "",
      e.last_contact_date ?? "",
    ]);
    downloadCSV(`re-approach-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...body]);
  };

  const loading = (archivedView ? archivedLoading : dealsLoading) || engLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground font-semibold">
            Capital Formation
          </div>
          <h1 className="mt-1 text-3xl font-display font-semibold tracking-tight text-foreground">
            Capital Raise
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Portfolio-wide equity raise across active investments
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex h-9 items-center rounded-md border border-hairline bg-card p-0.5">
            {(["active", "archived"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`h-8 rounded-[5px] px-3 text-xs font-medium transition-colors ${
                  view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {v === "active" ? "Active" : `Archived (${(archivedDeals ?? []).length})`}
              </button>
            ))}
          </div>
          <Input
            placeholder="Search deals…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-[220px] h-9"
          />
          {!archivedView && (
            <div className="flex items-center gap-2 border border-hairline rounded-md px-3 h-9 bg-card">
              <Switch id="price-only" checked={priceOnly} onCheckedChange={setPriceOnly} />
              <Label htmlFor="price-only" className="text-xs cursor-pointer whitespace-nowrap">
                Re-approach list
              </Label>
            </div>
          )}

          <Button variant="outline" size="sm" className="h-9" onClick={priceOnly && !archivedView ? exportPriceOnly : exportDeals}>
            <Download className="h-4 w-4 mr-1.5" /> Export
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      {archivedView ? (
        archivedLoading || engLoading ? (
          <Skeleton className="h-[104px] w-full" />
        ) : (
          <Card className="overflow-hidden">
            <div className="grid grid-cols-2 lg:grid-cols-4">
              <KpiTile label="Raises Archived" value={String(archivedPortfolio.count)} sub="read-only" icon={Archive} />
              <KpiTile label="Total Target" value={fmtUSD(archivedPortfolio.totalTarget, true)} sub="archived raises" icon={Target} />
              <KpiTile label="Total Committed" value={fmtUSD(archivedPortfolio.totalCommitted, true)} sub="archived raises" icon={Wallet} />
              <KpiTile
                label="Avg Final Coverage"
                value={archivedPortfolio.avgCoverage == null ? "—" : `${archivedPortfolio.avgCoverage.toFixed(0)}%`}
                sub="pipeline ÷ target"
                icon={Gauge}
              />
            </div>
          </Card>
        )
      ) : loading || !portfolio ? (
        <Skeleton className="h-[104px] w-full" />
      ) : (

        <Card className="overflow-hidden">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            <KpiTile
              label="Deals Raising"
              value={String(portfolio.dealsRaising)}
              sub={`${portfolio.lpsEngaged} LPs engaged`}
              icon={TrendingUp}
            />
            <KpiTile
              label="Aggregate Target"
              value={fmtUSD(portfolio.totalTarget, true)}
              sub={
                portfolio.dealsWithTarget === 0
                  ? "No targets set"
                  : `${portfolio.dealsWithTarget} of ${portfolio.dealsRaising} deals set`
              }
              icon={Target}
            />
            <KpiTile
              label="Soft-Circled"
              value={fmtUSD(portfolio.totalSoftCircled, true)}
              sub={`${portfolio.lpsIndicated} LPs indicated`}
              icon={CircleDot}
              accent
            />
            <KpiTile
              label="Committed"
              value={fmtUSD(portfolio.totalCommitted, true)}
              sub={
                portfolio.totalTarget > 0
                  ? `${portfolio.pctCommitted.toFixed(1)}% of target`
                  : "No target set"
              }
              icon={Wallet}
            />
            <KpiTile
              label="Coverage"
              value={portfolio.coveragePct == null ? "—" : `${portfolio.coveragePct.toFixed(0)}%`}
              sub="pipeline ÷ target"
              icon={Gauge}
              valueClassName={`text-2xl font-display font-semibold tabular-nums leading-none ${tierText[coverageTier(portfolio.coveragePct)]}`}
            />
            <KpiTile
              label="Serious Interest"
              value={String(portfolio.serious)}
              sub={`${portfolio.reApproach} to re-approach`}
              icon={Users}
            />
          </div>
          {portfolio.totalTarget > 0 && portfolio.coveragePct != null && (
            <div className="px-6 pb-5 pt-1 border-t border-hairline">
              <CoverageBar pct={portfolio.coveragePct} />
            </div>
          )}
        </Card>
      )}

      {/* Table */}
      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : archivedView ? (
        <Card>
          <CardContent className="p-0">
            <div className="px-5 py-3 border-b border-hairline flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
                Archived Raises
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {archivedRows.length} {archivedRows.length === 1 ? "raise" : "raises"}
              </div>
            </div>
            {archivedRows.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No archived raises. Archive a raise from its Capital Raise tab when it closes.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm table-fixed">
                  <colgroup>
                    <col className="w-[24%]" />
                    <col className="w-[11%]" />
                    <col className="w-[11%]" />
                    <col className="w-[11%]" />
                    <col className="w-[16%]" />
                    <col className="w-[8%]" />
                    <col className="w-[11%]" />
                    <col className="w-[8%]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-hairline bg-muted/20 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      <th className="text-center px-5 py-3 font-semibold whitespace-nowrap">Investment</th>
                      <th className="text-center px-3 py-3 font-semibold whitespace-nowrap">Target</th>
                      <th className="text-center px-3 py-3 font-semibold whitespace-nowrap">Soft-Circled</th>
                      <th className="text-center px-3 py-3 font-semibold whitespace-nowrap">Committed</th>
                      <th className="text-center px-3 py-3 font-semibold whitespace-nowrap">Final Coverage</th>
                      <th className="text-center px-2 py-3 font-semibold whitespace-nowrap">Engaged</th>
                      <th className="text-center px-3 py-3 font-semibold whitespace-nowrap">Archived</th>
                      <th className="text-right px-4 py-3 font-semibold whitespace-nowrap"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {archivedRows.map((r) => {
                      const coverage = coverageOf(r);
                      const location = [r.city, r.state].filter(Boolean).join(", ");
                      return (
                        <tr
                          key={r.id}
                          className="border-b border-hairline last:border-b-0 hover:bg-muted/20 transition-colors cursor-pointer"
                          onClick={() => navigate(`/deals/${r.id}`)}
                        >
                          <td className="px-5 py-4 align-middle text-center">
                            <div className="font-semibold text-muted-foreground truncate">{r.property_name}</div>
                            <div className="text-xs text-muted-foreground/80 mt-0.5 tabular-nums truncate">
                              {location || "—"}
                              {r.unit_count ? ` · ${r.unit_count} units` : ""}
                            </div>
                          </td>
                          <td className="px-3 py-4 text-center font-mono tabular-nums text-muted-foreground align-middle">
                            {r.target_raise ? fmtUSD(r.target_raise, true) : "—"}
                          </td>
                          <td className="px-3 py-4 text-center font-mono tabular-nums text-muted-foreground align-middle">
                            {r.softCircled > 0 ? fmtUSD(r.softCircled, true) : "—"}
                          </td>
                          <td className="px-3 py-4 text-center font-mono tabular-nums text-muted-foreground align-middle">
                            {r.committed > 0 ? fmtUSD(r.committed, true) : "—"}
                          </td>
                          <td className="px-3 py-4 align-middle">
                            {coverage != null ? (
                              <div className="space-y-1.5 opacity-70">
                                <CoverageBar pct={coverage} />
                                <div className={`text-[11px] tabular-nums text-center ${tierText[coverageTier(coverage)]}`}>
                                  {coverage.toFixed(0)}% covered
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground block text-center">No target</span>
                            )}
                          </td>
                          <td className="px-2 py-4 text-center tabular-nums text-muted-foreground align-middle">
                            {r.engaged}
                          </td>
                          <td className="px-3 py-4 text-center text-xs text-muted-foreground align-middle">
                            <div className="tabular-nums">{fmtDate(r.raise_archived_at ?? null)}</div>
                            {r.raise_archived_by && (
                              <div className="truncate text-muted-foreground/80">{r.raise_archived_by}</div>
                            )}
                          </td>
                          <td className="px-4 py-4 text-right align-middle">
                            <div
                              className="inline-flex items-center gap-1 justify-end"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {r.raise_archive_note && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground">
                                        <Info className="h-3.5 w-3.5" />
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs text-xs">
                                      {r.raise_archive_note}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1"
                                disabled={restoreRaise.isPending}
                                onClick={() => restoreRaise.mutate({ dealId: r.id })}
                              >
                                <RotateCcw className="h-3.5 w-3.5" /> Restore
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : priceOnly ? (

        <Card>
          <CardContent className="p-0">
            <div className="px-5 py-4 border-b border-hairline bg-muted/30 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-semibold text-foreground">Re-approach list</p>
                <p className="text-xs text-muted-foreground">
                  Partners who passed but flagged price as surmountable ({passedOnPrice.length})
                </p>
              </div>
            </div>
            {passedOnPrice.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">No qualifying engagements.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline bg-muted/20">
                    <th className="text-center px-5 py-3 font-semibold text-muted-foreground text-[10px] uppercase tracking-[0.12em]">Deal</th>
                    <th className="text-center px-5 py-3 font-semibold text-muted-foreground text-[10px] uppercase tracking-[0.12em]">Partner</th>
                    <th className="text-center px-5 py-3 font-semibold text-muted-foreground text-[10px] uppercase tracking-[0.12em]">Indicated</th>
                    <th className="text-center px-5 py-3 font-semibold text-muted-foreground text-[10px] uppercase tracking-[0.12em]">Pass Feedback</th>
                    <th className="text-center px-5 py-3 font-semibold text-muted-foreground text-[10px] uppercase tracking-[0.12em]">Last Contact</th>
                  </tr>
                </thead>
                <tbody>
                  {passedOnPrice.map((e) => (
                    <tr key={e.id} className="border-b border-hairline hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-3 text-center">
                        <button
                          className="hover:text-primary font-medium"
                          onClick={() => navigate(`/deals/${e.deal_id}`)}
                        >
                          {e.deals?.property_name || "—"}
                        </button>
                      </td>
                      <td className="px-5 py-3 text-center">
                        <button
                          className="hover:text-primary"
                          onClick={() => navigate(`/partners/${e.partner_id}`)}
                        >
                          {e.partners?.name || "—"}
                        </button>
                      </td>
                      <td className="px-5 py-3 text-center font-mono tabular-nums">{fmtUSD(e.indicated_amount)}</td>
                      <td className="px-5 py-3 text-center text-muted-foreground max-w-md truncate">{e.pass_feedback || "—"}</td>
                      <td className="px-5 py-3 text-center text-muted-foreground tabular-nums">{fmtDate(e.last_contact_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="px-5 py-3 border-b border-hairline flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
                Active Raises
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {rows.length} {rows.length === 1 ? "deal" : "deals"}
              </div>
            </div>
            {rows.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">No deals currently raising.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm table-fixed">
                  <colgroup>
                    <col className="w-[22%]" />
                    <col className="w-[11%]" />
                    <col className="w-[11%]" />
                    <col className="w-[11%]" />
                    <col className="w-[16%]" />
                    <col className="w-[8%]" />
                    <col className="w-[8%]" />
                    <col className="w-[7%]" />
                    <col className="w-[6%]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-hairline bg-muted/20 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      <th className="text-center px-5 py-3 font-semibold whitespace-nowrap">Investment</th>
                      <th className="text-center px-3 py-3 font-semibold whitespace-nowrap">Target</th>
                      <th className="text-center px-3 py-3 font-semibold whitespace-nowrap">Soft-Circled</th>
                      <th className="text-center px-3 py-3 font-semibold whitespace-nowrap">Committed</th>
                      <th className="text-center px-3 py-3 font-semibold whitespace-nowrap">Coverage</th>
                      <th className="text-center px-2 py-3 font-semibold whitespace-nowrap">Engaged</th>
                      <th className="text-center px-2 py-3 font-semibold whitespace-nowrap">Serious</th>
                      <th className="text-center px-2 py-3 font-semibold whitespace-nowrap">Passed</th>
                      <th className="text-center px-3 py-3 font-semibold whitespace-nowrap">Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const days = daysSince(r.earliestReachout);
                      const coverage =
                        r.target_raise && r.target_raise > 0
                          ? ((r.softCircled + r.committed) / r.target_raise) * 100
                          : null;
                      const tier = coverageTier(coverage);
                      const location = [r.city, r.state].filter(Boolean).join(", ");
                      return (
                        <tr
                          key={r.id}
                          className="border-b border-hairline last:border-b-0 hover:bg-muted/30 transition-colors cursor-pointer"
                          onClick={() => navigate(`/deals/${r.id}`)}
                        >
                          <td className="px-5 py-4 align-middle text-center">
                            <div className="font-semibold text-foreground truncate">{r.property_name}</div>
                            <div className="text-xs text-muted-foreground mt-0.5 tabular-nums truncate">
                              {location || "—"}
                              {r.unit_count ? ` · ${r.unit_count} units` : ""}
                            </div>
                          </td>
                          <td className="px-3 py-4 text-center font-mono tabular-nums text-foreground align-middle">
                            {r.target_raise ? fmtUSD(r.target_raise, true) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3 py-4 text-center font-mono tabular-nums align-middle">
                            {r.softCircled > 0 ? (
                              <span className="text-primary">{fmtUSD(r.softCircled, true)}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-4 text-center font-mono tabular-nums text-foreground align-middle">
                            {r.committed > 0 ? fmtUSD(r.committed, true) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3 py-4 align-middle">
                            {coverage != null ? (
                              <div className="space-y-1.5">
                                <CoverageBar pct={coverage} />
                                <div className={`text-[11px] tabular-nums text-center ${tierText[tier]}`}>
                                  {coverage.toFixed(0)}% covered
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground block text-center">No target</span>
                            )}
                          </td>
                          <td className="px-2 py-4 text-center tabular-nums text-foreground font-medium align-middle">
                            {r.engaged}
                          </td>
                          <td className="px-2 py-4 text-center align-middle">
                            {r.serious > 0 ? (
                              <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 rounded-full bg-[hsl(var(--tier-strong-bg))] text-[hsl(var(--tier-strong-fg))] text-xs font-semibold tabular-nums">
                                {r.serious}
                              </span>
                            ) : (
                              <span className="text-muted-foreground tabular-nums">0</span>
                            )}
                          </td>
                          <td className="px-2 py-4 text-center tabular-nums text-muted-foreground align-middle">{r.passed}</td>
                          <td className="px-3 py-4 text-center tabular-nums text-muted-foreground align-middle whitespace-nowrap">
                            {days != null ? `${days}d` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
