// Drafts the first email to capital partners about a deal, from the Brain's
// partner outreach template.
//
// The template leaves the financials blank; they are filled from the deal's
// uploaded OM, rent roll and T12 (as parsed by parse-deal-document), then the
// deal record.
//
// Body: { deal_id, notes? }. Returns { subject, body, check, templates, documents }.
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
  documentFactsBlock,
  normalizeOutreachDraft,
  OUTREACH_DEAL_FIELDS,
  OUTREACH_DOC_TYPES,
  OUTREACH_SCHEMA,
  type OutreachDocument,
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
        error: "No partner outreach template in the Brain yet. Add one there with the category \"Partner outreach template\".",
      }, 400);
    }

    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select(OUTREACH_DEAL_FIELDS.join(", "))
      .eq("id", deal_id)
      .single();
    if (dealErr) throw dealErr;

    // The newest parsed OM, rent roll and T12. Only the figures are selected
    // from extraction: the rest of it is every unit row and ledger line.
    const { data: docs, error: docErr } = await sb
      .from("deal_documents")
      .select("doc_type, file_name, doc_as_of, summary, figures:extraction->figures")
      .eq("deal_id", deal_id)
      .in("doc_type", [...OUTREACH_DOC_TYPES])
      .order("created_at", { ascending: false })
      .limit(30);
    if (docErr) throw docErr;
    const documents: string[] = [];
    for (const type of OUTREACH_DOC_TYPES) {
      const doc = (docs ?? []).find((d: any) => d.doc_type === type && (d.summary || d.figures));
      const block = doc ? documentFactsBlock(doc as OutreachDocument) : "";
      if (block) documents.push(block);
    }

    const prompt = buildOutreachPrompt({
      templates,
      dealFacts: dealFactsBlock(deal as unknown as Record<string, unknown>),
      documents,
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
    return json({
      ...draft,
      templates: templates.map((t) => t.title),
      documents: documents.map((d) => d.split("\n")[0]),
    });
  } catch (e) {
    return errorResponse(e, corsHeaders, { fn: "draft-partner-outreach", publicMessage: "Could not draft the email." });
  }
});
