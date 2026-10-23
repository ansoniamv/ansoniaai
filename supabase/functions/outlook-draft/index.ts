// Creates a DRAFT (not sent) in the signed-in sender's own mailbox. Body:
//   { to: string[], cc?: string[], subject, html?, text?, partnerId?, dealId?, partnerContactId? }
// Returns { ok, id, webLink }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsFor, requireApprovedUser } from "../_shared/auth.ts";
import { errorResponse } from "../_shared/errors.ts";
import { graphFetch, MAILBOX_UPN, resolveUserMailbox } from "../_shared/graphMail.ts";
import { senderMailboxUpn } from "../_shared/senderMailbox.ts";

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // This endpoint composes mail in a real Ansonia mailbox, so it is gated the
  // same way its sibling outlook-send is.
  const authz = await requireApprovedUser(req);
  if (!authz.ok) return authz.response;

  try {
    // The draft goes to the drafter's own Outlook, so they review and send it
    // from their own address. The mailbox comes from the signed-in account,
    // never the request, and must be in the company's own domain.
    const upn = senderMailboxUpn(authz.user.email, MAILBOX_UPN.atlas.split("@")[1] ?? "");
    if (!upn) {
      return new Response(
        JSON.stringify({
          error: "No company mailbox for this account",
          code: "mailbox_not_enabled",
          detail: `Drafts go to your own Outlook, and ${authz.user.email ?? "this account"} is not an Ansonia mailbox.`,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const mb = resolveUserMailbox(upn);
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
    const res = await graphFetch(mb, "/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    // 403: the Exchange access policy that limits this app does not include the
    // sender yet. 404: Graph has no mailbox under that address. Every draft for
    // this sender would fail the same way, so say what to fix.
    if (res.status === 403 || res.status === 404) {
      console.error(JSON.stringify({ fn: "outlook-draft", upn, status: res.status, detail: await res.text() }));
      return new Response(
        JSON.stringify({
          error: res.status === 403 ? "Your mailbox isn't enabled for drafts yet" : "No Outlook mailbox found",
          code: "mailbox_not_enabled",
          detail:
            res.status === 403
              ? `Ask the Microsoft 365 admin to add ${upn} to the app's mail access group.`
              : `Microsoft has no mailbox for ${upn}.`,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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
