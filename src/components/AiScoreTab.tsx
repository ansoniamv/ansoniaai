import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, Loader2, Minus, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { InfoTip, SourceBadge } from "@/components/DataSourceTip";
import { usePipelineRentScores } from "@/hooks/usePipelineRentScores";
import { useCurrentImport, useSubmarketSeries } from "@/lib/marketData";
import { forecastCheck, LEGS, MIN_PEERS, type DealScore, type Factor, type Leg } from "@/lib/rentGrowthScore";
import type { SourceInfo } from "@/lib/dataSources";
import { cn } from "@/lib/utils";

type DealLike = {
  id: string;
  costar_submarket_code?: string | null;
  new_supply_source?: string | null;
  unit_count?: number | null;
  vintage_year?: number | null;
  pillar_scores?: unknown;
  ai_score_summary?: string | null;
};

const scoreTone = (v: number | null) =>
  v == null ? "text-muted-foreground" : v >= 60 ? "text-emerald-600" : v < 40 ? "text-amber-600" : "text-foreground";

const COSTAR: SourceInfo = { vendor: "CoStar", detail: "CoStar submarket, all classes" };
const HELLODATA_TREND: SourceInfo = { vendor: "HelloData", detail: "HelloData same-unit asking rent, last 12 months" };

/** Plain-English explanations, one per label that isn't self-explanatory. */
const EXPLAIN = {
  structural:
    "Long-run demand: will more people with more income want to rent here over the next 5–10 years? Built from job growth, population growth, income growth and how many households rent. 0–100, ranked against the other deals in our active pipeline.",
  cyclical:
    "Timing: where this submarket sits in the supply cycle over the next 1–3 years. A wave of new buildings delivering means concessions and flat rents, whatever the long-run story. 0–100, ranked against every US CoStar submarket with 500+ units.",
  micro:
    "The asset itself: how much room this property's rents have to grow, given what its class rents for nearby, what local renters earn and how far below new Class A product it sits. 0–100, ranked against the other deals in our active pipeline.",
  percentile:
    "A percentile rank, not a forecast. 75 means this deal beats or ties 75% of the deals (or submarkets) it's compared with on that measure, for rent growth. 50 is the middle.",
  headline:
    "Chosen by fixed rules from the three scores (60+ counts as strong, under 40 as weak). The same three numbers always give the same sentence. It's a summary, not a separate judgement.",
  pillars:
    "Ansonia's buybox scoring. Each pillar is scored 0–100 from the signals inside it, then weighted by the % shown. Base is the weighted average of the pillars that have data. Thesis is an adjustment for fit with our written investment thesis. The big number is Base + Thesis. Confidence and '% weight' say how much of the model actually had data. Low confidence means most pillars are blank.",
  bar: "How the deal ranks on this one measure. Further right is better for rent growth, whichever way the raw number points (less supply and a bigger rent gap both fill the bar). The thin tick is the median deal in our pipeline.",
  thesis: "The Ansonia buybox threshold for this measure. ✓ passes, ✗ misses, – no data.",
  deliveries:
    "New apartment units completed each year as a share of all units in the submarket, all classes. Above roughly 3–4% a year, landlords usually compete on concessions. Faded bars are CoStar's forecast.",
  forecastCheck:
    "Compares CoStar's forecast of rent growth with what rents actually did over the last year. A big gap means the forecast assumes a turn that hasn't started yet, so don't underwrite to it without a reason.",
  forecast: "CoStar's base-case effective rent growth for the whole submarket, averaged per year over the next three years.",
  t12: "How much effective rents (asking rent minus concessions) actually changed in this submarket over the last 12 months, per CoStar.",
  asset: "How this property's own asking rents moved over 12 months, comparing the same units, per HelloData. Shows whether the asset is tracking its submarket.",
  forecastGap:
    "Trailing 12-month rent growth minus CoStar's 3-year forecast, in basis points (100 bps = 1%). Negative means CoStar expects rents to grow faster than they are now. Past ±150 bps it's flagged Review, because the forecast is betting on a change in direction.",
  review: "The forecast and actual rent growth are 150+ bps apart. Check why before relying on CoStar's forecast in underwriting.",
  ranking:
    "Sorted by Cyclical, because timing is the score that changes most between deals and over a hold. There's deliberately no blended rank: a great asset at the wrong moment and an average asset at the right one are different bets.",
};

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
    <div className="space-y-8">
      {/* ---------- three scores */}
      <section>
        <Header
          title="Rent Growth Score"
          tip={EXPLAIN.percentile}
          right={
            <>
              Three scores, kept separate · {data.livePeers} live deals
              {current ? ` · CoStar ${current.as_of}` : ""}
            </>
          }
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {LEGS.map((l) => (
            <LegCard key={l.key} label={l.label} horizon={l.horizon} basis={l.basis} tip={EXPLAIN[l.key]} leg={score.legs[l.key]} />
          ))}
        </div>
        <div className="mt-3 rounded-md border-l-4 border-primary bg-muted/40 px-4 py-3">
          <div className="font-serif-display text-lg leading-snug flex items-center gap-1.5">
            {score.headline.title}
            <InfoTip label="this summary">{EXPLAIN.headline}</InfoTip>
          </div>
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
        <Header title="Buybox Pillars" tip={EXPLAIN.pillars} right="The six pillars every deal is scored on, with their weights" />
        {deal.pillar_scores ? (
          <ScoreBreakdown data={deal.pillar_scores as never} summary={deal.ai_score_summary} newSupplySource={deal.new_supply_source} />
        ) : (
          <p className="text-sm text-muted-foreground">This deal hasn't been pillar-scored yet.</p>
        )}
      </section>

      {/* ---------- factors */}
      <section>
        <Header
          title="What Moves Each Score"
          tip={EXPLAIN.bar}
          right="Bar = rank for rent growth; further right is better. Tick = pipeline median. Badge = data source."
        />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {LEGS.map((l) => (
            <Card key={l.key} className="surface-card border-hairline">
              <CardContent className="pt-4">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1">
                    {l.label}
                    <InfoTip label={l.label}>{EXPLAIN[l.key]}</InfoTip>
                  </span>
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
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1">
                Deliveries, % of submarket inventory
                <InfoTip label="deliveries">{EXPLAIN.deliveries}</InfoTip>
              </span>
              <SourceBadge source={COSTAR} />
            </div>
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
              <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1">
                Forecast check
                <InfoTip label="the forecast check">{EXPLAIN.forecastCheck}</InfoTip>
              </span>
              {check?.review && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 px-2 py-0.5 text-[10px] font-semibold uppercase">
                  <AlertTriangle className="h-3 w-3" /> Review
                  <InfoTip label="Review" className="text-amber-700 dark:text-amber-400">{EXPLAIN.review}</InfoTip>
                </span>
              )}
            </div>
            <dl className="text-sm divide-y divide-border/60">
              <KV k="CoStar forecast, 3-yr CAGR" tip={EXPLAIN.forecast} source={COSTAR} v={pct(check?.forecast)} />
              <KV k="Submarket effective rent, trailing 12 mo" tip={EXPLAIN.t12} source={COSTAR} v={pct(check?.t12)} />
              <KV k="This asset, same-unit rent, 12 mo" tip={EXPLAIN.asset} source={HELLODATA_TREND} v={pct(check?.asset)} />
              <KV k="Forecast gap" tip={EXPLAIN.forecastGap} v={bps(check?.gapBps)} />
            </dl>
            <p className="text-[10px] text-muted-foreground mt-2">
              CoStar's forecast covers the whole submarket, and its rents are weighted toward newer stock.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* ---------- pipeline */}
      <section>
        <Header title="Live Pipeline" tip={EXPLAIN.ranking} right="Ranked by cyclical score. No blended rank." />
        <div className="border border-hairline rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Deal</th>
                <th className="text-left px-3 py-2 font-medium">Market</th>
                <th className="text-right px-3 py-2 font-medium">Units</th>
                {LEGS.map((l) => (
                  <th key={l.key} className="text-right px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      {l.label}
                      <InfoTip label={l.label}>{EXPLAIN[l.key]}</InfoTip>
                    </span>
                  </th>
                ))}
                <th className="text-right px-3 py-2 font-medium">
                  <span className="inline-flex items-center gap-1">
                    Forecast gap
                    <InfoTip label="forecast gap">{EXPLAIN.forecastGap}</InfoTip>
                  </span>
                </th>
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
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{bps(fc.gapBps)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-[11px] text-muted-foreground">
        Scores are percentile ranks, not rent forecasts. Structural and micro rank this deal against the {data.livePeers} deals in active
        stages (a factor needs {MIN_PEERS}+ deals with data to rank); cyclical ranks the CoStar submarket against every US submarket of 500+ units.
        A leg scores once at least half its factors are ranked. Market rent is CoStar's {score.slice} slice, inferred from vintage.
        Thresholds marked ✓/✗ are the Ansonia buybox.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function Header({ title, tip, right }: { title: string; tip?: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-1">
        {title}
        {tip && <InfoTip label={title}>{tip}</InfoTip>}
      </h2>
      {right && <span className="text-[11px] text-muted-foreground">{right}</span>}
    </div>
  );
}

function LegCard({
  label,
  horizon,
  basis,
  tip,
  leg,
}: {
  label: string;
  horizon: string;
  basis: string;
  tip: string;
  leg: DealScore["legs"][Leg];
}) {
  const vendors = [...new Map(leg.factors.flatMap((f) => f.sources).map((s) => [s.vendor, s])).values()];
  return (
    <div className="rounded-md border border-hairline p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {label}
        <InfoTip label={label}>{tip}</InfoTip>
      </div>
      <div className="text-[11px] text-muted-foreground">{horizon}</div>
      <div className={cn("text-4xl font-serif-display tabular-nums leading-tight mt-2", scoreTone(leg.score))}>
        {leg.score ?? "—"}
        {leg.score != null && <span className="text-sm text-muted-foreground"> / 100</span>}
      </div>
      <div className="text-[10px] text-muted-foreground mt-1">
        {leg.score != null ? `percentile ${basis} · ${leg.ranked} of ${leg.factors.length} factors` : `not enough data · ${leg.ranked} of ${leg.factors.length} factors ranked`}
      </div>
      <div className="flex flex-wrap gap-1 mt-2">
        {vendors.map((s) => (
          <SourceBadge key={s.vendor} source={{ vendor: s.vendor, detail: `${label} uses ${s.vendor} data. Hover a factor's badge below for the exact measure.` }} />
        ))}
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
          <InfoTip label={f.label}>{f.help}</InfoTip>
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
      <div className="mt-1 flex flex-wrap items-center justify-between gap-1">
        <span className="flex flex-wrap gap-1">
          {f.sources.map((s, i) => (
            <SourceBadge key={i} source={s} />
          ))}
        </span>
        {f.thesis && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            {f.thesis.pass === true ? (
              <Check className="h-3 w-3 text-emerald-600" />
            ) : f.thesis.pass === false ? (
              <X className="h-3 w-3 text-destructive" />
            ) : (
              <Minus className="h-3 w-3" />
            )}
            Thesis {f.thesis.label}
            <InfoTip label="the thesis check">{EXPLAIN.thesis}</InfoTip>
          </span>
        )}
      </div>
    </li>
  );
}

function KV({ k, v, tip, source }: { k: string; v: string; tip: string; source?: SourceInfo }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <dt className="text-muted-foreground flex items-center gap-1 min-w-0">
        <span className="truncate">{k}</span>
        <InfoTip label={k}>{tip}</InfoTip>
        {source && <SourceBadge source={source} />}
      </dt>
      <dd className="tabular-nums shrink-0">{v}</dd>
    </div>
  );
}

const pct = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`);
const bps = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)} bps`);
