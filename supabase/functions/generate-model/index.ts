// generate-model
// Builds a deal's pro forma model with the full-underwrite skill, run as an
// Anthropic Managed Agents session (see anthropic/README.md for the setup).
//
// A run takes roughly 20 minutes and needs Python and LibreOffice, so it cannot
// happen in an edge function: this function only starts it and collects it.
//
//   {action: "start", deal_id, inputs?, options?}
//     Picks the deal's files (or takes the user's picks), uploads them with the
//     template and the Novogradac workbook from Brain, and starts the session.
//     Returns 202 with the deal_models id; the uploads finish in the background.
//   {action: "check", model_id}
//     Reads what the session did since the last check, denies any tool call it
//     is holding for approval (nobody is watching), and once the run is over
//     saves the model and QC report to the deal-models bucket. The deal page
//     calls this every 20 seconds while a run is open, so a run finishing while
//     nobody has the page open is collected the next time someone does.
//   {action: "cancel", model_id}
//     Interrupts the session and marks the run failed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsFor, requireApprovedUser } from "../_shared/auth.ts";
import { deleteClaudeFile, uploadClaudeFile } from "../_shared/anthropic.ts";
import { assertWithinBudget, BudgetExceededError, getSpend, invalidateSpendCache, MONTHLY_BUDGET_USD } from "../_shared/aiBudget.ts";
import { errorResponse } from "../_shared/errors.ts";
import {
  budgetAmount,
  digestEvents,
  failureMessage,
  fileExtension,
  listCostUsd,
  modelFileName,
  type EventDigest,
  type ModelInputPick,
  type ModelInputRole,
  parseRunResult,
  pickModelInputs,
  pickOutputs,
  RENOVATION_LEVELS,
  runIsOver,
  type SessionEvent,
} from "../_shared/dealModel.ts";
import {
  createSession,
  downloadFile,
  getSession,
  listEvents,
  listSessionFiles,
  sendEvents,
  type SessionResource,
} from "../_shared/managedAgents.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AGENT_ID = Deno.env.get("MODEL_AGENT_ID");
const ENVIRONMENT_ID = Deno.env.get("MODEL_ENVIRONMENT_ID");
/**
 * Hard cap on one run's spend, enforced by Anthropic on the session. A run that
 * reaches it stops; the skill saves the model after every tab, so it still
 * leaves the tabs it finished.
 */
const RUN_BUDGET_USD = Number(Deno.env.get("MODEL_RUN_BUDGET_USD") ?? 15);
/** The model the agent runs on (anthropic/agents/underwriter.md), for the usage log. */
const AGENT_MODEL = "claude-opus-5-5";
const FN = "generate-model";

const DOCS_BUCKET = "deal-documents";
const BRAIN_BUCKET = "data-room";
const MODELS_BUCKET = "deal-models";
/** A 'starting' row older than this died before its session was created. */
const STALE_START_MS = 10 * 60_000;
/** Checks closer together than this return the row as it is. */
const MIN_CHECK_MS = 15_000;
/** Event pages read per check, so one check stays well inside the runtime's limits. */
const MAX_EVENT_PAGES = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES: ModelInputRole[] = ["rent_roll", "t12", "om", "comps"];
const DEAL_FIELDS = [
  "id", "property_name", "address", "city", "state", "zip", "unit_count", "vintage_year",
  "total_sqft", "occupancy_pct", "asking_price", "broker", "cfo_date", "marketed",
];

class UserFacingError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const authz = await requireApprovedUser(req);
  if (!authz.ok) return authz.response;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({}));
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    if (body.action === "start") return json(await start(admin, body, authz.user.id), 202);
    if (typeof body.model_id !== "string" || !UUID_RE.test(body.model_id)) {
      return json({ error: "model_id must be a UUID" }, 400);
    }
    if (body.action === "check") return json(await check(admin, body.model_id));
    if (body.action === "cancel") return json(await cancel(admin, body.model_id));
    return json({ error: "action must be start, check or cancel" }, 400);
  } catch (e) {
    if (e instanceof UserFacingError) return json({ error: e.message }, e.status);
    if (e instanceof BudgetExceededError) return json({ error: e.message }, 429);
    return errorResponse(e, cors, { fn: FN });
  }
});

// ---------------------------------------------------------------- start

type Picked = { role: ModelInputRole | "template" | "affordability"; id: string; file_name: string; storage_path: string; bucket: string };

async function start(admin: any, body: any, userId: string) {
  if (!AGENT_ID || !ENVIRONMENT_ID) {
    throw new UserFacingError("Model generation isn't set up yet: MODEL_AGENT_ID and MODEL_ENVIRONMENT_ID are not configured.", 503);
  }
  const dealId = body.deal_id;
  if (typeof dealId !== "string" || !UUID_RE.test(dealId)) throw new UserFacingError("deal_id must be a UUID");

  // The run's cap must fit in what is left of the month, or a run could take
  // the account past the Console limit that stops every AI feature at once.
  await assertWithinBudget(admin, "interactive");
  const { month } = await getSpend(admin);
  if (month + RUN_BUDGET_USD > MONTHLY_BUDGET_USD) {
    throw new UserFacingError(
      `A model run can cost up to $${RUN_BUDGET_USD}, and only $${Math.max(0, MONTHLY_BUDGET_USD - month).toFixed(2)} ` +
        `of this month's $${MONTHLY_BUDGET_USD} AI budget is left.`,
      429,
    );
  }

  const options = {
    renovation_level: RENOVATION_LEVELS.includes(body.options?.renovation_level) ? body.options.renovation_level : "unknown",
    notes: typeof body.options?.notes === "string" ? body.options.notes.slice(0, 4000) : "",
  };

  const { data: deal, error: dealErr } = await admin.from("deals").select(DEAL_FIELDS.join(",")).eq("id", dealId).maybeSingle();
  if (dealErr) throw dealErr;
  if (!deal) throw new UserFacingError("Deal not found", 404);

  // ---- the deal's files: the user's picks, else the defaults
  const { data: docs, error: docErr } = await admin
    .from("deal_documents")
    .select("id,file_name,storage_path,doc_type,doc_as_of,created_at")
    .eq("deal_id", dealId);
  if (docErr) throw docErr;
  const byId = new Map((docs ?? []).map((d: any) => [d.id, d]));
  const defaults = pickModelInputs(docs ?? []);
  const asked: ModelInputPick = body.inputs && typeof body.inputs === "object" ? body.inputs : {};
  const picked: Picked[] = [];
  for (const role of ROLES) {
    // A role the user sent as null or "" is one they cleared on purpose.
    const id = role in asked ? asked[role] : defaults[role];
    if (!id) continue;
    const d: any = byId.get(id);
    if (!d) throw new UserFacingError(`The ${role.replace("_", " ")} file is not one of this deal's documents.`);
    picked.push({ role, id, file_name: d.file_name, storage_path: d.storage_path, bucket: DOCS_BUCKET });
  }
  for (const role of ["t12", "rent_roll"] as const) {
    if (!picked.some((p) => p.role === role)) {
      throw new UserFacingError(`Upload the deal's ${role === "t12" ? "T12" : "rent roll"} first: a model needs both.`);
    }
  }

  // ---- Brain: the newest file in each model category
  for (const [role, category, required] of [
    ["template", "model_template", true],
    ["affordability", "affordability", false],
  ] as const) {
    const { data: src, error } = await admin
      .from("data_room_sources")
      .select("id,file_name,storage_path")
      .eq("category", category)
      .eq("kind", "file")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!src && required) {
      throw new UserFacingError('No pro forma template in Brain yet. Upload it there under "Pro forma template (model runs)".');
    }
    if (src) picked.push({ role, id: src.id, file_name: src.file_name, storage_path: src.storage_path, bucket: BRAIN_BUCKET });
  }

  const inputs = Object.fromEntries(picked.map((p) => [p.role, { id: p.id, file_name: p.file_name }]));
  const { data: row, error: insErr } = await admin
    .from("deal_models")
    .insert({ deal_id: dealId, status: "starting", inputs, options, created_by: userId, progress: "Uploading the files" })
    .select("id")
    .single();
  if (insErr) {
    if (insErr.code === "23505") throw new UserFacingError("A model is already being generated for this deal.", 409);
    throw insErr;
  }

  const work = launch(admin, row.id, deal, picked, options).catch(async (e) => {
    console.error(JSON.stringify({ fn: FN, model_id: row.id, stage: "start", detail: String(e?.stack ?? e) }));
    await admin.from("deal_models").update({
      status: "failed",
      error: e instanceof UserFacingError ? e.message : "The run could not be started. Check the function logs.",
      finished_at: new Date().toISOString(),
    }).eq("id", row.id);
    await cleanUp(admin, row.id);
  });
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
  else await work;
  return { model_id: row.id };
}

/** Upload everything to Anthropic and create the session. */
async function launch(admin: any, modelId: string, deal: any, picked: Picked[], options: Record<string, string>) {
  const fileIds: string[] = [];
  const resources: SessionResource[] = [];
  const files: Record<string, { mounted_as: string; original_name: string }> = {};
  const remember = async () => {
    await admin.from("deal_models").update({ anthropic_file_ids: fileIds }).eq("id", modelId);
  };

  for (const p of picked) {
    const { data: blob, error } = await admin.storage.from(p.bucket).download(p.storage_path);
    if (error || !blob) throw new Error(`download of ${p.file_name} failed: ${error?.message}`);
    const ext = p.role === "template" || p.role === "affordability" ? ".xlsx" : fileExtension(p.file_name);
    const mountAs = `${p.role === "affordability" ? "novogradac" : p.role}${ext}`;
    const fileId = await uploadClaudeFile(blob, p.file_name);
    fileIds.push(fileId);
    await remember();
    resources.push({ type: "file", file_id: fileId, mount_path: `/${mountAs}` });
    files[p.role] = { mounted_as: `/mnt/session/uploads/${mountAs}`, original_name: p.file_name };
  }

  const brief = {
    deal: Object.fromEntries(DEAL_FIELDS.filter((f) => f !== "id").map((f) => [f, deal[f] ?? null])),
    asking_price_note: "asking_price is in $ millions.",
    files,
    options,
    model_file_name: modelFileName(deal.property_name),
  };
  const briefId = await uploadClaudeFile(new Blob([JSON.stringify(brief, null, 2)], { type: "application/json" }), "run.json");
  fileIds.push(briefId);
  await remember();
  resources.push({ type: "file", file_id: briefId, mount_path: "/run.json" });

  const session = await createSession({
    agentId: AGENT_ID!,
    environmentId: ENVIRONMENT_ID!,
    title: `Pro forma: ${deal.property_name}`,
    resources,
    budgetCents: budgetAmount(RUN_BUDGET_USD),
    message: "Build the pro forma model for this deal with the full-underwrite skill. Start by reading /mnt/session/uploads/run.json.",
    metadata: { deal_id: String(deal.id), model_id: modelId },
  });
  await admin.from("deal_models").update({
    status: "running",
    session_id: session.id,
    started_at: new Date().toISOString(),
    progress: "Started",
  }).eq("id", modelId);
}

// ---------------------------------------------------------------- check

async function check(admin: any, modelId: string) {
  const { data: row, error } = await admin.from("deal_models").select("*").eq("id", modelId).maybeSingle();
  if (error) throw error;
  if (!row) throw new UserFacingError("Model run not found", 404);

  if (row.status === "starting") {
    if (Date.now() - Date.parse(row.created_at) > STALE_START_MS) {
      await finish(admin, row, { status: "failed", error: "The run never started. Try again." });
      return await reload(admin, modelId);
    }
    return publicRow(row);
  }
  if (row.status !== "running") return publicRow(row);

  // Claim this check so two open tabs don't collect the same run twice.
  const now = new Date();
  const since = new Date(now.getTime() - MIN_CHECK_MS).toISOString();
  const { data: claimed } = await admin
    .from("deal_models")
    .update({ checked_at: now.toISOString() })
    .eq("id", modelId)
    .eq("status", "running")
    .or(`checked_at.is.null,checked_at.lt.${since}`)
    .select("*")
    .maybeSingle();
  if (!claimed) return publicRow(row);

  const session = await getSession(claimed.session_id);
  const cost = listCostUsd(session.usage?.list_cost);

  // ---- new events since the last check
  let page: string | null = claimed.events_page ?? null;
  let lastId: string | null = claimed.last_event_id ?? null;
  // Held asks are not carried over: each is denied in the check that sees it.
  let digest: EventDigest = digestEvents([], { ...(claimed.event_state ?? {}), progress: claimed.progress, pendingAsks: [] });
  let pagesRead = 0;
  for (; pagesRead < MAX_EVENT_PAGES; pagesRead++) {
    const res = await listEvents(claimed.session_id, page);
    const events: SessionEvent[] = res.data ?? [];
    const seenAt = lastId ? events.findIndex((e) => e.id === lastId) : -1;
    const fresh = seenAt >= 0 ? events.slice(seenAt + 1) : events;
    digest = digestEvents(fresh, digest);
    if (events.length) lastId = events[events.length - 1].id;
    if (!res.next_page) break;
    page = res.next_page;
  }
  // Held tool calls: nobody is watching, so deny them and let the run carry on.
  if (digest.pendingAsks.length) {
    try {
      await sendEvents(claimed.session_id, digest.pendingAsks.map((id) => ({
        type: "user.tool_confirmation",
        tool_use_id: id,
        result: "deny",
        deny_message: "Nobody is watching this run to approve tool calls. Do the step another way, or skip it and list it in qc.md.",
      })));
    } catch (e) {
      // Already answered, or the call moved on: not worth failing the check over.
      console.error(JSON.stringify({ fn: FN, model_id: modelId, stage: "deny", detail: String(e) }));
    }
  }

  await admin.from("deal_models").update({
    events_page: page,
    last_event_id: lastId,
    progress: digest.progress,
    // Why the session last stopped, and what it last said, outlive the check
    // that read them: the idle event can arrive a check before the session's
    // status shows it.
    event_state: {
      stopReason: digest.stopReason,
      terminated: digest.terminated,
      lastMessage: digest.lastMessage?.slice(0, 2000) ?? null,
      errors: digest.errors.slice(-5),
    },
    cost_usd: cost,
  }).eq("id", modelId);

  // A full set of pages means there may be more events than one check reads:
  // finish reading them on the next check before deciding the run is over.
  if (pagesRead < MAX_EVENT_PAGES && runIsOver(session.status, digest)) {
    await collect(admin, { ...claimed, cost_usd: cost }, digest);
  }
  return await reload(admin, modelId);
}

/** Save the run's outputs and close the row. */
async function collect(admin: any, row: any, digest: EventDigest) {
  const outputs = pickOutputs(await listSessionFiles(row.session_id));
  const text = async (f?: { id: string }) => (f ? await (await downloadFile(f.id)).text() : null);
  const qc = await text(outputs.qc);
  const result = parseRunResult(await text(outputs.result));

  if (!outputs.model) {
    await finish(admin, row, { status: "failed", error: failureMessage(digest, RUN_BUDGET_USD), qc_report: qc });
    return;
  }
  const blob = await downloadFile(outputs.model.id);
  const fileName = outputs.model.filename.split("/").pop()!;
  const path = `${row.deal_id}/${row.id}/${fileName}`;
  const { error: upErr } = await admin.storage.from(MODELS_BUCKET).upload(path, blob, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    upsert: true,
  });
  if (upErr) throw upErr;

  const capped = digest.stopReason === "budget_reached";
  await finish(admin, row, {
    status: "done",
    complete: result.complete && !capped,
    skipped: capped ? [...result.skipped, `Stopped at the $${RUN_BUDGET_USD} cost cap`] : result.skipped,
    storage_path: path,
    file_name: fileName,
    qc_report: qc,
    error: capped ? `The run reached its $${RUN_BUDGET_USD} cost cap; this is its last save.` : null,
  });
}

async function finish(admin: any, row: any, fields: Record<string, unknown>) {
  const { data: closed } = await admin
    .from("deal_models")
    .update({ ...fields, finished_at: new Date().toISOString() })
    .eq("id", row.id)
    .in("status", ["starting", "running"])
    .select("id")
    .maybeSingle();
  // Only the check that closed the row logs its cost, once.
  if (closed && Number(row.cost_usd) > 0) {
    try {
      await admin.from("ai_usage_log").insert({
        function_name: FN,
        model: AGENT_MODEL,
        provider: "anthropic",
        input_tokens: 0,
        output_tokens: 0,
        cached_tokens: 0,
        cost_usd: Number(row.cost_usd),
        success: fields.status === "done",
        deal_id: row.deal_id,
      });
      invalidateSpendCache();
    } catch (e) {
      console.error(JSON.stringify({ fn: FN, model_id: row.id, stage: "log", detail: String(e) }));
    }
  }
  await cleanUp(admin, row.id);
}

/** Delete the inputs uploaded to Anthropic. The session itself is kept: its trace is the record of the run. */
async function cleanUp(admin: any, modelId: string) {
  const { data } = await admin.from("deal_models").select("anthropic_file_ids").eq("id", modelId).maybeSingle();
  await Promise.all(((data?.anthropic_file_ids ?? []) as string[]).map(deleteClaudeFile));
}

// ---------------------------------------------------------------- cancel

async function cancel(admin: any, modelId: string) {
  const { data: row, error } = await admin.from("deal_models").select("*").eq("id", modelId).maybeSingle();
  if (error) throw error;
  if (!row) throw new UserFacingError("Model run not found", 404);
  if (row.status !== "starting" && row.status !== "running") return publicRow(row);
  if (row.session_id) {
    try {
      await sendEvents(row.session_id, [{ type: "user.interrupt" }]);
      const s = await getSession(row.session_id);
      row.cost_usd = listCostUsd(s.usage?.list_cost);
    } catch (e) {
      console.error(JSON.stringify({ fn: FN, model_id: modelId, stage: "cancel", detail: String(e) }));
    }
  }
  await finish(admin, row, { status: "failed", error: "Cancelled.", cost_usd: row.cost_usd });
  return await reload(admin, modelId);
}

// ---------------------------------------------------------------- rows

async function reload(admin: any, modelId: string) {
  const { data, error } = await admin.from("deal_models").select("*").eq("id", modelId).single();
  if (error) throw error;
  return publicRow(data);
}

/** The row without the polling bookkeeping and Anthropic ids. */
function publicRow(row: any) {
  const { events_page: _p, last_event_id: _l, anthropic_file_ids: _f, event_state: _s, ...rest } = row;
  return rest;
}
