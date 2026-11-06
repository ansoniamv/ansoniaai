// read-partner-strategies — reads each capital partner's notes and rates every
// strategy bucket (dedicated / active / open / none / avoids) with the line it
// relied on. Feeds the Capital Intelligence page.
//
// COST DISCIPLINE: never called from a render path. Runs only when someone
// clicks Refresh on Capital Intelligence (or a single partner is passed), and
// skips every partner whose notes are unchanged since the last read. A full
// first read of ~210 partners with notes is a few dollars on Sonnet; after that
// only edited notes are re-read. Interactive priority, so the day cap that
// pauses background work does not refuse a click.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUserOrService, corsFor } from "../_shared/auth.ts";
import { logAiFailure, logAiUsage } from "../_shared/logUsage.ts";
import { completeText } from "../_shared/ai.ts";
import { BudgetExceededError } from "../_shared/aiBudget.ts";
import { PARTNER_MODEL } from "../_shared/featureModels.ts";
import { buildReadPrompt, interpretReads, notesText, READ_SCHEMA } from "../_shared/strategyRead.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CONCURRENCY = 4;
const MAX_IDS_PER_CALL = 300;
// Edge functions are cut off at ~150s; stop taking new work well before that and
// report how many are left, so the page can call again.
const TIME_BUDGET_MS = 110_000;

type PartnerRow = {
  id: string;
  name: string;
  organized_notes: string | null;
  additional_notes: string | null;
};

async function sha256(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const started = Date.now();
  try {
    const auth = await requireUserOrService(req);
    if (auth && !auth.ok) return auth.response;

    let partnerIds: string[] | null = null;
    try {
      const body = await req.json();
      if (body?.partner_ids != null) {
        if (!Array.isArray(body.partner_ids) || !body.partner_ids.every((x: unknown) => typeof x === "string")) {
          return json({ error: "partner_ids must be an array of strings" }, 400);
        }
        partnerIds = body.partner_ids.slice(0, MAX_IDS_PER_CALL);
      }
    } catch {
      // Empty body = every active partner whose notes changed.
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    let query = sb.from("partners").select("id, name, organized_notes, additional_notes");
    if (partnerIds?.length) query = query.in("id", partnerIds);
    else query = query.is("archived_at", null).is("blacklisted_at", null);
    const { data: partners, error: pErr } = await query.returns<PartnerRow[]>();
    if (pErr) throw pErr;

    const { data: existing, error: eErr } = await sb.from("partner_strategy_reads").select("partner_id, notes_hash");
    if (eErr) throw eErr;
    const prevHash = new Map((existing ?? []).map((r: any) => [r.partner_id, r.notes_hash]));

    type Work = { partner: PartnerRow; notes: string; hash: string };
    const queue: Work[] = [];
    let skipped = 0;
    let noNotes = 0;
    for (const p of partners ?? []) {
      const notes = notesText(p);
      const hash = await sha256(notes);
      if (prevHash.get(p.id) === hash) { skipped++; continue; }
      if (!notes) {
        // Nothing to read: record an empty read so the page shows "no notes"
        // rather than "not read yet", without paying for a call.
        const { error } = await sb.from("partner_strategy_reads").upsert({
          partner_id: p.id, reads: {}, notes_hash: hash, model: null, read_at: new Date().toISOString(),
        });
        if (error) throw error;
        noNotes++;
        continue;
      }
      queue.push({ partner: p, notes, hash });
    }
    console.log(`[read-partner-strategies] ${queue.length} to read, ${skipped} unchanged, ${noNotes} without notes`);

    let processed = 0;
    let failed = 0;
    let quotesDropped = 0;
    let halted: string | null = null;
    const worker = async () => {
      for (;;) {
        if (halted || Date.now() - started > TIME_BUDGET_MS) return;
        const item = queue.shift();
        if (!item) return;
        const { partner, notes, hash } = item;
        try {
          let res;
          try {
            res = await completeText(buildReadPrompt(partner.name, notes), {
              model: PARTNER_MODEL,
              maxTokens: 4000,
              effort: "low",
              timeoutMs: 60000,
              schema: READ_SCHEMA,
              priority: "interactive",
              supabase: sb,
            });
          } catch (e) {
            await logAiFailure(sb, { function_name: "read-partner-strategies", model: PARTNER_MODEL, error: e, partner_id: partner.id });
            throw e;
          }
          await logAiUsage(sb, {
            function_name: "read-partner-strategies",
            model: res.model,
            provider: res.provider,
            usage: res.usage,
            partner_id: partner.id,
          });
          const { reads, dropped } = interpretReads(JSON.parse(res.text), notes);
          quotesDropped += dropped.length;
          if (dropped.length) {
            console.warn(`[read-partner-strategies] ${partner.name}: no matching quote for ${dropped.join(", ")}; set to none`);
          }
          const { error: uErr } = await sb.from("partner_strategy_reads").upsert({
            partner_id: partner.id,
            reads,
            notes_hash: hash,
            model: res.model,
            read_at: new Date().toISOString(),
          });
          if (uErr) throw uErr;
          processed++;
        } catch (e) {
          failed++;
          if (e instanceof BudgetExceededError) {
            halted = e.message;
          } else {
            console.error(`[read-partner-strategies] ${partner.name} failed:`, (e as Error)?.message);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    return json({
      ok: true,
      processed,
      skipped,
      no_notes: noNotes,
      failed,
      quotes_dropped: quotesDropped,
      remaining: queue.length,
      ...(halted ? { halted } : {}),
    });
  } catch (e) {
    console.error("[read-partner-strategies] fatal:", (e as Error)?.message);
    return json({ error: (e as Error)?.message ?? "Internal error" }, 500);
  }
});
