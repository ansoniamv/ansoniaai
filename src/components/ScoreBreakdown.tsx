import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Sparkles, Info } from "lucide-react";
import { useState } from "react";

type SignalResult = {
  name: string;
  field_source: string;
  raw_value: any;
  score: number | null;
  weight: number;
};
type PillarResult = {
  key: string;
  name: string;
  weight: number;
  score: number | null;
  signals: SignalResult[];
};
type Coverage = {
  pillars_covered: number;
  pillars_total: number;
  signals_covered: number;
  signals_total: number;
  weight_covered_pct: number;
};
type Confidence = "high" | "medium" | "low" | "insufficient";
type Breakdown = {
  base_score: number;
  final_score: number;
  adjustment: number;
  pillars: PillarResult[];
  confidence?: Confidence;
  coverage?: Coverage;
};

function scoreColor(s: number | null | undefined) {
  if (s == null) return "text-muted-foreground";
  if (s >= 75) return "text-green-500";
  if (s >= 50) return "text-yellow-500";
  return "text-red-500";
}

function scoreBarColor(s: number | null | undefined) {
  if (s == null) return "bg-muted";
  if (s >= 75) return "bg-green-500";
  if (s >= 50) return "bg-yellow-500";
  return "bg-red-500";
}

function fmtRaw(v: any): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(v).slice(0, 40);
}

// Deterministic rationale generated from signal data (no LLM call needed).
function buildRationale(p: PillarResult): string {
  const covered = p.signals.filter((s) => s.score != null);
  const missing = p.signals.filter((s) => s.score == null);

  if (covered.length === 0) {
    return `No data available for any of the ${p.signals.length} signals in this pillar. Fill in ${missing
      .slice(0, 3)
      .map((s) => s.name)
      .join(", ")}${missing.length > 3 ? ", …" : ""} to generate a score.`;
  }

  // Rank by weighted contribution
  const ranked = [...covered].sort(
    (a, b) => (b.score! * b.weight) - (a.score! * a.weight),
  );
  const strong = ranked.filter((s) => (s.score ?? 0) >= 70);
  const weak = ranked.filter((s) => (s.score ?? 0) < 50);

  const parts: string[] = [];
  if (strong.length) {
    parts.push(
      `Strong: ${strong
        .slice(0, 3)
        .map((s) => `${s.name} (${Math.round(s.score!)})`)
        .join(", ")}.`,
    );
  }
  if (weak.length) {
    parts.push(
      `Weak: ${weak
        .slice(0, 3)
        .map((s) => `${s.name} (${Math.round(s.score!)})`)
        .join(", ")}.`,
    );
  }
  if (!strong.length && !weak.length) {
    parts.push(
      `Middling scores across ${covered.length} signals (avg ${Math.round(
        covered.reduce((a, s) => a + (s.score ?? 0), 0) / covered.length,
      )}).`,
    );
  }
  if (missing.length) {
    parts.push(
      `Missing: ${missing
        .slice(0, 2)
        .map((s) => s.name)
        .join(", ")}${missing.length > 2 ? ` +${missing.length - 2} more` : ""}.`,
    );
  }
  return parts.join(" ");
}

export function ScoreBreakdown({
  data,
  summary,
}: {
  data: Breakdown | null | undefined;
  summary: string | null | undefined;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!data) return null;

  const confBadge: Record<Confidence, string> = {
    high: "bg-green-500/15 text-green-600 border-green-500/30",
    medium: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30",
    low: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    insufficient: "bg-muted text-muted-foreground border-border",
  };
  const confLabel: Record<Confidence, string> = {
    high: "High confidence",
    medium: "Medium confidence",
    low: "Low confidence",
    insufficient: "Insufficient data",
  };

  return (
    <Card className="p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-sm tracking-tight">AI Score Breakdown</h3>
        {data.confidence ? (
          <span
            className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded border ${confBadge[data.confidence]}`}
          >
            {confLabel[data.confidence]}
          </span>
        ) : null}
        {data.coverage ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {data.coverage.pillars_covered}/{data.coverage.pillars_total} pillars ·{" "}
            {Math.round((data.coverage.weight_covered_pct ?? 0) * 100)}% weight
          </span>
        ) : null}
        <div className="ml-auto flex items-baseline gap-4 text-sm tabular-nums">
          <span className="text-muted-foreground">
            Base <span className="font-semibold text-foreground">{data.base_score}</span>
          </span>
          <span className="text-muted-foreground">
            Thesis{" "}
            <span
              className={`font-semibold ${
                data.adjustment > 0
                  ? "text-green-500"
                  : data.adjustment < 0
                  ? "text-red-500"
                  : "text-foreground"
              }`}
            >
              {data.adjustment >= 0 ? "+" : ""}
              {data.adjustment}
            </span>
          </span>
          <span className={`text-2xl font-bold tabular-nums ${scoreColor(data.final_score)}`}>
            {data.final_score}
          </span>
        </div>
      </div>

      {/* Overall summary */}
      {summary && (
        <div className="flex gap-2 text-sm text-muted-foreground border-l-2 border-primary/40 pl-3 py-1">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary/70" />
          <p className="leading-relaxed">{summary}</p>
        </div>
      )}

      {/* Pillars */}
      <div className="space-y-1">
        {data.pillars.map((p) => {
          const isOpen = open[p.key] ?? false;
          const rationale = buildRationale(p);
          return (
            <Collapsible
              key={p.key}
              open={isOpen}
              onOpenChange={() => setOpen((o) => ({ ...o, [p.key]: !o[p.key] }))}
            >
              <CollapsibleTrigger className="flex items-center gap-3 w-full px-3 py-2.5 text-left hover:bg-muted/50 rounded-md transition-colors">
                <ChevronDown
                  className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? "" : "-rotate-90"}`}
                />
                <span className="text-sm font-medium tracking-tight">{p.name}</span>
                <span className="text-[11px] text-muted-foreground tabular-nums">{p.weight}%</span>

                {/* Progress bar */}
                <div className="ml-auto flex items-center gap-3 min-w-[120px] justify-end">
                  <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full ${scoreBarColor(p.score)} transition-all`}
                      style={{ width: `${p.score ?? 0}%` }}
                    />
                  </div>
                  <span
                    className={`text-base font-bold tabular-nums w-8 text-right ${scoreColor(p.score)}`}
                  >
                    {p.score ?? "—"}
                  </span>
                </div>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <div className="pl-7 pr-3 pb-3 pt-1 space-y-3">
                  {/* Rationale box */}
                  <div className="text-xs leading-relaxed text-muted-foreground bg-muted/30 border border-hairline rounded-md px-3 py-2">
                    <span className="font-semibold text-foreground/80 uppercase tracking-wider text-[10px] block mb-1">
                      Rationale
                    </span>
                    {rationale}
                  </div>

                  {/* Signals table */}
                  <div className="space-y-1">
                    {p.signals.map((s, i) => (
                      <div
                        key={i}
                        className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-xs py-1"
                      >
                        <span className="truncate">{s.name}</span>
                        <span className="text-muted-foreground/70 font-mono tabular-nums text-right">
                          {fmtRaw(s.raw_value)}
                        </span>
                        <span
                          className={`w-12 text-right font-semibold tabular-nums ${scoreColor(s.score)}`}
                        >
                          {s.score == null ? "—" : Number(s.score).toFixed(0)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </Card>
  );
}
