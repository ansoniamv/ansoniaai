import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsFor, requireUserOrService } from "../_shared/auth.ts";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/microsoft_outlook";

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
function preExtractFacts(subject: string, body: string | null): {
  units: number | null;
  year_built: number | null;
} {
  const blob = `${subject}\n${body ? stripHtml(body) : ""}`;

  let units: number | null = null;
  const unitMatch =
    blob.match(/(\d[\d,]{0,4})\s*\+?\s*units?\b/i) ||
    blob.match(/unit\s*count[:\s]+(\d[\d,]{0,4})/i);
  if (unitMatch) {
    const n = parseInt(unitMatch[1].replace(/,/g, ""), 10);
    if (Number.isFinite(n) && n >= 5 && n <= 10000) units = n;
  }

  let year_built: number | null = null;
  const yearMatch = blob.match(
    /\b(?:year\s*built|built(?:\s*in)?|vintage|constructed(?:\s*in)?|circa|c\.)\s*[:\-]?\s*((?:19|20)\d{2})\b/i,
  );
  if (yearMatch) {
    const y = parseInt(yearMatch[1], 10);
    const currentYear = new Date().getFullYear();
    if (y >= 1900 && y <= currentYear) year_built = y;
  }

  return { units, year_built };
}

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

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const url =
      `${GATEWAY_URL}/me/messages` +
      `?$top=100&$orderby=receivedDateTime desc` +
      `&$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}` +
      `&$select=id,subject,bodyPreview,body,from,receivedDateTime`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": OUTLOOK_KEY,
      },
    });
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
        const { units, year_built } = preExtractFacts(subject, fullBody);
        // Create new inbox_deal (do NOT set email_message_id — that lives on deal_emails now)
        const { data: newDeal, error: insErr } = await supabase
          .from("inbox_deals")
          .insert({
            email_subject: subject || "(no subject)",
            email_body: fullBody,
            email_received_at: receivedAt,
            broker_contact_email: brokerEmail,
            broker_contact_name: brokerName,
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

    // Fire summarization async (don't block response). Larger batch + flash-lite
    // means we can process the whole sync in one call.
    if (touchedDealIds.size > 0) {
      supabase.functions
        .invoke("summarize-emails", { body: { limit: 200 } })
        .then(({ error }) => {
          if (error) console.error("summarize-emails invoke returned error", error);
        })
        .catch((e) => console.error("summarize-emails invoke threw", e));
    }

    return new Response(
      JSON.stringify({
        ok: true,
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
