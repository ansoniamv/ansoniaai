// Thread-aware Atlas email analyzer. Proposes changes (never applies).
// Input: { partner_id?: string, since_days?: number }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { completeJSON } from "../_shared/ai.ts";
import { requireUserOrService } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RAISE_STAGES = [
  "initial_reachout","materials_shared","discussion_scheduled",
  "serious_interest","committed","passed",
] as const;
const WARMTH_VALUES = ["Existing Partner","Very Warm","Warm","Tepid","Cold"] as const;
const CAPITAL_STATUS_VALUES = ["Actively Deploying","Selective","Constrained","Out of Capital"] as const;
const FACT_CATEGORIES = [
  "capital","personnel","strategy","organizational","relationship","other",
] as const;

const AI_MODEL = "google/gemini-2.5-flash";
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

// Confidence gates
const MIN_CONF: Record<string, number> = {
  warmth_change: 0.6, partner_field: 0.6, stage_change: 0.6, avoided_market_add: 0.55,
  contact_add: 0.7, contact_update: 0.6,
  capital_status_change: 0.7,   // high-consequence: gates whether we even pitch them
  profile_fact_add: 0.65,
};
const LOCKED_MIN_CONF = 0.8;
const CONTACT_UPDATE_CHANGE_CONF = 0.8; // higher bar when overwriting an existing non-empty value

// --- Name / nickname matching for contact resolution ---
const NICKNAMES: Record<string, string[]> = {
  sarah: ["sara","sadie"], sara: ["sarah"],
  robert: ["bob","rob","bobby","robbie"], bob: ["robert"], rob: ["robert"],
  william: ["will","bill","billy","liam"], bill: ["william"], will: ["william"],
  michael: ["mike","mick","mickey"], mike: ["michael"],
  richard: ["rick","dick","rich","richie"], rick: ["richard"],
  thomas: ["tom","tommy"], tom: ["thomas"],
  james: ["jim","jimmy","jamie"], jim: ["james"],
  john: ["johnny","jack","jonathan"], jack: ["john","jackson"],
  charles: ["charlie","chuck"], chuck: ["charles"], charlie: ["charles"],
  daniel: ["dan","danny"], dan: ["daniel"],
  david: ["dave","davey"], dave: ["david"],
  christopher: ["chris"], chris: ["christopher","christina","christine"],
  matthew: ["matt","matty"], matt: ["matthew"],
  andrew: ["andy","drew"], andy: ["andrew"],
  anthony: ["tony"], tony: ["anthony"],
  joseph: ["joe","joey"], joe: ["joseph"],
  benjamin: ["ben","benji"], ben: ["benjamin"],
  nicholas: ["nick","nicky"], nick: ["nicholas"],
  alexander: ["alex","xander"], alex: ["alexander","alexandra","alexandria"],
  samuel: ["sam","sammy"], sam: ["samuel","samantha"],
  elizabeth: ["liz","beth","betsy","eliza","lizzy"], liz: ["elizabeth"], beth: ["elizabeth"],
  katherine: ["kate","katie","kathy","kat"], kate: ["katherine","kathryn"], katie: ["katherine","kathryn"],
  jennifer: ["jen","jenny"], jen: ["jennifer"],
  margaret: ["maggie","meg","peggy"], maggie: ["margaret"],
  patricia: ["pat","patty","tricia"], pat: ["patrick","patricia"],
  patrick: ["pat","paddy"],
  jonathan: ["jon","jonny","john"], jon: ["jonathan"],
  edward: ["ed","eddie","ted"], ed: ["edward"], ted: ["edward","theodore"],
  theodore: ["theo","ted","teddy"],
};

function normalizeNameToken(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^\p{L}]/gu, "");
}
function splitFullName(raw: string | null | undefined): { first: string; last: string } | null {
  if (!raw) return null;
  const cleaned = String(raw)
    .replace(/["'`]/g, "")
    .replace(/\b(mr|mrs|ms|miss|dr|prof|sir|jr|sr|ii|iii|iv|esq|phd|md|cfa)\.?\b/gi, "")
    .replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const parts = cleaned.split(/\s+/).map(p => p.replace(/\.$/, "")).filter(p => p && !/^[A-Za-z]$/.test(p)); // drop single-letter middle initials
  if (parts.length === 0) return null;
  const first = normalizeNameToken(parts[0]);
  const last = normalizeNameToken(parts[parts.length - 1]);
  if (!first || !last) return null;
  return { first, last };
}
function firstNameMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // Explicit nickname table only — no bare prefix rule (e.g. "danielle" must not match "dan").
  const aliases = new Set([...(NICKNAMES[a] || []), ...(NICKNAMES[b] || [])]);
  return aliases.has(a) || aliases.has(b);
}
type ContactRow = {
  id: string; name: string | null; email: string | null; phone: string | null;
  role: string | null; linkedin_url: string | null; firm_location: string | null;
};
function findContactByEmail(contacts: ContactRow[], email: string | null | undefined): ContactRow | null {
  if (!email) return null;
  const e = email.toLowerCase().trim();
  return contacts.find(c => c.email && c.email.toLowerCase().trim() === e) || null;
}
function findContactByName(contacts: ContactRow[], name: string | null | undefined): ContactRow | null {
  const parsed = splitFullName(name);
  if (!parsed) return null;
  const candidates = contacts
    .map(c => ({ c, p: splitFullName(c.name) }))
    .filter(x => x.p && x.p.last === parsed.last && firstNameMatches(x.p.first, parsed.first));
  if (candidates.length === 1) return candidates[0].c;
  // If multiple last-name matches, prefer exact first-name match
  const exact = candidates.filter(x => x.p!.first === parsed.first);
  if (exact.length === 1) return exact[0].c;
  return null;
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}

const ANSONIA_DOMAIN = "ansoniaproperties.com";

// Types whose evidence must be the partner's own words.
const PARTNER_VOICE_TYPES = new Set([
  "warmth_change", "partner_field", "avoided_market_add",
  "capital_status_change", "profile_fact_add", "contact_update", "contact_add",
]);

const normalizeForMatch = (s: string) =>
  s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
   .replace(/\s+/g, " ").trim();


// --- Directive parsing (Atlas CC'd with explicit instructions) ---

function normalizeCompanyName(s: string): string {
  return s.toLowerCase()
    .replace(/\b(llc|l\.l\.c\.|llp|lp|inc|inc\.|incorporated|corp|corporation|company|co\.|co|group|capital|partners|partnership|holdings|holding|properties|realty|management|mgmt|investments|invest|the)\b/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ").trim();
}

function looksLikeDirective(m: any): boolean {
  const bodyText = (m.body_text || stripHtml(m.body_html) || m.preview || "").toLowerCase();
  const head = bodyText.slice(0, 1200);
  if (!head) return false;

  const mentionsAtlas = /\batlas\b/i.test(head);
  const hasImperative =
    /\batlas\b[\s,:!.-]*(please|pls|add|attach|create|note|tag|link|associate|log|record)/i.test(head)
    || /(please|pls)[^.]{0,40}\batlas\b/i.test(head);
  // Structured form: "Capital partner: X" / "Deal: Y" — only counts alongside an Atlas mention.
  const hasStructuredLabels =
    /(capital\s+partner|partner)\s*[:\-]/i.test(head) && /\bdeal\s*[:\-]/i.test(head);

  return hasImperative || (mentionsAtlas && hasStructuredLabels);
}

async function parseDirectiveWithAI(
  m: any, apiKey: string,
): Promise<{ intent: string; partner_name: string | null; deal_name: string | null } | null> {
  const text = (m.body_text || stripHtml(m.body_html) || m.preview || "").slice(0, 3000);
  const prompt = `An Ansonia teammate CC'd atlas@ansoniaproperties.com with an instruction for Atlas.
Extract the directive. Return STRICT JSON:
{ "intent": "attach_email" | "add_partner" | "add_deal" | "none",
  "partner_name": string|null, "deal_name": string|null, "confidence": number }

- "attach_email": asks Atlas to log/attach/record this email chain against a partner and/or deal.
- "add_partner"/"add_deal": explicitly asks to create a new record with no attach intent.
- "none": no clear Atlas directive.
Extract the PARTNER (capital partner / firm) and DEAL (property name) exactly as written.
Example: "Atlas please add this email chain to / Capital partner: Long Wharf / Deal: Aviary at Middleton"
  -> { "intent": "attach_email", "partner_name": "Long Wharf", "deal_name": "Aviary at Middleton", "confidence": 0.95 }

Subject: ${m.subject || ""}
From: ${m.from_email || ""}
Body:
${text}`;
  try {
    // Claude Opus 5 primary, gateway fallback — see _shared/ai.ts.
    const { parsed } = await completeJSON<any>(prompt, { maxTokens: 4000 });
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.confidence === "number" && parsed.confidence < 0.5) return null;
    const intent = String(parsed.intent || "none");
    if (!["attach_email","add_partner","add_deal","none"].includes(intent)) return null;
    return {
      intent,
      partner_name: typeof parsed.partner_name === "string" && parsed.partner_name.trim() ? parsed.partner_name.trim() : null,
      deal_name: typeof parsed.deal_name === "string" && parsed.deal_name.trim() ? parsed.deal_name.trim() : null,
    };
  } catch (e) { console.error("directive AI parse", e); return null; }
}

function fuzzyMatchByName<T extends { name?: string | null; property_name?: string | null }>(
  rows: T[], nameField: "name" | "property_name", query: string,
): T | null {
  const norm = normalizeCompanyName(query);
  if (!norm) return null;
  const scored = rows.map(r => {
    const rn = normalizeCompanyName((r as any)[nameField] || "");
    if (!rn) return { r, score: 0 };
    if (rn === norm) return { r, score: 1 };
    if (rn.includes(norm) || norm.includes(rn)) return { r, score: 0.85 };
    const a = new Set(norm.split(" ").filter(Boolean));
    const b = new Set(rn.split(" ").filter(Boolean));
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    const denom = Math.max(a.size, b.size);
    return { r, score: denom > 0 ? inter / denom : 0 };
  }).sort((x, y) => y.score - x.score);
  return scored[0] && scored[0].score >= 0.6 ? scored[0].r : null;
}



type Recipient = { name: string | null; email: string };

/** Parse Graph-shaped recipients: [{emailAddress:{name,address}}] — also tolerates pre-normalized shapes. */
function parseRecipients(raw: any): Recipient[] {
  if (!raw) return [];
  let arr: any[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") {
    try { const p = JSON.parse(raw); arr = Array.isArray(p) ? p : []; } catch { return []; }
  } else if (typeof raw === "object") {
    arr = [raw];
  }
  const out: Recipient[] = [];
  for (const item of arr) {
    if (!item) continue;
    const ea = item.emailAddress || item.email_address || item;
    const address = (ea?.address || ea?.email || (typeof item === "string" ? item : "") || "").toString().trim().toLowerCase();
    if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) continue;
    const name = (ea?.name || item?.name || null);
    out.push({ name: typeof name === "string" && name.trim() ? name.trim() : null, email: address });
  }
  return out;
}

function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const i = email.lastIndexOf("@");
  if (i < 0) return null;
  const d = email.slice(i + 1).toLowerCase().trim();
  return d || null;
}

/** Firm domains for a partner: from existing contact emails, filtered to non-Ansonia. */
function firmDomainsFromContacts(contacts: ContactRow[]): Set<string> {
  const set = new Set<string>();
  for (const c of contacts) {
    const d = domainOf(c.email);
    if (d && d !== ANSONIA_DOMAIN) set.add(d);
  }
  return set;
}

function titleCaseMarket(s: string): string | null {
  if (!s || typeof s !== "string") return null;
  const cleaned = s.trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  return cleaned.split(/([\s,\-\/])/).map(part =>
    /^[a-zA-Z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part
  ).join("");
}

function normalizeEquityM(v: any): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v !== "string") return null;
  const m = v.replace(/[,$]/g, "").match(/([\d.]+)\s*(m|mm|million|b|billion|k)?/i);
  if (!m) return null;
  const n = parseFloat(m[1]); if (!isFinite(n)) return null;
  const unit = (m[2] || "m").toLowerCase();
  if (unit === "b" || unit === "billion") return n * 1000;
  if (unit === "k") return n / 1000;
  return n;
}

/**
 * Normalize proposed_value per field. Returns null to signal drop.
 */
function normalizeProposal(type: string, field: string | null, val: any): any {
  if (val === null || val === undefined) return null;
  if (type === "capital_status_change") {
    if (!val || typeof val !== "object") return null;
    const v = val as any;
    const status = (CAPITAL_STATUS_VALUES as readonly string[])
      .find(s => s.toLowerCase() === String(v.status || "").trim().toLowerCase());
    if (!status) return null;
    const out: Record<string, any> = { status };
    // ISO date only; reject anything unparseable rather than guessing.
    if (typeof v.available_from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.available_from.trim())) {
      out.available_from = v.available_from.trim();
    }
    if (typeof v.detail === "string" && v.detail.trim()) out.detail = v.detail.trim().slice(0, 500);
    return out;
  }
  if (type === "profile_fact_add") {
    if (!val || typeof val !== "object") return null;
    const v = val as any;
    const fact = typeof v.fact === "string" ? v.fact.trim() : "";
    if (fact.length < 12) return null;              // a fragment is not a fact
    const category = (FACT_CATEGORIES as readonly string[])
      .includes(String(v.category || "").toLowerCase()) ? String(v.category).toLowerCase() : "other";
    const out: Record<string, any> = { fact: fact.slice(0, 1000), category };
    if (typeof v.fact_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.fact_date.trim())) {
      out.fact_date = v.fact_date.trim();
    }
    return out;
  }
  if (type === "warmth_change") {
    const s = String(val).trim();
    const match = (WARMTH_VALUES as readonly string[]).find(w => w.toLowerCase() === s.toLowerCase());
    return match || null;
  }
  if (type === "stage_change") {
    const s = String(val).trim().toLowerCase().replace(/\s+/g, "_");
    return (RAISE_STAGES as readonly string[]).includes(s) ? s : null;
  }
  if (type === "avoided_market_add") {
    if (Array.isArray(val)) {
      const arr = val.map(titleCaseMarket).filter(Boolean) as string[];
      return arr.length ? arr : null;
    }
    return titleCaseMarket(String(val));
  }
  if (type === "partner_field") {
    if (!field) return null;
    if (field === "min_equity_m" || field === "max_equity_m") return normalizeEquityM(val);
    if (field.startsWith("strategy_")) {
      if (typeof val === "boolean") return val;
      const s = String(val).toLowerCase();
      if (["true","yes","y","1"].includes(s)) return true;
      if (["false","no","n","0"].includes(s)) return false;
      return null;
    }
    if (field === "geography" || field === "product_types") {
      if (Array.isArray(val)) {
        const arr = val.map(x => titleCaseMarket(String(x))).filter(Boolean) as string[];
        return arr.length ? arr : null;
      }
      const t = titleCaseMarket(String(val));
      return t ? [t] : null;
    }
    return val;
  }
  if (type === "contact_add") {
    if (!val || typeof val !== "object") return null;
    const v = val as any;
    const name = typeof v.name === "string" ? v.name.trim() : "";
    if (!name) return null;
    const clean: Record<string, any> = { name };
    for (const f of ["email","phone","role","linkedin_url","firm_location"]) {
      if (typeof v[f] === "string" && v[f].trim()) clean[f] = v[f].trim();
    }
    if (clean.email) clean.email = clean.email.toLowerCase();
    return clean;
  }
  if (type === "contact_update") {
    if (!val || typeof val !== "object") return null;
    const v = val as any;
    if (!v.contact_id || typeof v.contact_id !== "string") return null;
    const fills = (v.fills && typeof v.fills === "object") ? v.fills : {};
    const changes = (v.changes && typeof v.changes === "object") ? v.changes : {};
    const cleanFills: Record<string, string> = {};
    for (const [f, raw] of Object.entries(fills)) {
      if (!["email","phone","role","linkedin_url","firm_location"].includes(f)) continue;
      if (typeof raw === "string" && raw.trim()) cleanFills[f] = f === "email" ? raw.trim().toLowerCase() : raw.trim();
    }
    const cleanChanges: Record<string, { old: any; new: string }> = {};
    for (const [f, obj] of Object.entries(changes)) {
      if (!["email","phone","role","linkedin_url","firm_location"].includes(f)) continue;
      const o = obj as any;
      if (!o || typeof o !== "object") continue;
      if (typeof o.new !== "string" || !o.new.trim()) continue;
      cleanChanges[f] = { old: o.old ?? null, new: f === "email" ? o.new.trim().toLowerCase() : o.new.trim() };
    }
    if (Object.keys(cleanFills).length === 0 && Object.keys(cleanChanges).length === 0) return null;
    const out: Record<string, any> = { contact_id: v.contact_id };
    if (typeof v.contact_name === "string") out.contact_name = v.contact_name;
    if (Object.keys(cleanFills).length) out.fills = cleanFills;
    if (Object.keys(cleanChanges).length) out.changes = cleanChanges;
    return out;
  }
  return val;
}

type Suggestion = {
  type: string; field?: string | null; proposed_value: unknown; current_value?: unknown;
  summary: string; rationale?: string; confidence?: number;
  evidence?: { message_ids?: string[]; quote?: string };
  engagement_id?: string | null; deal_id?: string | null; deal_confidence?: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await requireUserOrService(req);
  if (auth && !auth.ok) return auth.response;
  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const partnerFilter: string | undefined = body.partner_id;
    // catch_up widens the window for a single run so a recovered backlog can be processed.
    const catchUp = body.catch_up === true;
    const sinceDays: number = catchUp ? 120 : (Number(body.since_days) || 30);
    const sinceIso = new Date(Date.now() - sinceDays * 86400_000).toISOString();

    // Pull unanalyzed atlas messages (partner-attached AND unattributed — the latter may carry directives)
    let msgQ = supabase
      .from("outlook_messages")
      .select("id,message_id,conversation_id,subject,preview,body_text,body_html,from_email,from_name,to_recipients,cc_recipients,received_at,partner_id,deal_id,web_link")
      .eq("source", "atlas")
      .is("analyzed_at", null)
      .gte("received_at", sinceIso)
      .order("received_at", { ascending: true })
      .limit(500);
    if (partnerFilter) msgQ = msgQ.eq("partner_id", partnerFilter);
    const { data: allMessages, error: msgErr } = await msgQ;
    if (msgErr) throw msgErr;

    let totalSuggestions = 0;
    let totalAnalyzed = 0;
    let threadsAnalyzed = 0;
    let outboundOnlyThreads = 0;

    let directivesHandled = 0;
    const directiveHandledIds = new Set<string>();
    const directiveCheckedIds = new Set<string>();

    // --- DIRECTIVE PASS: Atlas CC'd by an internal teammate with an explicit instruction ---
    // Run BEFORE the partner loop so unattributed directive messages are not dropped.
    const directiveCandidates = (allMessages || []).filter((m: any) => {
      // A directive is always FROM an Ansonia teammate CC'ing Atlas with an instruction.
      // External mail can never be a directive — this gate is what keeps broker teasers
      // and LP newsletters out of the directive LLM path.
      if (domainOf(m.from_email) !== ANSONIA_DOMAIN) return false;
      return looksLikeDirective(m);
    });

    for (const m of directiveCandidates) {
      const parsed = await parseDirectiveWithAI(m, LOVABLE_API_KEY);
      directiveCheckedIds.add((m as any).id);   // spent an LLM call — never re-check this message
      if (!parsed || parsed.intent === "none") continue;
      if (!parsed.partner_name && !parsed.deal_name) continue;

      // Load full thread (conversation) to attach as a chain
      const convId = (m as any).conversation_id || (m as any).message_id;
      const { data: threadRows } = await supabase
        .from("outlook_messages")
        .select("message_id, subject, body_html, body_text, preview, received_at, from_email, from_name")
        .eq("conversation_id", convId)
        .order("received_at", { ascending: true });
      const chain: any[] = (threadRows && threadRows.length ? threadRows : [m]) as any[];

      const chainHtml = chain.map((x) =>
        `<div style="margin-bottom:16px">`
        + `<div><strong>${(x.from_name || x.from_email || "").toString()}</strong> — ${x.received_at || ""}</div>`
        + `<div><em>${(x.subject || "").toString()}</em></div>`
        + (x.body_html || `<p>${((x.body_text || x.preview || "") as string).replace(/\n/g, "<br/>")}</p>`)
        + `</div>`
      ).join("\n<hr/>\n");
      const chainText = chain.map((x) =>
        `From: ${x.from_name || x.from_email || ""}\nDate: ${x.received_at || ""}\nSubject: ${x.subject || ""}\n\n${x.body_text || stripHtml(x.body_html) || x.preview || ""}`
      ).join("\n\n---\n\n");
      const messageIds: string[] = chain.map((x) => x.message_id).filter(Boolean);

      // Resolve targets
      let partnerMatch: { id: string; name: string } | null = null;
      let dealMatch: { id: string; property_name: string } | null = null;
      if (parsed.partner_name) {
        const { data: prs } = await supabase.from("partners").select("id, name").is("archived_at", null).limit(1000);
        const hit = fuzzyMatchByName<any>((prs || []) as any[], "name", parsed.partner_name);
        if (hit) partnerMatch = { id: hit.id, name: hit.name };
      }
      if (parsed.deal_name) {
        const { data: drs } = await supabase.from("deals").select("id, property_name").limit(2000);
        const hit = fuzzyMatchByName<any>((drs || []) as any[], "property_name", parsed.deal_name);
        if (hit) dealMatch = { id: hit.id, property_name: hit.property_name };
      }

      const inserts: any[] = [];
      const evidence = { message_ids: messageIds, quote: ((m as any).preview || "").slice(0, 300) };

      // partner_add if partner named but not found
      if (parsed.partner_name && !partnerMatch) {
        inserts.push({
          partner_id: null, deal_id: null, engagement_id: null,
          type: "partner_add", field: null, current_value: null,
          proposed_value: { name: parsed.partner_name },
          summary: `Create partner "${parsed.partner_name}" (Atlas directive from ${(m as any).from_email})`,
          rationale: `Requested via Atlas email directive.`,
          evidence, confidence: 0.9, status: "pending",
        });
      }
      // deal_add if deal named but not found
      if (parsed.deal_name && !dealMatch) {
        inserts.push({
          partner_id: null, deal_id: null, engagement_id: null,
          type: "deal_add", field: null, current_value: null,
          proposed_value: { property_name: parsed.deal_name, source: "atlas" },
          summary: `Create deal "${parsed.deal_name}" (Atlas directive from ${(m as any).from_email})`,
          rationale: `Requested via Atlas email directive.`,
          evidence, confidence: 0.9, status: "pending",
        });
      }

      // attach_email suggestion — bind existing ids where we have them; carry names for new records.
      const targetBits: string[] = [];
      if (partnerMatch) targetBits.push(`partner ${partnerMatch.name}`);
      else if (parsed.partner_name) targetBits.push(`new partner "${parsed.partner_name}"`);
      if (dealMatch) targetBits.push(`deal ${dealMatch.property_name}`);
      else if (parsed.deal_name) targetBits.push(`new deal "${parsed.deal_name}"`);

      const subject = (m as any).subject || "(no subject)";
      inserts.push({
        partner_id: partnerMatch?.id || null,
        deal_id: dealMatch?.id || null,
        engagement_id: null,
        type: "attach_email", field: null, current_value: null,
        proposed_value: {
          partner_id: partnerMatch?.id || null,
          partner_name: partnerMatch?.name || parsed.partner_name || null,
          deal_id: dealMatch?.id || null,
          deal_name: dealMatch?.property_name || parsed.deal_name || null,
          subject,
          body_html: chainHtml,
          body_text: chainText,
          email_date: (m as any).received_at || new Date().toISOString(),
          message_ids: messageIds,
          needs_partner_create: !!(parsed.partner_name && !partnerMatch),
          needs_deal_create: !!(parsed.deal_name && !dealMatch),
        },
        summary: `Attach email chain "${subject}" to ${targetBits.join(" and ")}`,
        rationale: `Atlas directive from ${(m as any).from_email}: "${((m as any).preview || "").slice(0, 200)}"`,
        evidence, confidence: 0.9, status: "pending",
      });

      const { error: insErr } = await supabase.from("partner_suggestions").insert(inserts);
      if (insErr) { console.error("directive insert error", insErr); continue; }
      totalSuggestions += inserts.length;
      directivesHandled++;
      directiveHandledIds.add((m as any).id);
      await supabase.from("outlook_messages").update({ analyzed_at: new Date().toISOString() }).eq("id", (m as any).id);
      totalAnalyzed++;
    }

    // Close out every message this run considered but will not process further:
    //  - directive candidates we spent an LLM call on that produced no directive
    //  - unattributed messages the standard pass can never see (it requires partner_id)
    // Assigning a partner in the Unattributed tab resets analyzed_at to null, so these
    // remain reachable the moment a human attributes them.
    const closeOutIds = (allMessages || [])
      .filter((m: any) =>
        !directiveHandledIds.has(m.id) &&
        (directiveCheckedIds.has(m.id) || !m.partner_id))
      .map((m: any) => m.id);

    if (closeOutIds.length) {
      await supabase
        .from("outlook_messages")
        .update({ analyzed_at: new Date().toISOString() })
        .in("id", closeOutIds);
    }

    // Remaining messages for the standard partner-attached pass
    const messages = (allMessages || []).filter((m: any) => m.partner_id && !directiveHandledIds.has(m.id));
    if (messages.length === 0) {
      return new Response(JSON.stringify({
        ok: true, analyzed: totalAnalyzed, suggestions: totalSuggestions, threads: 0,
        directives: directivesHandled,
        directive_calls: directiveCheckedIds.size, closed_out: closeOutIds.length,
        outbound_only_threads: outboundOnlyThreads,
        window_days: sinceDays,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Group by partner then by thread (conversation_id fallback to message id)
    const byPartner = new Map<string, typeof messages>();
    for (const m of messages) {
      if (!m.partner_id) continue;
      const arr = byPartner.get(m.partner_id) || [];
      arr.push(m); byPartner.set(m.partner_id, arr as any);
    }



    for (const [partnerId, msgs] of byPartner) {
      const [pRes, eRes, sRes, rejRes, cRes] = await Promise.all([
        supabase.from("partners").select("*").eq("id", partnerId).maybeSingle(),
        supabase.from("capital_raise_engagements")
          .select("id, deal_id, stage, indicated_amount, committed_amount, notes, deals(id,property_name)")
          .eq("partner_id", partnerId),
        supabase.from("partner_suggestions")
          .select("id, field, type, proposed_value")
          .eq("partner_id", partnerId).eq("status", "pending"),
        supabase.from("partner_suggestions")
          .select("field, type, proposed_value")
          .eq("partner_id", partnerId).eq("status", "rejected")
          .gte("reviewed_at", new Date(Date.now() - 60 * 86400_000).toISOString()),
        supabase.from("partner_contacts")
          .select("id, name, email, phone, role, linkedin_url, firm_location")
          .eq("partner_id", partnerId),
      ]);
      if (pRes.error || !pRes.data) continue;
      const partner = pRes.data;
      const engagements = (eRes.data || []).filter((e: any) => e.stage !== "passed" && e.stage !== "committed");
      const manualFields: string[] = partner.manual_fields || [];
      const partnerContacts: ContactRow[] = (cRes.data || []) as ContactRow[];
      const contactFirmDomains = firmDomainsFromContacts(partnerContacts);

      const pendingByKey = new Map<string, string>(); // key -> id (for supersede)
      for (const s of (sRes.data || []) as any[]) {
        const k = `${s.type}|${s.field || ""}`;
        pendingByKey.set(k, s.id);
      }
      const rejectedSet = new Set(
        ((rejRes.data || []) as any[]).map((s) =>
          `${s.type}|${s.field || ""}|${JSON.stringify(s.proposed_value)}`),
      );

      // Group messages by conversation
      const threads = new Map<string, typeof msgs>();
      for (const m of msgs) {
        const key = (m as any).conversation_id || (m as any).message_id;
        const arr = threads.get(key) || [];
        arr.push(m); threads.set(key, arr as any);
      }

      const allProposals: (Suggestion & { thread_deal_id?: string | null })[] = [];

      for (const [convId, threadMsgs] of threads) {
        threadMsgs.sort((a: any, b: any) => (a.received_at || "").localeCompare(b.received_at || ""));

        // Only the partner's own words can ground a profile change. A thread the partner
        // never spoke in can only produce suggestions grounded in our own speculation.
        const partnerMsgs = (threadMsgs as any[]).filter(
          (m: any) => domainOf(m.from_email) !== ANSONIA_DOMAIN,
        );
        if (partnerMsgs.length === 0) {
          outboundOnlyThreads++;
          continue; // analyzed_at is stamped for all of this partner's msgs at the end of the loop
        }

        threadsAnalyzed++;


        // Deal linking (subject+body match against active engagements' property_name)
        let threadDealId: string | null = null;
        let threadEngagementId: string | null = null;
        let dealConfidence = 0;

        const haystack = threadMsgs.map((m: any) =>
          `${m.subject || ""} ${(stripHtml(m.body_html) || m.body_text || m.preview || "").slice(0, 4000)}`).join(" ").toLowerCase();

        const engMatches = engagements.filter((e: any) => {
          const name = (e.deals?.property_name || "").toLowerCase().trim();
          return name && name.length >= 3 && haystack.includes(name);
        });
        if (engMatches.length === 1) {
          threadDealId = engMatches[0].deal_id;
          threadEngagementId = engMatches[0].id;
          dealConfidence = 0.95;
        } else if (engMatches.length === 0 && engagements.length === 1) {
          threadDealId = engagements[0].deal_id;
          threadEngagementId = engagements[0].id;
          dealConfidence = 0.8;
        } else if (engMatches.length > 1) {
          // AI will pick
          dealConfidence = 0;
        }

        // --- Harvest recipients on the firm's domain(s) as contact_add candidates ---
        // Build the domain set for this thread: partner-contact domains, else the dominant
        // non-Ansonia domain seen across from/to/cc in this thread.
        const threadPeople: Recipient[] = [];
        for (const m of threadMsgs as any[]) {
          if (m.from_email) {
            threadPeople.push({
              name: (typeof m.from_name === "string" && m.from_name.trim()) ? m.from_name.trim() : null,
              email: String(m.from_email).toLowerCase().trim(),
            });
          }
          for (const r of parseRecipients(m.to_recipients)) threadPeople.push(r);
          for (const r of parseRecipients(m.cc_recipients)) threadPeople.push(r);
        }

        let firmDomains = new Set(contactFirmDomains);
        if (firmDomains.size === 0) {
          const counts = new Map<string, number>();
          for (const p of threadPeople) {
            const d = domainOf(p.email);
            if (!d || d === ANSONIA_DOMAIN) continue;
            counts.set(d, (counts.get(d) || 0) + 1);
          }
          let bestDomain: string | null = null; let bestCount = 0;
          for (const [d, n] of counts) {
            if (n > bestCount) { bestDomain = d; bestCount = n; }
          }
          if (bestDomain) firmDomains.add(bestDomain);
        }

        const recipientCandidates: Suggestion[] = [];
        const seenEmails = new Set<string>();
        for (const p of threadPeople) {
          if (!p.email || seenEmails.has(p.email)) continue;
          const d = domainOf(p.email);
          if (!d || d === ANSONIA_DOMAIN) continue;
          if (!firmDomains.has(d)) continue;
          seenEmails.add(p.email);
          // Require a real display name with first+last — do NOT fall back to email local-part.
          const displayName = (typeof p.name === "string" && p.name.trim()) ? p.name.trim() : null;
          if (!displayName || !splitFullName(displayName)) continue;
          recipientCandidates.push({
            type: "contact_add",
            proposed_value: { name: displayName, email: p.email },
            summary: `Add ${displayName} — seen on thread as ${p.email}`,
            rationale: "Appeared as from/to/cc on this thread with the partner firm's email domain.",
            confidence: 0.8,
            evidence: { message_ids: threadMsgs.map((m: any) => m.message_id) },
          });
        }


        const firmDomainsArr = Array.from(firmDomains);
        // Feed the model the whole thread most-recent-first so newer context anchors the read.
        const slimAsc = threadMsgs.slice(-30).map((m: any) => ({
          message_id: m.message_id,
          speaker: domainOf(m.from_email) === ANSONIA_DOMAIN ? "ANSONIA" : "PARTNER",
          received_at: m.received_at,
          subject: m.subject,
          from: `${m.from_name || ""} <${m.from_email || ""}>`,
          to: parseRecipients(m.to_recipients).map(r => `${r.name || ""} <${r.email}>`),
          cc: parseRecipients(m.cc_recipients).map(r => `${r.name || ""} <${r.email}>`),
          body: (stripHtml(m.body_html) || m.body_text || m.preview || "").slice(0, 3000),
        }));
        const slim = [...slimAsc].reverse();

        const candidateEngagements = engMatches.length > 0 ? engMatches : engagements;

        const systemPrompt = `You review a THREAD of real-estate capital-raise emails (MOST RECENT FIRST) and propose changes for HUMAN APPROVAL. You NEVER apply changes.

BE THOROUGH: extract EVERY actionable item supported by the thread — do not stop at one. A substantive thread often yields multiple suggestions across different categories.

WHO IS SPEAKING — read this before extracting anything.
Every message carries \`speaker\`: "PARTNER" (someone at the partner firm) or "ANSONIA" (us).
- Facts about the partner — their capital, criteria, markets, strategy, people, warmth —
  may ONLY come from messages where speaker = "PARTNER".
- ANSONIA messages are CONTEXT ONLY. They tell you what was asked, what we sent, and what we
  believe. What an Ansonia colleague thinks or speculates about a partner is NOT evidence about
  that partner, no matter how confidently it is written.
- Your \`quote\` MUST be copied verbatim from a message where speaker = "PARTNER".
  A suggestion quoting an ANSONIA message is INVALID — omit it.
EXCEPTION — stage_change records an ACTION in the raise process, not a partner statement.
It may be grounded in an ANSONIA message (e.g. we sent materials). All other categories
require a PARTNER quote.



Return STRICT JSON:
{ "deal_pick": { "engagement_id": string|null, "confidence": number },
  "suggestions": [ ... ] }.

deal_pick — DEAL LINKING:
- Consider ALL candidate_engagements. Pick one when the thread references it by property name, address, market, unit count, or an unambiguous nickname — even if property_name is not a substring of the body. Return the engagement_id + confidence (0..1).
- If truly ambiguous or off-topic, return null.

Extraction categories (emit ANY that apply — never limit to one per thread):
1. warmth_change — signals of relationship temperature change (fast responses, meetings booked, warm intro, ghosting, cool tone). field="relationship_strength", value one of: ${WARMTH_VALUES.join(", ")}.
2. partner_field — updated preferences the partner states about themselves. field is an exact partners column: min_equity_m, max_equity_m (numeric $M), hold_period (array of strings like "5-7 yrs"), geography (array of markets), product_types (array: Multifamily, Industrial, Office, Retail, etc.), strategy_value_add | strategy_core_plus | strategy_workforce | strategy_affordable (boolean).
3. avoided_market_add — partner explicitly says they will NOT invest in a market/asset class. field="geography_avoid", value a market string or array.
4. stage_change — capital-raise stage progression on a resolved deal. field="stage", value one of: ${RAISE_STAGES.join(", ")}. Requires deal_pick.
5. contact_add — a NEW person at the partner firm (see contact rules below). Capture full detail: name, email, role/title, phone, firm/office location, linkedin_url — pull from email signature block whenever present.
6. contact_update — enrich or correct an EXISTING partner_contact (see contact rules below).
7. capital_status_change — the partner states anything about their ability to deploy capital
   right now. This is the HIGHEST-VALUE signal in this system: it determines whether we pitch
   them at all. field="capital_status".
   proposed_value: { "status": one of ${CAPITAL_STATUS_VALUES.join(" | ")},
                     "available_from": "YYYY-MM-DD" | null,
                     "detail": "<one clause in their own words>" }
   - "Out of Capital"      — fully allocated / no dry powder / cannot transact now.
   - "Constrained"         — limited capacity, needs something to happen first (a fund close,
                             an exit, an LP approval, board sign-off).
   - "Selective"           — has capital but a narrowed or raised bar.
   - "Actively Deploying"  — has capital and wants deals now.
   - Resolve relative dates against \`today\` and \`thread_latest_date\` from the payload.
     "end of the year"      -> Dec 31 of the current year
     "Q1"                   -> first day of that quarter
     "after our fund closes" with no date -> available_from: null (do NOT invent one)
   - Only emit when the partner says this about THEMSELVES. Never infer it from silence, from
     a decline on one deal, or from something an Ansonia teammate speculates.

8. profile_fact_add — a durable, decision-relevant fact about the partner that does NOT fit any
   column above. This is the catch-all that stops real signal from being dropped.
   proposed_value: { "fact": "<one self-contained sentence, written for a colleague who has
                              not read the email>",
                     "category": ${FACT_CATEGORIES.join(" | ")},
                     "fact_date": "YYYY-MM-DD" }
   Good: "Raising Fund IV, targeting a $400M first close in Q1 2027."
         "Dave Chen has taken over the Ansonia relationship from Sarah Liu, who left the firm."
         "Board has paused all new value-add commitments through the end of the fiscal year."
   Bad:  "They seem interested."            (not durable, not a fact)
         "Nice call today."                 (no decision value)
         "Their min check is $15M."         (that IS a column — use partner_field)
   - Never use this as an overflow bin for something a typed category can hold.
   - One fact per suggestion. Do not bundle three things into one sentence.



Each suggestion MUST include:
- type (one of the above)
- field (see per-type notes; omit for contact_*)
- proposed_value (typed per-field as above)
- current_value: the exact current value from partner/engagement/contact context (or null if none)
- summary: one short sentence a human can scan
- rationale: 1-2 sentences explaining WHY this evidence supports the change
- confidence: 0..1
- evidence: { "message_ids": [ one or more message_id from the thread ], "quote": "the exact verbatim sentence(s) from a message that justify this suggestion" }

HARD RULES — a suggestion is INVALID and MUST BE OMITTED if:
- You cannot cite an exact "quote" copied verbatim from the thread that grounds it.
- The \`quote\` does not appear verbatim in a PARTNER-sent message in this thread (stage_change excepted).
- The only support is an Ansonia colleague's characterisation of the partner
  ("I think they're...", "they seem to be...", "my sense is they've moved off...").
  Report what the partner said, never what we said about them.
- proposed_value equals current_value (no restatements, no no-ops).
- It duplicates an entry in existing_pending (same type+field+value).
- It contradicts a value in partner.manual_fields (HUMAN-LOCKED) unless the email is an unambiguous explicit override AND confidence >= 0.85.
- It is a stage_change without a resolved deal.
- The evidence is a weak inference (tone-only, name mentioned in prose without a signature block, third-party gossip).
- A capital_status_change or profile_fact_add without a verbatim \`quote\` is INVALID.
- Never emit profile_fact_add for information already captured by a column
  (check size, geography, product type, strategy, hold period, warmth, stage, contacts).


CONTACT proposals (from email signature blocks, headers, or explicit "loop in ..." lines):
- Use "contact_update" when the person MATCHES an existing partner_contact — MATCH BY EMAIL FIRST, then by NAME (case-insensitive; tolerant of middle initials and common nicknames: Sara↔Sarah, Bob↔Robert, Mike↔Michael, Cathy↔Catherine, etc.). Many existing contacts have only a name saved — a signature naming that person MUST attach to the existing row rather than create a duplicate.
  - proposed_value: { "contact_id": "<uuid of existing contact>", "contact_name": "<display name>", "fills": { field?: value }, "changes": { field: { "old": <current>, "new": <new> } } }
  - Put a field in "fills" ONLY when the existing value is null/empty.
  - Put a field in "changes" ONLY when the existing value differs; require confidence >= 0.8.
- Use "contact_add" ONLY for a NEW person who plainly works at this partner firm AND does NOT match any existing contact.
  - proposed_value: { "name": "<full name>", "email"?, "phone"?, "role"?, "linkedin_url"?, "firm_location"? } — populate every field you can read from the signature; a bare name is low value.
- Firm domains for this partner: ${firmDomainsArr.length ? firmDomainsArr.join(", ") : "none known"}.
- NEVER propose contacts for @ansoniaproperties.com addresses (that's us).
- The system separately harvests raw from/to/cc names on the firm domain; your job is to add the details raw headers can't: role, phone, linkedin, firm location.

Notes on noise reduction:
- Prefer FEWER, high-quality, well-grounded suggestions over many weak ones. If in doubt, OMIT.
- Never invent values. Never propose changes to Ansonia's writing style, tone, or internal process.`;

        const userPayload = {
          today: new Date().toISOString().slice(0, 10),
          thread_latest_date: (threadMsgs[threadMsgs.length - 1] as any)?.received_at?.slice(0, 10) ?? null,
          capital_status_values: CAPITAL_STATUS_VALUES,
          fact_categories: FACT_CATEGORIES,
          partner: {
            id: partner.id, name: partner.name,
            capital_status: (partner as any).capital_status ?? null,
            capital_available_from: (partner as any).capital_available_from ?? null,
            relationship_strength: partner.relationship_strength,
            min_equity_m: partner.min_equity_m, max_equity_m: partner.max_equity_m,
            hold_period: partner.hold_period, geography: partner.geography,
            geography_avoid: partner.geography_avoid, product_types: partner.product_types,
            strategy_value_add: partner.strategy_value_add,
            strategy_core_plus: partner.strategy_core_plus,
            strategy_workforce: partner.strategy_workforce,
            strategy_affordable: partner.strategy_affordable,
            manual_fields: manualFields,
            additional_notes: partner.additional_notes,
          },
          existing_contacts: partnerContacts.map(c => ({
            id: c.id, name: c.name, email: c.email, phone: c.phone,
            role: c.role, linkedin_url: c.linkedin_url, firm_location: c.firm_location,
          })),
          candidate_engagements: candidateEngagements.map((e: any) => ({
            engagement_id: e.id, deal_id: e.deal_id,
            property_name: e.deals?.property_name, stage: e.stage,
            indicated_amount: e.indicated_amount, committed_amount: e.committed_amount,
          })),
          raise_stages: RAISE_STAGES,
          warmth_values: WARMTH_VALUES,
          existing_pending: (sRes.data || []).map((s: any) => ({ type: s.type, field: s.field, proposed_value: s.proposed_value })),
          firm_domains: firmDomainsArr,
          thread: { conversation_id: convId, messages: slim },
          preresolved: threadDealId ? { engagement_id: threadEngagementId, deal_confidence: dealConfidence } : null,
        };

        let aiJson: { suggestions?: Suggestion[]; deal_pick?: any } | null = null;
        try {
          // Claude Opus 5 primary, gateway fallback — see _shared/ai.ts.
          const { parsed } = await completeJSON<{ suggestions?: Suggestion[]; deal_pick?: any }>(
            JSON.stringify(userPayload),
            { system: systemPrompt, maxTokens: 8000 },
          );
          aiJson = parsed;
        } catch (e) { console.error("AI parse error", e); continue; }

        // Resolve deal via AI pick if needed
        if (!threadDealId && aiJson?.deal_pick?.engagement_id) {
          const pick = engagements.find((e: any) => e.id === aiJson!.deal_pick.engagement_id);
          if (pick && typeof aiJson.deal_pick.confidence === "number" && aiJson.deal_pick.confidence >= 0.6) {
            threadEngagementId = pick.id; threadDealId = pick.deal_id;
            dealConfidence = aiJson.deal_pick.confidence;
          }
        }

        // Write thread deal_id back onto messages
        if (threadDealId) {
          await supabase.from("outlook_messages")
            .update({ deal_id: threadDealId })
            .in("id", threadMsgs.map((m: any) => m.id));
        }

        const aiSuggestions = (aiJson?.suggestions || []) as Suggestion[];
        for (const raw of [...aiSuggestions, ...recipientCandidates]) {
          if (!raw || !raw.type) continue;
          const s: Suggestion = raw;
          if (s.type === "stage_change") {
            if (!threadDealId || !threadEngagementId) continue; // withhold when unclear
            s.deal_id = threadDealId; s.engagement_id = threadEngagementId;
            s.deal_confidence = dealConfidence;
          }

          // --- Resolve / route contact proposals against existing partner_contacts ---
          if (s.type === "contact_add" || s.type === "contact_update") {
            const pv: any = s.proposed_value || {};
            const proposedName: string = pv.name || pv.contact_name || "";
            const proposedEmailRaw: string | null =
              (typeof pv.email === "string" ? pv.email : (pv.changes?.email?.new || pv.fills?.email)) || null;
            const proposedEmail = proposedEmailRaw ? String(proposedEmailRaw).trim().toLowerCase() : null;

            // Ignore anyone with an Ansonia domain — never a partner contact
            if (proposedEmail && proposedEmail.endsWith("@ansoniaproperties.com")) continue;

            // STRONG match = same email (case-insensitive). Name-only similarity is NOT strong enough.
            const byEmail = findContactByEmail(partnerContacts, proposedEmail);
            const byName = !byEmail ? findContactByName(partnerContacts, proposedName) : null;

            // Assemble candidate new values from either shape
            const assembleProposals = (): Record<string, string> => {
              const proposals: Record<string, string> = {};
              const addOnly = (k: string, v: any) => {
                if (typeof v === "string" && v.trim()) proposals[k] = k === "email" ? v.trim().toLowerCase() : v.trim();
              };
              if (s.type === "contact_add") {
                for (const k of ["email","phone","role","linkedin_url","firm_location"]) addOnly(k, pv[k]);
              } else {
                for (const [k, v] of Object.entries(pv.fills || {})) addOnly(k, v);
                for (const [k, obj] of Object.entries(pv.changes || {})) addOnly(k, (obj as any)?.new);
              }
              return proposals;
            };

            if (byEmail) {
              // Strong identity match — safe to coerce into a contact_update on this row.
              const matched = byEmail;
              const current: Record<string, any> = {
                email: matched.email, phone: matched.phone, role: matched.role,
                linkedin_url: matched.linkedin_url, firm_location: matched.firm_location,
              };
              const proposals = assembleProposals();
              // Identity guard: never change email to a different address on an existing row.
              // (byEmail matched, so proposed email — if any — already equals current; drop it defensively.)
              if (proposals.email && current.email && proposals.email !== String(current.email).trim().toLowerCase()) {
                delete proposals.email;
              }
              const fills: Record<string, string> = {};
              const changes: Record<string, { old: any; new: string }> = {};
              for (const [k, newVal] of Object.entries(proposals)) {
                const cur = current[k];
                const curEmpty = cur === null || cur === undefined || (typeof cur === "string" && cur.trim() === "");
                if (curEmpty) {
                  fills[k] = newVal;
                } else {
                  const curNorm = String(cur).trim().toLowerCase();
                  const newNorm = String(newVal).trim().toLowerCase();
                  // Non-identity field changes are allowed; identity (email) is guarded above.
                  if (curNorm !== newNorm) changes[k] = { old: cur, new: newVal };
                }
              }
              if (Object.keys(fills).length === 0 && Object.keys(changes).length === 0) continue;

              s.type = "contact_update";
              s.field = `contact:${matched.id}`;
              s.current_value = { name: matched.name, ...current };
              s.proposed_value = {
                contact_id: matched.id,
                contact_name: matched.name || proposedName,
                ...(Object.keys(fills).length ? { fills } : {}),
                ...(Object.keys(changes).length ? { changes } : {}),
              };
              if (!s.summary) {
                const parts: string[] = [];
                if (Object.keys(fills).length) parts.push(`fill ${Object.keys(fills).join(", ")}`);
                if (Object.keys(changes).length) parts.push(`change ${Object.keys(changes).join(", ")}`);
                s.summary = `Update ${matched.name || "contact"} — ${parts.join("; ")}`;
              }
            } else if (s.type === "contact_update") {
              // AI proposed an update but no existing contact matched by email.
              // If a name lookalike exists, this is almost certainly a different person —
              // convert to a contact_add (when we have enough info) instead of overwriting anyone.
              if (!splitFullName(proposedName)) continue;
              const addPv: Record<string, any> = { name: proposedName };
              const proposals = assembleProposals();
              for (const [k, v] of Object.entries(proposals)) addPv[k] = v;
              s.type = "contact_add";
              s.proposed_value = addPv;
              s.field = `contact_add:${normalizeNameToken(proposedName)}`;
              if (byName) {
                s.summary = `Add ${proposedName} — possible duplicate of ${byName.name || "existing contact"} (different email)`;
              }
            } else {
              // contact_add path. Require a plausible full name (first + last).
              if (!splitFullName(proposedName)) continue;
              s.field = `contact_add:${normalizeNameToken(proposedName)}`;
              // Name-only lookalike with a DIFFERENT (or missing-on-existing) email → keep as add, flag for reviewer.
              if (byName) {
                const existingEmail = byName.email ? byName.email.toLowerCase().trim() : null;
                const looksDifferent = !proposedEmail || !existingEmail || proposedEmail !== existingEmail;
                if (looksDifferent) {
                  s.summary = `Add ${proposedName}${proposedEmail ? ` <${proposedEmail}>` : ""} — possible duplicate of ${byName.name || "existing contact"}; human review`;
                }
              }
            }
          }


          const evidence = s.evidence || {};
          evidence.message_ids = evidence.message_ids || threadMsgs.map((m: any) => m.message_id);
          s.evidence = evidence;
          allProposals.push(s);
        }
      } // threads

      // Collapse duplicates within run + apply gates + normalize + rejection filter + supersede
      const dedupKeys = new Set<string>();
      const inserts: any[] = [];
      const supersedeIds: string[] = [];

      // Snapshot current partner values for no-op detection
      const partnerCurrent: Record<string, any> = {
        relationship_strength: partner.relationship_strength,
        min_equity_m: partner.min_equity_m, max_equity_m: partner.max_equity_m,
        hold_period: partner.hold_period, geography: partner.geography,
        geography_avoid: partner.geography_avoid, product_types: partner.product_types,
        strategy_value_add: partner.strategy_value_add,
        strategy_core_plus: partner.strategy_core_plus,
        strategy_workforce: partner.strategy_workforce,
        strategy_affordable: partner.strategy_affordable,
      };
      const sameValue = (a: any, b: any): boolean => {
        if (a === b) return true;
        if (a == null || b == null) return a == null && b == null;
        if (Array.isArray(a) && Array.isArray(b)) {
          if (a.length !== b.length) return false;
          const na = [...a].map(x => String(x).toLowerCase()).sort();
          const nb = [...b].map(x => String(x).toLowerCase()).sort();
          return na.every((v, i) => v === nb[i]);
        }
        if (Array.isArray(b) && !Array.isArray(a)) return b.length === 1 && String(b[0]).toLowerCase() === String(a).toLowerCase();
        if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-6;
        return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
      };

      // Everything the PARTNER themself wrote in this batch — the only admissible evidence
      // for profile-facing suggestion types.
      const partnerCorpus = normalizeForMatch(
        (msgs as any[])
          .filter((m: any) => domainOf(m.from_email) !== ANSONIA_DOMAIN)
          .map((m: any) => stripHtml(m.body_html) || m.body_text || m.preview || "")
          .join(" \n "),
      );

      for (const s of allProposals) {
        const normalized = normalizeProposal(s.type, s.field || null, s.proposed_value);
        if (normalized === null || normalized === undefined) continue;

        const conf = typeof s.confidence === "number" ? s.confidence : 0;
        const gate = (MIN_CONF as any)[s.type] ?? 0.6;
        if (conf < gate) continue;

        // Require a grounded quote for every AI-proposed change (recipient harvester is exempt — it's structural).
        const isRecipientHarvest = s.type === "contact_add" && s.rationale?.startsWith("Appeared as from/to/cc");
        const quote = (s.evidence as any)?.quote;
        if (!isRecipientHarvest && (!quote || typeof quote !== "string" || quote.trim().length < 8)) continue;

        // The quote must be the partner's own words (stage_change records OUR action, so it's exempt).
        if (!isRecipientHarvest && PARTNER_VOICE_TYPES.has(s.type)) {
          const q = normalizeForMatch(String(quote));
          const probe = q.length > 60 ? q.slice(0, 60) : q;
          if (!partnerCorpus.includes(probe)) {
            console.log(`dropped ${s.type}: quote not found in partner-sent messages — "${String(quote).slice(0, 80)}"`);
            continue;
          }
        }


        // Skip no-op suggestions that merely restate the current value
        if (s.type === "warmth_change" && sameValue(normalized, partnerCurrent.relationship_strength)) continue;
        if (s.type === "partner_field" && s.field && sameValue(normalized, partnerCurrent[s.field])) continue;
        if (s.type === "avoided_market_add") {
          const existing: string[] = Array.isArray(partnerCurrent.geography_avoid) ? partnerCurrent.geography_avoid : [];
          const existingLower = new Set(existing.map((v) => String(v).toLowerCase()));
          const proposedArr = Array.isArray(normalized) ? normalized : [normalized];
          const anyNew = proposedArr.some((v: any) => !existingLower.has(String(v).toLowerCase()));
          if (!anyNew) continue;
        }
        if (s.type === "stage_change" && s.engagement_id) {
          const eng = engagements.find((e: any) => e.id === s.engagement_id);
          if (eng && sameValue(normalized, eng.stage)) continue;
        }
        if (s.type === "capital_status_change") {
          const n = normalized as any;
          const sameStatus = sameValue(n.status, (partner as any).capital_status);
          const sameDate = sameValue(n.available_from ?? null, (partner as any).capital_available_from ?? null);
          if (sameStatus && sameDate) continue;
          // field must be set so locking + superseding work.
          s.field = "capital_status";
        }
        if (s.type === "profile_fact_add") {
          // Append-only — never supersedes a prior fact.
          s.field = null;
        }



        const touchesLocked = !!s.field && manualFields.includes(s.field);
        if (touchesLocked && conf < LOCKED_MIN_CONF) continue;
        if (s.type === "contact_update" && (normalized as any)?.changes && Object.keys((normalized as any).changes).length > 0 && conf < CONTACT_UPDATE_CHANGE_CONF) continue;
        if (s.type === "stage_change" && !s.deal_id) continue;

        const rejKey = `${s.type}|${s.field || ""}|${JSON.stringify(normalized)}`;
        if (rejectedSet.has(rejKey)) continue;

        const dedupKey = `${s.type}|${s.field || ""}|${JSON.stringify(normalized)}|${s.engagement_id || ""}`;
        if (dedupKeys.has(dedupKey)) continue;
        dedupKeys.add(dedupKey);

        // Supersede any existing pending for same partner+type+field pair
        const pairKey = `${s.type}|${s.field || ""}`;
        const stale = pendingByKey.get(pairKey);
        if (stale) supersedeIds.push(stale);

        inserts.push({
          partner_id: partnerId,
          deal_id: s.deal_id || null,
          engagement_id: s.engagement_id || null,
          type: s.type,
          field: s.field || null,
          current_value: s.current_value ?? null,
          proposed_value: normalized,
          summary: s.summary || `${s.type} suggestion`,
          rationale: s.rationale || null,
          evidence: s.evidence || null,
          confidence: conf,
          deal_confidence: s.deal_confidence ?? null,
          signals: null,
          status: "pending",
        });
      }

      if (inserts.length) {
        const { data: inserted, error: insErr } = await supabase
          .from("partner_suggestions").insert(inserts).select("id, type, field");
        if (insErr) { console.error("insert suggestions error", insErr); }
        else {
          totalSuggestions += inserted?.length || 0;
          // Supersede stale: match by pair to newly inserted id
          if (supersedeIds.length && inserted) {
            const nowIso = new Date().toISOString();
            for (const staleId of supersedeIds) {
              // Find replacement — first insert with matching pair
              // We don't know pair mapping precisely without a re-query; mark all stale as superseded (they'll be replaced by the newest of same pair).
              await supabase.from("partner_suggestions")
                .update({ status: "superseded", superseded_by: inserted[0].id, reviewed_at: nowIso })
                .eq("id", staleId);
            }
          }
        }
      }

      const ids = msgs.map((m: any) => m.id);
      await supabase.from("outlook_messages").update({ analyzed_at: new Date().toISOString() }).in("id", ids);
      totalAnalyzed += ids.length;
    }

    return new Response(JSON.stringify({
      ok: true, analyzed: totalAnalyzed, suggestions: totalSuggestions,
      threads: threadsAnalyzed, partners: byPartner.size, directives: directivesHandled,
      directive_calls: directiveCheckedIds.size, closed_out: closeOutIds.length,
      outbound_only_threads: outboundOnlyThreads,
      window_days: sinceDays,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
