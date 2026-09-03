// Scheduled Atlas orchestrator. Files suggestions only — never applies.
// Guarded by connectors.atlas_automation.enabled.
// Cadence lives in pg_cron (job 11), not in this function or the app.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireCronSecret } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const denied = requireCronSecret(req);
  if (denied) return denied.response;
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: cfg } = await supabase.from("connectors")
      .select("enabled,config").eq("key", "atlas_automation").maybeSingle();
    const prevConfig = ((cfg?.config as any) || {}) as Record<string, unknown>;

    if (!cfg?.enabled) {
      await supabase.from("connectors").update({
        config: {
          ...prevConfig,
          last_run_at: new Date().toISOString(),
          last_status: "disabled",
        },
      }).eq("key", "atlas_automation");
      return new Response(JSON.stringify({ ok: true, skipped: "disabled" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const counts: Record<string, any> = {};
    const failures: string[] = [];

    async function runStage(
      name: string,
      fn: string,
      body: Record<string, unknown>,
      // Optional extra check for functions that return 200 with a nested error.
      inspect?: (data: any) => string | null,
    ) {
      try {
        const r = await supabase.functions.invoke(fn, { body });
        if (r.error) {
          counts[name] = { error: (r.error as any).message || String(r.error) };
          failures.push(`${name}: ${counts[name].error}`);
          return;
        }
        const nested = inspect ? inspect(r.data) : null;
        if (nested) {
          counts[name] = { ...(r.data || {}), error: nested };
          failures.push(`${name}: ${nested}`);
          return;
        }
        counts[name] = r.data ?? { ok: true };
      } catch (e) {
        counts[name] = { error: (e as Error).message };
        failures.push(`${name}: ${(e as Error).message}`);
      }
    }

    await runStage("sync", "outlook-sync", { mailbox: "atlas" }, (data) => {
      // outlook-sync returns 200 even when a mailbox fails — check the nested result.
      const atlas = data?.mailboxes?.atlas;
      if (!atlas) return "Atlas mailbox not configured (MICROSOFT_OUTLOOK_ATLAS_API_KEY missing)";
      if (atlas.error) return `Atlas sync failed — ${atlas.error}`;
      if (atlas.truncated) return "Atlas sync truncated — not all messages in the gap were fetched";
      return null;
    });

    await runStage("analyze", "analyze-partner-emails", {});
    await runStage("warmth", "compute-partner-warmth", {});

    const status = failures.length === 0 ? "ok" : failures.length === 3 ? "failed" : "degraded";
    const now = new Date().toISOString();

    await supabase.from("connectors").update({
      config: {
        ...prevConfig,
        last_run_at: now,
        last_counts: counts,
        last_status: status,
        last_error: failures.length ? failures.join(" · ") : null,
        last_success_at: status === "ok" ? now : ((prevConfig as any).last_success_at ?? null),
      },
    }).eq("key", "atlas_automation");

    return new Response(
      JSON.stringify({ ok: failures.length === 0, status, counts, failures }),
      {
        status: failures.length === 3 ? 500 : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
