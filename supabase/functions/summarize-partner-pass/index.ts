// summarize-partner-pass — why a capital partner passed on a deal, in one line,
// and what that pass says about their criteria.
//
// Reads the analyst's pass notes and the partner's emails about the deal,
// writes capital_raise_engagements.pass_summary, and turns a standing
// preference the partner stated ("we don't do suburban Chicago", "$50M
// minimum", "no equity until our next fund") into a partners criteria change.
// The same ownership rules as enrich-partner-from-notes apply: a value needs a
// verbatim quote, a field a person owns becomes a partner_suggestions row
// instead, and information older than what a field already rests on is ignored.
//
// Body: { engagement_id } (queued by the pass trigger), { partner_id }, or {}
// for the nightly sweep over every pass. Unchanged inputs are skipped by hash;
// { force: true } re-runs anyway; { dry_run: true } returns what it would
// write without writing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { completeText } from "../_shared/ai.ts";
import { BudgetExceededError } from "../_shared/aiBudget.ts";
import { corsFor, requireUserOrService } from "../_shared/auth.ts";
import { PARTNER_MODEL } from "../_shared/featureModels.ts";
import { logAiFailure, logAiUsage } from "../_shared/logUsage.ts";
import {
  buildPrompt, dealFacts, emailText, planUpdates, quoteHolds, sourceTexts, stripHtml, mentionsDeal,
  ANSONIA_DOMAIN, SCHEMA, type Email, type ModelOut,
} from "../_shared/passSummary.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNCTION_NAME = "summarize-partner-pass";

/** Bump when the prompt changes so the sweep re-summarizes every pass. */
const PROMPT_VERSION = 1;
/** Model calls per sweep run; the rest are picked up the next night. */
const SWEEP_LIMIT = 30;
const CONCURRENCY = 3;
const MAX_EMAILS = 10;
const EMAIL_CHARS = 1500;

type Outcome = { engagement_id: string; status: "summarized" | "unchanged" | "skipped" | "error"; reason?: string; preview?: unknown };
type RunOpts = { force: boolean; dry: boolean; priority: "interactive" | "background" };

async function sha256(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadEmails(sb: any, partnerId: string, deal: any): Promise<Email[]> {
  const { data, error } = await sb
    .from("outlook_messages")
    .select("id, conversation_id, deal_id, from_email, subject, body_html, preview, received_at, sent_at")
    .eq("partner_id", partnerId)
    .order("received_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  const rows = (data ?? []) as any[];
  // Matching reads the whole body, quoted thread included: a short reply
  // often names the deal only in the message it quotes.
  const hit = rows.filter((m) =>
    m.deal_id === deal.id ||
    mentionsDeal(`${m.subject ?? ""}\n${m.body_html ? stripHtml(m.body_html) : m.preview ?? ""}`, deal.property_name ?? "")
  );
  // Whole conversations: a reply often drops the property name from its body.
  const convs = new Set(hit.map((m) => m.conversation_id).filter(Boolean));
  const picked = rows.filter((m) => hit.includes(m) || (m.conversation_id && convs.has(m.conversation_id)));
  // Partner-sent first, then newest: the reason is in what they wrote.
  const ordered = picked
    .map((m) => ({ m, partner: !String(m.from_email ?? "").toLowerCase().endsWith(ANSONIA_DOMAIN) }))
    .sort((a, b) => Number(b.partner) - Number(a.partner) || String(b.m.received_at ?? "").localeCompare(String(a.m.received_at ?? "")))
    .slice(0, MAX_EMAILS);
  return ordered
    .map(({ m, partner }) => ({
      id: m.id as string,
      date: (m.received_at ?? m.sent_at ?? null) as string | null,
      from: m.from_email ?? null,
      partner_sent: partner,
      subject: String(m.subject ?? "").slice(0, 200),
      body: emailText(m).slice(0, EMAIL_CHARS),
    }))
    .sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
}

/** When the pass happened: the latest move to Passed, else the row's last edit. */
async function passDate(sb: any, e: any): Promise<string> {
  const { data } = await sb
    .from("stage_change_events")
    .select("created_at")
    .eq("engagement_id", e.id)
    .eq("to_stage", "passed")
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0]?.created_at ?? e.updated_at;
}

async function summarizeOne(sb: any, engagementId: string, opts: RunOpts): Promise<Outcome> {
  // A dry run reads and calls the model but writes nothing, and works before
  // the migration adds the pass_summary columns.
  const markDone = async (id: string) => {
    if (!opts.dry) await sb.from("capital_raise_engagements").update({ pass_summary_pending: false }).eq("id", id);
  };
  const { data: e, error } = await sb
    .from("capital_raise_engagements")
    .select("id, partner_id, deal_id, stage, removed_at, pass_feedback, pass_category, pass_price_surmountable, updated_at, deal:deals(id, property_name, city, state, msa, unit_count, asking_price, estimated_equity, in_place_cap_rate)" + (opts.dry ? "" : ", pass_summary_hash"))
    .eq("id", engagementId)
    .maybeSingle();
  if (error) throw error;
  if (!e) return { engagement_id: engagementId, status: "skipped", reason: "not found" };
  if (e.stage !== "passed" || e.removed_at) {
    await markDone(e.id);
    return { engagement_id: e.id, status: "skipped", reason: "not passed" };
  }

  const { data: partner, error: pErr } = await sb.from("partners").select("*").eq("id", e.partner_id).maybeSingle();
  if (pErr) throw pErr;
  if (!partner || !e.deal) return { engagement_id: e.id, status: "skipped", reason: "partner or deal missing" };

  const notes = stripHtml(e.pass_feedback ?? "");
  const emails = await loadEmails(sb, partner.id, e.deal);
  const hash = await sha256(JSON.stringify({
    v: PROMPT_VERSION,
    notes,
    category: e.pass_category ?? null,
    surmountable: !!e.pass_price_surmountable,
    emails: emails.map((m) => m.id),
    deal: dealFacts(e.deal),
  }));
  if (!opts.force && e.pass_summary_hash === hash) {
    await markDone(e.id);
    return { engagement_id: e.id, status: "unchanged" };
  }

  let out: ModelOut;
  try {
    const res = await completeText(buildPrompt(e.deal, partner, notes, e.pass_category, emails), {
      model: PARTNER_MODEL,
      maxTokens: 4000,
      timeoutMs: 60000,
      schema: SCHEMA,
      priority: opts.priority,
      supabase: sb,
    });
    await logAiUsage(sb, { function_name: FUNCTION_NAME, model: res.model, provider: res.provider, usage: res.usage, deal_id: e.deal_id, partner_id: partner.id });
    out = JSON.parse(res.text) as ModelOut;
  } catch (err) {
    if (!(err instanceof BudgetExceededError)) {
      await logAiFailure(sb, { function_name: FUNCTION_NAME, model: PARTNER_MODEL, error: err, deal_id: e.deal_id, partner_id: partner.id });
    }
    await markDone(e.id);
    throw err;
  }

  const texts = sourceTexts(notes, emails);
  // A "partner" reason must really be in their words; without that it is an
  // inference at best, and is labelled as one.
  let basis = out.basis;
  let evidence: any = null;
  if (basis === "partner") {
    if (quoteHolds(out.quote, out.source, texts)) {
      evidence = { quote: out.quote!.slice(0, 500), source: out.source, date: texts.get(out.source!)!.date };
    } else {
      basis = "inferred";
    }
  }
  let summary = String(out.summary ?? "").trim().slice(0, 240);
  if (basis === "inferred" && !/^likely\b/i.test(summary)) summary = `Likely: ${summary}`;
  if (basis === "unknown" || !summary) summary = "No reason recorded.";

  const passAt = await passDate(sb, e);
  const plan = planUpdates(partner, out.criteria_updates ?? [], texts, passAt, { deal_id: e.deal_id, engagement_id: e.id });

  if (opts.dry) {
    return {
      engagement_id: e.id,
      status: "summarized",
      preview: { deal: e.deal.property_name, summary, basis, evidence, updates: plan.records, write: plan.write, suggestions: plan.suggestions, emails: emails.length },
    };
  }

  if (Object.keys(plan.write).length) {
    const { error: wErr } = await sb.from("partners").update(plan.write).eq("id", partner.id);
    if (wErr) throw wErr;
  }

  if (plan.suggestions.length) {
    // One suggestion per pass and value, ever: a rejected one stays rejected.
    const { data: existing } = await sb
      .from("partner_suggestions")
      .select("type, field, proposed_value")
      .eq("partner_id", partner.id)
      .eq("engagement_id", e.id);
    const seen = new Set((existing ?? []).map((s: any) => `${s.type}|${s.field}|${JSON.stringify(s.proposed_value)}`));
    const rows = plan.suggestions
      .filter((s) => !seen.has(`${s.type}|${s.field}|${JSON.stringify(s.proposed_value)}`))
      .map((s) => ({
        ...s,
        partner_id: partner.id,
        deal_id: e.deal_id,
        engagement_id: e.id,
        summary: `${s.summary} (from their pass on ${e.deal.property_name})`,
        rationale: "Stated when they passed on this deal; the field is owned by a person, so it needs a review.",
        confidence: 0.8,
        status: "pending",
      }));
    if (rows.length) {
      const { error: sErr } = await sb.from("partner_suggestions").insert(rows);
      if (sErr) console.error("partner_suggestions insert failed", sErr);
    }
  }

  const { error: uErr } = await sb.from("capital_raise_engagements").update({
    pass_summary: summary,
    pass_summary_basis: basis,
    pass_summary_evidence: evidence,
    pass_summary_updates: plan.records,
    pass_summary_hash: hash,
    pass_summary_at: new Date().toISOString(),
    pass_summary_pending: false,
  }).eq("id", e.id);
  if (uErr) throw uErr;

  // The profile summary reads these fields; refresh it while we're here.
  if (Object.keys(plan.write).length) {
    await fetch(`${SUPABASE_URL}/functions/v1/summarize-partners`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ partner_ids: [partner.id] }),
    }).catch((err) => console.error("summarize-partners refresh failed", err));
  }

  return { engagement_id: e.id, status: "summarized" };
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const auth = await requireUserOrService(req);
  if (auth && !auth.ok) return auth.response;

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body = sweep */ }
  const force = body?.force === true;
  const dry = body?.dry_run === true;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    if (typeof body?.engagement_id === "string") {
      const r = await summarizeOne(sb, body.engagement_id, { force, dry, priority: "interactive" });
      return json({ ok: true, results: [r] });
    }

    let q = sb.from("capital_raise_engagements").select("id, partner_id").eq("stage", "passed").is("removed_at", null).limit(500);
    if (typeof body?.partner_id === "string") q = q.eq("partner_id", body.partner_id);
    const { data, error } = await q;
    if (error) throw error;

    // One worker per partner, so two passes never read-modify-write the same
    // partners row at once.
    const byPartner = new Map<string, string[]>();
    for (const r of (data ?? []) as any[]) byPartner.set(r.partner_id, [...(byPartner.get(r.partner_id) ?? []), r.id]);
    const queues = [...byPartner.values()];
    const results: Outcome[] = [];
    let calls = 0;
    let stop = false;
    const priority = body?.partner_id ? "interactive" : "background";

    const worker = async () => {
      while (queues.length && !stop) {
        const ids = queues.shift()!;
        for (const id of ids) {
          if (stop || calls >= SWEEP_LIMIT) { stop = true; break; }
          try {
            const r = await summarizeOne(sb, id, { force, dry, priority });
            if (r.status === "summarized") calls++;
            results.push(r);
          } catch (err) {
            if (err instanceof BudgetExceededError) stop = true;
            results.push({ engagement_id: id, status: "error", reason: String((err as any)?.message ?? err).slice(0, 200) });
          }
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const count = (s: Outcome["status"]) => results.filter((r) => r.status === s).length;
    return json({
      ok: true,
      total: data?.length ?? 0,
      summarized: count("summarized"),
      unchanged: count("unchanged"),
      errors: results.filter((r) => r.status === "error"),
      ...(dry ? { previews: results.map((r) => r.preview).filter(Boolean) } : {}),
      stopped_early: stop,
    });
  } catch (err: any) {
    const status = err instanceof BudgetExceededError ? 429 : 500;
    return json({ ok: false, error: String(err?.message ?? err) }, status);
  }
});
