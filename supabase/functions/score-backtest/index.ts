import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsFor, requireApprovedUser } from "../_shared/auth.ts";

type Row = {
  id: string;
  property_name: string | null;
  ai_score: number | null;
  analyst_grade: "A" | "B" | "C" | "Pass" | null;
  score_confidence: string | null;
};

// Ranks with average-rank tie handling (Spearman convention).
function ranks(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avg = (i + j) / 2 + 1; // 1-based avg rank
    for (let k = i; k <= j; k++) out[indexed[k].i] = avg;
    i = j + 1;
  }
  return out;
}

function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length < 3) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = xs.length;
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i] - mx;
    const b = ry[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const denom = Math.sqrt(dx * dy);
  if (denom === 0) return null;
  return num / denom;
}

const GRADE_RANK: Record<string, number> = { A: 4, B: 3, C: 2, Pass: 1 };
const GRADE_TO_EXPECTED_SCORE: Record<string, number> = { A: 85, B: 65, C: 45, Pass: 20 };

function plainEnglish(rho: number | null, n: number): string {
  if (rho == null) return `Not enough graded deals yet (need at least 3, have ${n}).`;
  const r = Math.round(rho * 100) / 100;
  if (rho >= 0.7) return `Strong agreement (ρ=${r}). The score is tracking analyst judgment well.`;
  if (rho >= 0.4) return `Moderate agreement (ρ=${r}). The score generally tracks judgment but has notable misses.`;
  if (rho >= 0.1) return `Weak agreement (ρ=${r}). The score barely correlates with how analysts grade deals — pillar weights likely need tuning.`;
  if (rho > -0.1) return `No real agreement (ρ=${r}). The score is essentially independent of analyst grades.`;
  return `Inverse relationship (ρ=${r}). The score is pointing the wrong way — review pillar definitions before trusting it.`;
}

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Returns every graded deal's name, AI score and analyst grade — the firm's
  // internal pipeline intelligence.
  const authz = await requireApprovedUser(req);
  if (!authz.ok) return authz.response;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("deals")
      .select("id, property_name, ai_score, analyst_grade, score_confidence")
      .not("ai_score", "is", null)
      .not("analyst_grade", "is", null);
    if (error) throw error;

    const rows = (data ?? []) as Row[];
    const n = rows.length;

    // Per-grade averages
    const byGrade: Record<string, { count: number; sum: number; avg: number | null }> = {
      A: { count: 0, sum: 0, avg: null },
      B: { count: 0, sum: 0, avg: null },
      C: { count: 0, sum: 0, avg: null },
      Pass: { count: 0, sum: 0, avg: null },
    };
    for (const r of rows) {
      if (!r.analyst_grade || r.ai_score == null) continue;
      const g = byGrade[r.analyst_grade];
      g.count += 1;
      g.sum += r.ai_score;
    }
    for (const k of Object.keys(byGrade)) {
      const g = byGrade[k];
      g.avg = g.count > 0 ? Math.round((g.sum / g.count) * 10) / 10 : null;
    }

    // Spearman: score vs grade rank
    const scores = rows.map((r) => r.ai_score as number);
    const gradeRanks = rows.map((r) => GRADE_RANK[r.analyst_grade as string]);
    const rho = spearman(scores, gradeRanks);

    // Mismatches: gap between actual score and what the grade implies
    const scored = rows.map((r) => {
      const expected = GRADE_TO_EXPECTED_SCORE[r.analyst_grade as string];
      const gap = (r.ai_score as number) - expected; // positive = score too high, negative = score too low
      return {
        id: r.id,
        property_name: r.property_name,
        ai_score: r.ai_score,
        analyst_grade: r.analyst_grade,
        score_confidence: r.score_confidence,
        expected_score: expected,
        gap,
      };
    });

    // High grade, low score (score under-rated a good deal)
    const underrated = [...scored]
      .filter((s) => s.gap <= -15)
      .sort((a, b) => a.gap - b.gap)
      .slice(0, 5);

    // Low grade, high score (score over-rated a weak deal)
    const overrated = [...scored]
      .filter((s) => s.gap >= 15)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 5);

    return new Response(
      JSON.stringify({
        n_graded: n,
        per_grade: byGrade,
        spearman_rho: rho,
        plain_english: plainEnglish(rho, n),
        underrated, // strong deals scored too low
        overrated,  // weak deals scored too high
        generated_at: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("score-backtest error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
