// fathom
// Connects a user's Fathom account and keeps a rolling 30 days of their
// external calls (summary, action items, transcript) for Atlas to search.
//
// Actions (POST body):
//   {action: "status"}                       The caller's connection (never secrets),
//                                            how many meetings it brought in, and
//                                            whether OAuth is configured.
//   {action: "oauth_start", redirect_uri}    Returns the Fathom sign-in URL. The
//                                            redirect must be in FATHOM_REDIRECT_URIS.
//   {action: "oauth_complete", code, state}  The callback page sends what Fathom
//                                            returned; the code is exchanged here.
//   {action: "connect_api_key", api_key}     Fallback: a personal key from Fathom's
//                                            Settings → API Access.
//   {action: "sync_now"}                     Syncs the caller's connection now.
//   {action: "disconnect"}                   Removes the webhook at Fathom, the stored
//                                            credentials, and the meetings this user
//                                            brought in.
//   {action: "sync"} (cron)                  Every connection, then pending content.
//
// Secrets: FATHOM_TOKEN_KEY (required: 32 bytes, base64), FATHOM_CLIENT_ID +
// FATHOM_CLIENT_SECRET + FATHOM_REDIRECT_URIS (OAuth only; without them the
// card offers the API key alone).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsFor, requireApprovedUser, requireCronSecret } from "../_shared/auth.ts";
import { errorResponse } from "../_shared/errors.ts";
import {
  authorizeUrl,
  exchangeCode,
  FathomClient,
  FathomError,
  type FathomMeeting,
  refreshTokens,
  type TokenResponse,
} from "../_shared/fathomApi.ts";
import { decryptSecret, encryptSecret } from "../_shared/fathomCrypto.ts";
import { hasInlineContent } from "../_shared/fathomIngest.ts";
import {
  loadPartnerContacts,
  type PartnerContact,
  storeMeetingContent,
  storePendingMeeting,
} from "../_shared/fathomStore.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN_KEY = Deno.env.get("FATHOM_TOKEN_KEY") ?? "";
const CLIENT_ID = Deno.env.get("FATHOM_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("FATHOM_CLIENT_SECRET") ?? "";
const REDIRECT_URIS = new Set(
  (Deno.env.get("FATHOM_REDIRECT_URIS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
);
const FN = "fathom";
const RETENTION_DAYS = 30;
const MAX_PAGES_PER_CONNECTION = 10;
// Two heavy calls (summary + transcript) per OAuth meeting, against Fathom's
// 30-a-minute heavy limit.
const CONTENT_PER_RUN = 12;
const MAX_CONTENT_ATTEMPTS = 3;
// Stop starting new work after this, inside the edge function's wall-clock limit.
const RUN_BUDGET_MS = 110_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped client, as in the other functions
type Db = any;

class UserFacingError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type Connection = {
  user_id: string;
  auth_method: "oauth" | "api_key";
  webhook_id: string | null;
  status: string;
  last_synced_at: string | null;
};

// ------------------------------------------------------------ entry

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    if (!TOKEN_KEY) throw new UserFacingError("Fathom isn't set up on the server yet.", 503);
    const body = await req.json().catch(() => ({}));
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    if (requireCronSecret(req) === null) {
      if (body.action !== "sync") return json({ error: "Not allowed for service callers" }, 403);
      return json(await syncAll(admin));
    }

    const authz = await requireApprovedUser(req);
    if (!authz.ok) return authz.response;
    const userId = authz.user.id;

    switch (body.action) {
      case "status":
        return json(await status(admin, userId));
      case "oauth_start":
        return json(await oauthStart(admin, userId, body.redirect_uri));
      case "oauth_complete":
        return json(await oauthComplete(admin, userId, body.code, body.state));
      case "connect_api_key":
        return json(await connectApiKey(admin, userId, body.api_key));
      case "sync_now": {
        const work = syncUser(admin, userId);
        if (typeof EdgeRuntime !== "undefined") {
          EdgeRuntime.waitUntil(work.catch((e) => logErr("sync_now", userId, e)));
          return json({ status: "syncing" }, 202);
        }
        return json(await work);
      }
      case "disconnect":
        return json(await disconnect(admin, userId));
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    if (e instanceof UserFacingError) return json({ error: e.message }, e.status);
    return errorResponse(e, cors, { fn: FN });
  }
});

function logErr(stage: string, id: string, e: unknown) {
  console.error(JSON.stringify({ fn: FN, stage, id, detail: String((e as Error)?.stack ?? e) }));
}

function retentionStart(): Date {
  return new Date(Date.now() - RETENTION_DAYS * 86_400_000);
}

// ------------------------------------------------------------ status

async function status(admin: Db, userId: string) {
  const { data: conn } = await admin
    .from("fathom_connections")
    .select("auth_method, status, last_error, last_synced_at, connected_at, webhook_id")
    .eq("user_id", userId)
    .maybeSingle();

  const count = async (filter: (q: Db) => Db) => {
    const { count } = await filter(admin.from("fathom_meetings").select("recording_id", { count: "exact", head: true }));
    return count ?? 0;
  };

  return {
    oauth_available: !!(CLIENT_ID && CLIENT_SECRET && REDIRECT_URIS.size),
    connection: conn
      ? {
          auth_method: conn.auth_method,
          status: conn.status,
          last_error: conn.last_error,
          last_synced_at: conn.last_synced_at,
          connected_at: conn.connected_at,
          webhook: !!conn.webhook_id,
          meetings: await count((q) => q.eq("synced_by", userId)),
          pending: await count((q) => q.eq("synced_by", userId).eq("content_status", "pending")),
        }
      : null,
    team_meetings: await count((q) => q),
  };
}

// ------------------------------------------------------------ connect

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function oauthStart(admin: Db, userId: string, redirectUri: unknown) {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new UserFacingError("Fathom sign-in isn't set up yet. Use an API key for now.", 503);
  if (typeof redirectUri !== "string" || !REDIRECT_URIS.has(redirectUri)) {
    throw new UserFacingError("That return address isn't allowed for Fathom sign-in.");
  }
  const state = randomState();
  const { error } = await admin.from("fathom_oauth_states").insert({ state, user_id: userId, redirect_uri: redirectUri });
  if (error) throw new Error(`fathom_oauth_states insert: ${error.message}`);
  return { url: authorizeUrl(CLIENT_ID, redirectUri, state) };
}

async function oauthComplete(admin: Db, userId: string, code: unknown, state: unknown) {
  if (typeof code !== "string" || !code || typeof state !== "string" || !state) {
    throw new UserFacingError("Fathom didn't return a sign-in code.");
  }
  // One use: delete returns the row only if it was this user's and still live.
  const { data: rows, error } = await admin
    .from("fathom_oauth_states")
    .delete()
    .eq("state", state)
    .eq("user_id", userId)
    .gt("expires_at", new Date().toISOString())
    .select("redirect_uri");
  if (error) throw new Error(`fathom_oauth_states delete: ${error.message}`);
  if (!rows?.length) throw new UserFacingError("This sign-in link has expired. Start again from the Fathom page.");

  let tokens: TokenResponse;
  try {
    tokens = await exchangeCode({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      code,
      redirectUri: rows[0].redirect_uri,
    });
  } catch (e) {
    logErr("oauth_exchange", userId, e);
    throw new UserFacingError("Fathom didn't accept the sign-in. Try connecting again.", 502);
  }

  await saveConnection(admin, userId, "oauth", {
    access_token_enc: await encryptSecret(tokens.access_token, TOKEN_KEY),
    refresh_token_enc: await encryptSecret(tokens.refresh_token, TOKEN_KEY),
    api_key_enc: null,
    expires_at: new Date(Date.now() + (tokens.expires_in - 300) * 1000).toISOString(),
  });
  return await afterConnect(admin, userId);
}

async function connectApiKey(admin: Db, userId: string, apiKey: unknown) {
  if (typeof apiKey !== "string" || apiKey.trim().length < 10) throw new UserFacingError("Paste the API key from Fathom.");
  const key = apiKey.trim();
  try {
    await new FathomClient({ kind: "api_key", key }).listMeetings({
      since: new Date(Date.now() - 86_400_000).toISOString(),
      withContent: false,
    });
  } catch (e) {
    if (e instanceof FathomError && (e.status === 401 || e.status === 403)) {
      throw new UserFacingError("Fathom didn't accept that API key.");
    }
    throw e;
  }
  await saveConnection(admin, userId, "api_key", {
    access_token_enc: null,
    refresh_token_enc: null,
    api_key_enc: await encryptSecret(key, TOKEN_KEY),
    expires_at: null,
  });
  return await afterConnect(admin, userId);
}

async function saveConnection(
  admin: Db,
  userId: string,
  method: "oauth" | "api_key",
  creds: Record<string, string | null>,
) {
  // Reconnecting replaces the old webhook; remove it at Fathom first so the
  // user isn't left with two deliveries.
  await removeWebhook(admin, userId).catch((e) => logErr("reconnect_webhook", userId, e));

  const conn = await admin.from("fathom_connections").upsert(
    {
      user_id: userId,
      auth_method: method,
      webhook_id: null,
      status: "active",
      last_error: null,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (conn.error) throw new Error(`fathom_connections upsert: ${conn.error.message}`);

  const { data: prev } = await admin.from("fathom_credentials").select("token_version").eq("user_id", userId).maybeSingle();
  const cred = await admin.from("fathom_credentials").upsert(
    { user_id: userId, ...creds, webhook_secret_enc: null, token_version: (prev?.token_version ?? 0) + 1 },
    { onConflict: "user_id" },
  );
  if (cred.error) throw new Error(`fathom_credentials upsert: ${cred.error.message}`);
}

/** Webhook (best effort) and the first sync, in the background. */
async function afterConnect(admin: Db, userId: string) {
  let webhook = false;
  try {
    const client = await clientFor(admin, userId);
    const hook = await client.createWebhook(`${SUPABASE_URL}/functions/v1/fathom-webhook?u=${userId}`);
    await admin.from("fathom_connections").update({ webhook_id: hook.id }).eq("user_id", userId);
    await admin
      .from("fathom_credentials")
      .update({ webhook_secret_enc: await encryptSecret(hook.secret, TOKEN_KEY) })
      .eq("user_id", userId);
    webhook = true;
  } catch (e) {
    // The 10-minute sync still brings meetings in; only the instant push is lost.
    logErr("create_webhook", userId, e);
  }

  const work = syncUser(admin, userId);
  if (typeof EdgeRuntime !== "undefined") {
    EdgeRuntime.waitUntil(work.catch((e) => logErr("first_sync", userId, e)));
  } else {
    await work;
  }
  return { connected: true, webhook };
}

async function removeWebhook(admin: Db, userId: string) {
  const { data: conn } = await admin.from("fathom_connections").select("webhook_id").eq("user_id", userId).maybeSingle();
  if (!conn?.webhook_id) return;
  const client = await clientFor(admin, userId);
  try {
    await client.deleteWebhook(conn.webhook_id);
  } catch (e) {
    if (!(e instanceof FathomError && e.status === 404)) throw e;
  }
}

async function disconnect(admin: Db, userId: string) {
  await removeWebhook(admin, userId).catch((e) => logErr("disconnect_webhook", userId, e));
  const meetings = await admin.from("fathom_meetings").delete().eq("synced_by", userId);
  if (meetings.error) throw new Error(`fathom_meetings delete: ${meetings.error.message}`);
  // Credentials go with the connection through the cascade.
  const conn = await admin.from("fathom_connections").delete().eq("user_id", userId);
  if (conn.error) throw new Error(`fathom_connections delete: ${conn.error.message}`);
  return { disconnected: true };
}

// ------------------------------------------------------------ credentials

async function clientFor(admin: Db, userId: string): Promise<FathomClient> {
  const { data: conn } = await admin.from("fathom_connections").select("auth_method").eq("user_id", userId).maybeSingle();
  const { data: cred } = await admin.from("fathom_credentials").select("*").eq("user_id", userId).maybeSingle();
  if (!conn || !cred) throw new FathomError(401, "No Fathom connection");

  if (conn.auth_method === "api_key") {
    return new FathomClient({ kind: "api_key", key: await decryptSecret(cred.api_key_enc, TOKEN_KEY) });
  }

  if (cred.expires_at && new Date(cred.expires_at).getTime() > Date.now() + 60_000) {
    return new FathomClient({ kind: "bearer", token: await decryptSecret(cred.access_token_enc, TOKEN_KEY) });
  }

  // Refresh. Fathom refresh tokens are single-use, so only the run whose
  // update still sees the version it read keeps its result; a run that lost
  // the race (or whose refresh Fathom refused because another run already used
  // the token) rereads the row and uses what the winner saved.
  let tokens: TokenResponse | null = null;
  try {
    tokens = await refreshTokens({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      refreshToken: await decryptSecret(cred.refresh_token_enc, TOKEN_KEY),
    });
  } catch (e) {
    logErr("refresh", userId, e);
  }

  if (tokens) {
    const { data: saved } = await admin
      .from("fathom_credentials")
      .update({
        access_token_enc: await encryptSecret(tokens.access_token, TOKEN_KEY),
        refresh_token_enc: await encryptSecret(tokens.refresh_token, TOKEN_KEY),
        expires_at: new Date(Date.now() + (tokens.expires_in - 300) * 1000).toISOString(),
        token_version: cred.token_version + 1,
      })
      .eq("user_id", userId)
      .eq("token_version", cred.token_version)
      .select("user_id");
    if (saved?.length) return new FathomClient({ kind: "bearer", token: tokens.access_token });
  }

  const { data: now } = await admin.from("fathom_credentials").select("*").eq("user_id", userId).maybeSingle();
  if (now && now.token_version !== cred.token_version && now.access_token_enc) {
    return new FathomClient({ kind: "bearer", token: await decryptSecret(now.access_token_enc, TOKEN_KEY) });
  }
  throw new FathomError(401, "Fathom sign-in expired");
}

async function markConnectionError(admin: Db, userId: string, e: unknown) {
  const auth = e instanceof FathomError && (e.status === 401 || e.status === 403);
  await admin
    .from("fathom_connections")
    .update({
      status: auth ? "needs_reconnect" : "error",
      last_error: auth ? "Fathom sign-in expired or was revoked. Reconnect." : "Last sync failed. It will retry.",
    })
    .eq("user_id", userId);
}

// ------------------------------------------------------------ sync

/** Lists new meetings for one connection. API-key connections get content inline. */
async function listPass(admin: Db, conn: Connection, contacts: PartnerContact[], deadline: number) {
  const startedAt = new Date();
  const client = await clientFor(admin, conn.user_id);
  const withContent = conn.auth_method === "api_key";

  // An hour of overlap with the last run: a meeting's created_at can land just
  // before a run finishes listing.
  const floor = retentionStart();
  const last = conn.last_synced_at ? new Date(new Date(conn.last_synced_at).getTime() - 3_600_000) : floor;
  const since = (last > floor ? last : floor).toISOString();

  let cursor: string | null = null;
  let seen = 0;
  let complete = false;
  for (let page = 0; page < MAX_PAGES_PER_CONNECTION && Date.now() < deadline; page++) {
    const res = await client.listMeetings({ since, cursor, withContent });
    for (const m of res.items ?? []) {
      seen++;
      if (m.calendar_invitees_domains_type === "only_internal") continue;
      if (withContent && hasInlineContent(m)) {
        await storeIfNotReady(admin, m, conn.user_id, contacts);
      } else {
        await storePendingMeeting(admin, m, conn.user_id, contacts);
      }
    }
    cursor = res.next_cursor;
    if (!cursor) {
      complete = true;
      break;
    }
  }

  // Only move the window forward once every page was read; otherwise the
  // next run starts from the same point and picks up the rest.
  await admin
    .from("fathom_connections")
    .update({
      status: "active",
      last_error: null,
      ...(complete ? { last_synced_at: startedAt.toISOString() } : {}),
    })
    .eq("user_id", conn.user_id);
  return { seen, complete };
}

async function storeIfNotReady(admin: Db, m: FathomMeeting, userId: string, contacts: PartnerContact[]) {
  const { data: existing } = await admin
    .from("fathom_meetings")
    .select("content_status")
    .eq("recording_id", m.recording_id)
    .maybeSingle();
  if (existing?.content_status === "ready") return;
  await storeMeetingContent(
    admin,
    m,
    {
      syncedBy: userId,
      summary: m.default_summary?.markdown_formatted ?? null,
      actionItems: m.action_items,
      transcript: m.transcript ?? [],
    },
    contacts,
  );
}

/** Fills summary + transcript for pending meetings (OAuth, or a failed push). */
async function contentPass(admin: Db, contacts: PartnerContact[], deadline: number, onlyUser?: string) {
  let q = admin
    .from("fathom_meetings")
    .select("recording_id, synced_by, content_attempts, title, started_at, ended_at, recorded_by_name, recorded_by_email, share_url, invitees, action_items")
    .eq("content_status", "pending")
    .lt("content_attempts", MAX_CONTENT_ATTEMPTS)
    .order("started_at", { ascending: false })
    .limit(CONTENT_PER_RUN);
  if (onlyUser) q = q.eq("synced_by", onlyUser);
  const { data: pending, error } = await q;
  if (error) throw new Error(`pending select: ${error.message}`);

  const clients = new Map<string, FathomClient | null>();
  let filled = 0;
  for (const row of pending ?? []) {
    if (Date.now() > deadline || !row.synced_by) continue;
    if (!clients.has(row.synced_by)) {
      clients.set(row.synced_by, await clientFor(admin, row.synced_by).catch(() => null));
    }
    const client = clients.get(row.synced_by);
    if (!client) continue;

    try {
      const [summary, transcript] = await Promise.all([
        client.getSummary(row.recording_id),
        client.getTranscript(row.recording_id),
      ]);
      // Rebuild a FathomMeeting from the stored metadata so the same writer
      // (and partner matching) is used as for inline content.
      const meeting: FathomMeeting = {
        recording_id: row.recording_id,
        title: row.title,
        meeting_title: row.title,
        share_url: row.share_url ?? undefined,
        recording_start_time: row.started_at,
        recording_end_time: row.ended_at,
        calendar_invitees: row.invitees ?? [],
        recorded_by: row.recorded_by_name || row.recorded_by_email
          ? { name: row.recorded_by_name ?? "", email: row.recorded_by_email ?? "" }
          : undefined,
      };
      await storeMeetingContent(
        admin,
        meeting,
        { syncedBy: row.synced_by, summary, actionItems: row.action_items, transcript },
        contacts,
      );
      filled++;
    } catch (e) {
      logErr("content", String(row.recording_id), e);
      const attempts = row.content_attempts + 1;
      await admin
        .from("fathom_meetings")
        .update({
          content_attempts: attempts,
          ...(attempts >= MAX_CONTENT_ATTEMPTS ? { content_status: "failed" } : {}),
        })
        .eq("recording_id", row.recording_id);
      if (e instanceof FathomError && e.status === 429) break;
    }
  }
  return { filled };
}

async function syncUser(admin: Db, userId: string) {
  const deadline = Date.now() + RUN_BUDGET_MS;
  const { data: conn } = await admin.from("fathom_connections").select("*").eq("user_id", userId).maybeSingle();
  if (!conn) throw new UserFacingError("Fathom isn't connected.", 404);
  const contacts = await loadPartnerContacts(admin);
  try {
    const listed = await listPass(admin, conn, contacts, deadline);
    const content = await contentPass(admin, contacts, deadline, userId);
    return { ...listed, ...content };
  } catch (e) {
    await markConnectionError(admin, userId, e);
    throw e;
  }
}

async function syncAll(admin: Db) {
  const deadline = Date.now() + RUN_BUDGET_MS;
  const { data: conns, error } = await admin
    .from("fathom_connections")
    .select("*")
    .in("status", ["active", "error"]);
  if (error) throw new Error(`fathom_connections select: ${error.message}`);
  const contacts = await loadPartnerContacts(admin);

  let listed = 0;
  for (const conn of (conns ?? []) as Connection[]) {
    if (Date.now() > deadline) break;
    try {
      await listPass(admin, conn, contacts, deadline);
      listed++;
    } catch (e) {
      logErr("list", conn.user_id, e);
      await markConnectionError(admin, conn.user_id, e);
    }
  }
  const content = await contentPass(admin, contacts, deadline);
  return { connections: conns?.length ?? 0, listed, ...content };
}
