import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, Info, Loader2, Minus, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usePipelineRentScores } from "@/hooks/usePipelineRentScores";
import { useCurrentImport, useSubmarketSeries } from "@/lib/marketData";
import { forecastCheck, LEGS, type DealScore, type Factor, type Leg } from "@/lib/rentGrowthScore";
import { cn } from "@/lib/utils";

type DealLike = {
  id: string;
  costar_submarket_code?: string | null;
  unit_count?: number | null;
  vintage_year?: number | null;
  pillar_scores?: unknown;
  ai_score_summary?: string | null;
};

const scoreTone = (v: number | null) =>
  v == null ? "text-muted-foreground" : v >= 60 ? "text-emerald-600" : v < 40 ? "text-amber-600" : "text-foreground";

/**
 * Rent-growth propensity on three separate clocks. See lib/rentGrowthScore for
 * why the three are never blended into one number.
 */
export function AiScoreTab({ deal }: { deal: DealLike }) {
  const { data, isLoading, error } = usePipelineRentScores(deal.id);
  const { data: current } = useCurrentImport();
  const { data: series = [] } = useSubmarketSeries(deal.costar_submarket_code, current?.id);

  const score = data?.scores.get(deal.id) ?? null;
  const entry = data?.entries.find((e) => e.deal.id === deal.id) ?? null;
  const check = entry ? forecastCheck(entry.signals, entry.deal) : null;

  const deliveries = useMemo(() => {
    const asOfYear = current ? Number(current.as_of.slice(0, 4)) : null;
    return series
      .filter((p) => asOfYear == null || (p.year >= asOfYear - 2 && p.year <= asOfYear + 2))
      .map((p) => ({
        year: p.year,
        kind: p.kind,
        share: p.delivered != null && p.inventory ? (p.delivered / p.inventory) * 100 : null,
      }));
  }, [series, current]);

  const ranked = useMemo(() => {
    if (!data) return [];
    return data.entries
      .map((e) => ({ e, s: data.scores.get(e.deal.id)! }))
      .filter((r) => r.s && (r.e.deal.id === deal.id || r.s.legs.cyclical.score != null || r.s.legs.micro.score != null || r.s.legs.structural.score != null))
      .sort((a, b) => (b.s.legs.cyclical.score ?? -1) - (a.s.legs.cyclical.score ?? -1));
  }, [data, deal.id]);

  if (isLoading)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Scoring against the live pipeline…
      </div>
    );
  if (error)
    return <p className="text-sm text-destructive py-8">Couldn't load scores: {(error as Error).message}</p>;
  if (!score || !data) return null;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-8">
        {/* ---------- three scores */}
        <section>
          <Header
            title="Rent Growth Score"
            right={
              <>
                Three scores, kept separate · {data.livePeers} live deals
                {current ? ` · CoStar ${current.as_of}` : ""}
              </>
            }
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {LEGS.map((l) => (
              <LegCard key={l.key} label={l.label} horizon={l.horizon} basis={l.basis} leg={score.legs[l.key]} />
            ))}
          </div>
          <div className="mt-3 rounded-md border-l-4 border-primary bg-muted/40 px-4 py-3">
            <div className="font-serif-display text-lg leading-snug">{score.headline.title}</div>
            <p className="text-sm text-muted-foreground mt-0.5">{score.headline.body}</p>
          </div>
          {!data.currentIsActive && (
            <p className="text-[11px] text-muted-foreground mt-2">
              This deal isn't in an active stage. It's scored against the live pipeline but doesn't count toward anyone else's rank.
            </p>
          )}
        </section>

        {/* ---------- buybox pillars: how the deal scores on the thesis, weighted */}
        <section>
          <Header title="Buybox Pillars" right="The six pillars every deal is scored on, with their weights" />
          {deal.pillar_scores ? (
            <ScoreBreakdown data={deal.pillar_scores as never} summary={deal.ai_score_summary} />
          ) : (
            <p className="text-sm text-muted-foreground">This deal hasn't been pillar-scored yet.</p>
          )}
        </section>

        {/* ---------- factors */}
        <section>
          <Header title="What Moves Each Score" right="Bar = rank for rent growth; further right is better. Tick = pipeline median." />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {LEGS.map((l) => (
              <Card key={l.key} className="surface-card border-hairline">
                <CardContent className="pt-4">
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wider">{l.label}</span>
                    <span className="text-[10px] text-muted-foreground">{l.basis}</span>
                  </div>
                  <ul className="divide-y divide-border/60">
                    {score.legs[l.key].factors.map((f) => (
                      <FactorRow key={f.key} f={f} />
                    ))}
                  </ul>
                  {l.key === "cyclical" && !deal.costar_submarket_code && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Pick the CoStar submarket in Submarket Signals on the Overview tab to score this leg.
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* ---------- deliveries + forecast check */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card className="surface-card border-hairline">
            <CardContent className="pt-4">
              <div className="text-xs font-semibold uppercase tracking-wider mb-1">Deliveries, % of submarket inventory</div>
              {deliveries.length ? (
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={deliveries} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                      <XAxis dataKey="year" tickLine={false} axisLine={false} fontSize={10} />
                      <YAxis tickLine={false} axisLine={false} fontSize={10} width={36} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                      <ChartTooltip
                        cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                        formatter={(v: number) => [`${v.toFixed(1)}% of inventory`, "Net deliveries"]}
                        contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))" }}
                      />
                      <Bar dataKey="share" radius={[4, 4, 0, 0]} maxBarSize={28}>
                        {deliveries.map((p) => (
                          <Cell key={p.year} fill="hsl(var(--primary))" fillOpacity={p.kind === "forecast" ? 0.35 : 0.9} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-6">No CoStar submarket picked for this deal.</p>
              )}
              <p className="text-[10px] text-muted-foreground mt-1">Faded bars are CoStar forecast. All classes.</p>
            </CardContent>
          </Card>

          <Card className="surface-card border-hairline">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider">Forecast check</span>
                {check?.review && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 px-2 py-0.5 text-[10px] font-semibold uppercase">
                    <AlertTriangle className="h-3 w-3" /> Review
                  </span>
                )}
              </div>
              <dl className="text-sm divide-y divide-border/60">
                <KV k="CoStar forecast, 3-yr CAGR" v={pct(check?.forecast)} />
                <KV k="Submarket effective rent, trailing 12 mo" v={pct(check?.t12)} />
                <KV k="This asset, same-unit rent, 12 mo (HelloData)" v={pct(check?.asset)} />
                <KV
                  k="Trailing vs forecast"
                  v={check?.gapBps != null ? `${check.gapBps > 0 ? "+" : check.gapBps < 0 ? "−" : ""}${Math.abs(check.gapBps)} bps` : "—"}
                />
              </dl>
              <p className="text-[10px] text-muted-foreground mt-2">
                A forecast 150 bps or more away from what rents actually did is CoStar betting on a turn. Check it before an underwriting leans on it.
                CoStar's forecast covers the whole submarket, and its rents are weighted toward newer stock.
              </p>
            </CardContent>
          </Card>
        </section>

        {/* ---------- pipeline */}
        <section>
          <Header title="Live Pipeline" right="Ranked by cyclical score. No blended rank." />
          <div className="border border-hairline rounded-md overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Deal</th>
                  <th className="text-left px-3 py-2 font-medium">Market</th>
                  <th className="text-right px-3 py-2 font-medium">Units</th>
                  {LEGS.map((l) => (
                    <th key={l.key} className="text-right px-3 py-2 font-medium">{l.label}</th>
                  ))}
                  <th className="text-right px-3 py-2 font-medium">Forecast gap</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map(({ e, s }) => {
                  const fc = forecastCheck(e.signals, e.deal);
                  const self = e.deal.id === deal.id;
                  return (
                    <tr key={e.deal.id} className={cn("border-t border-border", self && "bg-primary/5 font-medium")}>
                      <td className="px-3 py-1.5">
                        {self ? (
                          e.deal.property_name || "This deal"
                        ) : (
                          <Link to={`/deals/${e.deal.id}`} className="hover:underline">
                            {e.deal.property_name || "Untitled"}
                          </Link>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">{e.deal.city || e.deal.msa || "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{e.deal.unit_count ?? "—"}</td>
                      {LEGS.map((l) => (
                        <td key={l.key} className={cn("px-3 py-1.5 text-right tabular-nums", scoreTone(s.legs[l.key].score))}>
                          {s.legs[l.key].score ?? "—"}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        {fc.gapBps != null ? `${fc.gapBps > 0 ? "+" : fc.gapBps < 0 ? "−" : ""}${Math.abs(fc.gapBps)}bps` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <p className="text-[11px] text-muted-foreground">
          Scores are percentile ranks, not rent forecasts. Structural and micro rank this deal against the {data.livePeers} deals in active
          stages (a factor needs {5}+ deals with data to rank); cyclical ranks the CoStar submarket against every US submarket of 500+ units.
          A leg scores once at least half its factors are ranked. Market rent is CoStar's {score.slice} slice, inferred from vintage.
          Thresholds marked ✓/✗ are the Ansonia buybox.
        </p>
      </div>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------- pieces

function Header({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h2>
      {right && <span className="text-[11px] text-muted-foreground">{right}</span>}
    </div>
  );
}

function LegCard({ label, horizon, basis, leg }: { label: string; horizon: string; basis: string; leg: DealScore["legs"][Leg] }) {
  return (
    <div className="rounded-md border border-hairline p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-[11px] text-muted-foreground">{horizon}</div>
      <div className={cn("text-4xl font-serif-display tabular-nums leading-tight mt-2", scoreTone(leg.score))}>
        {leg.score ?? "—"}
        {leg.score != null && <span className="text-sm text-muted-foreground"> / 100</span>}
      </div>
      <div className="text-[10px] text-muted-foreground mt-1">
        {leg.score != null ? `percentile ${basis} · ${leg.ranked} of ${leg.factors.length} factors` : `not enough data · ${leg.ranked} of ${leg.factors.length} factors ranked`}
      </div>
    </div>
  );
}

function FactorRow({ f }: { f: Factor }) {
  return (
    <li className="py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="truncate">{f.label}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label={`About ${f.label}`} className="text-muted-foreground shrink-0">
                <Info className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              {f.help}
              <div className="mt-1 text-muted-foreground">Source: {f.source}</div>
            </TooltipContent>
          </Tooltip>
        </span>
        <span className="tabular-nums shrink-0">{f.display}</span>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="relative h-1.5 flex-1 rounded-full bg-muted">
          {f.pct != null && (
            <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${Math.max(2, f.pct * 100)}%` }} />
          )}
          {f.medianPct != null && (
            <span className="absolute -top-0.5 -bottom-0.5 w-px bg-foreground/60" style={{ left: `${f.medianPct * 100}%` }} />
          )}
        </span>
        <span className="w-7 text-right text-[11px] tabular-nums text-muted-foreground">{f.pct != null ? Math.round(f.pct * 100) : "—"}</span>
      </div>
      {f.thesis && (
        <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
          {f.thesis.pass === true ? (
            <Check className="h-3 w-3 text-emerald-600" />
          ) : f.thesis.pass === false ? (
            <X className="h-3 w-3 text-destructive" />
          ) : (
            <Minus className="h-3 w-3" />
          )}
          Thesis {f.thesis.label}
        </div>
      )}
    </li>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}

const pct = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`);
