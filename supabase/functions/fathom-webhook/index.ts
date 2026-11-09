// fathom-webhook
// Fathom POSTs a finished meeting here (summary, action items, transcript) a
// few minutes after the call ends. Public endpoint: deployed with
// --no-verify-jwt, so the signature is the only gate.
//
// The URL carries the connected user (?u=<user id>) so we know which webhook
// secret to check against; the signature, not the URL, is what proves Fathom
// sent it. Anything unsigned, stale, or for an unknown user gets a 401 and
// nothing is written.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type { FathomMeeting } from "../_shared/fathomApi.ts";
import { decryptSecret } from "../_shared/fathomCrypto.ts";
import { loadPartnerContacts, storeMeetingContent } from "../_shared/fathomStore.ts";
import { verifyFathomWebhook } from "../_shared/fathomWebhook.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN_KEY = Deno.env.get("FATHOM_TOKEN_KEY") ?? "";
const FN = "fathom-webhook";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 10_000_000;

const reply = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  const correlationId = crypto.randomUUID();
  try {
    const userId = new URL(req.url).searchParams.get("u") ?? "";
    if (!UUID_RE.test(userId) || !TOKEN_KEY) return reply(401, { error: "Unauthorized" });

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return reply(413, { error: "Too large" });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: cred } = await admin
      .from("fathom_credentials")
      .select("webhook_secret_enc")
      .eq("user_id", userId)
      .maybeSingle();
    if (!cred?.webhook_secret_enc) return reply(401, { error: "Unauthorized" });

    const ok = await verifyFathomWebhook({
      secret: await decryptSecret(cred.webhook_secret_enc, TOKEN_KEY),
      id: req.headers.get("webhook-id"),
      timestamp: req.headers.get("webhook-timestamp"),
      signatureHeader: req.headers.get("webhook-signature"),
      body: raw,
    });
    if (!ok) return reply(401, { error: "Unauthorized" });

    const meeting = JSON.parse(raw) as FathomMeeting;
    if (!Number.isSafeInteger(meeting?.recording_id)) return reply(400, { error: "No recording_id" });
    // Internal-only calls are never stored (they would be visible to everyone).
    if (meeting.calendar_invitees_domains_type === "only_internal") return reply(200, { skipped: "internal" });

    const contacts = await loadPartnerContacts(admin);
    const { chunks } = await storeMeetingContent(
      admin,
      meeting,
      {
        syncedBy: userId,
        summary: meeting.default_summary?.markdown_formatted ?? null,
        actionItems: meeting.action_items,
        transcript: meeting.transcript ?? [],
      },
      contacts,
    );
    return reply(200, { stored: meeting.recording_id, chunks });
  } catch (e) {
    console.error(JSON.stringify({ correlationId, fn: FN, detail: String((e as Error)?.stack ?? e) }));
    // 500 makes Fathom retry the delivery, which the upsert makes safe.
    return reply(500, { error: "Failed", correlation_id: correlationId });
  }
});
