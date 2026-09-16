import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { graphFetch, resolveMailbox } from "../_shared/graphMail.ts";
import { corsFor, requireUserOrService } from "../_shared/auth.ts";
import { preExtractFacts, firmFromEmailDomain } from "../_shared/dealFields.ts";

const SKIP_SUBJECT_TERMS = [
  "quarantine", "out of office", "microsoft alert",
  "unsubscribe notice", "undeliverable",
];
const BLOCKED_DOMAINS = ["ansoniaproperties.com"];


interface GraphMessage {
  id: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType: string; content: string };
  from?: { emailAddress?: { name?: string; address?: string } };
  receivedDateTime?: string;
}

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Very light heuristic property-name extraction from a subject line.
 * Strips common broker prefixes/suffixes. Real fuzzy matching happens in SQL.
 */
function guessPropertyName(subject: string): string {
  let s = subject.replace(/^(re:|fw:|fwd:)\s*/i, "");
  s = s.replace(/\b(new listing|offering memorandum|om|opportunity|deal|investment opportunity|for sale|price reduction|reminder|update|call for offers)\b/gi, "");
  s = s.replace(/[\|\-–—:]+/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

/** Strip HTML tags and decode a few common entities for regex scanning. */
function stripHtml(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/\s+/g, " ");
}

/** Fast regex pre-extraction of units + year_built from subject + body. */

/** Find a likely matching existing inbox_deal by fuzzy property name. */
async function findMatchingDeal(
  supabase: ReturnType<typeof createClient>,
  guessedName: string,
  senderEmail: string,
): Promise<string | null> {
  if (!guessedName || guessedName.length < 4) return null;
  const normGuess = norm(guessedName);
  const tokens = normGuess.split(" ").filter((t) => t.length >= 4).slice(0, 4);

  // Pull candidate deals: those with similar tokens in property_name OR same broker.
  //
  // senderEmail originates in SMTP-delivered content (a parsed forwarded-message
  // header, or Graph's emailAddress.address) and is only lowercased. Interpolated
  // into .or() a comma rewrites the filter logic — e.g. an address surfaced as
  // "a@b.com,property_name.not.is.null" matches every row. Assert the shape, and
  // run the broker match as a separate .eq() query, which PostgREST encodes.
  const EMAIL_RE = /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,255}\.[a-z]{2,}$/;
  const safeSender = EMAIL_RE.test(senderEmail ?? "") ? senderEmail : null;
  // tokens come from norm(), which strips to [a-z0-9 ] — assert rather than trust.
  const safeTokens = tokens.filter((t) => /^[a-z0-9]+$/.test(t));

  const rows: Array<Record<string, unknown>> = [];
  if (safeTokens.length) {
    const { data: byName } = await supabase
      .from("inbox_deals")
      .select("id, property_name, broker_contact_email")
      .or(safeTokens.map((t) => `property_name.ilike.%${t}%`).join(","))
      .limit(40);
    rows.push(...(byName ?? []));
  }
  if (safeSender) {
    const { data: byBroker } = await supabase
      .from("inbox_deals")
      .select("id, property_name, broker_contact_email")
      .eq("broker_contact_email", safeSender)
      .limit(40);
    rows.push(...(byBroker ?? []));
  }
  // De-duplicate: a deal can match on both name and broker.
  const seen = new Set<string>();
  const data = rows.filter((r) => {
    const id = String(r.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  let best: { id: string; score: number } | null = null;
  for (const row of data ?? []) {
    const candName = norm(row.property_name as string | null);
    if (!candName) continue;
    const candTokens = new Set(candName.split(" "));
    const overlap = tokens.filter((t) => candTokens.has(t)).length;
    let score = overlap / Math.max(tokens.length, 1);
    if (row.broker_contact_email === senderEmail) score += 0.15;
    if (score > (best?.score ?? 0)) best = { id: row.id as string, score };
  }
  return best && best.score >= 0.6 ? best.id : null;
}

/** Detect if an email is a forward by subject prefix or body forwarded-header block. */
function isForwarded(subject: string, body: string | null): boolean {
  if (/^\s*(fw|fwd)\b/i.test(subject)) return true;
  if (!body) return false;
  const text = stripHtml(body);
  if (/-{3,}\s*Forwarded message/i.test(text)) return true;
  if (/Begin forwarded message/i.test(text)) return true;
  // From: ... Sent:/Date: ... Subject: block (Outlook-style)
  if (/From:\s*[^\n]{1,200}?(Sent|Date):\s*[^\n]{1,200}?Subject:/is.test(text)) return true;
  return false;
}

/** Extract the original external sender from a forwarded message body. */
function extractOriginalSender(body: string | null): { email: string; name: string | null } | null {
  if (!body) return null;
  try {
    const text = stripHtml(body);
    // Find all "From:" lines and the content following them
    const fromRegex = /From:\s*([^\n<>]{0,200}?)?\s*<?([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})>?/gi;
    let m: RegExpExecArray | null;
    while ((m = fromRegex.exec(text)) !== null) {
      const rawName = (m[1] || "").trim().replace(/["']/g, "").replace(/\s+/g, " ").trim();
      const email = m[2].toLowerCase();
      const domain = email.split("@")[1] || "";
      if (!BLOCKED_DOMAINS.includes(domain)) {
        return { email, name: rawName || null };
      }
    }
  } catch (_e) {
    return null;
  }
  return null;
}

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Drives Graph reads of the acquisitions mailbox and chains a 200-email LLM
  // batch. Invoked from the UI and by daily-digest with the service-role key.
  const authz = await requireUserOrService(req);
  if (authz && !authz.ok) return authz.response;

  try {
    const mb = resolveMailbox("acquisitions");
    if (!mb) {
      return new Response(JSON.stringify({ error: "Outlook connector not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const path =
      `/messages` +
      `?$top=100&$orderby=receivedDateTime desc` +
      `&$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}` +
      `&$select=id,subject,bodyPreview,body,from,receivedDateTime`;

    const res = await graphFetch(mb, path);
    if (!res.ok) {
      const text = await res.text();
      return new Response(
        JSON.stringify({ error: "Graph API error", status: res.status, detail: text }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await res.json();
    const messages: GraphMessage[] = data.value || [];

    let skipped = 0;
    let createdDeals = 0;
    let linkedToExisting = 0;
    let duplicateEmails = 0;
    const touchedDealIds = new Set<string>();

    for (const m of messages) {
      const subject = m.subject || "";
      const lowerSubj = subject.toLowerCase();
      const fromAddr = m.from?.emailAddress?.address?.toLowerCase() || "";
      const fromDomain = fromAddr.split("@")[1] || "";

      if (SKIP_SUBJECT_TERMS.some((t) => lowerSubj.includes(t))) { skipped++; continue; }
      if (!fromAddr) { skipped++; continue; }

      // Peek body early so we can detect forwards before applying the internal-domain skip
      const bodyHtmlPeek = m.body?.contentType?.toLowerCase() === "html" ? m.body.content : null;
      const bodyTextPeek = m.body?.contentType?.toLowerCase() === "text" ? m.body.content : (m.bodyPreview || null);
      const fullBodyPeek = bodyHtmlPeek || bodyTextPeek || null;
      const forwarded = isForwarded(subject, fullBodyPeek);

      // Skip DIRECT internal mail only; forwards from @ansoniaproperties.com are allowed through
      if (BLOCKED_DOMAINS.includes(fromDomain) && !forwarded) { skipped++; continue; }

      // Skip if we've already ingested this exact message into deal_emails
      const { data: existingEmail } = await supabase
        .from("deal_emails")
        .select("id")
        .eq("email_message_id", m.id)
        .maybeSingle();
      if (existingEmail) { duplicateEmails++; continue; }

      // Check if an inbox_deal was previously created from this same Outlook message
      // (older syncs stored email_message_id directly on inbox_deals)
      const { data: existingDeal } = await supabase
        .from("inbox_deals")
        .select("id")
        .eq("email_message_id", m.id)
        .maybeSingle();

      const fullBody = fullBodyPeek;
      const receivedAt = m.receivedDateTime || new Date().toISOString();
      const guessedName = guessPropertyName(subject);

      // For forwarded emails, recover the original external sender from the body.
      // Fall back to the actual sender if parsing fails or finds nothing external.
      let brokerEmail = fromAddr;
      let brokerName: string | null = m.from?.emailAddress?.name || null;
      if (forwarded) {
        const orig = extractOriginalSender(fullBody);
        if (orig) {
          brokerEmail = orig.email;
          brokerName = orig.name || brokerName;
        }
      }

      // Resolve which inbox_deal this email belongs to
      let dealId: string | null = (existingDeal?.id as string | undefined) ?? null;
      if (dealId) {
        linkedToExisting++;
      } else {
        dealId = await findMatchingDeal(supabase, guessedName, brokerEmail);
        if (dealId) linkedToExisting++;
      }

      if (!dealId) {
        const { units, year_built, rejected } = preExtractFacts(subject, fullBody);
        for (const r of rejected) {
          console.warn(
            `[sync-acquisitions-inbox] rejected ${r.field}=${JSON.stringify(r.value)}: ${r.reason}`,
          );
        }
        // broker_firm was only ever written by the model, while contact name and
        // email are written here from the headers — which is why the contact
        // survives an LLM outage and the firm does not. The domain is already in
        // hand, so derive a firm now; the model can refine it later.
        const brokerFirm = firmFromEmailDomain(brokerEmail);
        // Create new inbox_deal (do NOT set email_message_id — that lives on deal_emails now)
        const { data: newDeal, error: insErr } = await supabase
          .from("inbox_deals")
          .insert({
            email_subject: subject || "(no subject)",
            email_body: fullBody,
            email_received_at: receivedAt,
            broker_contact_email: brokerEmail,
            broker_contact_name: brokerName,
            broker_firm: brokerFirm,
            property_name: guessedName || subject || null,
            source: "email",
            email_count: 1,
            units,
            year_built,
          })
          .select("id")
          .single();
        if (insErr) {
          console.error("insert inbox_deal failed", insErr);
          continue;
        }
        dealId = newDeal!.id as string;
        createdDeals++;
      }

      // Insert deal_emails row
      const { error: deErr } = await supabase.from("deal_emails").insert({
        deal_id: dealId,
        email_message_id: m.id,
        subject,
        body: fullBody,
        received_at: receivedAt,
        sender_email: fromAddr,
      });
      if (deErr) {
        console.error("insert deal_email failed", deErr);
        continue;
      }

      touchedDealIds.add(dealId);
    }

    // Recompute email_count for every touched deal
    for (const id of touchedDealIds) {
      const { count } = await supabase
        .from("deal_emails")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", id);
      await supabase
        .from("inbox_deals")
        .update({ email_count: count ?? 1 })
        .eq("id", id);
    }

    // Fire summarization async (don't block response) — which means a failing
    // batch never reaches this caller. Watch ai_usage_log and the function logs,
    // not this function's response. Batch size is owned by summarize-emails
    // (SUMMARIZE_BATCH_SIZE), so no limit is passed here.
    // Awaited, not fire-and-forget. The old form sent the only report of a
    // failed summarisation to console.error, where it reached neither this
    // caller nor the database — one of three independent mechanisms that made
    // the pipeline's most important failure unobservable.
    let summarizeError: string | null = null;
    if (touchedDealIds.size > 0) {
      try {
        const { error } = await supabase.functions.invoke("summarize-emails", { body: {} });
        if (error) summarizeError = error.message ?? String(error);
      } catch (e) {
        summarizeError = e instanceof Error ? e.message : String(e);
      }
      if (summarizeError) {
        console.error("summarize-emails invoke failed", summarizeError);
        // Persisted on the touched rows so it is visible from SQL and in the UI,
        // not just in the function logs.
        await supabase
          .from("inbox_deals")
          .update({
            summary_error: `summarize-emails invoke failed: ${summarizeError}`.slice(0, 2000),
            summary_attempted_at: new Date().toISOString(),
          })
          .in("id", Array.from(touchedDealIds));
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        summarize_error: summarizeError,
        scanned: messages.length,
        skipped,
        createdDeals,
        linkedToExisting,
        duplicateEmails,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
