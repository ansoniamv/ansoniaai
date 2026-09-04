// Creates a DRAFT (not sent) in the Atlas mailbox. Body:
//   { to: string[], cc?: string[], subject, html?, text?, partnerId?, dealId?, partnerContactId? }
// Returns { ok, id, webLink }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsFor, requireApprovedUser } from "../_shared/auth.ts";
import { errorResponse } from "../_shared/errors.ts";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/microsoft_outlook";

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // This endpoint composes mail in a real Ansonia mailbox, so it is gated the
  // same way its sibling outlook-send is.
  const authz = await requireApprovedUser(req);
  if (!authz.ok) return authz.response;

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    // Atlas mailbox connection. Fall back to the main Outlook key if the Atlas
    // one isn't configured.
    const OUTLOOK_KEY =
      Deno.env.get("MICROSOFT_OUTLOOK_ATLAS_API_KEY") ||
      Deno.env.get("MICROSOFT_OUTLOOK_API_KEY_1") ||
      Deno.env.get("MICROSOFT_OUTLOOK_API_KEY");
    if (!LOVABLE_API_KEY || !OUTLOOK_KEY) {
      return new Response(JSON.stringify({ error: "Outlook connector not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { to, cc, subject, html, text, partnerId, dealId, partnerContactId } = await req.json();
    if (!subject || (!html && !text) || !to || to.length === 0) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate every recipient looks like an email address (mirrors outlook-send).
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const allRecipients = [...(to ?? []), ...(cc ?? [])];
    if (allRecipients.some((a: unknown) => typeof a !== "string" || !emailRe.test(a) || a.length > 255)) {
      return new Response(JSON.stringify({ error: "Invalid recipient" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const message = {
      subject,
      body: { contentType: html ? "HTML" : "Text", content: html || text },
      toRecipients: (to || []).map((a: string) => ({ emailAddress: { address: a } })),
      ccRecipients: (cc || []).map((a: string) => ({ emailAddress: { address: a } })),
    };

    // POST /me/messages -> creates a DRAFT (does NOT send)
    const res = await fetch(`${GATEWAY_URL}/me/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": OUTLOOK_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });

    if (!res.ok) {
      // The raw Graph body names internal endpoints and mailbox identifiers: log
      // it, hand the caller only a reference.
      return errorResponse(new Error(`graph ${res.status}: ${await res.text()}`), corsHeaders, {
        fn: "outlook-draft",
        status: 502,
        publicMessage: "Draft failed.",
      });
    }
    const draft = await res.json();

    if (partnerId) {
      await supabase.from("partner_interactions").insert({
        partner_id: partnerId,
        contact_id: partnerContactId || null,
        interaction_type: "email_draft",
        content: `Outreach draft prepared: ${subject}`.slice(0, 5000),
        source: "outlook",
        interaction_date: new Date().toISOString(),
      });
    }

    return new Response(
      JSON.stringify({ ok: true, id: draft.id, webLink: draft.webLink }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
