import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUserOrService } from "../_shared/auth.ts";
import { resolveAtlasKey, resolveAcquisitionsKey } from "../_shared/outlookKeys.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/microsoft_outlook";

interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType: string; content: string };
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  ccRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  importance?: string;
  webLink?: string;
  parentFolderId?: string;
}

interface Mailbox {
  key: string;              // logical name stored on the row
  connectionApiKey: string; // X-Connection-Api-Key value
}

const ANSONIA_DOMAIN = "ansoniaproperties.com";
const GENERIC_DOMAINS = new Set([
  "gmail.com","yahoo.com","outlook.com","hotmail.com","icloud.com","aol.com",
  "me.com","live.com","msn.com","proton.me","protonmail.com",
]);
const ROLE_ACCOUNTS = /^(info|ir|admin|office|hello|contact|support|noreply|no-reply|donotreply|notifications?|alerts?|team|sales|marketing|accounting|ap|ar|billing|legal|compliance|careers|jobs|hr)$/i;

type Candidate = {
  email: string;
  partner_id: string;
  display_name: string | null;
  is_sender: boolean;
  message_id: string;
  subject: string | null;
  received_at: string | null;
  body_text: string | null;
};

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|br|tr|li|h\d)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function nameFromLocalPart(email: string): string | null {
  const local = email.split("@")[0];
  const parts = local.split(/[._-]+/).filter((p) => /^[a-z]{2,}$/i.test(p));
  if (parts.length < 2) return null;
  return parts.map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(" ");
}

const TITLE_PATTERN = /\b(managing\s+partner|managing\s+director|senior\s+managing\s+director|executive\s+director|managing\s+principal|principal|partner|founder|co-founder|chief\s+\w+\s+officer|c[eioft]o|head\s+of\s+[\w\s]{2,30}|(senior\s+|vice\s+|associate\s+|assistant\s+)?(vice\s+)?president|(senior\s+|executive\s+)?vice\s+president|svp|evp|avp|vp|director(\s+of\s+[\w\s]{2,30})?|senior\s+associate|associate|senior\s+analyst|analyst|portfolio\s+manager|asset\s+manager|controller|general\s+counsel)\b/i;

function titleFromSignature(bodyText: string, personName: string | null): string | null {
  const plain = stripHtml(bodyText) || bodyText || "";
  const lines = plain.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-20);
  if (personName) {
    const last = personName.split(" ").pop()!.toLowerCase();
    const idx = lines.findIndex((l) => l.toLowerCase().includes(last) && l.length < 60);
    if (idx >= 0 && idx + 1 < lines.length) {
      const next = lines[idx + 1];
      if (next.length <= 60 && TITLE_PATTERN.test(next)) return next;
    }
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.length <= 60 && TITLE_PATTERN.test(l)) return l;
  }
  return null;
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await requireUserOrService(req);
    if (auth && !auth.ok) return auth.response;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const acqRes = resolveAcquisitionsKey();
    const atlasRes = resolveAtlasKey();
    const ACQ_KEY = acqRes.key;
    const ATLAS_KEY = atlasRes.collidesWithAcquisitions ? null : atlasRes.key;


    if (!LOVABLE_API_KEY || (!ACQ_KEY && !ATLAS_KEY)) {
      return new Response(JSON.stringify({ error: "Outlook connector not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const top = Math.min(Number(body.top) || 50, 200);
    const folder: string = body.folder || "inbox";
    const requestedMailbox: string | undefined = body.mailbox; // optional filter

    const mailboxes: Mailbox[] = [];
    if (ACQ_KEY) mailboxes.push({ key: "acquisitions", connectionApiKey: ACQ_KEY });
    if (ATLAS_KEY) mailboxes.push({ key: "atlas", connectionApiKey: ATLAS_KEY });

    const targets = requestedMailbox
      ? mailboxes.filter((m) => m.key === requestedMailbox)
      : mailboxes;

    if (targets.length === 0) {
      return new Response(JSON.stringify({ error: "No matching mailbox configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load partner_contacts for email matching (shared across mailboxes)
    const { data: contacts } = await supabase
      .from("partner_contacts")
      .select("id, email, partner_id");
    const contactMap = new Map<string, { id: string; partner_id: string | null }>();
    for (const c of contacts || []) {
      if (c.email) contactMap.set(c.email.toLowerCase(), { id: c.id, partner_id: c.partner_id });
    }

    // domain -> set of partner_ids that have a contact on it (unambiguous ownership only)
    const domainOwners = new Map<string, Set<string>>();
    for (const c of contacts || []) {
      if (!c.email || !c.partner_id) continue;
      const d = c.email.toLowerCase().split("@")[1];
      if (!d || d === ANSONIA_DOMAIN || GENERIC_DOMAINS.has(d)) continue;
      if (!domainOwners.has(d)) domainOwners.set(d, new Set());
      domainOwners.get(d)!.add(c.partner_id);
    }
    const firmDomain = new Map<string, string>();
    for (const [d, owners] of domainOwners) {
      if (owners.size === 1) firmDomain.set(d, [...owners][0]);
    }
    const candidates = new Map<string, Candidate>();


    const results: Record<string, { fetched: number; upserted: number; matched: number; error?: string; since?: string; pages?: number; truncated?: boolean; key_name?: string | null }> = {};
    if (atlasRes.collidesWithAcquisitions) {
      results.atlas = {
        fetched: 0,
        upserted: 0,
        matched: 0,
        key_name: atlasRes.name,
        error:
          `Atlas connection key (${atlasRes.name}) is identical to the acquisitions key — ` +
          `the Atlas connection was almost certainly authorized against the wrong mailbox. ` +
          `Re-authorize as atlas@ansoniaproperties.com.`,
      };
    }

    let totalFetched = 0;
    let totalUpserted = 0;
    let totalMatched = 0;

    const SELECT = "id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients," +
      "receivedDateTime,sentDateTime,isRead,hasAttachments,importance,webLink,parentFolderId";
    const PAGE_SIZE = Math.min(Number(body.top) || 100, 200);
    const MAX_PAGES = 20;
    const DEFAULT_LOOKBACK_DAYS = 30;
    const MAX_LOOKBACK_DAYS = 120;
    const explicitSince: string | undefined = body.since;

    for (const mb of targets) {
      // The newest message we already hold for this mailbox IS the watermark.
      const { data: newest } = await supabase
        .from("outlook_messages")
        .select("received_at")
        .eq("mailbox", mb.key)
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let floor: Date;
      if (explicitSince) {
        floor = new Date(explicitSince);
      } else if (newest?.received_at) {
        floor = new Date(new Date(newest.received_at).getTime() - 24 * 3600_000);
      } else {
        floor = new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 86_400_000);
      }
      const hardFloor = new Date(Date.now() - MAX_LOOKBACK_DAYS * 86_400_000);
      if (floor < hardFloor) floor = hardFloor;

      const baseUrl =
        `${GATEWAY_URL}/me/mailFolders/${folder}/messages` +
        `?$top=${PAGE_SIZE}` +
        `&$orderby=receivedDateTime desc` +
        `&$filter=receivedDateTime ge ${floor.toISOString()}` +
        `&$select=${SELECT}`;

      let url: string | null = baseUrl;
      const messages: GraphMessage[] = [];
      let pages = 0;
      let truncated = false;
      let failed = false;

      while (url && pages < MAX_PAGES) {
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": mb.connectionApiKey,
          },
        });
        if (!res.ok) {
          const text = await res.text();
          results[mb.key] = {
            fetched: 0, upserted: 0, matched: 0,
            error: `HTTP ${res.status}: ${text.slice(0, 300)}`,
          };
          failed = true;
          break;
        }
        const data = await res.json();
        const batch: GraphMessage[] = data.value || [];
        messages.push(...batch);
        pages++;

        const next = data["@odata.nextLink"];
        if (typeof next === "string" && next.startsWith(GATEWAY_URL)) {
          url = next;
        } else if (next || batch.length === PAGE_SIZE) {
          // Gateway didn't return a followable nextLink — fall back to $skip paging.
          url = `${baseUrl}&$skip=${pages * PAGE_SIZE}`;
        } else {
          url = null;
        }
      }
      if (failed) continue;
      if (pages >= MAX_PAGES && url) truncated = true;


      const rows = messages.map((m) => {
        const fromAddr = m.from?.emailAddress?.address?.toLowerCase() || null;
        const toAddrs = (m.toRecipients || [])
          .map((r) => r.emailAddress?.address?.toLowerCase())
          .filter(Boolean) as string[];
        const ccAddrs = (m.ccRecipients || [])
          .map((r) => r.emailAddress?.address?.toLowerCase())
          .filter(Boolean) as string[];

        const namesByAddress = new Map<string, string>();
        for (const r of [...(m.toRecipients || []), ...(m.ccRecipients || [])]) {
          const a = r.emailAddress?.address?.toLowerCase();
          const n = r.emailAddress?.name;
          if (a && n && !namesByAddress.has(a)) namesByAddress.set(a, n);
        }

        // Consider from + to + cc; ignore internal @ansoniaproperties.com addresses
        const externalAddrs = [fromAddr, ...toAddrs, ...ccAddrs]
          .filter((a): a is string => !!a)
          .filter((a) => !a.endsWith("@ansoniaproperties.com"));

        // Deterministic new-contact detection (no LLM)
        for (const addr of externalAddrs) {
          const d = addr.split("@")[1];
          const partnerId = d ? firmDomain.get(d) : undefined;
          if (!partnerId) continue;
          if (contactMap.has(addr)) continue;
          if (ROLE_ACCOUNTS.test(addr.split("@")[0])) continue;

          const isSender = addr === fromAddr;
          const displayName = isSender
            ? (m.from?.emailAddress?.name || null)
            : (namesByAddress.get(addr) || null);

          const prev = candidates.get(addr);
          if (!prev || (isSender && !prev.is_sender)) {
            candidates.set(addr, {
              email: addr,
              partner_id: partnerId,
              display_name: displayName || prev?.display_name || null,
              is_sender: isSender || !!prev?.is_sender,
              message_id: m.id,
              subject: m.subject || null,
              received_at: m.receivedDateTime || null,
              body_text: isSender ? (m.body?.content || null) : (prev?.body_text ?? null),
            });
          } else if (!prev.display_name && displayName) {
            prev.display_name = displayName;
          }
        }


        let matched: { id: string; partner_id: string | null } | undefined;
        for (const a of externalAddrs) {
          const hit = contactMap.get(a);
          if (hit) { matched = hit; break; }
        }

        // Domain fallback: exactly one partner shares the domain
        if (!matched) {
          const genericDomains = new Set(["gmail.com","yahoo.com","outlook.com","hotmail.com","icloud.com","aol.com"]);
          const domains = new Set(
            externalAddrs
              .map((a) => a.split("@")[1])
              .filter((d): d is string => !!d && !genericDomains.has(d)),
          );
          for (const d of domains) {
            const partners = new Set<string>();
            for (const [email, c] of contactMap) {
              if (email.endsWith("@" + d) && c.partner_id) partners.add(c.partner_id);
            }
            if (partners.size === 1) {
              matched = { id: "", partner_id: [...partners][0] };
              break;
            }
          }
        }

        const source = mb.key === "atlas" ? "atlas" : "personal";

        return {
          message_id: m.id,
          conversation_id: m.conversationId || null,
          subject: m.subject || "(no subject)",
          preview: m.bodyPreview || null,
          body_html: m.body?.contentType === "html" || m.body?.contentType === "HTML" ? m.body.content : null,
          body_text: m.body?.contentType === "text" || m.body?.contentType === "Text" ? m.body?.content : null,
          from_email: fromAddr,
          from_name: m.from?.emailAddress?.name || null,
          to_recipients: m.toRecipients || [],
          cc_recipients: m.ccRecipients || [],
          received_at: m.receivedDateTime || null,
          sent_at: m.sentDateTime || null,
          is_read: !!m.isRead,
          has_attachments: !!m.hasAttachments,
          importance: m.importance || null,
          web_link: m.webLink || null,
          folder,
          mailbox: mb.key,
          source,
          partner_contact_id: matched && matched.id ? matched.id : null,
          partner_id: matched?.partner_id || null,
          raw: m as unknown as Record<string, unknown>,
          synced_at: new Date().toISOString(),
        };
      });

      let upserted = 0;
      if (rows.length) {
        const CHUNK = 20;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const slice = rows.slice(i, i + CHUNK);
          const { error } = await supabase
            .from("outlook_messages")
            .upsert(slice, { onConflict: "message_id" });
          if (error) {
            results[mb.key] = { fetched: messages.length, upserted, matched: 0, error: error.message };
            break;
          }
          upserted += slice.length;
        }
      }

      const matchedCount = rows.filter((r) => r.partner_contact_id).length;
      if (!results[mb.key]) {
        results[mb.key] = {
          fetched: messages.length, upserted, matched: matchedCount,
          since: floor.toISOString(), pages,
          ...(mb.key === "atlas" ? { key_name: atlasRes.name } : {}),
          ...(truncated ? { truncated: true } : {}),
        };

      }
      totalFetched += messages.length;
      totalUpserted += upserted;
      totalMatched += matchedCount;
    }

    // Deterministic contact suggestions — never allowed to break a sync.
    let contactsDetected = 0;
    try {
      const emails = [...candidates.keys()];
      if (emails.length) {
        const { data: prior } = await supabase
          .from("partner_suggestions")
          .select("id, status, proposed_value")
          .in("type", ["contact_add", "contact_update"])
          .in("status", ["pending", "rejected", "applied", "approved"]);
        const seen = new Set(
          (prior || [])
            .map((s: any) =>
              ((s.proposed_value?.email || s.proposed_value?.fills?.email || "") as string)
                .toString().toLowerCase().trim())
            .filter(Boolean),
        );

        const rows: Record<string, unknown>[] = [];
        for (const c of candidates.values()) {
          if (seen.has(c.email)) continue;
          const name = c.display_name || nameFromLocalPart(c.email);
          const nameSource = c.display_name ? "header" : (name ? "inferred" : "unknown");
          const role = c.is_sender && c.body_text ? titleFromSignature(c.body_text, name) : null;

          rows.push({
            partner_id: c.partner_id,
            type: "contact_add",
            field: `contact_add:${c.email}`,
            current_value: null,
            proposed_value: {
              name,
              email: c.email,
              ...(role ? { role } : {}),
              name_source: nameSource,
              ...(role ? { role_source: "signature_heuristic" } : {}),
              detected_by: "sync",
            },
            summary: name
              ? `Add ${name}${role ? ` — ${role}` : ""} <${c.email}>`
              : `Add unknown contact <${c.email}> — name required`,
            rationale: `New address on this partner's firm domain, seen ${c.is_sender ? "as sender" : "on to/cc"} in "${c.subject || "(no subject)"}". Not in partner_contacts.`,
            evidence: { message_ids: [c.message_id] },
            confidence: nameSource === "header" ? 0.8 : nameSource === "inferred" ? 0.65 : 0.5,
            status: "pending",
          });
        }
        if (rows.length) {
          const { error } = await supabase.from("partner_suggestions").insert(rows);
          if (!error) contactsDetected = rows.length;
          else console.error("contact suggestion insert failed", error.message);
        }
      }
    } catch (e) {
      console.error("contact detection failed", (e as Error).message);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        fetched: totalFetched,
        upserted: totalUpserted,
        matched: totalMatched,
        contacts_detected: contactsDetected,
        mailboxes: results,
      }),

      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
