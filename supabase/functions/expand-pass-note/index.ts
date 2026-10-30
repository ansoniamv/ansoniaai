// Expands an analyst's short pass note on a capital-raise engagement.
//
// The analyst writes what the partner said in a few words; this returns a
// sentence or two that spells out what they meant, with the deal facts that
// make it concrete. Nothing is saved here: the analyst sees the expansion and
// chooses to use it. The note is sent in the request (not read from the row)
// because the pass dialog has not saved it yet.
import { completeText } from "../_shared/ai.ts";
import { logAiFailure, logAiUsage } from "../_shared/logUsage.ts";
import { corsFor, requireApprovedUser } from "../_shared/auth.ts";
import { errorResponse } from "../_shared/errors.ts";
import { PASS_NOTE_MODEL } from "../_shared/featureModels.ts";
import {
  buildExpandPrompt,
  dealFactsLines,
  noteHtmlToText,
  partnerFactsLines,
  readExpansion,
} from "../_shared/passNoteExpand.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NOTE_CHARS = 2000;

const DEAL_FIELDS = [
  "property_name", "city", "state", "msa", "unit_count", "vintage_year",
  "asking_price", "estimated_equity", "target_raise", "in_place_cap_rate",
  "stabilized_cap_rate", "year1_coc", "projected_irr", "equity_multiple",
  "hold_period_years", "occupancy_pct", "value_add_potential", "affordable",
].join(", ");

const PARTNER_FIELDS = "name, firm_type, investor_type, min_equity_m, max_equity_m, geography";

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authz = await requireApprovedUser(req);
  if (!authz.ok) return authz.response;
  const sb = authz.admin;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { engagement_id, note, category, price_surmountable } = await req.json();
    if (typeof engagement_id !== "string" || !UUID_RE.test(engagement_id)) {
      throw new Error("engagement_id must be a UUID");
    }
    const noteText = typeof note === "string" ? noteHtmlToText(note).slice(0, MAX_NOTE_CHARS) : "";
    if (!noteText) return json({ error: "Write the note first, then expand it." }, 400);

    const { data: eng, error: eErr } = await sb
      .from("capital_raise_engagements")
      .select("deal_id, partner_id, pass_category, pass_price_surmountable")
      .eq("id", engagement_id)
      .maybeSingle();
    if (eErr) throw eErr;
    if (!eng) return json({ error: "Engagement not found." }, 404);

    const [{ data: deal, error: dErr }, { data: partner, error: pErr }] = await Promise.all([
      eng.deal_id
        ? sb.from("deals").select(DEAL_FIELDS).eq("id", eng.deal_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      sb.from("partners").select(PARTNER_FIELDS).eq("id", eng.partner_id).maybeSingle(),
    ]);
    if (dErr) throw dErr;
    if (pErr) throw pErr;

    const dealFacts = deal ? dealFactsLines(deal as unknown as Record<string, unknown>) : [];
    const partnerFacts = partner ? partnerFactsLines(partner as unknown as Record<string, unknown>) : [];
    const prompt = buildExpandPrompt({
      note: noteText,
      partnerName: (partner as { name?: string } | null)?.name ?? "the partner",
      // The dialog sends what is picked now; the row has what was saved.
      category: typeof category === "string" && category.trim() ? category.trim() : eng.pass_category,
      priceSurmountable: typeof price_surmountable === "boolean" ? price_surmountable : !!eng.pass_price_surmountable,
      dealFacts,
      partnerFacts,
    });

    let res;
    try {
      res = await completeText(prompt, {
        model: PASS_NOTE_MODEL,
        maxTokens: 1000,
        effort: "low",
        timeoutMs: 30000,
        priority: "interactive",
        supabase: sb,
      });
    } catch (e) {
      await logAiFailure(sb, { function_name: "expand-pass-note", model: PASS_NOTE_MODEL, error: e });
      throw e;
    }
    await logAiUsage(sb, {
      function_name: "expand-pass-note",
      model: res.model,
      provider: res.provider,
      usage: res.usage,
    });

    const result = readExpansion(res.text, [noteText, ...dealFacts, ...partnerFacts]);
    if (!result.ok) {
      console.warn("expand-pass-note rejected:", result.reason, res.text.slice(0, 500));
      return json({ error: "Couldn't expand this note without adding facts we don't have. Try adding a bit more detail." }, 422);
    }
    return json({ expanded: result.text });
  } catch (e) {
    return errorResponse(e, corsHeaders, { fn: "expand-pass-note", publicMessage: "Could not expand the note." });
  }
});
