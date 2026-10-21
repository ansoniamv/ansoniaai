// Picks a new deal's CoStar submarket so nobody has to.
//
// Called by the UI right after a deal is created (all three ways a deal reaches
// the Pipeline), and as a backfill for deals that predate it. Claude chooses
// from the deal's state's submarket list; see _shared/submarketPick.ts for why
// that is the right shape and what it refuses.
//
// It only ever fills a blank. A deal whose submarket a person set — or cleared
// — has costar_submarket_source = 'manual' and is never touched, and the write
// itself re-checks that the row is still undecided, so a pick made in the
// seconds this call takes is not overwritten.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsFor, requireUserOrService } from "../_shared/auth.ts";
import { completeText } from "../_shared/ai.ts";
import { logAiFailure, logAiUsage } from "../_shared/logUsage.ts";
import { errorResponse } from "../_shared/errors.ts";
import { SUBMARKET_MODEL } from "../_shared/featureModels.ts";
import {
  buildPrompt,
  candidatesFor,
  interpretPick,
  PICK_SCHEMA,
  shouldAssign,
  type SubmarketRow,
} from "../_shared/submarketPick.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEAL_COLUMNS =
  "id,property_name,address,property_address,city,state,zip,msa,latitude,longitude,costar_submarket_code,costar_submarket_source";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type Outcome =
  | { deal_id: string; status: "assigned"; code: string; name: string; confidence: string; reason: string }
  | { deal_id: string; status: "declined"; reason: string }
  | { deal_id: string; status: "skipped"; reason: string };

/** Every Combined-scope submarket. ~2,300 rows, paged because PostgREST caps a response at 1,000. */
async function loadSubmarkets(sb: any): Promise<SubmarketRow[]> {
  const out: SubmarketRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("costar_submarket_signals")
      .select("geography_code,geography_name,market_name,submarket_name,state")
      .eq("scope", "Combined")
      .order("geography_code")
      .range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function assignOne(sb: any, deal: any, all: SubmarketRow[]): Promise<Outcome> {
  if (deal.costar_submarket_code || deal.costar_submarket_source) {
    return { deal_id: deal.id, status: "skipped", reason: "already decided" };
  }
  const candidates = candidatesFor(deal, all);
  // No state and no recognisable metro: nothing to choose from. Left undecided,
  // not marked, so a backfill retries once someone fills the location in.
  if (!candidates.length) {
    return { deal_id: deal.id, status: "skipped", reason: "no state or metro to narrow by" };
  }

  let res;
  try {
    res = await completeText(buildPrompt(deal, candidates), {
      model: SUBMARKET_MODEL,
      maxTokens: 2000,
      effort: "low",
      timeoutMs: 45000,
      schema: PICK_SCHEMA,
      supabase: sb,
    });
  } catch (e) {
    await logAiFailure(sb, { function_name: "assign-submarket", model: SUBMARKET_MODEL, error: e, deal_id: deal.id });
    throw e;
  }
  await logAiUsage(sb, {
    function_name: "assign-submarket",
    model: res.model,
    provider: res.provider,
    usage: res.usage,
    deal_id: deal.id,
  });

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(res.text);
  } catch {
    // Schema-constrained output should always parse; if it doesn't, it's a decline.
  }
  const pick = interpretPick(parsed, candidates);
  const assign = shouldAssign(pick);

  // A declined pick is recorded too (source 'ai', code still null), so the
  // backfill does not pay to ask the same question again. The reason is what a
  // person reads to pick it themselves.
  const { data: written, error } = await sb
    .from("deals")
    .update({
      ...(assign ? { costar_submarket_code: pick.code } : {}),
      costar_submarket_source: "ai",
      costar_submarket_note: pick.reason || null,
    })
    .eq("id", deal.id)
    .is("costar_submarket_code", null)
    .is("costar_submarket_source", null)
    .select("id");
  if (error) throw error;
  if (!written?.length) return { deal_id: deal.id, status: "skipped", reason: "decided by someone meanwhile" };

  if (!assign) return { deal_id: deal.id, status: "declined", reason: pick.reason };
  const row = candidates.find((c) => c.geography_code === pick.code)!;
  return {
    deal_id: deal.id,
    status: "assigned",
    code: pick.code,
    name: row.geography_name,
    confidence: pick.confidence,
    reason: pick.reason,
  };
}

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authz = await requireUserOrService(req);
  if (authz && !authz.ok) return authz.response;

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));

    let deals: any[];
    if (body.deal_id !== undefined) {
      if (typeof body.deal_id !== "string" || !UUID_RE.test(body.deal_id)) throw new Error("deal_id must be a UUID");
      const { data, error } = await sb.from("deals").select(DEAL_COLUMNS).eq("id", body.deal_id).single();
      if (error) throw error;
      deals = [data];
    } else if (body.backfill === true) {
      // A backfill spends a call per deal, so from the UI it is an admin's button.
      if (authz) {
        const { data: isAdmin } = await sb.rpc("has_role", { _user_id: authz.user.id, _role: "admin" });
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: "Requires admin role" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      const limit = Math.min(Number(body.limit) || DEFAULT_LIMIT, MAX_LIMIT);
      const { data, error } = await sb
        .from("deals")
        .select(DEAL_COLUMNS)
        .is("costar_submarket_code", null)
        .is("costar_submarket_source", null)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      deals = data ?? [];
    } else {
      throw new Error("deal_id or backfill: true required");
    }

    const all = deals.length ? await loadSubmarkets(sb) : [];
    // No CoStar import loaded yet: nothing to pick from, and nothing marked.
    if (deals.length && !all.length) {
      return new Response(JSON.stringify({ results: [], note: "No CoStar submarkets loaded" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // One at a time: a backfill is nobody's wait, and serial calls keep the
    // budget check meaningful between them.
    const results: Outcome[] = [];
    for (const d of deals) {
      try {
        results.push(await assignOne(sb, d, all));
      } catch (e) {
        if (deals.length === 1) throw e;
        console.error(`[assign-submarket] ${d.id} failed`, e);
        results.push({ deal_id: d.id, status: "skipped", reason: (e as Error).message.slice(0, 200) });
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return errorResponse(e, corsHeaders, { fn: "assign-submarket", publicMessage: "Could not assign a submarket." });
  }
});
