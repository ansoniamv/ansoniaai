import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  Area,
  AreaChart,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

// Ansonia navy palette
const NAVY = "#002752";
const NAVY_MID = "#5B6472";
const NAVY_LIGHT = "#E4E7EC";
const NAVY_ACCENT = "#6aa3d8";

const usd = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);
const int = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-US").format(n);

// Two-decimal fixed for per-Mtok cells; muted em-dash when zero/NA.
const rate2 = (n: number | null | undefined) =>
  n == null || !Number.isFinite(Number(n)) || Number(n) === 0
    ? null
    : `$${Number(n).toFixed(2)}`;

function providerLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  const v = String(raw).trim();
  const low = v.toLowerCase();
  if (low === "anthropic") return "Anthropic";
  if (low === "lovable-gateway" || low === "lovable_gateway" || low === "lovable gateway")
    return "Lovable Gateway";
  if (low === "hellodata") return "HelloData";
  if (low === "esri" || low === "arcgis") return "Esri";
  return v.charAt(0).toUpperCase() + v.slice(1);
}

type UsageRow = {
  created_at: string;
  function_name: string;
  model: string | null;
  provider: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  cost_usd: number | null;
  billing_type: "token" | "request" | null;
  service: string | null;
  units: number | null;
};

type PricingRow = {
  model: string;
  provider: string;
  input_per_mtok: number;
  output_per_mtok: number;
  cached_input_per_mtok: number;
  per_call_usd: number | null;
  billing_type: "token" | "request";
  unit_label: string | null;
  currency: string;
  notes: string | null;
  updated_at: string;
};

function useUsage(days: 30 | 90) {
  return useQuery({
    queryKey: ["ai_usage_log", days],
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const { data, error } = await supabase
        .from("ai_usage_log")
        .select(
          "created_at, function_name, model, provider, input_tokens, output_tokens, cached_tokens, cost_usd, billing_type, service, units",
        )
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50000);
      if (error) throw error;
      return (data ?? []) as UsageRow[];
    },
  });
}

function useKpiTotals() {
  return useQuery({
    queryKey: ["ai_usage_kpi_v2"],
    queryFn: async () => {
      const now = Date.now();
      const [today, d7, d30, all] = await Promise.all([
        supabase.from("ai_usage_log").select("cost_usd").gte("created_at", new Date(now - 86400000).toISOString()),
        supabase.from("ai_usage_log").select("cost_usd").gte("created_at", new Date(now - 7 * 86400000).toISOString()),
        supabase
          .from("ai_usage_log")
          .select("cost_usd,input_tokens,output_tokens,billing_type")
          .gte("created_at", new Date(now - 30 * 86400000).toISOString()),
        supabase.from("ai_usage_log").select("cost_usd", { count: "exact", head: false }).limit(50000),
      ]);
      const sum = (rows: any[] | null) => (rows ?? []).reduce((a, r) => a + Number(r.cost_usd ?? 0), 0);
      const d30Rows = d30.data ?? [];
      return {
        today: sum(today.data ?? []),
        last7: sum(d7.data ?? []),
        last30: sum(d30Rows),
        allTime: sum(all.data ?? []),
        tokens30: d30Rows.reduce(
          (a: number, r: any) => a + Number(r.input_tokens ?? 0) + Number(r.output_tokens ?? 0),
          0,
        ),
        calls30: d30Rows.length,
      };
    },
  });
}

function usePricing() {
  return useQuery({
    queryKey: ["ai_model_pricing_v2"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_model_pricing")
        .select("*")
        .order("billing_type", { ascending: true })
        .order("model", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PricingRow[];
    },
  });
}

function KpiTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4 surface-card flex flex-col min-w-0">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold leading-tight min-h-[2.2em]">
        {label}
      </div>
      <div
        className="text-2xl font-display font-semibold mt-2 tabular-nums truncate"
        style={{ color: NAVY }}
        title={value}
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground mt-1 tabular-nums leading-tight min-h-[1.2em]">
        {sub ?? ""}
      </div>
    </Card>
  );
}

function EstBadge() {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 rounded-sm border border-amber-300 bg-amber-50 text-amber-700 px-1.5 py-[1px] text-[10px] font-medium tabular-nums cursor-help">
            Est.
            <Info className="h-2.5 w-2.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-[260px] text-xs">
          Placeholder rate — Lovable AI Gateway bills in credits, not direct USD. Confirm against actual billing before trusting the number. Admins can edit this row.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function AiUsageDashboard() {
  const [days, setDays] = useState<30 | 90>(30);
  const { isAdmin } = useAuth();
  const usageQ = useUsage(days);
  const kpiQ = useKpiTotals();
  const pricingQ = usePricing();
  const qc = useQueryClient();

  const isEmpty = !usageQ.isLoading && (usageQ.data?.length ?? 0) === 0;

  const tokenRows = useMemo(
    () => (pricingQ.data ?? []).filter((r) => r.billing_type !== "request"),
    [pricingQ.data],
  );
  const requestRows = useMemo(
    () => (pricingQ.data ?? []).filter((r) => r.billing_type === "request"),
    [pricingQ.data],
  );

  // Cost by provider (AI + data APIs together)
  const byProvider = useMemo(() => {
    const map = new Map<string, { provider: string; cost: number; calls: number }>();
    for (const r of usageQ.data ?? []) {
      const key = providerLabel(r.provider);
      const cur = map.get(key) ?? { provider: key, cost: 0, calls: 0 };
      cur.calls++;
      cur.cost += Number(r.cost_usd ?? 0);
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
  }, [usageQ.data]);

  // AI: cost by model (token billing only)
  const byModel = useMemo(() => {
    const map = new Map<string, { model: string; calls: number; input: number; output: number; cost: number }>();
    for (const r of usageQ.data ?? []) {
      if (r.billing_type === "request") continue;
      const key = r.model ?? "unknown";
      const cur = map.get(key) ?? { model: key, calls: 0, input: 0, output: 0, cost: 0 };
      cur.calls++;
      cur.input += Number(r.input_tokens ?? 0);
      cur.output += Number(r.output_tokens ?? 0);
      cur.cost += Number(r.cost_usd ?? 0);
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
  }, [usageQ.data]);

  // Cost by function (all)
  const byFn = useMemo(() => {
    const map = new Map<string, { function_name: string; calls: number; cost: number }>();
    for (const r of usageQ.data ?? []) {
      const cur = map.get(r.function_name) ?? { function_name: r.function_name, calls: 0, cost: 0 };
      cur.calls++;
      cur.cost += Number(r.cost_usd ?? 0);
      map.set(r.function_name, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.calls - a.calls);
  }, [usageQ.data]);

  const [fnSort, setFnSort] = useState<"calls" | "cost">("calls");
  const byFnSorted = useMemo(
    () => [...byFn].sort((a, b) => (fnSort === "calls" ? b.calls - a.calls : b.cost - a.cost)),
    [byFn, fnSort],
  );

  // Data-APIs: cost + call counts by service
  const byService = useMemo(() => {
    const map = new Map<string, { service: string; calls: number; units: number; cost: number }>();
    for (const r of usageQ.data ?? []) {
      if (r.billing_type !== "request") continue;
      const key = r.service ?? "unknown";
      const cur = map.get(key) ?? { service: key, calls: 0, units: 0, cost: 0 };
      cur.calls++;
      cur.units += Number(r.units ?? 1);
      cur.cost += Number(r.cost_usd ?? 0);
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
  }, [usageQ.data]);

  // Daily spend series (client-side rollup)
  const daily = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of usageQ.data ?? []) {
      const day = r.created_at.slice(0, 10);
      map.set(day, (map.get(day) ?? 0) + Number(r.cost_usd ?? 0));
    }
    const out: { day: string; cost: number }[] = [];
    const start = new Date(Date.now() - days * 86400000);
    for (let i = 0; i <= days; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const key = d.toISOString().slice(0, 10);
      out.push({ day: key.slice(5), cost: map.get(key) ?? 0 });
    }
    return out;
  }, [usageQ.data, days]);

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3 border-t border-hairline pt-6">
        <div>
          <h2 className="text-lg font-display font-semibold tracking-tight" style={{ color: NAVY }}>
            API Usage & Cost
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            All USD amounts are <span className="font-semibold">estimates</span>. Lovable AI Gateway
            usage bills in credits, and data-API providers meter by call/credit — figures below are
            computed from the editable pricing table using the rate on the row at time of the call.
          </p>
        </div>
        <div className="flex gap-1">
          {([30, 90] as const).map((n) => (
            <Button
              key={n}
              variant={days === n ? "default" : "outline"}
              size="sm"
              onClick={() => setDays(n)}
              className="tabular-nums"
              style={days === n ? { backgroundColor: NAVY, color: "white" } : undefined}
            >
              {n}d
            </Button>
          ))}
        </div>
      </div>

      {isEmpty ? (
        <Card className="p-8 text-center surface-card">
          <div className="text-sm text-muted-foreground">
            Tracking starts now — check back after some AI or data-API activity.
          </div>
        </Card>
      ) : (
        <>
          {/* KPI tiles — total API spend (AI + data) */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiTile label="Spend Today" value={usd(kpiQ.data?.today)} sub="Estimated · AI + data" />
            <KpiTile label="Last 7 Days" value={usd(kpiQ.data?.last7)} sub="Estimated" />
            <KpiTile label="Last 30 Days" value={usd(kpiQ.data?.last30)} sub="Estimated" />
            <KpiTile label="All-Time" value={usd(kpiQ.data?.allTime)} sub="Estimated" />
            <KpiTile label="Tokens (30d)" value={int(kpiQ.data?.tokens30)} sub="AI in + out" />
            <KpiTile label="Calls (30d)" value={int(kpiQ.data?.calls30)} sub="All API calls" />
          </div>

          {/* Daily spend */}
          <Card className="p-4 surface-card">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold" style={{ color: NAVY }}>
                Daily spend — last {days} days (Estimated)
              </div>
            </div>
            <ChartContainer
              config={{ cost: { label: "Estimated $", color: NAVY } }}
              className="h-[240px] w-full"
            >
              <AreaChart data={daily}>
                <defs>
                  <linearGradient id="navyGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={NAVY} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={NAVY} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={NAVY_LIGHT} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: NAVY_MID }} tickLine={false} axisLine={{ stroke: NAVY_LIGHT }} />
                <YAxis tick={{ fontSize: 10, fill: NAVY_MID }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v.toFixed(2)}`} />
                <RechartsTooltip content={<ChartTooltipContent formatter={(v: any) => usd(Number(v))} />} />
                <Area type="monotone" dataKey="cost" stroke={NAVY} fill="url(#navyGrad)" strokeWidth={2} />
              </AreaChart>
            </ChartContainer>
          </Card>

          {/* Cost by provider (AI + data APIs) */}
          <Card className="p-4 surface-card">
            <div className="text-sm font-semibold mb-3" style={{ color: NAVY }}>
              Cost by provider (last {days} days, Estimated)
            </div>
            <ChartContainer config={{ cost: { label: "Estimated $", color: NAVY } }} className="h-[200px] w-full">
              <BarChart data={byProvider} layout="vertical" margin={{ left: 40 }}>
                <CartesianGrid stroke={NAVY_LIGHT} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: NAVY_MID }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v.toFixed(2)}`} />
                <YAxis type="category" dataKey="provider" tick={{ fontSize: 10, fill: NAVY_MID }} axisLine={false} tickLine={false} width={140} />
                <RechartsTooltip content={<ChartTooltipContent formatter={(v: any) => usd(Number(v))} />} />
                <Bar dataKey="cost" fill={NAVY} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartContainer>
          </Card>

          {/* Cost by AI model */}
          <Card className="p-4 surface-card">
            <div className="text-sm font-semibold mb-3" style={{ color: NAVY }}>
              Cost by AI model (last {days} days, Estimated)
            </div>
            <ChartContainer config={{ cost: { label: "Estimated $", color: NAVY } }} className="h-[200px] w-full">
              <BarChart data={byModel} layout="vertical" margin={{ left: 40 }}>
                <CartesianGrid stroke={NAVY_LIGHT} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: NAVY_MID }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v.toFixed(2)}`} />
                <YAxis type="category" dataKey="model" tick={{ fontSize: 10, fill: NAVY_MID }} axisLine={false} tickLine={false} width={190} />
                <RechartsTooltip content={<ChartTooltipContent formatter={(v: any) => usd(Number(v))} />} />
                <Bar dataKey="cost" fill={NAVY} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartContainer>
          </Card>

          {/* Data-API services: cost + call counts */}
          {byService.length > 0 && (
            <Card className="p-4 surface-card">
              <div className="text-sm font-semibold mb-3" style={{ color: NAVY }}>
                Data APIs — cost & call counts (last {days} days, Estimated)
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">Service</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-muted-foreground">Calls</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-muted-foreground">Units</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-muted-foreground">Estimated $</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byService.map((r) => (
                      <TableRow key={r.service}>
                        <TableCell className="font-mono text-xs whitespace-nowrap">{providerLabel(r.service)}</TableCell>
                        <TableCell className="text-right tabular-nums">{int(r.calls)}</TableCell>
                        <TableCell className="text-right tabular-nums">{int(r.units)}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">{usd(r.cost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}

          {/* Load + cost by function — call count is the load signal, cost is the $ signal.
              They diverge (a cheap function called 7,000x is the real problem), so both
              are shown side by side, sorted by calls. */}
          <Card className="p-4 surface-card">
            <div className="flex items-baseline justify-between mb-3">
              <div className="text-sm font-semibold" style={{ color: NAVY }}>
                Load &amp; cost by function (last {days} days)
              </div>
              <div className="flex items-center gap-1 text-[11px]">
                <span className="text-muted-foreground">Sort by</span>
                <button
                  onClick={() => setFnSort("calls")}
                  className={cn("px-2 py-0.5 rounded border", fnSort === "calls" ? "bg-primary text-primary-foreground border-primary" : "border-hairline text-muted-foreground")}
                >
                  Calls
                </button>
                <button
                  onClick={() => setFnSort("cost")}
                  className={cn("px-2 py-0.5 rounded border", fnSort === "cost" ? "bg-primary text-primary-foreground border-primary" : "border-hairline text-muted-foreground")}
                >
                  Cost
                </button>
              </div>
            </div>
            <ChartContainer
              config={{ calls: { label: "Calls", color: NAVY }, cost: { label: "Estimated $", color: NAVY_ACCENT } }}
              className="h-[220px] w-full"
            >
              <BarChart data={byFnSorted} layout="vertical" margin={{ left: 40 }}>
                <CartesianGrid stroke={NAVY_LIGHT} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: NAVY_MID }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="function_name" tick={{ fontSize: 10, fill: NAVY_MID }} axisLine={false} tickLine={false} width={190} />
                <RechartsTooltip content={<ChartTooltipContent />} />
                <Bar dataKey={fnSort} fill={fnSort === "calls" ? NAVY : NAVY_ACCENT} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartContainer>
            <div className="overflow-x-auto mt-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Function</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Est. cost</TableHead>
                    <TableHead className="text-right">Est. $/call</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byFnSorted.map((r) => (
                    <TableRow key={r.function_name}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{r.function_name}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{int(r.calls)}</TableCell>
                      <TableCell className="text-right tabular-nums">{usd(r.cost)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {r.calls ? usd(r.cost / r.calls) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Call count is the load signal and cost is the spend signal — they diverge. A high-volume,
              low-cost function is usually what makes the app slow. All dollar figures are estimates.
            </p>
          </Card>
        </>
      )}

      {/* ============================================================
          PRICING — TWO SUB-TABLES: tokens vs per-request
      ============================================================ */}

      {/* Sub-table 1: AI models per 1M tokens */}
      <Card className="p-4 surface-card">
        <div className="mb-2">
          <div className="text-sm font-semibold" style={{ color: NAVY }}>
            AI models — per 1M tokens (USD)
          </div>
          <div className="text-xs text-muted-foreground">
            Rates apply at insert time to compute <code>cost_usd</code>. Editing a rate affects only
            future usage — historic rows keep their original cost.
            {isAdmin ? " Admin: click Edit to change." : " Only admins can edit."}
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b" style={{ borderColor: NAVY_LIGHT }}>
                <TableHead className="w-[28%] text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Model
                </TableHead>
                <TableHead className="w-[18%] text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Provider
                </TableHead>
                <TableHead className="w-[16%] text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Input · $/Mtok
                </TableHead>
                <TableHead className="w-[16%] text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Cached · $/Mtok
                </TableHead>
                <TableHead className="w-[16%] text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Output · $/Mtok
                </TableHead>
                <TableHead className="w-[6%] text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Est.
                </TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokenRows.map((r) => (
                <TokenPricingRow
                  key={r.model}
                  row={r}
                  canEdit={isAdmin}
                  onSaved={() => qc.invalidateQueries({ queryKey: ["ai_model_pricing_v2"] })}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Sub-table 2: Data APIs per request */}
      <Card className="p-4 surface-card">
        <div className="mb-2">
          <div className="text-sm font-semibold" style={{ color: NAVY }}>
            Data APIs — per request (USD)
          </div>
          <div className="text-xs text-muted-foreground">
            HelloData and Esri bill per call or per credit — one row is written for every external
            call. Editing here affects only future costs.
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b" style={{ borderColor: NAVY_LIGHT }}>
                <TableHead className="w-[22%] text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Service
                </TableHead>
                <TableHead className="w-[22%] text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Provider
                </TableHead>
                <TableHead className="w-[22%] text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Per call · USD
                </TableHead>
                <TableHead className="w-[16%] text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Unit
                </TableHead>
                <TableHead className="w-[8%] text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Est.
                </TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {requestRows.map((r) => (
                <RequestPricingRow
                  key={r.model}
                  row={r}
                  canEdit={isAdmin}
                  onSaved={() => qc.invalidateQueries({ queryKey: ["ai_model_pricing_v2"] })}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </section>
  );
}

/* ============================================================
   Row editors
============================================================ */

function ModelCell({ model }: { model: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="font-mono text-xs whitespace-nowrap block max-w-[240px] truncate">
            {model}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs font-mono">
          {model}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function Muted() {
  return <span className="text-muted-foreground">—</span>;
}

function TokenPricingRow({
  row,
  canEdit,
  onSaved,
}: {
  row: PricingRow;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(String(row.input_per_mtok));
  const [cached, setCached] = useState(String(row.cached_input_per_mtok));
  const [output, setOutput] = useState(String(row.output_per_mtok));

  useEffect(() => {
    setInput(String(row.input_per_mtok));
    setCached(String(row.cached_input_per_mtok));
    setOutput(String(row.output_per_mtok));
  }, [row]);

  const save = useMutation({
    mutationFn: async () => {
      const patch = {
        input_per_mtok: Number(input),
        cached_input_per_mtok: Number(cached),
        output_per_mtok: Number(output),
      };
      if ([patch.input_per_mtok, patch.cached_input_per_mtok, patch.output_per_mtok].some((n) => !Number.isFinite(n) || n < 0)) {
        throw new Error("Rates must be non-negative numbers");
      }
      const { error } = await supabase.from("ai_model_pricing").update(patch).eq("model", row.model);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Updated pricing for ${row.model}`);
      setEditing(false);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isPlaceholder = /PLACEHOLDER/i.test(row.notes ?? "");
  const inputCell = rate2(row.input_per_mtok);
  const cachedCell = rate2(row.cached_input_per_mtok);
  const outputCell = rate2(row.output_per_mtok);

  return (
    <TableRow className="border-b" style={{ borderColor: NAVY_LIGHT }}>
      <TableCell className="py-2.5">
        <ModelCell model={row.model} />
      </TableCell>
      <TableCell className="py-2.5 text-xs whitespace-nowrap">{providerLabel(row.provider)}</TableCell>
      <TableCell className="py-2.5 text-right tabular-nums text-xs">
        {editing ? (
          <Input value={input} onChange={(e) => setInput(e.target.value)} className="h-8 w-24 ml-auto text-right tabular-nums" inputMode="decimal" />
        ) : (
          inputCell ?? <Muted />
        )}
      </TableCell>
      <TableCell className="py-2.5 text-right tabular-nums text-xs">
        {editing ? (
          <Input value={cached} onChange={(e) => setCached(e.target.value)} className="h-8 w-24 ml-auto text-right tabular-nums" inputMode="decimal" />
        ) : (
          cachedCell ?? <Muted />
        )}
      </TableCell>
      <TableCell className="py-2.5 text-right tabular-nums text-xs">
        {editing ? (
          <Input value={output} onChange={(e) => setOutput(e.target.value)} className="h-8 w-24 ml-auto text-right tabular-nums" inputMode="decimal" />
        ) : (
          outputCell ?? <Muted />
        )}
      </TableCell>
      <TableCell className="py-2.5 text-right">
        {isPlaceholder ? <EstBadge /> : <Muted />}
      </TableCell>
      <TableCell className="py-2.5">
        {canEdit && (
          editing ? (
            <div className="flex gap-1 justify-end">
              <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={save.isPending}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => save.mutate()}
                disabled={save.isPending}
                style={{ backgroundColor: NAVY, color: "white" }}
              >
                Save
              </Button>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Edit
              </Button>
            </div>
          )
        )}
      </TableCell>
    </TableRow>
  );
}

function RequestPricingRow({
  row,
  canEdit,
  onSaved,
}: {
  row: PricingRow;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [perCall, setPerCall] = useState(String(row.per_call_usd ?? 0));

  useEffect(() => {
    setPerCall(String(row.per_call_usd ?? 0));
  }, [row]);

  const save = useMutation({
    mutationFn: async () => {
      const n = Number(perCall);
      if (!Number.isFinite(n) || n < 0) throw new Error("Rate must be a non-negative number");
      const { error } = await supabase
        .from("ai_model_pricing")
        .update({ per_call_usd: n })
        .eq("model", row.model);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Updated pricing for ${row.model}`);
      setEditing(false);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isPlaceholder = /PLACEHOLDER/i.test(row.notes ?? "");
  const priceCell = row.per_call_usd == null ? null : `$${Number(row.per_call_usd).toFixed(4)}`;

  return (
    <TableRow className="border-b" style={{ borderColor: NAVY_LIGHT }}>
      <TableCell className="py-2.5">
        <ModelCell model={row.model} />
      </TableCell>
      <TableCell className="py-2.5 text-xs whitespace-nowrap">{providerLabel(row.provider)}</TableCell>
      <TableCell className="py-2.5 text-right tabular-nums text-xs">
        {editing ? (
          <Input
            value={perCall}
            onChange={(e) => setPerCall(e.target.value)}
            className="h-8 w-28 ml-auto text-right tabular-nums"
            inputMode="decimal"
          />
        ) : (
          priceCell ?? <Muted />
        )}
      </TableCell>
      <TableCell className="py-2.5 text-xs text-muted-foreground whitespace-nowrap">
        {row.unit_label ?? "per call"}
      </TableCell>
      <TableCell className="py-2.5 text-right">
        {isPlaceholder ? <EstBadge /> : <Muted />}
      </TableCell>
      <TableCell className="py-2.5">
        {canEdit && (
          editing ? (
            <div className="flex gap-1 justify-end">
              <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={save.isPending}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => save.mutate()}
                disabled={save.isPending}
                style={{ backgroundColor: NAVY, color: "white" }}
              >
                Save
              </Button>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Edit
              </Button>
            </div>
          )
        )}
      </TableCell>
    </TableRow>
  );
}
