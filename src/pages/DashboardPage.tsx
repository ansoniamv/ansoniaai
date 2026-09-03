import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, subDays, startOfDay, eachDayOfInterval, differenceInHours } from "date-fns";
import { ArrowDownRight, ArrowUpRight, Minus, CalendarClock, Clock, ShieldOff, UserPlus, Users } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { ALL_TIERS, CHART_HEX, TIER_HEX, TIER_LABEL, tierKey, type TierKey } from "@/lib/tier";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useCreateTeamMember, useTeamMembers, initialsOf, type TeamMember } from "@/hooks/useTeamMembers";

type InboxRow = {
  id: string;
  fit_tier: string | null;
  fit_score: number | null;
  reviewed: boolean | null;
  reviewed_at: string | null;
  email_received_at: string | null;
  location_state: string | null;
  msa: string | null;
  property_name: string | null;
  gate_status: string | null;
  broker_firm: string | null;
  offers_due: string | null;
  assigned_to: string | null;
};

const PERIOD_DAYS = 30;

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
  labelStyle: { color: CHART_HEX.slate, fontWeight: 500, marginBottom: 4 },
  cursor: { fill: "rgba(31,56,100,0.04)" },
} as const;

export default function DashboardPage() {
  const { data: rows, isLoading } = useQuery({
    queryKey: ["dashboard_inbox_deals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inbox_deals")
        .select(
          "id, fit_tier, fit_score, reviewed, reviewed_at, email_received_at, location_state, msa, property_name, gate_status, broker_firm, offers_due, assigned_to",
        )
        .order("email_received_at", { ascending: false, nullsFirst: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as InboxRow[];
    },
  });

  const { data: team } = useTeamMembers();

  const stats = useMemo(() => {
    const now = startOfDay(new Date());
    const periodStart = subDays(now, PERIOD_DAYS - 1);
    const priorStart = subDays(periodStart, PERIOD_DAYS);
    const all = rows ?? [];

    const inPeriod = all.filter((r) => {
      if (!r.email_received_at) return false;
      const d = parseISO(r.email_received_at);
      return d >= periodStart;
    });
    const inPrior = all.filter((r) => {
      if (!r.email_received_at) return false;
      const d = parseISO(r.email_received_at);
      return d >= priorStart && d < periodStart;
    });

    const periodTotal = inPeriod.length;
    const priorTotal = inPrior.length;
    const strongCount = inPeriod.filter((r) => tierKey(r.fit_tier) === "strong").length;
    const priorStrong = inPrior.filter((r) => tierKey(r.fit_tier) === "strong").length;

    const scored = inPeriod.filter((r) => r.fit_score != null);
    const avgScore = scored.length ? scored.reduce((s, r) => s + (r.fit_score ?? 0), 0) / scored.length : null;
    const priorScored = inPrior.filter((r) => r.fit_score != null);
    const priorAvg = priorScored.length ? priorScored.reduce((s, r) => s + (r.fit_score ?? 0), 0) / priorScored.length : null;

    const needingReview = all.filter((r) => !r.reviewed).length;
    const priorReview = all.filter((r) => !r.reviewed && r.email_received_at && parseISO(r.email_received_at) < periodStart).length;

    const days = eachDayOfInterval({ start: periodStart, end: now });
    const flow = days.map((d) => {
      const k = format(d, "yyyy-MM-dd");
      const count = inPeriod.filter((r) => r.email_received_at && format(parseISO(r.email_received_at), "yyyy-MM-dd") === k).length;
      return { date: format(d, "MMM d"), iso: k, count };
    });

    const tierCounts: Record<TierKey, number> = { strong: 0, medium: 0, maybe: 0, skip: 0 };
    for (const r of all) tierCounts[tierKey(r.fit_tier)]++;
    const tierData = ALL_TIERS.map((t) => ({ tier: TIER_LABEL[t], key: t, count: tierCounts[t] }));

    const stateCounts = new Map<string, number>();
    for (const r of inPeriod) {
      const s = r.location_state ?? "—";
      stateCounts.set(s, (stateCounts.get(s) ?? 0) + 1);
    }
    const geoData = Array.from(stateCounts.entries())
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const scoreTrend = days.map((d) => {
      const k = format(d, "yyyy-MM-dd");
      const dayRows = inPeriod.filter(
        (r) => r.email_received_at && format(parseISO(r.email_received_at), "yyyy-MM-dd") === k && r.fit_score != null,
      );
      const mean = dayRows.length ? dayRows.reduce((s, r) => s + (r.fit_score ?? 0), 0) / dayRows.length : null;
      return { date: format(d, "MMM d"), iso: k, score: mean };
    });

    // Gate funnel counts
    const gatePassed = inPeriod.filter((r) => r.gate_status === "passed").length;
    const gateReview = inPeriod.filter((r) => r.gate_status === "review").length;
    const gateFiltered = inPeriod.filter((r) => r.gate_status === "filtered").length;

    // Pipeline funnel (trailing period)
    const received = periodTotal;
    const passedStage = inPeriod.filter((r) => r.gate_status === "passed" || r.gate_status === "review").length;
    const scoredStage = inPeriod.filter((r) => r.fit_score != null).length;
    const strongStage = inPeriod.filter((r) => tierKey(r.fit_tier) === "strong").length;
    const reviewedStage = inPeriod.filter((r) => r.reviewed).length;
    const funnel = [
      { label: "Received", count: received },
      { label: "Passed Gate", count: passedStage },
      { label: "Scored", count: scoredStage },
      { label: "Strong Fit", count: strongStage },
      { label: "Reviewed", count: reviewedStage },
    ].map((s, i, arr) => ({
      ...s,
      pct: arr[0].count ? (s.count / arr[0].count) * 100 : 0,
      stepConv: i === 0 ? 100 : arr[i - 1].count ? (s.count / arr[i - 1].count) * 100 : 0,
    }));

    // Action card data
    const offersWeek = (() => {
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + 7);
      return all.filter((r) => {
        if (!r.offers_due) return false;
        const t = tierKey(r.fit_tier);
        if (t !== "strong" && t !== "medium") return false;
        const d = parseISO(r.offers_due);
        return d >= startOfDay(new Date()) && d <= horizon;
      }).length;
    })();

    const reviewTimes = all
      .filter((r) => r.reviewed && r.reviewed_at && r.email_received_at)
      .map((r) => differenceInHours(parseISO(r.reviewed_at!), parseISO(r.email_received_at!)))
      .filter((h) => h >= 0 && h < 24 * 90);
    const avgReviewDays = reviewTimes.length
      ? reviewTimes.reduce((s, h) => s + h, 0) / reviewTimes.length / 24
      : null;

    const totalGated = all.filter((r) => r.gate_status && r.gate_status !== "pending").length;
    const filteredAll = all.filter((r) => r.gate_status === "filtered").length;
    const gateFilteredPct = totalGated ? (filteredAll / totalGated) * 100 : 0;

    // Broker intelligence (use all rows)
    const brokerMap = new Map<string, { count: number; scored: number; sumScore: number }>();
    for (const r of all) {
      const b = (r.broker_firm ?? "").trim();
      if (!b) continue;
      const e = brokerMap.get(b) ?? { count: 0, scored: 0, sumScore: 0 };
      e.count += 1;
      if (r.fit_score != null) {
        e.scored += 1;
        e.sumScore += r.fit_score;
      }
      brokerMap.set(b, e);
    }
    const brokerVolume = Array.from(brokerMap.entries())
      .map(([broker, v]) => ({ broker, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    const brokerQuality = Array.from(brokerMap.entries())
      .filter(([, v]) => v.scored >= 2)
      .map(([broker, v]) => ({ broker, avg: v.sumScore / v.scored, n: v.scored }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 10);

    // Market quality
    const stateScoreMap = new Map<string, { scored: number; sum: number }>();
    for (const r of all) {
      const s = (r.location_state ?? "").trim();
      if (!s || r.fit_score == null) continue;
      const e = stateScoreMap.get(s) ?? { scored: 0, sum: 0 };
      e.scored += 1;
      e.sum += r.fit_score;
      stateScoreMap.set(s, e);
    }
    const marketQuality = Array.from(stateScoreMap.entries())
      .filter(([, v]) => v.scored >= 2)
      .map(([state, v]) => ({ state, avg: v.sum / v.scored, n: v.scored }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 12);

    // Team workload
    const assignCounts = new Map<string, { assigned: number; reviewed: number }>();
    for (const r of all) {
      if (!r.assigned_to) continue;
      const e = assignCounts.get(r.assigned_to) ?? { assigned: 0, reviewed: 0 };
      e.assigned += 1;
      if (r.reviewed) e.reviewed += 1;
      assignCounts.set(r.assigned_to, e);
    }

    return {
      periodTotal,
      priorTotal,
      strongCount,
      priorStrong,
      avgScore,
      priorAvg,
      needingReview,
      priorReview,
      flow,
      tierData,
      geoData,
      scoreTrend,
      tierCounts,
      allTotal: all.length,
      gatePassed,
      gateReview,
      gateFiltered,
      funnel,
      offersWeek,
      avgReviewDays,
      gateFilteredCount: filteredAll,
      gateFilteredPct,
      brokerVolume,
      brokerQuality,
      marketQuality,
      assignCounts,
    };
  }, [rows]);

  if (isLoading || !stats) {
    return (
      <div className="space-y-6 animate-fade-in">
        <SectionHeader title="Dashboard" subtitle="Loading…" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="surface-card h-28 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <SectionHeader title="Dashboard" subtitle={`Acquisitions overview — trailing ${PERIOD_DAYS} days`} />

      {/* KPI strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Deals Received" value={stats.periodTotal} prior={stats.priorTotal} format="int" />
        <KpiCard label="Strong-Fit Count" value={stats.strongCount} prior={stats.priorStrong} format="int" emphasis />
        <KpiCard label="Avg Fit Score" value={stats.avgScore} prior={stats.priorAvg} format="score" />
        <KpiCard label="Awaiting Review" value={stats.needingReview} prior={stats.priorReview} format="int" inverted />
      </div>

      {/* Action cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ActionCard
          icon={<CalendarClock className="h-4 w-4" strokeWidth={1.75} />}
          label="Offers Due This Week"
          value={stats.offersWeek.toString()}
          hint="Strong/Medium · next 7 days"
        />
        <ActionCard
          icon={<Clock className="h-4 w-4" strokeWidth={1.75} />}
          label="Avg Days to Review"
          value={stats.avgReviewDays == null ? "—" : stats.avgReviewDays.toFixed(1)}
          hint="From inbox arrival to reviewed"
        />
        <ActionCard
          icon={<ShieldOff className="h-4 w-4" strokeWidth={1.75} />}
          label="Gate Filtered"
          value={stats.gateFilteredCount.toString()}
          hint={`${stats.gateFilteredPct.toFixed(0)}% of gated inbound`}
        />
      </div>

      {/* Pipeline funnel */}
      <ChartCard title="Pipeline Funnel" subtitle={`Trailing ${PERIOD_DAYS} days · conversion at each stage`}>
        <FunnelChart stages={stats.funnel} />
      </ChartCard>

      {/* Gate funnel strip */}
      <div className="surface-card px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
        <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
          Mandate Gate · trailing {PERIOD_DAYS}d
        </span>
        <span className="text-foreground">
          <span className="font-serif-display text-base font-medium tabular-nums mr-1">{stats.periodTotal}</span>
          deals received
        </span>
        <span className="text-tier-strong-fg">
          <span className="font-serif-display text-base font-medium tabular-nums mr-1">{stats.gatePassed}</span>
          passed gate
        </span>
        <span className="text-amber-700">
          <span className="font-serif-display text-base font-medium tabular-nums mr-1">{stats.gateReview}</span>
          need review
        </span>
        <span className="text-muted-foreground">
          <span className="font-serif-display text-base font-medium tabular-nums mr-1">{stats.gateFiltered}</span>
          filtered out
        </span>
      </div>

      {/* Original chart grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard className="lg:col-span-2" title="Deal Flow Over Time" subtitle="Deals received per day · trailing 30 days">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={stats.flow} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id="flowFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_HEX.navy} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={CHART_HEX.navy} stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={CHART_HEX.gridline} vertical={false} strokeDasharray="2 4" />
              <XAxis dataKey="date" {...axisProps} interval={Math.max(0, Math.floor(stats.flow.length / 8))} />
              <YAxis {...axisProps} width={32} allowDecimals={false} />
              <Tooltip {...tooltipProps} />
              <Area
                type="monotone"
                dataKey="count"
                stroke={CHART_HEX.navy}
                strokeWidth={1.75}
                fill="url(#flowFill)"
                dot={false}
                activeDot={{ r: 3, stroke: CHART_HEX.navy, strokeWidth: 1.5, fill: "#fff" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Pipeline by Fit Tier" subtitle="All-time distribution">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={stats.tierData.filter((d) => d.count > 0)}
                dataKey="count"
                nameKey="tier"
                cx="50%"
                cy="50%"
                innerRadius={56}
                outerRadius={86}
                paddingAngle={1.5}
                stroke="#fff"
                strokeWidth={2}
              >
                {stats.tierData.map((d) => (
                  <Cell key={d.key} fill={TIER_HEX[d.key as TierKey]} />
                ))}
              </Pie>
              <Tooltip {...tooltipProps} />
            </PieChart>
          </ResponsiveContainer>
          <TierLegend counts={stats.tierCounts} total={stats.allTotal} />
        </ChartCard>

        <ChartCard className="lg:col-span-2" title="Deals by Geography" subtitle="Top states · trailing 30 days">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={stats.geoData} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }} barCategoryGap={8}>
              <CartesianGrid stroke={CHART_HEX.gridline} horizontal={false} strokeDasharray="2 4" />
              <XAxis type="number" {...axisProps} allowDecimals={false} />
              <YAxis type="category" dataKey="state" {...axisProps} width={48} />
              <Tooltip {...tooltipProps} />
              <Bar dataKey="count" fill={CHART_HEX.navy} radius={[0, 2, 2, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Avg Fit Score Trend" subtitle="Daily mean · trailing 30 days">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={stats.scoreTrend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={CHART_HEX.gridline} vertical={false} strokeDasharray="2 4" />
              <XAxis dataKey="date" {...axisProps} interval={Math.max(0, Math.floor(stats.scoreTrend.length / 6))} />
              <YAxis {...axisProps} width={32} domain={[0, 100]} />
              <Tooltip {...tooltipProps} formatter={(v: number) => [v?.toFixed?.(0) ?? "—", "Score"]} />
              <Line
                type="monotone"
                dataKey="score"
                stroke={CHART_HEX.bronze}
                strokeWidth={1.75}
                dot={false}
                activeDot={{ r: 3, stroke: CHART_HEX.bronze, strokeWidth: 1.5, fill: "#fff" }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Broker Intelligence */}
      <SubsectionHeader title="Broker Intelligence" subtitle="Volume & average fit by source" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Top Brokers by Volume" subtitle="Total deals received per firm">
          {stats.brokerVolume.length === 0 ? (
            <EmptyChart label="No broker data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(240, stats.brokerVolume.length * 28)}>
              <BarChart data={stats.brokerVolume} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }} barCategoryGap={8}>
                <CartesianGrid stroke={CHART_HEX.gridline} horizontal={false} strokeDasharray="2 4" />
                <XAxis type="number" {...axisProps} allowDecimals={false} />
                <YAxis type="category" dataKey="broker" {...axisProps} width={140} />
                <Tooltip {...tooltipProps} />
                <Bar dataKey="count" fill={CHART_HEX.navy} radius={[0, 2, 2, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Broker Quality" subtitle="Avg fit score · min 2 scored deals">
          {stats.brokerQuality.length === 0 ? (
            <EmptyChart label="Not enough scored deals per broker yet" />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(240, stats.brokerQuality.length * 28)}>
              <BarChart data={stats.brokerQuality} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }} barCategoryGap={8}>
                <CartesianGrid stroke={CHART_HEX.gridline} horizontal={false} strokeDasharray="2 4" />
                <XAxis type="number" {...axisProps} domain={[0, 100]} />
                <YAxis type="category" dataKey="broker" {...axisProps} width={140} />
                <Tooltip
                  {...tooltipProps}
                  formatter={(v: number, _n: string, p: any) => [`${v.toFixed(0)} (${p.payload.n} deals)`, "Avg score"]}
                />
                <Bar dataKey="avg" fill={CHART_HEX.bronze ?? CHART_HEX.navy} radius={[0, 2, 2, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Market Quality */}
      <SubsectionHeader title="Market Quality" subtitle="Avg fit score by state — min 2 scored deals" />
      <ChartCard title="Avg Fit Score by Market" subtitle="Ranked descending">
        {stats.marketQuality.length === 0 ? (
          <EmptyChart label="Not enough scored deals per market yet" />
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(260, stats.marketQuality.length * 26)}>
            <BarChart data={stats.marketQuality} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }} barCategoryGap={8}>
              <CartesianGrid stroke={CHART_HEX.gridline} horizontal={false} strokeDasharray="2 4" />
              <XAxis type="number" {...axisProps} domain={[0, 100]} />
              <YAxis type="category" dataKey="state" {...axisProps} width={48} />
              <Tooltip
                {...tooltipProps}
                formatter={(v: number, _n: string, p: any) => [`${v.toFixed(0)} (${p.payload.n} deals)`, "Avg score"]}
              />
              <Bar dataKey="avg" fill={CHART_HEX.navy} radius={[0, 2, 2, 0]} maxBarSize={16} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Team panel */}
      <SubsectionHeader title="Team" subtitle="Ansonia Properties" />
      <TeamRow members={team ?? []} counts={stats.assignCounts} />


    </div>
  );
}

/* ----------------------------- Subcomponents ----------------------------- */

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-end justify-between border-b border-hairline pb-4">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">{title}</h1>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1 uppercase tracking-[0.12em] font-medium">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

function SubsectionHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between border-b border-hairline pb-2 pt-2">
      <div>
        <h2 className="font-display text-base font-semibold text-foreground">{title}</h2>
        {subtitle && (
          <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-[0.12em] font-medium">{subtitle}</p>
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
  format,
  emphasis,
  inverted,
}: {
  label: string;
  value: number | null;
  prior: number | null;
  format: "int" | "score";
  emphasis?: boolean;
  inverted?: boolean;
}) {
  const display = value == null ? "—" : format === "int" ? value.toLocaleString() : value.toFixed(0);
  let delta: number | null = null;
  let pct: number | null = null;
  if (value != null && prior != null) {
    delta = value - prior;
    if (prior !== 0) pct = (delta / prior) * 100;
  }
  const positive = delta != null && (inverted ? delta < 0 : delta > 0);
  const negative = delta != null && (inverted ? delta > 0 : delta < 0);
  const Arrow = delta == null || delta === 0 ? Minus : positive ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="surface-card p-5 transition-shadow">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">{label}</div>
      <div
        className={cn(
          "mt-3 font-serif-display font-medium leading-none tabular-nums",
          emphasis ? "text-[40px] text-primary" : "text-[40px] text-foreground",
        )}
      >
        {display}
      </div>
      {delta != null && (
        <div className="mt-3 flex items-center gap-1.5 text-xs">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-medium tabular-nums",
              positive && "text-tier-strong-fg bg-tier-strong-bg",
              negative && "text-destructive bg-destructive/8",
              !positive && !negative && "text-muted-foreground bg-muted",
            )}
          >
            <Arrow className="h-3 w-3" strokeWidth={2} />
            {pct != null ? `${Math.abs(pct).toFixed(0)}%` : Math.abs(delta).toLocaleString()}
          </span>
          <span className="text-muted-foreground">vs. prior {PERIOD_DAYS}d</span>
        </div>
      )}
    </div>
  );
}

function ActionCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="surface-card p-5">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <div className="mt-3 font-serif-display font-medium leading-none tabular-nums text-[32px] text-foreground">
        {value}
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("surface-card p-5", className)}>
      <div className="mb-4">
        <h3 className="font-display text-[15px] font-semibold text-foreground">{title}</h3>
        {subtitle && (
          <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-medium mt-1">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground border border-dashed border-hairline rounded">
      {label}
    </div>
  );
}

function FunnelChart({
  stages,
}: {
  stages: { label: string; count: number; pct: number; stepConv: number }[];
}) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div className="space-y-2.5">
      {stages.map((s, i) => {
        const widthPct = (s.count / max) * 100;
        const opacity = 1 - i * 0.12;
        return (
          <div key={s.label} className="grid grid-cols-[120px_1fr_140px] items-center gap-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
              {s.label}
            </div>
            <div className="relative h-7 bg-muted/40 rounded-sm overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-sm transition-[width] duration-500"
                style={{
                  width: `${widthPct}%`,
                  background: `linear-gradient(90deg, ${CHART_HEX.navy} 0%, ${CHART_HEX.slate} 100%)`,
                  opacity,
                }}
              />
            </div>
            <div className="text-xs text-foreground tabular-nums flex items-baseline gap-2 justify-end">
              <span className="font-serif-display text-[18px] font-medium leading-none">{s.count}</span>
              <span className="text-muted-foreground">
                {s.pct.toFixed(0)}% <span className="text-muted-foreground/60">overall</span>
              </span>
            </div>
          </div>
        );
      })}
      <div className="pt-2 mt-1 border-t border-hairline grid grid-cols-5 gap-3 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {stages.map((s, i) => (
          <div key={s.label} className="text-center">
            {i === 0 ? "—" : `${s.stepConv.toFixed(0)}% step`}
          </div>
        ))}
      </div>
    </div>
  );
}

function TierLegend({ counts, total }: { counts: Record<TierKey, number>; total: number }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1.5 px-2">
      {ALL_TIERS.map((t) => {
        const pct = total ? (counts[t] / total) * 100 : 0;
        return (
          <div key={t} className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: TIER_HEX[t] }} />
            <span className="text-foreground font-medium">{TIER_LABEL[t]}</span>
            <span className="ml-auto tabular-nums text-muted-foreground">
              {counts[t]} <span className="text-muted-foreground/60">· {pct.toFixed(0)}%</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TeamRow({
  members,
  counts,
}: {
  members: TeamMember[];
  counts: Map<string, { assigned: number; reviewed: number }>;
}) {
  if (members.length === 0) {
    return (
      <div className="surface-card border-dashed p-8 text-center text-xs text-muted-foreground">
        <Users className="h-5 w-5 mx-auto mb-2 text-muted-foreground/70" strokeWidth={1.5} />
        No team members yet. Add one to start assigning deal owners.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {members.map((m) => {
        const c = counts.get(m.id) ?? { assigned: 0, reviewed: 0 };
        return (
          <div key={m.id} className="surface-card p-4 flex items-center gap-3">
            <Avatar className="h-11 w-11 border border-hairline">
              {m.avatar_url && <AvatarImage src={m.avatar_url} alt={m.full_name} />}
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                {initialsOf(m.full_name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground truncate">{m.full_name}</div>
              <div className="text-[11px] text-muted-foreground truncate">{m.role ?? "—"}</div>
              <div className="text-[11px] text-muted-foreground tabular-nums mt-1">
                <span className="text-foreground font-medium">{c.assigned}</span> assigned ·{" "}
                <span className="text-foreground font-medium">{c.reviewed}</span> reviewed
              </div>
            </div>
            {!m.active && (
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Inactive</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AddTeamMemberDialog() {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const create = useCreateTeamMember();

  const submit = async () => {
    if (!fullName.trim()) {
      toast.error("Name is required");
      return;
    }
    try {
      await create.mutateAsync({
        full_name: fullName.trim(),
        role: role.trim() || null,
        email: email.trim() || null,
      });
      toast.success("Team member added");
      setOpen(false);
      setFullName("");
      setRole("");
      setEmail("");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not add member — admin role required");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 border-hairline text-xs">
          <UserPlus className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.75} />
          Add member
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Add team member</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="tm-name" className="text-xs">Full name</Label>
            <Input id="tm-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tm-role" className="text-xs">Role</Label>
            <Input id="tm-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Acquisitions Analyst" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tm-email" className="text-xs">Email</Label>
            <Input id="tm-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={create.isPending}>
            {create.isPending ? "Adding…" : "Add member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdminTeamRow() {
  const { data: admins, isLoading } = useQuery({
    queryKey: ["dashboard_admin_profiles"],
    queryFn: async () => {
      const { data: roles, error: rErr } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");
      if (rErr) throw rErr;
      const ids = (roles ?? []).map((r: any) => r.user_id);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ids);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return <div className="surface-card h-24 animate-pulse" />;
  }
  if (!admins || admins.length === 0) {
    return (
      <div className="surface-card border-dashed p-8 text-center text-xs text-muted-foreground">
        <Users className="h-5 w-5 mx-auto mb-2 text-muted-foreground/70" strokeWidth={1.5} />
        No administrators found.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {admins.map((m: any) => (
        <div key={m.id} className="surface-card p-4 flex items-center gap-3">
          <Avatar className="h-11 w-11 border border-hairline">
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
              {initialsOf(m.full_name ?? m.email)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground truncate">
              {m.full_name ?? m.email ?? "—"}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">{m.email ?? ""}</div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-primary font-semibold mt-1">
              Admin
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
