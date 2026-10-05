// Admin-only: invite a teammate by email. This is the ONLY way an account gets
// created — public signup is disabled in Supabase Auth settings, and
// handle_new_user leaves any other new auth user 'pending' (no data access).
//
// The invitee gets an email, follows the link to /reset-password, and sets their
// own password there. Re-sending to someone who never finished setup is the same
// call; someone who already has a password gets a 409 and should use a reset.
import { corsFor, requireRole } from "../_shared/auth.ts";

const COMPANY_DOMAIN = "@ansoniaproperties.com";

// Where invite links land. Taken from config, never from the request, so a
// caller cannot point the emailed link somewhere else. An allowlisted Origin
// (ALLOWED_ORIGINS, e.g. localhost during development) may override it.
const APP_URL = (Deno.env.get("APP_URL") ?? "https://ansoniaai.vercel.app").replace(/\/+$/, "");

interface InviteBody {
  email: string;
  full_name?: string | null;
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const auth = await requireRole(req, "admin");
    if (!auth.ok) return auth.response;
    const { admin, user: caller } = auth;

    const body = (await req.json().catch(() => ({}))) as InviteBody;
    const email = (body.email ?? "").trim().toLowerCase();
    const full_name = body.full_name?.trim().slice(0, 120) || null;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
      return json({ error: "Invalid email" }, 400);
    }
    if (!email.endsWith(COMPANY_DOMAIN)) {
      return json({ error: `Only ${COMPANY_DOMAIN} addresses can be invited.` }, 400);
    }

    const allowedOrigin = (cors as Record<string, string>)["Access-Control-Allow-Origin"];
    const base = allowedOrigin && allowedOrigin !== "*" ? allowedOrigin : APP_URL;

    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: full_name ? { full_name } : undefined,
      redirectTo: `${base}/reset-password`,
    });
    if (inviteErr) {
      // GoTrue re-sends to an invitee who never confirmed, and refuses only once
      // the address belongs to an active account.
      if (/already been registered|already registered|email_exists/i.test(inviteErr.message)) {
        return json(
          { error: "already_active", message: "This person already has an active account. Send a password reset instead." },
          409,
        );
      }
      if (/rate limit/i.test(inviteErr.message)) {
        return json({ error: "Too many emails sent recently. Try again in a few minutes." }, 429);
      }
      console.error("admin-invite-user: invite failed", inviteErr);
      return json({ error: "Could not send the invite." }, 502);
    }

    // The admin vouched for them, so approve the profile handle_new_user created
    // as 'pending'. Retry-safe: re-sending an invite just re-approves.
    if (invited.user) {
      const { error: profErr } = await admin
        .from("profiles")
        .update({
          status: "approved",
          approved_at: new Date().toISOString(),
          approved_by: caller.id,
          ...(full_name ? { full_name } : {}),
        })
        .eq("id", invited.user.id);
      if (profErr) {
        console.error("admin-invite-user: approve failed", profErr);
        return json({ error: "Invite sent, but approving the account failed. Approve them from the users list." }, 500);
      }
    }

    return json({ ok: true, user_id: invited.user?.id });
  } catch (e) {
    console.error("admin-invite-user: unexpected", e);
    return json({ error: "Could not send the invite." }, 500);
  }
});
