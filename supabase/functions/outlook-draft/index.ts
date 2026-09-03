// Creates a DRAFT (not sent) in the Atlas mailbox. Body:
//   { to: string[], cc?: string[], subject, html?, text?, partnerId?, dealId?, partnerContactId? }
// Returns { ok, id, webLink }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const GATEWAY_URL = "https://connector-gateway.lovable.dev/microsoft_outlook";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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
      const detail = await res.text();
      return new Response(
        JSON.stringify({ error: "Draft failed", status: res.status, detail }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
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
