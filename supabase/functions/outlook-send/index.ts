import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireApprovedUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/microsoft_outlook";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await requireApprovedUser(req);
    if (!auth.ok) return auth.response;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const OUTLOOK_KEY = Deno.env.get("MICROSOFT_OUTLOOK_API_KEY");
    if (!LOVABLE_API_KEY || !OUTLOOK_KEY) {
      return new Response(JSON.stringify({ error: "Outlook connector not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { to, cc, bcc, subject, html, text, replyToMessageId, dealId, partnerId, partnerContactId } = await req.json();
    if (!subject || (!html && !text) || (!to && !replyToMessageId)) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate every recipient looks like an email address.
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const allRecipients = [...(to ?? []), ...(cc ?? []), ...(bcc ?? [])];
    if (allRecipients.some((a: unknown) => typeof a !== "string" || !emailRe.test(a) || a.length > 255)) {
      return new Response(JSON.stringify({ error: "Invalid recipient" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const message = {
      subject,
      body: { contentType: html ? "HTML" : "Text", content: html || text },
      toRecipients: (to || []).map((a: string) => ({ emailAddress: { address: a } })),
      ccRecipients: (cc || []).map((a: string) => ({ emailAddress: { address: a } })),
      bccRecipients: (bcc || []).map((a: string) => ({ emailAddress: { address: a } })),
    };

    const endpoint = replyToMessageId
      ? `${GATEWAY_URL}/me/messages/${replyToMessageId}/reply`
      : `${GATEWAY_URL}/me/sendMail`;

    const payload = replyToMessageId
      ? { comment: html || text, message: { toRecipients: message.toRecipients } }
      : { message, saveToSentItems: true };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": OUTLOOK_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const detail = await res.text();
      return new Response(JSON.stringify({ error: "Send failed", status: res.status, detail }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log as partner interaction if linked
    if (partnerId) {
      await supabase.from("partner_interactions").insert({
        partner_id: partnerId,
        contact_id: partnerContactId || null,
        interaction_type: "email",
        content: `${subject}\n\n${text || html?.replace(/<[^>]+>/g, "") || ""}`.slice(0, 5000),
        source: "outlook",
        interaction_date: new Date().toISOString(),
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
