// Drafts the "why are we passing" sentence for the Deny dialog.
//
// The analyst picks a category; this writes the specific reason that category
// asks for (which submarket, how many units, what vintage) from what is already
// on the inbox row, so the required field starts with something worth keeping
// instead of "too small". It is a draft: nothing is saved here, and the analyst
// accepts, edits or ignores it.
import { completeText } from "../_shared/ai.ts";
import { logAiFailure, logAiUsage } from "../_shared/logUsage.ts";
import { corsFor, requireApprovedUser } from "../_shared/auth.ts";
import { errorResponse } from "../_shared/errors.ts";
import { DENY_REASON_MODEL } from "../_shared/featureModels.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CHARS = 220;

const DEAL_FIELDS = [
  "property_name", "address", "location_city", "location_state", "msa",
  "units", "year_built", "avg_sf", "occupancy_pct", "asset_class", "strategy",
  "asking_price", "offers_due", "fit_score", "fit_tier", "fit_rationale",
  "gate_reason", "email_thread_summary", "other_details",
] as const;

function factsBlock(deal: Record<string, unknown>): string {
  return DEAL_FIELDS
    .filter((k) => deal[k] != null && String(deal[k]).trim() !== "")
    .map((k) => `${k}: ${String(deal[k]).slice(0, k === "email_thread_summary" ? 2500 : 800)}`)
    .join("\n");
}

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authz = await requireApprovedUser(req);
  if (!authz.ok) return authz.response;
  const sb = authz.admin;

  try {
    const { inbox_deal_id, category, question } = await req.json();
    if (typeof inbox_deal_id !== "string" || !UUID_RE.test(inbox_deal_id)) {
      throw new Error("inbox_deal_id must be a UUID");
    }
    if (typeof category !== "string" || !category.trim()) throw new Error("category required");

    const { data: deal, error } = await sb
      .from("inbox_deals")
      .select(DEAL_FIELDS.join(", "))
      .eq("id", inbox_deal_id)
      .single();
    if (error) throw error;

    // Recent human-written reasons in this category, so the draft reads like the
    // team's own notes rather than like a model. Short ones are the "too small"
    // kind this field exists to replace, so they are not worth imitating.
    const { data: examples } = await sb
      .from("deal_feedback")
      .select("reason_text")
      .eq("action", "deny")
      .eq("category", category)
      .not("reason_text", "is", null)
      .order("created_at", { ascending: false })
      .limit(20);
    const styleExamples = (examples ?? [])
      .map((r: any) => String(r.reason_text ?? "").trim())
      .filter((t) => t.length >= 30)
      .slice(0, 5);

    const ask = typeof question === "string" && question.trim()
      ? question.trim().slice(0, 200)
      : "Why specifically are we passing?";

    const prompt = `You are an acquisitions analyst at a multifamily value-add investor. We are passing on the deal below.
Category chosen: ${category}
The form asks: ${ask}

Write the answer the analyst would type: ONE sentence, under ${MAX_CHARS} characters, terse note style, no preamble, no quotes.
- Lead with the concrete fact the question asks for (unit count, submarket, vintage, price per unit, date) taken from the deal data.
- Then say why that disqualifies it, in a few words.
- Use only facts present in the deal data. Never invent a number, submarket or name. If the decisive fact is missing, use what is there.
${styleExamples.length ? `\nHow the team has written these before:\n${styleExamples.map((t) => `- ${t}`).join("\n")}\n` : ""}
Deal data:
${factsBlock(deal as unknown as Record<string, unknown>)}`;

    let res;
    try {
      res = await completeText(prompt, {
        model: DENY_REASON_MODEL,
        maxTokens: 400,
        effort: "low",
        timeoutMs: 20000,
        priority: "interactive",
        supabase: sb,
      });
    } catch (e) {
      await logAiFailure(sb, { function_name: "suggest-deny-reason", model: DENY_REASON_MODEL, error: e });
      throw e;
    }
    await logAiUsage(sb, {
      function_name: "suggest-deny-reason",
      model: res.model,
      provider: res.provider,
      usage: res.usage,
    });

    const suggestion = res.text
      .trim()
      .split("\n")[0]
      .replace(/^["'“]+|["'”]+$/g, "")
      .trim()
      .slice(0, MAX_CHARS * 2);

    return new Response(JSON.stringify({ suggestion }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return errorResponse(e, corsHeaders, { fn: "suggest-deny-reason", publicMessage: "Could not draft a reason." });
  }
});
