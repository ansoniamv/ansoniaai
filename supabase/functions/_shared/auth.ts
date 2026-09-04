// Reusable authorization helpers for edge functions.
// Modeled on supabase/functions/admin-invite-user/index.ts.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Comma-separated list of exact origins allowed to read function responses from a
// browser, e.g.
//   ALLOWED_ORIGINS=https://app.ansoniaproperties.com,https://deal-pipeline-pro.vercel.app,http://localhost:5173
// Set it as a Supabase function secret. Never include "*".
const ALLOWED_ORIGINS = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

const headerCors = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  Vary: "Origin",
};

/**
 * Per-request CORS headers.
 *
 * Credentials are never allowed (this app authenticates with a bearer token, not
 * cookies), so the only thing at stake is whether a foreign page may READ a
 * response. Omitting Access-Control-Allow-Origin makes the browser block it.
 *
 * When ALLOWED_ORIGINS is unset this falls back to the previous wildcard so a
 * deploy cannot break the app before the secret is configured. Setting the secret
 * is what actually closes the hole — see the deployment checklist in SECURITY.md.
 */
export function corsFor(req: Request) {
  const origin = req.headers.get("Origin") ?? "";

  if (ALLOWED_ORIGINS.size === 0) {
    return { ...headerCors, "Access-Control-Allow-Origin": "*" };
  }
  // No Origin header means a server-to-server caller (pg_cron, function-to-
  // function). CORS does not apply; do not advertise an origin.
  if (!origin) return { ...headerCors };
  if (ALLOWED_ORIGINS.has(origin)) {
    return { ...headerCors, "Access-Control-Allow-Origin": origin };
  }
  return { ...headerCors };
}

export type AuthOk = {
  ok: true;
  user: { id: string; email: string | null };
  userClient: SupabaseClient;
  admin: SupabaseClient;
};
export type AuthErr = { ok: false; response: Response };

/** Requires a signed-in user whose profile is approved. */
export async function requireApprovedUser(req: Request): Promise<AuthOk | AuthErr> {
  const cors = corsFor(req);
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      }),
    };
  }

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      }),
    };
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: profile } = await admin
    .from("profiles")
    .select("status")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!profile || profile.status !== "approved") {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Account not approved" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      }),
    };
  }

  return {
    ok: true,
    user: { id: userData.user.id, email: userData.user.email ?? null },
    userClient,
    admin,
  };
}

/** Requires a specific role in addition to being approved. */
export async function requireRole(req: Request, role: "admin" | "user"): Promise<AuthOk | AuthErr> {
  const base = await requireApprovedUser(req);
  if (!base.ok) return base;
  const { data: isRole } = await base.admin.rpc("has_role", {
    _user_id: base.user.id,
    _role: role,
  });
  if (!isRole) {
    const cors = corsFor(req);
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: `Requires ${role} role` }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      }),
    };
  }
  return base;
}

/**
 * For cron-only functions. Accepts either a valid CRON_SHARED_SECRET header
 * OR the SERVICE_ROLE_KEY (used by the daily-digest chain / pg_cron).
 */
export function requireCronSecret(req: Request): AuthErr | null {
  const cors = corsFor(req);
  const shared = Deno.env.get("CRON_SHARED_SECRET");
  const auth = req.headers.get("Authorization") ?? "";
  const cronHeader = req.headers.get("x-cron-secret") ?? "";

  const okCron = shared && cronHeader && cronHeader === shared;
  const okService = auth.startsWith("Bearer ") && auth.slice(7) === SERVICE_ROLE;

  if (okCron || okService) return null;
  return {
    ok: false,
    response: new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...cors, "Content-Type": "application/json" },
    }),
  };
}

/**
 * Accepts EITHER a trusted service-role / cron caller OR an approved end user.
 * Use this on functions that are invoked both from the UI and function-to-function.
 * Returns null when the caller is a trusted service (no user context available).
 */
export async function requireUserOrService(req: Request): Promise<AuthOk | AuthErr | null> {
  if (requireCronSecret(req) === null) return null; // service-role key or x-cron-secret — allow
  return await requireApprovedUser(req);
}
