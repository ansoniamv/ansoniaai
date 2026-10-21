// Drafts the first email to capital partners about a deal, from the Data Room's
// partner outreach template.
//
// Body: { deal_id, notes? }. Returns { subject, body, check, templates }.
// Nothing is saved or sent here: the Draft Outreach dialog puts the result in
// its editor, the person reviews it, and only then are Outlook drafts created.
import { completeText } from "../_shared/ai.ts";
import { logAiFailure, logAiUsage } from "../_shared/logUsage.ts";
import { corsFor, requireApprovedUser } from "../_shared/auth.ts";
import { errorResponse } from "../_shared/errors.ts";
import { OUTREACH_MODEL } from "../_shared/featureModels.ts";
import { loadCompanyBrief } from "../_shared/companyBrief.ts";
import {
  buildOutreachPrompt,
  dealFactsBlock,
  normalizeOutreachDraft,
  OUTREACH_DEAL_FIELDS,
  OUTREACH_SCHEMA,
  type OutreachTemplate,
} from "../_shared/partnerOutreach.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authz = await requireApprovedUser(req);
  if (!authz.ok) return authz.response;
  const sb = authz.admin;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { deal_id, notes } = await req.json();
    if (typeof deal_id !== "string" || !UUID_RE.test(deal_id)) throw new Error("deal_id must be a UUID");

    // A note's text is in body; a file's or website's is in its passages.
    const { data: sources, error: srcErr } = await sb
      .from("data_room_sources")
      .select("id, kind, title, body")
      .eq("category", "partner_outreach")
      .eq("status", "ready")
      .order("created_at", { ascending: true });
    if (srcErr) throw srcErr;
    const templates: OutreachTemplate[] = [];
    for (const s of sources ?? []) {
      let text = s.kind === "note" ? String(s.body ?? "") : "";
      if (!text) {
        const { data: chunks } = await sb
          .from("data_room_chunks")
          .select("content")
          .eq("source_id", s.id)
          .order("ordinal", { ascending: true })
          .limit(10);
        text = (chunks ?? []).map((c: any) => c.content).join("\n");
      }
      if (text.trim()) templates.push({ title: s.title, text });
    }
    if (!templates.length) {
      return json({
        error: "No partner outreach template in the Data Room yet. Add one there with the category \"Partner outreach template\".",
      }, 400);
    }

    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select(OUTREACH_DEAL_FIELDS.join(", "))
      .eq("id", deal_id)
      .single();
    if (dealErr) throw dealErr;

    const { data: docs } = await sb
      .from("deal_documents")
      .select("file_name, summary")
      .eq("deal_id", deal_id)
      .eq("doc_type", "om")
      .not("summary", "is", null)
      .order("created_at", { ascending: false })
      .limit(2);
    const omSummaries = (docs ?? [])
      .filter((d: any) => d.summary?.om)
      .map((d: any) => `${d.file_name}: ${JSON.stringify(d.summary.om)}`);

    const prompt = buildOutreachPrompt({
      templates,
      dealFacts: dealFactsBlock(deal as unknown as Record<string, unknown>),
      omSummaries,
      companyBrief: await loadCompanyBrief(sb),
      notes: typeof notes === "string" ? notes : undefined,
    });

    let res;
    try {
      res = await completeText(prompt, {
        model: OUTREACH_MODEL,
        maxTokens: 4000,
        effort: "low",
        schema: OUTREACH_SCHEMA,
        timeoutMs: 60000,
        priority: "interactive",
        supabase: sb,
      });
    } catch (e) {
      await logAiFailure(sb, { function_name: "draft-partner-outreach", model: OUTREACH_MODEL, error: e });
      throw e;
    }
    await logAiUsage(sb, {
      function_name: "draft-partner-outreach",
      model: res.model,
      provider: res.provider,
      usage: res.usage,
    });

    const draft = normalizeOutreachDraft(JSON.parse(res.text));
    return json({ ...draft, templates: templates.map((t) => t.title) });
  } catch (e) {
    return errorResponse(e, corsHeaders, { fn: "draft-partner-outreach", publicMessage: "Could not draft the email." });
  }
});
