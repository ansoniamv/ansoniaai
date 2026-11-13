// onboard-deal
// Everything a new deal needs, run from the server the moment it is created.
//
// The insert trigger on deals (20261114120000_deal_onboarding.sql) queues a
// deal_onboarding row and calls {action: "run", deal_id}. The steps:
//
//   1. geocode       free Census coordinates + tract (geocode-deals)
//   2. in parallel:
//        esri        demographics (esri-enrich), then schools (schools-enrich)
//        hellodata   rents, occupancy, unit mix (fetch-hellodata)
//        submarket   CoStar submarket pick (assign-submarket)
//        agents      document mover + CA agent (deal-agents start); the
//                    documents it brings in are parsed, and their figures fill
//                    the deal's blank fields (parse-deal-document)
//   3. deal_score    market metrics + AI score (deal-score)
//   4. buybox        total_score / deal_tier, from everything above
//
// Each step's outcome lands on deal_onboarding.steps as it finishes, so the deal
// page shows what arrived and what did not. One step failing never stops the
// others. Steps are safe to repeat: each underlying function caches or only
// fills blanks, so "Run again" re-bills nothing that already succeeded.
//
// Actions (POST body):
//   {action: "run", deal_id}   The trigger (service), or "Run again" on the deal
//                              page (approved user; reruns a finished deal too).
//   {action: "sweep"}          Cron, every 2 min: runs rows whose kickoff never
//                              arrived and rows stuck mid-run.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsFor, requireApprovedUser, requireCronSecret } from "../_shared/auth.ts";
import { errorResponse } from "../_shared/errors.ts";
import { rescoreBuybox } from "../_shared/buyboxScore.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const FN = "onboard-deal";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A queued row the trigger's call never reached is picked up after this long.
const QUEUED_GRACE_MS = 90_000;
// A run that has not finished in this long died with its worker.
const STUCK_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;
// Per step. The runtime allows a background task ~400 s in all.
const STEP_TIMEOUT_MS = 150_000;

type StepStatus = "ok" | "failed" | "skipped";
type StepResult = { status: StepStatus; detail?: string | null; ms?: number; at?: string };
type Admin = SupabaseClient;

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({}));
    const isService = requireCronSecret(req) === null;
    if (!isService) {
      const authz = await requireApprovedUser(req);
      if (!authz.ok) return authz.response;
      if (body.action !== "run") return json({ error: "Not allowed" }, 403);
    }
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    if (body.action === "run") {
      const dealId = body.deal_id;
      if (typeof dealId !== "string" || !UUID_RE.test(dealId)) return json({ error: "deal_id must be a UUID" }, 400);
      // A person asking again reruns a finished deal; the trigger never does.
      const claimed = await claim(admin, dealId, !isService);
      if (!claimed) return json({ status: "already_running_or_done" });
      background(runAll(admin, dealId));
      return json({ status: "running" }, 202);
    }

    if (body.action === "sweep") {
      if (!isService) return json({ error: "sweep is for the scheduler" }, 403);
      const now = Date.now();
      const { data: rows, error } = await admin
        .from("deal_onboarding")
        .select("deal_id")
        .lt("attempts", MAX_ATTEMPTS)
        .or(
          `and(status.eq.queued,queued_at.lt.${new Date(now - QUEUED_GRACE_MS).toISOString()}),` +
            `and(status.eq.running,started_at.lt.${new Date(now - STUCK_MS).toISOString()})`,
        )
        .order("queued_at", { ascending: true })
        .limit(3);
      if (error) throw error;
      const started: string[] = [];
      for (const r of rows ?? []) {
        if (await claim(admin, r.deal_id, false)) {
          started.push(r.deal_id);
          background(runAll(admin, r.deal_id));
        }
      }
      return json({ started });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return errorResponse(e, cors, { fn: FN });
  }
});

function background(p: Promise<unknown>) {
  const guarded = p.catch((e) => console.error(JSON.stringify({ fn: FN, detail: String((e as Error)?.stack ?? e) })));
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(guarded);
}

/** Take the row for this worker. False when another worker has it (or it is finished). */
async function claim(admin: Admin, dealId: string, rerun: boolean): Promise<boolean> {
  const stuckBefore = new Date(Date.now() - STUCK_MS).toISOString();
  // A rerun starts a fresh row; the trigger may not have made one (older deals).
  if (rerun) {
    await admin.from("deal_onboarding").upsert({ deal_id: dealId }, { onConflict: "deal_id", ignoreDuplicates: true });
  }
  const eligible = rerun
    ? `status.in.(queued,done,failed),and(status.eq.running,started_at.lt.${stuckBefore})`
    : `status.eq.queued,and(status.eq.running,started_at.lt.${stuckBefore})`;
  const { data: row } = await admin.from("deal_onboarding").select("attempts").eq("deal_id", dealId).maybeSingle();
  if (!row) return false;
  const { data, error } = await admin
    .from("deal_onboarding")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
      finished_at: null,
      error: null,
      // A person's rerun gets a fresh allowance from the sweep.
      attempts: rerun ? 1 : (row.attempts ?? 0) + 1,
      ...(rerun ? { steps: {} } : {}),
    })
    .eq("deal_id", dealId)
    .or(eligible)
    .select("deal_id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

// ------------------------------------------------------------ the run

async function runAll(admin: Admin, dealId: string) {
  const steps: Record<string, StepResult> = {};
  const record = async (name: string, result: StepResult) => {
    steps[name] = { ...result, at: new Date().toISOString() };
    const { error } = await admin.from("deal_onboarding").update({ steps }).eq("deal_id", dealId);
    if (error) console.error(JSON.stringify({ fn: FN, dealId, stage: "record", detail: error.message }));
  };
  const step = async (name: string, work: () => Promise<StepResult>): Promise<StepResult> => {
    const t0 = Date.now();
    let result: StepResult;
    try {
      result = await work();
    } catch (e) {
      result = { status: "failed", detail: String((e as Error)?.message ?? e).slice(0, 300) };
    }
    result.ms = Date.now() - t0;
    await record(name, result);
    return result;
  };

  const { data: deal } = await admin
    .from("deals")
    .select("id, address, property_address")
    .eq("id", dealId)
    .maybeSingle();
  if (!deal) {
    await admin.from("deal_onboarding").update({ status: "failed", error: "deal not found", finished_at: new Date().toISOString() }).eq("deal_id", dealId);
    return;
  }

  // 1. Coordinates first: free, and the tract it writes is read by others.
  await step("geocode", async () => {
    const r = await call("geocode-deals", { deal_id: dealId });
    return r.ok ? { status: "ok" } : { status: "failed", detail: r.error };
  });

  // 2. Independent sources, side by side.
  await Promise.all([
    (async () => {
      // Esri rejects anything that is not an address-level match, so a deal
      // with only a town would spend a geocode to be told so.
      const street = String(deal.address ?? deal.property_address ?? "").trim();
      const esri = await step("esri", async () => {
        if (!street) return { status: "skipped", detail: "No street address on the deal." };
        const r = await call("esri-enrich", { deal_id: dealId });
        if (!r.ok) return { status: "failed", detail: r.error };
        return { status: "ok", detail: r.data?.cached ? "Already enriched." : null };
      });
      await step("schools", async () => {
        if (esri.status !== "ok") return { status: "skipped", detail: "Needs the Esri location first." };
        const r = await call("schools-enrich", { deal_id: dealId });
        return r.ok ? { status: "ok" } : { status: "failed", detail: r.error };
      });
    })(),
    step("hellodata", async () => {
      const r = await call("fetch-hellodata", { deal_id: dealId });
      if (!r.ok) return { status: "failed", detail: r.error };
      const s = r.data?.status;
      if (r.data?.skipped) return { status: "skipped", detail: "HelloData connector is turned off." };
      if (s === "fetched") return { status: "ok" };
      if (s === "unmatched") return { status: "skipped", detail: `No confident HelloData match: ${r.data?.reason ?? "unknown"}` };
      return { status: "failed", detail: r.data?.error ?? `status ${s ?? "unknown"}` };
    }),
    step("submarket", async () => {
      const r = await call("assign-submarket", { deal_id: dealId });
      if (!r.ok) return { status: "failed", detail: r.error };
      const res = (r.data?.results ?? [])[0];
      if (!res) return { status: "skipped", detail: "Nothing to pick." };
      if (res.status === "assigned") return { status: "ok", detail: res.name ?? res.code ?? null };
      return { status: "skipped", detail: res.reason ?? res.status };
    }),
    step("agents", async () => {
      const r = await call("deal-agents", { action: "start", deal_id: dealId });
      if (!r.ok) return { status: "failed", detail: r.error };
      // Attachments are imported whatever happens to the CA; the run row (or
      // its absence) says what happened to the CA.
      const s = r.data?.status;
      if (!s) return { status: "ok", detail: "Email attachments imported; no CA run." };
      return { status: "ok", detail: `CA agent: ${s}${r.data?.attention ? `. ${r.data.attention}` : ""}` };
    }),
  ]);

  // 3. Market metrics + the AI score, now that the inputs are in.
  await step("deal_score", async () => {
    const r = await call("deal-score", { deal_id: dealId });
    return r.ok ? { status: "ok" } : { status: "failed", detail: r.error };
  });

  // 4. The buybox score, last, over everything that landed.
  await step("buybox", async () => {
    const fields = await rescoreBuybox(admin, dealId);
    return fields ? { status: "ok", detail: `${fields.deal_tier} (${fields.total_score ?? "n/a"})` } : { status: "failed", detail: "deal not found" };
  });

  const failed = Object.entries(steps).filter(([, s]) => s.status === "failed").map(([k]) => k);
  await admin.from("deal_onboarding").update({
    steps,
    status: failed.length ? "failed" : "done",
    error: failed.length ? `Failed: ${failed.join(", ")}` : null,
    finished_at: new Date().toISOString(),
  }).eq("deal_id", dealId);
}

/** Call another function as the service. Never throws. */
async function call(
  name: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
    if (!res.ok || data?.error) {
      const msg = typeof data?.error === "string" ? data.error : `${name} returned ${res.status}`;
      return { ok: false, data, error: msg.slice(0, 300) };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: `${name}: ${String((e as Error)?.message ?? e)}`.slice(0, 300) };
  }
}
