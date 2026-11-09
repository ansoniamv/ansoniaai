// deal-agents
// Two agents for a deal that has just been added to the pipeline:
//
//   1. The CA agent. Finds the "Sign CA" link in the deal's emails and runs an
//      Anthropic Managed Agents session that opens it in a headless browser,
//      reads the agreement, signs it as the firm's signer when the terms are
//      standard, and downloads the OM / rent roll / T12 from the deal room.
//      A CA with unusual terms is not signed: the run stops at needs_approval
//      with the clauses quoted, and only a person's Approve continues it.
//   2. The document mover. Copies underwriting files onto the deal, from the
//      CA agent's downloads and from attachments on the deal's emails, and
//      starts parse-deal-document on each, exactly as an upload would.
//
// Actions (POST body):
//   {action: "start", deal_id}            Accept in the inbox calls this. Imports email
//                                         attachments, then starts a CA run if there is
//                                         a link and signing is on.
//   {action: "check", run_id}             Reads what the session did, answers its
//                                         verification-code requests, and collects its
//                                         outputs once it stops. The deal page calls it
//                                         every 20 s while a run is open; "sweep" covers
//                                         runs nobody is looking at.
//   {action: "approve", run_id}           Lets a run held at needs_approval sign.
//   {action: "cancel", run_id}            Stops a run without signing.
//   {action: "import_attachments", deal_id}   Document mover only (inbox sync calls it).
//   {action: "sweep"}                     Cron: check every open run.
//   {action: "status"}                    Whether the agent is set up and signing is on.
//   {action: "setup"} (admin)             Creates/updates environment, vault and agent.
//   {action: "save_login", platform, username, password, hosts} (admin)
//                                         Stores a portal password in the vault.
//   {action: "delete_login", platform} (admin)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsFor, requireApprovedUser, requireCronSecret } from "../_shared/auth.ts";
import { AnthropicHttpError, AnthropicNotConfiguredError, deleteClaudeFile, uploadClaudeFile } from "../_shared/anthropic.ts";
import { assertWithinBudget, BudgetExceededError, invalidateSpendCache } from "../_shared/aiBudget.ts";
import { errorResponse } from "../_shared/errors.ts";
import { graphFetch, resolveMailbox } from "../_shared/graphMail.ts";
import { findCaLinksInThread } from "../_shared/caLinks.ts";
import {
  documentFor,
  isUnderwritingAttachment,
  parseCaResult,
  runStatusFor,
  safeFileName,
} from "../_shared/dealAgents.ts";
import { AGENT, AGENT_MODEL, definitionHash, ENVIRONMENT } from "./agentDefinition.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
/** Hard cap on one CA run, enforced by Anthropic on the session. */
const RUN_BUDGET_USD = Number(Deno.env.get("CA_RUN_BUDGET_USD") ?? 5);
const FN = "deal-agents";
const DOCS_BUCKET = "deal-documents";
const AGENT_FILES_BUCKET = "agent-files";
const MA_BASE = "https://api.anthropic.com/v1";

const MIN_CHECK_MS = 15_000;
const STALE_START_MS = 10 * 60_000;
const MAX_EVENT_PAGES = 20;
/** How long a verification-code request waits for the email before answering "not found". */
const CODE_WAIT_MS = 4 * 60_000;
/** A run quiet this long while 'running' is checked by the sweep. */
const SWEEP_AFTER_MS = 60_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{2,40}$/;
const HOST_RE = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const OPEN = ["starting", "running", "needs_approval"];

class UserFacingError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped client, as in the other functions
type Admin = any;

// ------------------------------------------------------------ Managed Agents

async function ma<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!ANTHROPIC_API_KEY) throw new AnthropicNotConfiguredError();
  const resp = await fetch(`${MA_BASE}${path}`, {
    method,
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "managed-agents-2026-04-01",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await resp.text();
  if (!resp.ok) {
    throw new AnthropicHttpError(resp.status, txt.slice(0, 2000), `anthropic ${method} ${path} ${resp.status}: ${txt.slice(0, 400)}`);
  }
  return (txt ? JSON.parse(txt) : null) as T;
}

type SessionEvent = { id: string; type: string; [k: string]: unknown };
type Session = { id: string; status: string; usage?: { list_cost?: { amount?: string } } };

const listCostUsd = (s: Session): number | null => {
  const a = s.usage?.list_cost?.amount;
  return typeof a === "string" && /^\d+$/.test(a) ? Number(a) / 100 : null;
};

async function listSessionFiles(sessionId: string): Promise<{ id: string; filename: string; created_at: string }[]> {
  const out: { id: string; filename: string; created_at: string }[] = [];
  let after: string | null = null;
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ scope_id: sessionId, limit: "100" });
    if (after) q.set("after_id", after);
    const page = await ma<{ data: typeof out; has_more?: boolean; last_id?: string }>("GET", `/files?${q}`);
    out.push(...(page.data ?? []));
    if (!page.has_more || !page.last_id) break;
    after = page.last_id;
  }
  return out;
}

async function downloadFile(fileId: string): Promise<Blob> {
  const resp = await fetch(`${MA_BASE}/files/${encodeURIComponent(fileId)}/content`, {
    headers: {
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "managed-agents-2026-04-01",
    },
  });
  if (!resp.ok) throw new Error(`file download ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  return await resp.blob();
}

// ------------------------------------------------------------ entry

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({}));
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Service callers: the cron sweep and the inbox sync.
    const isService = requireCronSecret(req) === null;
    let userId: string | null = null;
    if (!isService) {
      const authz = await requireApprovedUser(req);
      if (!authz.ok) return authz.response;
      userId = authz.user.id;
    } else if (!["sweep", "import_attachments", "start"].includes(body.action)) {
      return json({ error: "Not allowed for service callers" }, 403);
    }

    const isAdmin = async () => {
      if (!userId) return false;
      const { data } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
      return !!data;
    };

    switch (body.action) {
      case "status":
        return json(await status(admin));
      case "setup":
      case "save_login":
      case "delete_login": {
        if (!(await isAdmin())) return json({ error: "Only an admin can change the deal agents." }, 403);
        if (body.action === "setup") return json(await setup(admin, userId!));
        if (body.action === "save_login") return json(await saveLogin(admin, body, userId!));
        return json(await deleteLogin(admin, body, userId!));
      }
      case "start":
        return json(await start(admin, requireUuid(body.deal_id, "deal_id"), userId), 202);
      case "import_attachments": {
        const dealId = requireUuid(body.deal_id, "deal_id");
        const work = importEmailAttachments(admin, dealId);
        if (typeof EdgeRuntime !== "undefined") {
          EdgeRuntime.waitUntil(work.catch((e) => logErr("import", dealId, e)));
          return json({ status: "importing" }, 202);
        }
        return json(await work);
      }
      case "sweep":
        if (!isService) return json({ error: "sweep is for the scheduler" }, 403);
        return json(await sweep(admin));
      case "check":
        return json(await check(admin, requireUuid(body.run_id, "run_id")));
      case "approve":
        return json(await approve(admin, requireUuid(body.run_id, "run_id"), userId!));
      case "cancel":
        return json(await cancel(admin, requireUuid(body.run_id, "run_id")));
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    if (e instanceof UserFacingError) return json({ error: e.message }, e.status);
    if (e instanceof BudgetExceededError) return json({ error: e.message }, 429);
    return errorResponse(e, cors, { fn: FN });
  }
});

function requireUuid(v: unknown, name: string): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new UserFacingError(`${name} must be a UUID`);
  return v;
}

function logErr(stage: string, id: string, e: unknown) {
  console.error(JSON.stringify({ fn: FN, stage, id, detail: String((e as Error)?.stack ?? e) }));
}

// ------------------------------------------------------------ config

async function loadConfig(admin: Admin) {
  const { data } = await admin.from("deal_agent_config").select("*").eq("id", 1).maybeSingle();
  return data as any;
}

async function loadProfile(admin: Admin) {
  const { data } = await admin.from("ca_signer_profile").select("*").eq("id", 1).maybeSingle();
  return data as any;
}

async function status(admin: Admin) {
  const [cfg, profile] = await Promise.all([loadConfig(admin), loadProfile(admin)]);
  const [envHash, agentHash] = await Promise.all([definitionHash(ENVIRONMENT), definitionHash(AGENT)]);
  return {
    configured: !!(cfg?.agent_id && cfg?.environment_id && cfg?.vault_id),
    up_to_date: cfg?.agent_hash === agentHash && cfg?.environment_hash === envHash,
    signing_enabled: !!profile?.enabled,
    logins: (profile?.portal_logins ?? []).map((l: any) => ({ platform: l.platform, username: l.username, hosts: l.hosts })),
    run_budget_usd: RUN_BUDGET_USD,
  };
}

async function setup(admin: Admin, userId: string) {
  const cfg = (await loadConfig(admin)) ?? {};
  const [envHash, agentHash] = await Promise.all([definitionHash(ENVIRONMENT), definitionHash(AGENT)]);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: userId };
  const changed: string[] = [];

  if (!cfg.environment_id) {
    patch.environment_id = (await ma<{ id: string }>("POST", "/environments", ENVIRONMENT)).id;
    patch.environment_hash = envHash;
    changed.push("environment");
  } else if (cfg.environment_hash !== envHash) {
    await ma("POST", `/environments/${cfg.environment_id}`, ENVIRONMENT);
    patch.environment_hash = envHash;
    changed.push("environment");
  }
  if (!cfg.vault_id) {
    patch.vault_id = (await ma<{ id: string }>("POST", "/vaults", { display_name: "Ansonia deal portals" })).id;
    changed.push("vault");
  }
  if (!cfg.agent_id) {
    const a = await ma<{ id: string; version: number }>("POST", "/agents", AGENT);
    Object.assign(patch, { agent_id: a.id, agent_version: a.version, agent_hash: agentHash });
    changed.push("agent");
  } else if (cfg.agent_hash !== agentHash) {
    const a = await ma<{ id: string; version: number }>("POST", `/agents/${cfg.agent_id}`, AGENT);
    Object.assign(patch, { agent_version: a.version, agent_hash: agentHash });
    changed.push("agent");
  }
  await admin.from("deal_agent_config").update(patch).eq("id", 1);
  return { changed, ...(await status(admin)) };
}

/**
 * Stores a portal password as a vault environment-variable credential. The
 * password passes through this function to Anthropic and is never written to
 * the database; the sandbox only ever sees a placeholder, swapped for the real
 * value on the listed hosts.
 */
async function saveLogin(admin: Admin, body: any, userId: string) {
  const cfg = await loadConfig(admin);
  if (!cfg?.vault_id) throw new UserFacingError("Set up the deal agents first.");
  const platform = String(body.platform ?? "").trim().toLowerCase();
  const username = String(body.username ?? "").trim();
  const password = typeof body.password === "string" ? body.password : "";
  const hosts: string[] = Array.isArray(body.hosts) ? body.hosts.map((h: unknown) => String(h).trim().toLowerCase()).filter(Boolean) : [];
  if (!/^[a-z0-9_]{2,30}$/.test(platform)) throw new UserFacingError("Platform must be a short name like rcm or buildout.");
  if (!username || username.length > 200) throw new UserFacingError("Username is required.");
  if (!password || password.length > 500) throw new UserFacingError("Password is required.");
  if (!hosts.length || hosts.length > 20 || !hosts.every((h) => HOST_RE.test(h))) {
    throw new UserFacingError("List the portal's hosts, e.g. rcm1.com, *.rcm1.com.");
  }
  const secretName = `${platform.toUpperCase()}_PASSWORD`;
  if (!ENV_NAME_RE.test(secretName)) throw new UserFacingError("Platform name is not usable.");

  const profile = await loadProfile(admin);
  const logins: any[] = profile?.portal_logins ?? [];
  const existing = logins.find((l) => l.platform === platform);
  const credential = {
    display_name: `${platform} login (${username})`,
    auth: {
      type: "environment_variable",
      secret_name: secretName,
      secret_value: password,
      networking: { type: "limited", allowed_hosts: hosts },
      // A login form posts the password in the request body.
      injection_location: { header: false, body: true },
    },
  };
  let credentialId: string;
  if (existing?.credential_id) {
    await ma("POST", `/vaults/${cfg.vault_id}/credentials/${existing.credential_id}`, credential);
    credentialId = existing.credential_id;
  } else {
    credentialId = (await ma<{ id: string }>("POST", `/vaults/${cfg.vault_id}/credentials`, credential)).id;
  }
  const next = [
    ...logins.filter((l) => l.platform !== platform),
    { platform, username, hosts, secret_name: secretName, credential_id: credentialId },
  ];
  await admin.from("ca_signer_profile").update({ portal_logins: next, updated_at: new Date().toISOString(), updated_by: userId }).eq("id", 1);
  return { saved: platform };
}

async function deleteLogin(admin: Admin, body: any, userId: string) {
  const cfg = await loadConfig(admin);
  const platform = String(body.platform ?? "");
  const profile = await loadProfile(admin);
  const logins: any[] = profile?.portal_logins ?? [];
  const existing = logins.find((l) => l.platform === platform);
  if (!existing) throw new UserFacingError("No such login.", 404);
  if (cfg?.vault_id && existing.credential_id) {
    await ma("DELETE", `/vaults/${cfg.vault_id}/credentials/${existing.credential_id}`).catch((e) => logErr("delete_login", platform, e));
  }
  await admin.from("ca_signer_profile").update({
    portal_logins: logins.filter((l) => l.platform !== platform),
    updated_at: new Date().toISOString(),
    updated_by: userId,
  }).eq("id", 1);
  return { deleted: platform };
}

// ------------------------------------------------------------ start

/** The deal's inbox rows: the one it was accepted from, plus any later thread attached to it. */
async function inboxIdsFor(admin: Admin, dealId: string): Promise<string[]> {
  const [{ data: deal }, { data: accepted }] = await Promise.all([
    admin.from("deals").select("id, inbox_deal_id").eq("id", dealId).maybeSingle(),
    admin.from("inbox_deals").select("id").eq("accepted_deal_id", dealId),
  ]);
  if (!deal) throw new UserFacingError("Deal not found", 404);
  const ids = new Set<string>((accepted ?? []).map((r: any) => r.id));
  if ((deal as any).inbox_deal_id) ids.add((deal as any).inbox_deal_id);
  return [...ids];
}

async function start(admin: Admin, dealId: string, userId: string | null) {
  // An open run is the answer to a second click.
  const { data: open } = await admin.from("deal_ca_runs").select("*").eq("deal_id", dealId).in("status", OPEN).maybeSingle();
  if (open) return publicRow(open);

  const inboxIds = await inboxIdsFor(admin, dealId);
  // The document mover runs whatever happens to the CA.
  const imports = importEmailAttachments(admin, dealId).catch((e) => logErr("import", dealId, e));
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(imports);

  const [{ data: emails }, { data: inbox }, { data: deal }] = await Promise.all([
    inboxIds.length
      ? admin.from("deal_emails").select("id, body, received_at").in("deal_id", inboxIds).order("received_at", { ascending: true })
      : Promise.resolve({ data: [] as any[] }),
    inboxIds.length
      ? admin.from("inbox_deals").select("id, email_body, email_received_at").in("id", inboxIds)
      : Promise.resolve({ data: [] as any[] }),
    admin.from("deals").select("id, property_name, address, city, state").eq("id", dealId).maybeSingle(),
  ]);
  const bodies = [...(emails ?? []).map((e: any) => e.body), ...(inbox ?? []).map((i: any) => i.email_body)];
  const links = findCaLinksInThread(bodies);
  const sourceEmail = links.ca ? (emails ?? []).find((e: any) => typeof e.body === "string" && e.body.includes(new URL(links.ca!.url).pathname)) : null;

  const base = {
    deal_id: dealId,
    created_by: userId,
    ca_url: links.ca?.url ?? null,
    platform: links.ca?.platform ?? null,
    deal_room_urls: links.dealRoom,
    source_email_id: sourceEmail?.id ?? null,
  };

  if (!links.ca) {
    const { data } = await admin.from("deal_ca_runs").insert({
      ...base,
      status: "no_link",
      attention: "No CA link in this deal's emails. Email attachments are still copied onto the deal.",
      finished_at: new Date().toISOString(),
    }).select("*").single();
    return publicRow(data);
  }

  const [profile, cfg] = await Promise.all([loadProfile(admin), loadConfig(admin)]);
  if (!profile?.enabled || !cfg?.agent_id) {
    const { data } = await admin.from("deal_ca_runs").insert({
      ...base,
      status: "disabled",
      attention: !cfg?.agent_id
        ? "The CA agent isn't set up yet (Admin → Connectors → Deal agents)."
        : "CA signing is turned off (Admin → Connectors → Deal agents). Turn it on, then press Sign CA.",
      finished_at: new Date().toISOString(),
    }).select("*").single();
    return publicRow(data);
  }

  await assertWithinBudget(admin, "interactive");

  const { data: row, error } = await admin.from("deal_ca_runs").insert({ ...base, status: "starting" }).select("*").single() as { data: any; error: any };
  if (error) {
    // Lost a race with another start: return the run that won.
    const { data: winner } = await admin.from("deal_ca_runs").select("*").eq("deal_id", dealId).in("status", OPEN).maybeSingle();
    if (winner) return publicRow(winner);
    throw error;
  }

  try {
    const uploaded: string[] = [];
    const signer = {
      name: profile.full_name,
      title: profile.title,
      company: profile.company,
      email: profile.email,
      phone: profile.phone,
      address: [profile.address_line, profile.city, profile.state, profile.zip].filter(Boolean).join(", "),
      address_line: profile.address_line,
      city: profile.city,
      state: profile.state,
      zip: profile.zip,
    };
    const resources: { type: "file"; file_id: string; mount_path: string }[] = [];
    const signerId = await uploadClaudeFile(new Blob([JSON.stringify(signer, null, 2)], { type: "application/json" }), "signer.json");
    uploaded.push(signerId);
    resources.push({ type: "file", file_id: signerId, mount_path: "/mnt/session/uploads/signer.json" });
    if (profile.signature_path) {
      const { data: sig } = await admin.storage.from(AGENT_FILES_BUCKET).download(profile.signature_path);
      if (sig) {
        const sigId = await uploadClaudeFile(new Blob([sig], { type: "image/png" }), "signature.png");
        uploaded.push(sigId);
        resources.push({ type: "file", file_id: sigId, mount_path: "/mnt/session/uploads/signature.png" });
      }
    }

    const logins = (profile.portal_logins ?? []) as any[];
    const d = deal as any;
    const message = [
      `Deal: ${d?.property_name ?? "(unnamed)"}${d?.city ? `, ${d.city}, ${d.state ?? ""}` : ""}${d?.address ? ` (${d.address})` : ""}.`,
      `CA link (${links.ca.platform}): ${links.ca.url}`,
      links.dealRoom.length
        ? `Other links from the broker's email (deal room / property website):\n${links.dealRoom.map((l) => `- ${l.text || "link"}: ${l.url}`).join("\n")}`
        : "The email had no separate deal-room link; the confirmation page after signing usually leads there.",
      logins.length
        ? `Portal logins:\n${logins.map((l) => `- ${l.platform}: username ${l.username}, password in $${l.secret_name} (hosts ${l.hosts.join(", ")})`).join("\n")}`
        : "Portal logins: none saved.",
      "This CA is NOT pre-approved: if any clause is flagged, stop for approval.",
    ].join("\n\n");

    const session = await ma<Session>("POST", "/sessions", {
      agent: cfg.agent_id,
      environment_id: cfg.environment_id,
      vault_ids: cfg.vault_id ? [cfg.vault_id] : [],
      title: `CA: ${d?.property_name ?? dealId}`.slice(0, 200),
      resources,
      budget: { type: "limit", max_list_cost: { amount: String(Math.round(RUN_BUDGET_USD * 100)), currency: "USD" } },
      metadata: { deal_id: dealId, run_id: row.id },
      initial_events: [{ type: "user.message", content: [{ type: "text", text: message }] }],
    });
    const { data: updated } = await admin.from("deal_ca_runs").update({
      status: "running",
      session_id: session.id,
      progress: "Starting",
      event_state: { uploaded },
    }).eq("id", row.id).select("*").single();
    return publicRow(updated);
  } catch (e) {
    await admin.from("deal_ca_runs").update({
      status: "failed",
      error: e instanceof AnthropicNotConfiguredError ? "The Anthropic key isn't configured." : "Could not start the CA agent. Try again.",
      finished_at: new Date().toISOString(),
    }).eq("id", row.id);
    throw e;
  }
}

// ------------------------------------------------------------ check

type Digest = {
  progress: string | null;
  lastMessage: string | null;
  stopReason: string | null;
  terminated: boolean;
  errors: string[];
  /** Custom tool calls not yet answered: {id, input, at}. */
  pendingTools: { id: string; name: string; input: any; at: string }[];
  uploaded?: string[];
};

function digest(events: SessionEvent[], prev: Digest): Digest {
  const out: Digest = { ...prev, errors: [...prev.errors], pendingTools: [...prev.pendingTools] };
  for (const e of events) {
    switch (e.type) {
      case "agent.message": {
        const text = Array.isArray(e.content)
          ? (e.content as any[]).filter((b) => b?.type === "text").map((b) => b.text).join("\n").trim()
          : "";
        if (!text) break;
        out.lastMessage = text.slice(0, 2000);
        const lines = text.split("\n").filter((l) => /^\s*PROGRESS:/i.test(l));
        if (lines.length) out.progress = lines[lines.length - 1].replace(/^\s*PROGRESS:\s*/i, "").slice(0, 200);
        break;
      }
      case "agent.custom_tool_use":
        out.pendingTools.push({ id: e.id, name: String(e.name ?? ""), input: e.input ?? {}, at: String(e.processed_at ?? new Date().toISOString()) });
        break;
      case "user.custom_tool_result":
        out.pendingTools = out.pendingTools.filter((t) => t.id !== e.custom_tool_use_id);
        break;
      case "session.status_running":
        out.stopReason = null;
        break;
      case "session.status_idle":
        out.stopReason = (e.stop_reason as { type?: string } | undefined)?.type ?? null;
        break;
      case "session.status_terminated":
        out.terminated = true;
        break;
      case "session.error":
        out.errors.push(String((e.error as any)?.message ?? "session error").slice(0, 500));
        break;
    }
  }
  return out;
}

const FINAL_STOPS = new Set(["end_turn", "retries_exhausted", "budget_reached"]);

async function check(admin: Admin, runId: string) {
  const { data: row } = await admin.from("deal_ca_runs").select("*").eq("id", runId).maybeSingle();
  if (!row) throw new UserFacingError("Run not found", 404);
  const r = row as any;
  if (r.status === "starting" && Date.now() - Date.parse(r.created_at) > STALE_START_MS) {
    await admin.from("deal_ca_runs").update({ status: "failed", error: "The run never started. Try again.", finished_at: new Date().toISOString() })
      .eq("id", runId).eq("status", "starting");
    return await reload(admin, runId);
  }
  if (r.status !== "running") return publicRow(r);

  const now = new Date();
  const since = new Date(now.getTime() - MIN_CHECK_MS).toISOString();
  const { data: claimed } = await admin.from("deal_ca_runs").update({ checked_at: now.toISOString() })
    .eq("id", runId).eq("status", "running").or(`checked_at.is.null,checked_at.lt.${since}`).select("*").maybeSingle();
  if (!claimed) return publicRow(r);
  const c = claimed as any;

  const session = await ma<Session>("GET", `/sessions/${encodeURIComponent(c.session_id)}`);
  const cost = listCostUsd(session);
  const prev: Digest = {
    progress: c.progress ?? null,
    lastMessage: c.event_state?.lastMessage ?? null,
    stopReason: c.event_state?.stopReason ?? null,
    terminated: c.event_state?.terminated ?? false,
    errors: c.event_state?.errors ?? [],
    pendingTools: c.event_state?.pendingTools ?? [],
    uploaded: c.event_state?.uploaded ?? [],
  };
  let page: string | null = c.events_page ?? null;
  let lastId: string | null = c.last_event_id ?? null;
  let dg = prev;
  let pagesRead = 0;
  for (; pagesRead < MAX_EVENT_PAGES; pagesRead++) {
    const q = page ? `?page=${encodeURIComponent(page)}` : "";
    const res = await ma<{ data: SessionEvent[]; next_page: string | null }>("GET", `/sessions/${encodeURIComponent(c.session_id)}/events${q}`);
    const events = res.data ?? [];
    const seenAt = lastId ? events.findIndex((e) => e.id === lastId) : -1;
    dg = digest(seenAt >= 0 ? events.slice(seenAt + 1) : events, dg);
    if (events.length) lastId = events[events.length - 1].id;
    if (!res.next_page) break;
    page = res.next_page;
  }

  // Answer verification-code requests from the mailbox.
  if (dg.pendingTools.length) dg = await answerTools(c.session_id, dg);

  await admin.from("deal_ca_runs").update({
    events_page: page,
    last_event_id: lastId,
    progress: dg.progress,
    event_state: {
      stopReason: dg.stopReason,
      terminated: dg.terminated,
      lastMessage: dg.lastMessage,
      errors: dg.errors.slice(-5),
      pendingTools: dg.pendingTools,
      uploaded: dg.uploaded,
    },
    cost_usd: cost,
  }).eq("id", runId);

  const over = session.status === "terminated" || dg.terminated ||
    (session.status === "idle" && dg.stopReason !== null && FINAL_STOPS.has(dg.stopReason) && dg.pendingTools.length === 0);
  if (pagesRead < MAX_EVENT_PAGES && over) {
    await collect(admin, { ...c, cost_usd: cost }, dg);
  }
  return await reload(admin, runId);
}

/** Answers get_email_code from the acquisitions mailbox; waits a few minutes for the email before saying none came. */
async function answerTools(sessionId: string, dg: Digest): Promise<Digest> {
  const answered: string[] = [];
  const results: unknown[] = [];
  for (const t of dg.pendingTools) {
    let result: Record<string, unknown>;
    if (t.name !== "get_email_code") {
      result = { error: `Unknown tool ${t.name}` };
    } else {
      const found = await findEmailCode(String(t.input?.portal ?? ""), String(t.input?.sent_after ?? t.at));
      if (!found && Date.now() - Date.parse(t.at) < CODE_WAIT_MS) continue; // try again next check
      result = found ?? { found: false, note: "No matching email arrived within 4 minutes." };
    }
    results.push({ type: "user.custom_tool_result", custom_tool_use_id: t.id, content: [{ type: "text", text: JSON.stringify(result) }] });
    answered.push(t.id);
  }
  if (results.length) {
    try {
      await ma("POST", `/sessions/${encodeURIComponent(sessionId)}/events`, { events: results });
    } catch (e) {
      logErr("tool_result", sessionId, e);
      return dg;
    }
  }
  return { ...dg, pendingTools: dg.pendingTools.filter((t) => !answered.includes(t.id)), stopReason: answered.length ? null : dg.stopReason };
}

async function findEmailCode(portal: string, sentAfter: string) {
  const after = Number.isFinite(Date.parse(sentAfter)) ? new Date(Date.parse(sentAfter) - 60_000) : new Date(Date.now() - 10 * 60_000);
  const mb = resolveMailbox("acquisitions");
  const path = `/messages?$top=15&$orderby=receivedDateTime desc` +
    `&$filter=${encodeURIComponent(`receivedDateTime ge ${after.toISOString()}`)}` +
    `&$select=id,subject,from,receivedDateTime,body`;
  const res = await graphFetch(mb, path);
  if (!res.ok) return null;
  const msgs: any[] = (await res.json()).value ?? [];
  const key = portal.toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  for (const m of msgs) {
    const from = String(m.from?.emailAddress?.address ?? "").toLowerCase();
    const subject = String(m.subject ?? "");
    const html = String(m.body?.content ?? "");
    const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
    const about = `${from} ${subject} ${text.slice(0, 3000)}`.toLowerCase();
    if (key && !about.includes(key.replace(/^www\./, "").split(".")[0])) continue;
    if (!/verif|code|sign.?in|log.?in|one.?time|passcode|confirm/i.test(`${subject} ${text.slice(0, 2000)}`)) continue;
    const code = text.match(/(?:code|passcode)[^0-9A-Z]{0,40}\b([0-9]{4,8}|[A-Z0-9]{6,8})\b/i)?.[1] ??
      text.match(/\b([0-9]{6})\b/)?.[1] ?? null;
    const link = (html.match(/href="([^"]+)"[^>]*>[^<]*(verify|sign in|log in|confirm|continue)/i)?.[1] ?? null)?.replace(/&amp;/g, "&") ?? null;
    if (code || link) return { found: true, code, link, subject, received_at: m.receivedDateTime };
  }
  return null;
}

/** Reads result.json and the files the session wrote, and closes or parks the run. */
async function collect(admin: Admin, row: any, dg: Digest) {
  const files = await listSessionFiles(row.session_id);
  const base = (f: { filename: string }) => f.filename.split("/").pop() ?? f.filename;
  const newest = [...files].sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
  const resultFile = newest.find((f) => base(f).toLowerCase() === "result.json");
  const result = parseCaResult(resultFile ? await (await downloadFile(resultFile.id)).text() : null);
  if (!resultFile && dg.stopReason === "budget_reached") result.notes = `The run reached its $${RUN_BUDGET_USD} cost cap.`;
  else if (!resultFile && dg.errors.length) result.notes = `The run failed: ${dg.errors[dg.errors.length - 1]}`;

  // CA copies, kept with the run (not parsed as documents).
  const caPath = async (name: string) => {
    const f = newest.find((x) => base(x).toLowerCase() === name);
    if (!f) return null;
    const blob = await downloadFile(f.id);
    const path = `${row.deal_id}/ca/${row.id}/${name}`;
    const { error } = await admin.storage.from(DOCS_BUCKET).upload(path, blob, { upsert: true, contentType: blob.type || undefined });
    return error ? null : path;
  };
  const caText = await caPath("ca_text.txt");
  const signedPdf = await caPath("signed_ca.pdf");
  const signedPng = signedPdf ? null : await caPath("signed_confirmation.png");

  // Deal-room downloads: the documents result.json lists, or anything under docs/.
  const docFiles = newest.filter((f) => /(^|\/)docs\//.test(f.filename) || !!documentFor(f.filename, result.documents))
    .filter((f) => !/\.(json|txt|png)$/i.test(base(f)) || documentFor(f.filename, result.documents));
  let added = 0;
  for (const f of docFiles) {
    try {
      const blob = await downloadFile(f.id);
      const ok = await addDocument(admin, row.deal_id, {
        source: "portal",
        sourceRef: `session:${row.session_id}:${f.id}`,
        fileName: base(f),
        blob,
        caRunId: row.id,
      });
      if (ok) added++;
    } catch (e) {
      logErr("portal_doc", row.id, e);
    }
  }

  const signedNow = result.outcome === "signed" || result.outcome === "already_signed";
  const { status, attention } = runStatusFor(result, !!row.approved_at);
  const profile = signedNow ? await loadProfile(admin) : null;
  const closes = status !== "needs_approval";
  const { data: updated } = await admin.from("deal_ca_runs").update({
    status,
    attention: attention ?? (status === "done" && result.documents.length === 0 ? (result.notes ?? "Signed; no documents were downloadable yet.") : null),
    error: status === "failed" ? (result.notes ?? "The run ended without a result.") : null,
    agent_notes: result.notes,
    platform: result.platform ?? row.platform,
    ca_standard: result.standard,
    ca_summary: result.summary,
    ca_flags: result.flags,
    ca_text_path: caText ?? row.ca_text_path,
    signed_copy_path: signedPdf ?? signedPng ?? row.signed_copy_path,
    signed_as: signedNow && profile ? { name: profile.full_name, title: profile.title, company: profile.company, email: profile.email } : row.signed_as,
    signed_at: signedNow ? (row.signed_at ?? new Date().toISOString()) : row.signed_at,
    documents_found: (row.documents_found ?? 0) + docFiles.length,
    documents_added: (row.documents_added ?? 0) + added,
    finished_at: closes ? new Date().toISOString() : null,
  }).eq("id", row.id).eq("status", "running").select("*").maybeSingle();

  if (updated) await logCost(admin, row, status);
  if (updated && closes) {
    await Promise.all(((row.event_state?.uploaded ?? dg.uploaded ?? []) as string[]).map(deleteClaudeFile));
  }
}

/** Logs the session's spend since the last log, once per collect. */
async function logCost(admin: Admin, row: any, status: string) {
  const total = Number(row.cost_usd ?? 0);
  const logged = Number(row.event_state?.costLogged ?? 0);
  const delta = total - logged;
  if (!(delta > 0)) return;
  try {
    await admin.from("ai_usage_log").insert({
      function_name: FN,
      model: AGENT_MODEL,
      provider: "anthropic",
      input_tokens: 0,
      output_tokens: 0,
      cached_tokens: 0,
      cost_usd: delta,
      success: status !== "failed",
      deal_id: row.deal_id,
    });
    const { data: cur } = await admin.from("deal_ca_runs").select("event_state").eq("id", row.id).maybeSingle();
    await admin.from("deal_ca_runs").update({ event_state: { ...((cur as any)?.event_state ?? {}), costLogged: total } }).eq("id", row.id);
    invalidateSpendCache();
  } catch (e) {
    logErr("log_cost", row.id, e);
  }
}

async function reload(admin: Admin, runId: string) {
  const { data } = await admin.from("deal_ca_runs").select("*").eq("id", runId).maybeSingle();
  return publicRow(data);
}

/** The row without the bookkeeping the page has no use for. */
function publicRow(row: any) {
  if (!row) return null;
  const { events_page: _p, last_event_id: _l, event_state: _e, ...rest } = row;
  return rest;
}

// ------------------------------------------------------------ approve / cancel / sweep

async function approve(admin: Admin, runId: string, userId: string) {
  const { data: row } = await admin.from("deal_ca_runs").select("*").eq("id", runId).maybeSingle();
  if (!row) throw new UserFacingError("Run not found", 404);
  const r = row as any;
  if (r.status !== "needs_approval") throw new UserFacingError("This run isn't waiting for approval.", 409);
  const { data: who } = await admin.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  const name = (who as any)?.full_name || (who as any)?.email || "an Ansonia user";

  const { data: claimed } = await admin.from("deal_ca_runs").update({
    status: "running",
    approved_by: userId,
    approved_at: new Date().toISOString(),
    progress: "Approved; signing",
    checked_at: null,
    event_state: { ...(r.event_state ?? {}), stopReason: null },
  }).eq("id", runId).eq("status", "needs_approval").select("*").maybeSingle();
  if (!claimed) return await reload(admin, runId);

  await ma("POST", `/sessions/${encodeURIComponent(r.session_id)}/events`, {
    events: [{
      type: "user.message",
      content: [{
        type: "text",
        text: `APPROVED by ${name}: the flagged clauses are accepted. Sign this CA as the signer, then collect the documents and rewrite result.json.`,
      }],
    }],
  });
  return await reload(admin, runId);
}

async function cancel(admin: Admin, runId: string) {
  const { data: row } = await admin.from("deal_ca_runs").select("*").eq("id", runId).maybeSingle();
  if (!row) throw new UserFacingError("Run not found", 404);
  const r = row as any;
  if (!OPEN.includes(r.status)) return publicRow(r);
  if (r.session_id && r.status === "running") {
    await ma("POST", `/sessions/${encodeURIComponent(r.session_id)}/events`, { events: [{ type: "user.interrupt" }] })
      .catch((e) => logErr("interrupt", runId, e));
  }
  await admin.from("deal_ca_runs").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", runId).in("status", OPEN);
  await Promise.all(((r.event_state?.uploaded ?? []) as string[]).map(deleteClaudeFile));
  return await reload(admin, runId);
}

async function sweep(admin: Admin) {
  const before = new Date(Date.now() - SWEEP_AFTER_MS).toISOString();
  const { data: runs } = await admin.from("deal_ca_runs").select("id")
    .in("status", ["starting", "running"]).or(`checked_at.is.null,checked_at.lt.${before}`).limit(20);
  const out: Record<string, string> = {};
  for (const r of runs ?? []) {
    try {
      out[(r as any).id] = (await check(admin, (r as any).id))?.status ?? "?";
    } catch (e) {
      logErr("sweep", (r as any).id, e);
      out[(r as any).id] = "error";
    }
  }
  return { checked: out };
}

// ------------------------------------------------------------ documents

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
};

/**
 * Puts one file on the deal the way an upload does: storage, a deal_documents
 * row, then parse-deal-document. Returns false when the deal already has it.
 */
async function addDocument(admin: Admin, dealId: string, f: {
  source: "email" | "portal";
  sourceRef: string;
  fileName: string;
  blob: Blob;
  caRunId?: string;
}): Promise<boolean> {
  const ext = (f.fileName.split(".").pop() ?? "").toLowerCase();
  if (!CONTENT_TYPES[ext]) return false;
  const hash = await sha256(f.blob);
  const fileName = safeFileName(f.fileName);

  // Claim it first: the unique keys make a second copy (same file from another
  // email, or from the deal room and an email) a no-op.
  const { data: claim, error: claimErr } = await admin.from("deal_document_imports").insert({
    deal_id: dealId,
    source: f.source,
    source_ref: f.sourceRef,
    content_hash: hash,
    file_name: fileName,
    ca_run_id: f.caRunId ?? null,
  }).select("id").maybeSingle();
  if (claimErr || !claim) return false;

  const key = `${dealId}/${crypto.randomUUID()}-${fileName}`;
  const { error: upErr } = await admin.storage.from(DOCS_BUCKET).upload(key, f.blob, { contentType: CONTENT_TYPES[ext] });
  if (upErr) {
    await admin.from("deal_document_imports").delete().eq("id", (claim as any).id);
    throw upErr;
  }
  const { data: doc, error: docErr } = await admin.from("deal_documents").insert({
    deal_id: dealId,
    storage_path: key,
    file_name: fileName,
    file_size: f.blob.size,
    content_type: CONTENT_TYPES[ext],
    uploaded_by: null,
  }).select("id").single();
  if (docErr) {
    await admin.storage.from(DOCS_BUCKET).remove([key]);
    await admin.from("deal_document_imports").delete().eq("id", (claim as any).id);
    throw docErr;
  }
  const documentId = (doc as any).id as string;
  await admin.from("deal_document_imports").update({ document_id: documentId }).eq("id", (claim as any).id);

  const { error: parseErr } = await admin.functions.invoke("parse-deal-document", { body: { document_id: documentId } });
  if (parseErr) {
    await admin.from("deal_documents").update({ parse_status: "failed", parse_error: "Could not start reading. Press Retry." })
      .eq("id", documentId).eq("parse_status", "pending");
  }
  return true;
}

/** Copies underwriting attachments from the deal's emails onto the deal. */
async function importEmailAttachments(admin: Admin, dealId: string) {
  const inboxIds = await inboxIdsFor(admin, dealId);
  if (!inboxIds.length) return { added: 0, seen: 0 };
  const { data: emails } = await admin.from("deal_emails").select("email_message_id").in("deal_id", inboxIds);
  const { data: done } = await admin.from("deal_document_imports").select("source_ref").eq("deal_id", dealId).eq("source", "email");
  const doneRefs = new Set((done ?? []).map((d: any) => d.source_ref));
  const mb = resolveMailbox("acquisitions");
  let added = 0;
  let seen = 0;
  for (const e of emails ?? []) {
    const msgId = (e as any).email_message_id as string | null;
    if (!msgId) continue;
    const res = await graphFetch(mb, `/messages/${encodeURIComponent(msgId)}/attachments?$select=id,name,contentType,size,isInline`);
    if (!res.ok) {
      // Moved or deleted mail is not worth failing the rest over.
      if (res.status !== 404) logErr("attachments", msgId, `${res.status} ${(await res.text()).slice(0, 200)}`);
      continue;
    }
    const atts: any[] = (await res.json()).value ?? [];
    for (const a of atts) {
      if (a["@odata.type"] && a["@odata.type"] !== "#microsoft.graph.fileAttachment") continue;
      const meta = { name: String(a.name ?? ""), contentType: a.contentType ?? null, size: Number(a.size ?? 0), isInline: !!a.isInline };
      if (!isUnderwritingAttachment(meta)) continue;
      seen++;
      const ref = `email:${msgId}:${a.id}`;
      if (doneRefs.has(ref)) continue;
      const raw = await graphFetch(mb, `/messages/${encodeURIComponent(msgId)}/attachments/${encodeURIComponent(a.id)}/$value`);
      if (!raw.ok) {
        logErr("attachment_value", ref, raw.status);
        continue;
      }
      try {
        if (await addDocument(admin, dealId, { source: "email", sourceRef: ref, fileName: meta.name, blob: await raw.blob() })) added++;
      } catch (err) {
        logErr("attachment_add", ref, err);
      }
    }
  }
  return { added, seen };
}
