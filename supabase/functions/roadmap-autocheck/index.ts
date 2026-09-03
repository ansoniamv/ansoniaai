import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

type CheckKey =
  | "inbox_has_deals"
  | "deals_gated"
  | "fields_extracted"
  | "deals_scored"
  | "sync_recent"
  | "partners_exist"
  | "scores_have_confidence"
  | "scored_deals_enriched"
  | "backtest_available";

type Rule = { check: CheckKey; min?: number };

type CheckResult = { passed: boolean; detail: string };

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CHECKS: Record<CheckKey, (min: number) => Promise<CheckResult>> = {
  inbox_has_deals: async () => {
    const { count } = await supabase
      .from("inbox_deals")
      .select("*", { count: "exact", head: true });
    const n = count ?? 0;
    return { passed: n > 0, detail: `Auto-completed: ${n} inbox deals present` };
  },
  deals_gated: async (min) => {
    const { count } = await supabase
      .from("inbox_deals")
      .select("*", { count: "exact", head: true })
      .not("gate_status", "is", null)
      .neq("gate_status", "pending");
    const n = count ?? 0;
    return { passed: n >= min, detail: `Auto-completed: ${n} deals gated` };
  },
  fields_extracted: async (min) => {
    const { count } = await supabase
      .from("inbox_deals")
      .select("*", { count: "exact", head: true })
      .or("units.not.is.null,year_built.not.is.null");
    const n = count ?? 0;
    return { passed: n >= min, detail: `Auto-completed: ${n} deals with extracted fields` };
  },
  deals_scored: async (min) => {
    const { count } = await supabase
      .from("inbox_deals")
      .select("*", { count: "exact", head: true })
      .not("fit_score", "is", null);
    const n = count ?? 0;
    return { passed: n >= min, detail: `Auto-completed: ${n} deals scored` };
  },
  sync_recent: async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("deal_emails")
      .select("*", { count: "exact", head: true })
      .gt("received_at", since);
    const n = count ?? 0;
    return { passed: n > 0, detail: `Auto-completed: inbox sync active (${n} emails in last 24h)` };
  },
  partners_exist: async () => {
    const { count } = await supabase
      .from("partners")
      .select("*", { count: "exact", head: true });
    const n = count ?? 0;
    return { passed: n > 0, detail: `Auto-completed: ${n} capital partners on file` };
  },
  scores_have_confidence: async (min) => {
    const { count } = await supabase
      .from("deals")
      .select("*", { count: "exact", head: true })
      .not("score_confidence", "is", null);
    const n = count ?? 0;
    return { passed: n >= min, detail: `Auto-completed: ${n} deals with score confidence recorded` };
  },
  scored_deals_enriched: async (min) => {
    // Count deals that have both an ai_score and a matching deal_enrichment row
    const { data, error } = await supabase
      .from("deals")
      .select("id, deal_enrichment!inner(deal_id)")
      .not("ai_score", "is", null);
    if (error) {
      console.error("scored_deals_enriched query failed:", error);
      return { passed: false, detail: `query failed: ${error.message}` };
    }
    const n = (data ?? []).length;
    return { passed: n >= min, detail: `Auto-completed: ${n} scored deals have enrichment data` };
  },
  backtest_available: async (min) => {
    const { count } = await supabase
      .from("deals")
      .select("*", { count: "exact", head: true })
      .not("analyst_grade", "is", null);
    const n = count ?? 0;
    return { passed: n >= min, detail: `Auto-completed: ${n} deals graded for backtesting` };
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { data: items, error } = await supabase
      .from("roadmap_items")
      .select("id, title, status, completion_rule")
      .not("completion_rule", "is", null)
      .neq("status", "shipped");
    if (error) throw error;

    const results: Array<{ id: string; title: string; tripped: boolean; detail?: string }> = [];

    for (const item of items ?? []) {
      const rule = item.completion_rule as Rule | null;
      if (!rule?.check || !(rule.check in CHECKS)) continue;
      const min = typeof rule.min === "number" ? rule.min : 1;
      const fn = CHECKS[rule.check];
      let res: CheckResult;
      try {
        res = await fn(min);
      } catch (e) {
        console.error(`check failed for ${item.title}:`, e);
        continue;
      }

      if (!res.passed) {
        results.push({ id: item.id, title: item.title, tripped: false });
        continue;
      }

      const prevStatus = item.status as string;
      const { error: updErr } = await supabase
        .from("roadmap_items")
        .update({
          status: "shipped",
          auto_completed: true,
          completed_at: new Date().toISOString(),
        })
        .eq("id", item.id)
        .neq("status", "shipped"); // guard against races
      if (updErr) {
        console.error("update failed:", updErr);
        continue;
      }

      await supabase.from("roadmap_events").insert({
        item_id: item.id,
        event_type: "auto_completed",
        from_status: prevStatus,
        to_status: "shipped",
        detail: res.detail,
        actor: "system",
      });

      results.push({ id: item.id, title: item.title, tripped: true, detail: res.detail });
    }

    return new Response(JSON.stringify({ checked: items?.length ?? 0, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
