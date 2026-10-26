import { useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { describeRange, formatSignalValue, missingHint } from "@/lib/buyboxSignalFormat";
import { cn } from "@/lib/utils";
import type {
  Confidence,
  Coverage,
  PillarResult,
  SignalResult,
} from "../../supabase/functions/_shared/pipelineScoreEngine";

/**
 * deals.pillar_scores as deal-score writes it. Version 2 (pipelineScoreEngine)
 * adds each signal's range, description and source and each pillar's points;
 * a deal scored before that has none of them until it is rescored.
 */
type Breakdown = {
  version?: 2;
  base_score: number;
  final_score: number;
  adjustment: number;
  pillars: Array<Partial<PillarResult> & Pick<PillarResult, "key" | "name" | "weight" | "score"> & {
    signals: Array<Partial<SignalResult> & Pick<SignalResult, "name" | "field_source" | "raw_value" | "score" | "weight">>;
  }>;
  confidence?: Confidence;
  coverage?: Coverage;
};
type Pillar = Breakdown["pillars"][number];
type Signal = Pillar["signals"][number];

// Same tones as the Rent Growth score above it on the AI Score tab.
const scoreTone = (v: number | null | undefined) =>
  v == null ? "text-muted-foreground" : v >= 60 ? "text-emerald-600" : v < 40 ? "text-amber-600" : "text-foreground";

const CONFIDENCE: Record<Confidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence: thesis adjustment skipped",
  insufficient: "Not enough data to score",
};

/** deal-score's fallback summary only restates the numbers shown here. */
const isTemplateSummary = (s: string) => /^Base score \d+ from \d+ of \d+ pillars/.test(s);

export function ScoreBreakdown({
  data,
  summary,
}: {
  data: Breakdown | null | undefined;
  summary: string | null | undefined;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!data) return null;
  const v2 = data.version === 2;
  const aiSummary = summary && !isTemplateSummary(summary) ? summary : null;
  const cov = data.coverage;

  return (
    <div className="space-y-3">
      {/* ---------- headline */}
      <div className="rounded-md border border-hairline p-4 grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-6 gap-y-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Buybox score</div>
          <div className={cn("text-4xl font-serif-display tabular-nums leading-tight mt-1", scoreTone(data.final_score))}>
            {data.final_score}
            <span className="text-sm text-muted-foreground"> / 100</span>
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums mt-1">
            Pillars {data.base_score} · thesis {data.adjustment > 0 ? "+" : data.adjustment < 0 ? "−" : "±"}
            {Math.abs(data.adjustment)}
          </div>
        </div>
        <div className="min-w-0 space-y-1.5">
          <div className="text-[11px] text-muted-foreground">
            {data.confidence ? CONFIDENCE[data.confidence] : null}
            {cov ? ` · ${cov.pillars_covered} of ${cov.pillars_total} pillars, ${cov.signals_covered} of ${cov.signals_total} signals have data` : null}
          </div>
          {aiSummary ? (
            <p className="text-sm leading-relaxed">{aiSummary}</p>
          ) : (
            <p className="text-sm text-muted-foreground leading-relaxed">
              Each pillar averages its signals on a 0–100 scale, and the pillars are weighted into the score. Signals with no data are left
              out rather than counted as zero. The AI thesis check then moves the score by up to ±10.
            </p>
          )}
          {!v2 && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              Scored before the signal fixes. Rescore to see sources and scoring ranges.
            </p>
          )}
        </div>
      </div>

      {/* ---------- pillars */}
      <div className="rounded-md border border-hairline divide-y divide-border/60">
        <div className="hidden sm:grid grid-cols-[1fr_6rem_2.5rem_4rem] gap-3 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>Pillar</span>
          <span />
          <span className="text-right">Score</span>
          <span className="text-right">Adds</span>
        </div>
        {data.pillars.map((p) => (
          <PillarRow
            key={p.key}
            p={p}
            v2={v2}
            isOpen={open[p.key] ?? false}
            onToggle={() => setOpen((o) => ({ ...o, [p.key]: !o[p.key] }))}
          />
        ))}
      </div>
    </div>
  );
}

function PillarRow({ p, v2, isOpen, onToggle }: { p: Pillar; v2: boolean; isOpen: boolean; onToggle: () => void }) {
  const scored = p.signals.filter((s) => s.score != null);
  const missing = p.signals.filter((s) => s.score == null);
  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <CollapsibleTrigger className="w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors">
        <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_6rem_2.5rem_4rem] items-center gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <ChevronRight className={cn("h-3.5 w-3.5 mt-1 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{p.name}</div>
              <div className="text-[11px] text-muted-foreground">
                {p.weight}% of score · {scored.length} of {p.signals.length} signals
              </div>
            </div>
          </div>
          <span className="hidden sm:block relative h-1.5 rounded-full bg-muted">
            {p.score != null && (
              <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${Math.max(2, p.score)}%` }} />
            )}
          </span>
          <span className={cn("text-right text-lg font-serif-display tabular-nums", scoreTone(p.score))}>{p.score ?? "—"}</span>
          <span className="hidden sm:block text-right text-[11px] text-muted-foreground tabular-nums">
            {p.points != null ? `+${p.points.toFixed(1)} pts` : "—"}
          </span>
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-4 pb-4 sm:pl-10 space-y-3">
          {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
          {scored.length > 0 && (
            <ul className="divide-y divide-border/60">
              {scored.map((s) => (
                <SignalRow key={s.field_source + s.name} s={s} v2={v2} pillarSignals={p.signals} />
              ))}
            </ul>
          )}
          {missing.length > 0 && (
            <div className="rounded-md bg-muted/40 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Not scored: no data
              </div>
              <ul className="space-y-0.5">
                {missing.map((s) => {
                  const hint = missingHint(s.field_source);
                  return (
                    <li key={s.field_source + s.name} className="text-xs flex flex-wrap gap-x-2">
                      <span>{s.name}</span>
                      {hint && <span className="text-muted-foreground">{hint}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SignalRow({ s, v2, pillarSignals }: { s: Signal; v2: boolean; pillarSignals: Signal[] }) {
  const range = v2 && s.method ? describeRange(s.field_source, s as Required<Signal>) : null;
  const scoredWeight = pillarSignals.filter((x) => x.score != null).reduce((a, x) => a + x.weight, 0);
  const share = scoredWeight > 0 ? Math.round((s.weight / scoredWeight) * 100) : null;
  return (
    <li className="py-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="truncate">{s.name}</span>
          {(s.description || range) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label={`About ${s.name}`} className="text-muted-foreground shrink-0">
                  <Info className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs space-y-1">
                {s.description && <p>{s.description}</p>}
                {range && <p className="text-muted-foreground">{range}</p>}
                {share != null && <p className="text-muted-foreground">{share}% of this pillar's score.</p>}
              </TooltipContent>
            </Tooltip>
          )}
        </span>
        <span className="flex items-center gap-3 shrink-0">
          <span className="tabular-nums">{v2 ? formatSignalValue(s.field_source, s.raw_value) : legacyValue(s.raw_value)}</span>
          <span className={cn("w-7 text-right text-[11px] font-semibold tabular-nums", scoreTone(s.score))}>{Math.round(s.score!)}</span>
        </span>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="relative h-1 flex-1 rounded-full bg-muted">
          <span className="absolute inset-y-0 left-0 rounded-full bg-primary/70" style={{ width: `${Math.max(2, s.score!)}%` }} />
        </span>
        <span className="w-7" />
      </div>
      {s.source && <div className="text-[10px] text-muted-foreground mt-1">Source: {s.source}</div>}
    </li>
  );
}

/** Version-1 raw values were in mixed units (price per unit in $M), so show them as stored. */
function legacyValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(v).slice(0, 40);
}
