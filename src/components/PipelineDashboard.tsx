import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { TrendingUp, Layers, Percent, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DealThumbnail } from "@/components/DealThumbnail";
import type { Deal } from "@/hooks/useDeals";
import type { HelloDataPayload } from "@/lib/dealScoring";

const TIER_ORDER = [
  "Tier 1 – Strong Fit",
  "Tier 2 – Fit",
  "Tier 3 – Marginal",
  "Tier 4 – Weak",
  "Disqualified",
] as const;

const TIER_STYLES: Record<string, string> = {
  "Tier 1 – Strong Fit": "bg-emerald-600 text-white border-emerald-700",
  "Tier 2 – Fit": "bg-primary text-primary-foreground border-primary",
  "Tier 3 – Marginal": "bg-amber-500 text-white border-amber-600",
  "Tier 4 – Weak": "bg-muted text-foreground border-border",
  Disqualified: "bg-destructive/10 text-destructive border-destructive/30",
};

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

function rentLagPct(deal: Deal): number | null {
  const payload = (deal as any).hellodata_payload as HelloDataPayload | null | undefined;
  const inPlace = (deal as any).in_place_avg_rent as number | null | undefined;
  if (!payload || typeof inPlace !== "number") return null;
  const market =
    payload.market_rent_per_unit ?? payload.avg_market_rent ?? payload.market_rent ?? null;
  if (typeof market !== "number" || market <= 0) return null;
  return ((market - inPlace) / market) * 100;
}

function dealDate(deal: Deal): number {
  const d = (deal as any).scored_at ?? (deal as any).created_at ?? null;
  return d ? new Date(d).getTime() : 0;
}

export function PipelineDashboard({ deals }: { deals: Deal[] }) {
  const navigate = useNavigate();

  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    TIER_ORDER.forEach((t) => (counts[t] = 0));
    let tier12Upside = 0;
    const lags: number[] = [];
    deals.forEach((d) => {
      const tier = ((d as any).deal_tier as string) ?? "Tier 4 – Weak";
      counts[tier] = (counts[tier] ?? 0) + 1;
      if (tier === "Tier 1 – Strong Fit" || tier === "Tier 2 – Fit") {
        const u = (d as any).value_add_upside as number | null;
        if (typeof u === "number" && Number.isFinite(u)) tier12Upside += u;
      }
      const lag = rentLagPct(d);
      if (lag != null) lags.push(lag);
    });
    const avgLag = lags.length ? lags.reduce((a, b) => a + b, 0) / lags.length : null;
    return { counts, tier12Upside, avgLag, total: deals.length };
  }, [deals]);

  const newest = useMemo(
    () => [...deals].sort((a, b) => dealDate(b) - dealDate(a)).slice(0, 6),
    [deals]
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* KPI strip — spans 2 cols on lg */}
      <div className="lg:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={<Layers className="h-4 w-4" />}
          label="Total Deals"
          value={stats.total.toString()}
        />
        <KpiCard
          icon={<Sparkles className="h-4 w-4 text-emerald-600" />}
          label="Tier 1 + 2"
          value={(stats.counts["Tier 1 – Strong Fit"] + stats.counts["Tier 2 – Fit"]).toString()}
          sub={`${stats.counts["Tier 1 – Strong Fit"]} strong / ${stats.counts["Tier 2 – Fit"]} fit`}
        />
        <KpiCard
          icon={<TrendingUp className="h-4 w-4 text-primary" />}
          label="Upside (T1+T2)"
          value={fmtMoney(stats.tier12Upside)}
          sub="Cumulative value-add"
          serif
        />
        <KpiCard
          icon={<Percent className="h-4 w-4 text-muted-foreground" />}
          label="Avg Rent Lag"
          value={stats.avgLag != null ? `${stats.avgLag.toFixed(1)}%` : "—"}
          sub={`${deals.filter((d) => rentLagPct(d) != null).length} with market data`}
        />

        {/* Tier breakdown */}
        <Card className="surface-card border-hairline col-span-2 md:col-span-4">
          <CardHeader className="py-3">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              By Tier
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-1.5">
              {TIER_ORDER.map((tier) => {
                const n = stats.counts[tier] ?? 0;
                const pct = stats.total ? (n / stats.total) * 100 : 0;
                return (
                  <div key={tier} className="grid grid-cols-[180px_1fr_40px] items-center gap-3 text-xs">
                    <Badge variant="outline" className={`${TIER_STYLES[tier]} justify-center`}>
                      {tier}
                    </Badge>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary/70"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="tabular-nums text-right">{n}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Newest feed */}
      <Card className="surface-card border-hairline">
        <CardHeader className="py-3">
          <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Newest Deals
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {newest.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deals yet.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {newest.map((d) => {
                const tier = ((d as any).deal_tier as string) ?? "Tier 4 – Weak";
                const ts = dealDate(d);
                return (
                  <li
                    key={d.id}
                    onClick={() => navigate(`/deals/${d.id}`)}
                    className="py-2 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex items-start justify-between gap-2 flex-1 min-w-0">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{d.property_name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {[d.city, d.state].filter(Boolean).join(", ") || "—"}
                            {ts > 0 && ` · ${new Date(ts).toLocaleDateString()}`}
                          </p>
                        </div>
                        <Badge variant="outline" className={`${TIER_STYLES[tier]} shrink-0 text-[10px]`}>
                          {tier.replace(/–.*$/, "").trim()}
                        </Badge>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  serif = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  serif?: boolean;
}) {
  return (
    <Card className="surface-card border-hairline">
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {icon}
          {label}
        </div>
        <p className={`mt-2 text-2xl tabular-nums ${serif ? "font-serif-display" : "font-display"}`}>
          {value}
        </p>
        {sub && <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">{sub}</p>}
      </CardContent>
    </Card>
  );
}
