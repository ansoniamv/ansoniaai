import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface InviteBody {
  email: string;
  full_name?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing auth" }, 401);
    }

    // Verify caller and check admin
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: isAdminData, error: roleErr } = await admin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (roleErr) return json({ error: roleErr.message }, 500);
    if (!isAdminData) return json({ error: "Admins only" }, 403);

    const body = (await req.json()) as InviteBody;
    const email = (body.email ?? "").trim().toLowerCase();
    const full_name = body.full_name?.trim() || null;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
      return json({ error: "Invalid email" }, 400);
    }

    const origin = req.headers.get("origin") ?? undefined;
    const redirectTo = origin ? `${origin}/reset-password` : undefined;

    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: full_name ? { full_name } : undefined,
      redirectTo,
    });
    if (inviteErr) return json({ error: inviteErr.message }, 400);

    // Auto-approve invited users (admin vouched for them)
    if (invited.user) {
      await admin
        .from("profiles")
        .update({
          status: "approved",
          approved_at: new Date().toISOString(),
          approved_by: userData.user.id,
          full_name: full_name ?? undefined,
        })
        .eq("id", invited.user.id);
    }

    return json({ ok: true, user_id: invited.user?.id });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
