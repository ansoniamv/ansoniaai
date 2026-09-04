// summarize-partners — generates a stored 1-2 sentence profile summary per
// capital partner. COST DISCIPLINE: never called from a render path. Runs only
// on explicit invocation (single partner from the detail page, or a bulk
// "generate missing" admin action) and skips any partner whose source-field
// hash is unchanged. Never self-invokes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUserOrService, corsFor } from "../_shared/auth.ts";
import { logAiUsage } from "../_shared/logUsage.ts";
import { completeText } from "../_shared/ai.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";
const CONCURRENCY = 4;
const MAX_IDS_PER_CALL = 200;

const PROMPT_INSTRUCTION =
  "In 1-2 sentences, remind a real-estate acquisitions analyst who this capital partner is. " +
  "Cover what kind of firm it is, where it is based, who leads it, its cheque size, and its " +
  "investment strategy. Use only the facts provided. Do not speculate, do not add adjectives " +
  "like 'well-respected', and omit anything you were not given. Maximum 45 words.";

const PARTNER_FIELDS =
  "id, name, firm_type, investor_type, headquarters, min_equity_m, max_equity_m, " +
  "geography, geography_avoid, strategy_value_add, strategy_core_plus, strategy_workforce, " +
  "strategy_affordable, product_types, hold_period, additional_notes, organized_notes, " +
  "profile_summary, profile_summary_hash";

type ContactLite = { name: string | null; role: string | null };

async function sha256(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stable fingerprint over EXACTLY the inputs the prompt sees. */
function hashInput(p: any, contacts: ContactLite[]): string {
  return JSON.stringify({
    name: p.name ?? null,
    firm_type: p.firm_type ?? null,
    investor_type: p.investor_type ?? [],
    headquarters: p.headquarters ?? null,
    min_equity_m: p.min_equity_m ?? null,
    max_equity_m: p.max_equity_m ?? null,
    geography: p.geography ?? [],
    geography_avoid: p.geography_avoid ?? [],
    strategy_value_add: !!p.strategy_value_add,
    strategy_core_plus: !!p.strategy_core_plus,
    strategy_workforce: !!p.strategy_workforce,
    strategy_affordable: !!p.strategy_affordable,
    product_types: p.product_types ?? [],
    hold_period: p.hold_period ?? [],
    additional_notes: p.additional_notes ?? null,
    organized_notes: p.organized_notes ?? null,
    contacts: contacts.map((c) => [c.name ?? "", c.role ?? ""]),
  });
}

const list = (v: any): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];

function formatBand(min: any, max: any): string | null {
  const lo = typeof min === "number" ? min : null;
  const hi = typeof max === "number" ? max : null;
  if (lo != null && hi != null) return `$${lo}M–$${hi}M`;
  if (lo != null) return `$${lo}M+`;
  if (hi != null) return `up to $${hi}M`;
  return null;
}

function buildFacts(p: any, contacts: ContactLite[]): string {
  const lines: string[] = [`Firm: ${p.name}`];
  if (p.firm_type) lines.push(`Firm type: ${p.firm_type}`);
  const inv = list(p.investor_type);
  if (inv.length) lines.push(`Investor type: ${inv.join(", ")}`);
  if (p.headquarters) lines.push(`Headquarters: ${p.headquarters}`);
  const band = formatBand(p.min_equity_m, p.max_equity_m);
  if (band) lines.push(`Equity cheque size: ${band}`);
  const geo = list(p.geography);
  if (geo.length) lines.push(`Invests in: ${geo.join(", ")}`);
  const avoid = list(p.geography_avoid);
  if (avoid.length) lines.push(`Avoids: ${avoid.join(", ")}`);
  const strategies: string[] = [];
  if (p.strategy_value_add) strategies.push("Value-Add");
  if (p.strategy_core_plus) strategies.push("Core+");
  if (p.strategy_workforce) strategies.push("Workforce");
  if (p.strategy_affordable) strategies.push("Affordable");
  if (strategies.length) lines.push(`Strategies: ${strategies.join(", ")}`);
  const products = list(p.product_types);
  if (products.length) lines.push(`Product types: ${products.join(", ")}`);
  const holds = list(p.hold_period);
  if (holds.length) lines.push(`Hold period: ${holds.join(", ")}`);
  const people = contacts
    .filter((c) => c.name)
    .map((c) => (c.role ? `${c.name} (${c.role})` : String(c.name)));
  if (people.length) lines.push(`Contacts: ${people.join(", ")}`);
  const notes = [p.organized_notes, p.additional_notes].filter(Boolean).join("\n").trim();
  if (notes) lines.push(`Notes: ${notes.slice(0, 2000)}`);
  return lines.join("\n");
}

class GatewayError extends Error {
  status: number;
  creditLimit: boolean;
  constructor(status: number, body: string) {
    super(`Gateway ${status}: ${body.slice(0, 300)}`);
    this.status = status;
    this.creditLimit = status === 402 || status === 403 || /credit_limit_reached/i.test(body);
  }
}

// Routing and retries live in _shared/ai.ts — Claude Opus 5 primary, gateway fallback.
async function callLLM(prompt: string, ctx: { supabase: any; partner_id: string }): Promise<string> {
  // Floor the budget: Opus 5 thinking tokens share max_tokens.
  const res = await completeText(prompt, { maxTokens: 4000 });
  await logAiUsage(ctx.supabase, {
    function_name: "summarize-partners",
    model: res.model,
    provider: res.provider,
    usage: res.usage,
    partner_id: ctx.partner_id,
  });
  return res.text;
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    // Approved end user (UI buttons) OR a trusted service/cron caller.
    const auth = await requireUserOrService(req);
    if (auth && !auth.ok) return auth.response;

    let partnerIds: string[] | null = null;
    try {
      const body = await req.json();
      if (body?.partner_ids != null) {
        if (!Array.isArray(body.partner_ids) || !body.partner_ids.every((x: any) => typeof x === "string")) {
          return json({ error: "partner_ids must be an array of strings" }, 400);
        }
        partnerIds = body.partner_ids.slice(0, MAX_IDS_PER_CALL);
      }
    } catch {
      // Empty body = bulk run over all partners needing a summary.
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    let query = sb.from("partners").select(PARTNER_FIELDS);
    if (partnerIds && partnerIds.length > 0) query = query.in("id", partnerIds);
    else query = query.is("archived_at", null);
    const { data: partners, error: pErr } = await query;
    if (pErr) throw pErr;
    if (!partners?.length) return json({ ok: true, processed: 0, skipped: 0, failed: 0 });

    const ids = partners.map((p: any) => p.id);
    const { data: contactRows, error: cErr } = await sb
      .from("partner_contacts")
      .select("partner_id, name, role")
      .in("partner_id", ids)
      .order("name", { ascending: true });
    if (cErr) throw cErr;
    const contactsByPartner = new Map<string, ContactLite[]>();
    for (const c of contactRows ?? []) {
      const arr = contactsByPartner.get(c.partner_id) ?? [];
      arr.push({ name: c.name, role: c.role });
      contactsByPartner.set(c.partner_id, arr);
    }

    // Hash every candidate; skip unchanged. Hashing is cheap — LLM calls are not.
    type Work = { partner: any; hash: string };
    const queue: Work[] = [];
    let skipped = 0;
    for (const p of partners) {
      const hash = await sha256(hashInput(p, contactsByPartner.get(p.id) ?? []));
      if (p.profile_summary != null && p.profile_summary_hash === hash) {
        skipped++;
        continue;
      }
      queue.push({ partner: p, hash });
    }
    console.log(`[summarize-partners] ${queue.length} to process, ${skipped} skipped (unchanged)`);

    // Worker pool — bounded concurrency, no recursion, no self-invocation.
    let processed = 0;
    let failed = 0;
    let creditLimited = false;
    const worker = async () => {
      for (;;) {
        const item = queue.shift();
        if (!item || creditLimited) return;
        const { partner, hash } = item;
        try {
          const prompt = `${PROMPT_INSTRUCTION}\n\nFacts:\n${buildFacts(partner, contactsByPartner.get(partner.id) ?? [])}`;
          const summary = await callLLM(prompt, { supabase: sb, partner_id: partner.id });
          if (!summary) throw new Error("Empty summary from model");
          const { error: uErr } = await sb
            .from("partners")
            .update({
              profile_summary: summary,
              profile_summary_hash: hash,
              profile_summary_updated_at: new Date().toISOString(),
            })
            .eq("id", partner.id);
          if (uErr) throw uErr;
          processed++;
        } catch (e) {
          failed++;
          if (e instanceof GatewayError && e.creditLimit) {
            creditLimited = true; // stop burning retries when credits are exhausted
            console.error("[summarize-partners] credit limit reached — halting batch");
          } else {
            console.error(`[summarize-partners] partner ${partner.id} failed:`, (e as Error)?.message);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    return json({
      ok: true,
      processed,
      skipped,
      failed,
      ...(creditLimited ? { halted: "credit_limit_reached" } : {}),
    });
  } catch (e) {
    console.error("[summarize-partners] fatal:", (e as Error)?.message);
    return json({ error: (e as Error)?.message ?? "Internal error" }, 500);
  }
});
