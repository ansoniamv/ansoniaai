import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Activity, RefreshCw, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Mismatch = {
  id: string;
  property_name: string | null;
  ai_score: number;
  analyst_grade: "A" | "B" | "C" | "Pass";
  expected_score: number;
  gap: number;
  score_confidence: string | null;
};

type Backtest = {
  n_graded: number;
  per_grade: Record<string, { count: number; sum: number; avg: number | null }>;
  spearman_rho: number | null;
  plain_english: string;
  underrated: Mismatch[];
  overrated: Mismatch[];
  generated_at: string;
};

const GRADE_ORDER: Array<"A" | "B" | "C" | "Pass"> = ["A", "B", "C", "Pass"];

export function CalibrationPanel({ refreshKey }: { refreshKey?: number }) {
  const [data, setData] = useState<Backtest | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data: res, error } = await supabase.functions.invoke("score-backtest", { body: {} });
    if (error) {
      setErr(error.message);
    } else {
      setData(res as Backtest);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const rho = data?.spearman_rho;
  const rhoColor =
    rho == null ? "text-muted-foreground"
    : rho >= 0.7 ? "text-tier-strong-fg"
    : rho >= 0.4 ? "text-tier-medium-fg"
    : rho >= 0.1 ? "text-amber-600"
    : "text-destructive";

  return (
    <section className="rounded-[8px] border border-[#E4E7EC] bg-white p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[#002752]" />
          <h2 className="text-[15px] font-semibold text-[#002752]">Score Calibration</h2>
          <span className="text-[11px] text-[#5B6472]">
            How well the AI score tracks analyst grades. Use mismatches to decide what to tune.
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={load}
          disabled={loading}
          className="h-8 px-3"
        >
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {err ? (
        <div className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {err}
        </div>
      ) : null}

      {data ? (
        data.n_graded === 0 ? (
          <div className="rounded border border-dashed border-[#E4E7EC] p-6 text-center text-sm text-muted-foreground">
            No graded deals yet. Grade deals A / B / C / Pass on the Pipeline to start calibrating.
          </div>
        ) : (
          <>
            {/* Correlation + read */}
            <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4 items-center rounded border border-[#E4E7EC] bg-[#F7F8FA] p-4">
              <div className="text-center md:text-left">
                <p className="text-[10px] uppercase tracking-wider text-[#5B6472]">Spearman ρ</p>
                <p className={cn("text-4xl font-serif-display tabular-nums", rhoColor)}>
                  {rho == null ? "—" : rho.toFixed(2)}
                </p>
                <p className="text-[11px] text-[#5B6472]">n = {data.n_graded} graded</p>
              </div>
              <p className="text-sm text-[#1A1F2B] leading-relaxed">{data.plain_english}</p>
            </div>

            {/* Per-grade averages */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5B6472] mb-2">
                Average AI score by analyst grade
              </p>
              <div className="grid grid-cols-4 gap-3">
                {GRADE_ORDER.map((g) => {
                  const cell = data.per_grade[g];
                  const avg = cell?.avg;
                  return (
                    <div key={g} className="rounded border border-[#E4E7EC] p-3 text-center">
                      <p className="text-xs font-semibold text-[#002752]">{g}</p>
                      <p className="font-serif-display tabular-nums text-2xl text-[#1A1F2B] mt-1">
                        {avg == null ? "—" : avg.toFixed(1)}
                      </p>
                      <p className="text-[10px] text-[#5B6472]">{cell?.count ?? 0} deals</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Mismatches */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <MismatchList
                title="Strong deals scored too low"
                icon={<TrendingDown className="h-3.5 w-3.5 text-tier-strong-fg" />}
                hint="High grade but low score — the score is missing what makes these good."
                items={data.underrated}
                gapClass="text-tier-strong-fg"
              />
              <MismatchList
                title="Weak deals scored too high"
                icon={<TrendingUp className="h-3.5 w-3.5 text-destructive" />}
                hint="Low grade but high score — pillars are rewarding the wrong things."
                items={data.overrated}
                gapClass="text-destructive"
              />
            </div>

            <p className="text-[10px] text-[#5B6472] text-right">
              Generated {new Date(data.generated_at).toLocaleString()}
            </p>
          </>
        )
      ) : (
        <div className="text-sm text-muted-foreground">Loading backtest…</div>
      )}
    </section>
  );
}

function MismatchList({
  title, icon, hint, items, gapClass,
}: {
  title: string;
  icon: React.ReactNode;
  hint: string;
  items: Mismatch[];
  gapClass: string;
}) {
  return (
    <div className="rounded border border-[#E4E7EC] p-4">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <p className="text-sm font-semibold text-[#1A1F2B]">{title}</p>
      </div>
      <p className="text-[11px] text-[#5B6472] mb-3">{hint}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No notable mismatches.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((m) => (
            <li key={m.id} className="flex items-center gap-2 text-sm">
              <span className="text-[10px] font-semibold uppercase tracking-wider w-9 text-[#5B6472]">{m.analyst_grade}</span>
              <Link to={`/deals/${m.id}`} className="flex-1 truncate text-[#002752] hover:underline">
                {m.property_name ?? "(untitled)"}
              </Link>
              <span className="tabular-nums text-[#1A1F2B]">{m.ai_score}</span>
              <span className={cn("tabular-nums text-xs font-semibold w-12 text-right", gapClass)}>
                {m.gap > 0 ? "+" : ""}{Math.round(m.gap)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {items.some((m) => m.score_confidence === "low" || m.score_confidence === "insufficient") ? (
        <p className="mt-3 text-[10px] text-amber-600 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          Some entries have low/insufficient data confidence — fix coverage before tuning weights.
        </p>
      ) : null}
    </div>
  );
}
