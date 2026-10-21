import { useState } from "react";
import { Link } from "react-router-dom";
import { Info, Loader2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SubmarketPicker } from "@/components/SubmarketPicker";
import {
  COMBINED,
  CYCLICAL_SIGNALS,
  formatSignal,
  useCurrentImport,
  useSubmarketSeries,
  useSubmarketSignals,
  type SubmarketSignals,
} from "@/lib/marketData";
import { useAssignSubmarket } from "@/hooks/useAssignSubmarket";
import { cn } from "@/lib/utils";

type DealLike = {
  id: string;
  city?: string | null;
  state?: string | null;
  msa?: string | null;
  costar_submarket_code?: string | null;
  costar_submarket_source?: string | null;
  costar_submarket_note?: string | null;
};

const fmtUnits = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString());

/**
 * Where the deal's submarket sits in the supply cycle, from the latest CoStar
 * export. This is the "cyclical" leg of rent-growth propensity, the 12–36 month
 * timing signal. Structural (jobs, migration, income) and asset-level
 * positioning (rent gap to comps) are separate legs and aren't in this panel.
 */
export function SubmarketSignalsPanel({ deal }: { deal: DealLike }) {
  const code = deal.costar_submarket_code ?? null;
  const [scope, setScope] = useState<string>(COMBINED);
  const { assign, saving } = useAssignSubmarket(deal.id);
  const { data: current, isLoading: loadingImport } = useCurrentImport();
  const { data: rows = [], isLoading: loadingSignals } = useSubmarketSignals(code);
  const { data: series = [] } = useSubmarketSeries(code, current?.id);

  const scopes = rows.map((r) => r.scope!).sort((a, b) => (a === COMBINED ? -1 : b === COMBINED ? 1 : a.localeCompare(b)));
  const s: SubmarketSignals | undefined = rows.find((r) => r.scope === scope) ?? rows.find((r) => r.scope === COMBINED);

  if (loadingImport) return null;

  if (!current) {
    return (
      <Card className="surface-card border-hairline">
        <CardContent className="py-4 text-sm text-muted-foreground">
          No CoStar market data has been loaded yet. An admin can upload the quarterly export on{" "}
          <Link to="/market-data" className="underline">
            Market Data
          </Link>
          .
        </CardContent>
      </Card>
    );
  }

  const asOfYear = Number(current.as_of.slice(0, 4));
  const histMean = s?.occupancy_10yr_mean ?? null;

  return (
    <Card className="surface-card border-hairline">
      <CardContent className="pt-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <SubmarketPicker
            value={code}
            onChange={assign}
            city={deal.city}
            state={deal.state}
            msa={deal.msa}
            disabled={saving}
          />
          {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {scopes.length > 1 && (
            <div className="flex rounded-md border border-hairline overflow-hidden text-xs">
              {scopes.map((sc) => (
                <button
                  key={sc}
                  type="button"
                  onClick={() => setScope(sc)}
                  className={cn(
                    "px-2.5 py-1",
                    sc === (s?.scope ?? COMBINED) ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  {sc === COMBINED ? "All classes" : sc}
                </button>
              ))}
            </div>
          )}
        </div>

        {deal.costar_submarket_source === "ai" && (
          <p className="text-xs text-muted-foreground">
            {code ? "Picked automatically from the address" : "Couldn't place this automatically"}
            {deal.costar_submarket_note ? `: ${deal.costar_submarket_note}` : "."}
            {code && " Change it above if it's wrong."}
          </p>
        )}

        {!code && (
          <p className="text-sm text-muted-foreground">
            Pick the CoStar submarket this property sits in. The New Supply figure then switches from Esri's
            housing-unit growth to the units actually under construction nearby, and the deal is ranked against about 2,000 submarkets nationally.
          </p>
        )}

        {code && loadingSignals && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}

        {code && !loadingSignals && !s && (
          <p className="text-sm text-destructive">
            Submarket {code} isn't in the {current.as_of} export. Pick it again from the list.
          </p>
        )}

        {s && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <ScoreTile signals={s} />
              <Fact label="Inventory" value={fmtUnits(s.inventory)} hint="units" />
              <Fact label="Under construction" value={fmtUnits(s.uc_units)} hint={formatSignal(s.uc_pct, "pct") + " of stock"} />
              <Fact
                label="Delivered, last 12 mo"
                value={fmtUnits(s.delivered_t12)}
                hint={formatSignal(s.delivered_t12_pct, "pct") + " of stock"}
              />
              <Fact
                label="Occupancy"
                value={formatSignal(s.occupancy, "pct")}
                hint={histMean != null ? `10-yr mean ${formatSignal(histMean, "pct")}` : undefined}
              />
            </div>

            <TooltipProvider delayDuration={150}>
              <ul className="divide-y divide-border/60">
                {CYCLICAL_SIGNALS.map((sig) => (
                  <SignalRow
                    key={sig.key}
                    label={sig.label}
                    help={sig.help}
                    value={formatSignal(s[sig.key] as number | null, sig.format)}
                    pct={s[sig.pct] as number | null}
                  />
                ))}
              </ul>
            </TooltipProvider>

            <p className="text-[11px] text-muted-foreground">
              Bars show where this submarket ranks for rent growth among {s.scope === COMBINED ? "all" : s.scope}{" "}
              submarkets of 500+ units; further right is better. CoStar {current.as_of}
              {s.scope === COMBINED && `, ${current.slices.join(" + ")} combined`}.
              {!s.eligible && " Under 500 units: shown, not ranked."}
            </p>

            {series.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <MiniChart title="Net deliveries, units / yr (all classes)" asOfYear={asOfYear}>
                  <BarChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                    <XAxis dataKey="year" tickLine={false} axisLine={false} fontSize={10} />
                    <YAxis tickLine={false} axisLine={false} fontSize={10} width={40} />
                    <ChartTooltip
                      cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                      formatter={(v: number) => [fmtUnits(v), "Net deliveries"]}
                      labelFormatter={(y) => periodLabel(Number(y), asOfYear)}
                      contentStyle={tooltipStyle}
                    />
                    <ReferenceLine x={asOfYear} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                    <Bar dataKey="delivered" radius={[4, 4, 0, 0]} maxBarSize={18}>
                      {series.map((p) => (
                        <Cell
                          key={p.year}
                          fill="hsl(var(--primary))"
                          fillOpacity={p.kind === "forecast" ? 0.35 : 0.9}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </MiniChart>
                <MiniChart title="Occupancy (all classes)" asOfYear={asOfYear}>
                  <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                    <XAxis dataKey="year" tickLine={false} axisLine={false} fontSize={10} />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      fontSize={10}
                      width={40}
                      domain={["auto", "auto"]}
                      tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                    />
                    <ChartTooltip
                      formatter={(v: number) => [formatSignal(v, "pct"), "Occupancy"]}
                      labelFormatter={(y) => periodLabel(Number(y), asOfYear)}
                      contentStyle={tooltipStyle}
                    />
                    <ReferenceLine x={asOfYear} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                    <Line
                      type="monotone"
                      dataKey="occupancy"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </MiniChart>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

const tooltipStyle = {
  fontSize: 11,
  borderRadius: 6,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--popover))",
  color: "hsl(var(--popover-foreground))",
};

function periodLabel(year: number, asOfYear: number) {
  if (year > asOfYear) return `${year} (CoStar forecast)`;
  if (year === asOfYear) return `${year} (CoStar full-year estimate)`;
  return String(year);
}

function MiniChart({ title, asOfYear, children }: { title: string; asOfYear: number; children: React.ReactElement }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
        <span className="text-[10px] text-muted-foreground">after dashed line ({asOfYear}): forecast</span>
      </div>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-md border border-hairline p-3 min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">{label}</div>
      <div className="text-lg font-serif-display tabular-nums leading-tight">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground tabular-nums truncate">{hint}</div>}
    </div>
  );
}

function ScoreTile({ signals }: { signals: SubmarketSignals }) {
  const n = CYCLICAL_SIGNALS.filter((sig) => signals[sig.pct] != null).length;
  const score = signals.cyclical_score;
  return (
    <div className="rounded-md border border-hairline p-3 min-w-0 col-span-2 sm:col-span-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cyclical score</div>
      <div className="text-2xl font-serif-display tabular-nums leading-tight">
        {score ?? "—"}
        {score != null && <span className="text-sm text-muted-foreground"> / 100</span>}
      </div>
      <div className="text-[10px] text-muted-foreground">
        {score != null ? `mean rank of ${n} of 6 signals` : `needs 4 of 6 signals; has ${n}`}
      </div>
    </div>
  );
}

function SignalRow({ label, help, value, pct }: { label: string; help: string; value: string; pct: number | null }) {
  return (
    <li className="py-2 grid grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,9rem)] sm:grid-cols-[minmax(0,14rem)_6rem_minmax(0,1fr)] items-center gap-3 text-sm">
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="truncate">{label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label={`About ${label}`} className="text-muted-foreground shrink-0">
              <Info className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">{help}</TooltipContent>
        </Tooltip>
      </span>
      <span className="tabular-nums text-right">{value}</span>
      <span className="flex items-center gap-2 min-w-0">
        <span className="relative h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
          {pct != null && (
            <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${Math.max(2, pct * 100)}%` }} />
          )}
        </span>
        <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
          {pct != null ? `${Math.round(pct * 100)}` : "—"}
        </span>
      </span>
    </li>
  );
}
