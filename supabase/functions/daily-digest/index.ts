import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireCronSecret } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const denied = requireCronSecret(req);
  if (denied) return denied.response;


  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const callFn = async (name: string, body: unknown = {}) => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify(body),
      });
      return { name, status: res.status, ok: res.ok };
    } catch (e) {
      return { name, error: String(e) };
    }
  };

  // --- SYSTEM health checks (mailbox staleness + Atlas automation status) ---
  const STALE_HOURS = 26;
  const alerts: string[] = [];

  for (const mb of ["acquisitions", "atlas"]) {
    const { data: last } = await supabase
      .from("outlook_messages").select("synced_at")
      .eq("mailbox", mb).order("synced_at", { ascending: false }).limit(1).maybeSingle();
    const ts = last?.synced_at ? new Date(last.synced_at) : null;
    const hours = ts ? (Date.now() - ts.getTime()) / 3600_000 : Infinity;
    if (hours > STALE_HOURS) {
      alerts.push(ts
        ? `${mb} mailbox has not synced in ${Math.floor(hours / 24)} days (last ${ts.toISOString().slice(0, 16).replace("T", " ")} UTC) — reconnect the connector in Lovable → Integrations.`
        : `${mb} mailbox has never synced.`);
    }
  }

  const { data: atlasCfg } = await supabase.from("connectors")
    .select("config").eq("key", "atlas_automation").maybeSingle();
  const atlasStatus = (atlasCfg?.config as any)?.last_status;
  if (atlasStatus === "failed" || atlasStatus === "degraded") {
    alerts.push(`Atlas automation last run ${atlasStatus}.`);
    const lastError = (atlasCfg?.config as any)?.last_error;
    if (lastError) alerts.push(String(lastError));
  }

  const syncResult = await callFn("sync-acquisitions-inbox");
  // Only re-score deals received in the last day to avoid re-scoring the full backlog every morning.
  const scoreResult = await callFn("score-deals", { since_days: 1 });

  // Today's date (UTC)
  const today = new Date().toISOString().slice(0, 10);
  const start = `${today}T00:00:00.000Z`;
  const end = `${today}T23:59:59.999Z`;

  const { data: rows, error } = await supabase
    .from("inbox_deals")
    .select("fit_tier")
    .gte("email_received_at", start)
    .lte("email_received_at", end);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const counts = { strong: 0, medium: 0, maybe: 0, skip: 0 };
  for (const r of rows ?? []) {
    const tier = (r.fit_tier ?? "").toLowerCase();
    if (tier in counts) (counts as any)[tier]++;
  }
  const total = (rows ?? []).length;

  const { error: upsertErr } = await supabase
    .from("daily_digests")
    .upsert(
      {
        digest_date: today,
        deal_count: total,
        strong_count: counts.strong,
        medium_count: counts.medium,
        maybe_count: counts.maybe,
        skip_count: counts.skip,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "digest_date" }
    );

  if (upsertErr) {
    return new Response(JSON.stringify({ error: upsertErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Realtime broadcast
  const channel = supabase.channel("daily-digest");
  await channel.subscribe();
  await channel.send({
    type: "broadcast",
    event: "digest",
    payload: {
      date: today,
      strong_count: counts.strong,
      medium_count: counts.medium,
      maybe_count: counts.maybe,
      total,
      ...(alerts.length ? { system_alerts: alerts } : {}),
    },
  });
  await supabase.removeChannel(channel);

  return new Response(
    JSON.stringify({
      date: today,
      ...(alerts.length ? { system: alerts } : {}),
      ...counts,
      total,
      sync: syncResult,
      score: scoreResult,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
