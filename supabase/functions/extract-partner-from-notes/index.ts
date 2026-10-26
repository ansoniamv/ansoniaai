// Drafts a new capital partner from pasted notes: the firm's name, type, HQ,
// website and the people we talk to there. Nothing is saved here — the Partner
// Import page shows the draft for review, creates the partner, saves the notes
// on it, and then runs enrich-partner-from-notes for the mandate and briefing.
import { completeText } from "../_shared/ai.ts";
import { logAiFailure, logAiUsage } from "../_shared/logUsage.ts";
import { corsFor, requireApprovedUser } from "../_shared/auth.ts";
import { errorResponse } from "../_shared/errors.ts";
import { PARTNER_MODEL } from "../_shared/featureModels.ts";
import {
  buildPartnerDraftPrompt,
  cleanDraft,
  MAX_NOTES_CHARS,
  PARTNER_DRAFT_SCHEMA,
} from "../_shared/partnerImport.ts";

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authz = await requireApprovedUser(req);
  if (!authz.ok) return authz.response;
  const sb = authz.admin;

  try {
    const { notes } = await req.json();
    if (typeof notes !== "string" || !notes.trim()) throw new Error("notes required");
    if (notes.length > MAX_NOTES_CHARS) {
      throw new Error(`notes are too long (${notes.length} characters, limit ${MAX_NOTES_CHARS})`);
    }

    let res;
    try {
      res = await completeText(buildPartnerDraftPrompt(notes.trim()), {
        model: PARTNER_MODEL,
        maxTokens: 4000,
        effort: "low",
        timeoutMs: 60000,
        schema: PARTNER_DRAFT_SCHEMA,
        priority: "interactive",
        supabase: sb,
      });
    } catch (e) {
      await logAiFailure(sb, { function_name: "extract-partner-from-notes", model: PARTNER_MODEL, error: e });
      throw e;
    }
    await logAiUsage(sb, {
      function_name: "extract-partner-from-notes",
      model: res.model,
      provider: res.provider,
      usage: res.usage,
    });

    const draft = cleanDraft(JSON.parse(res.text));
    return new Response(JSON.stringify({ draft }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return errorResponse(e, corsHeaders, { fn: "extract-partner-from-notes", publicMessage: "Could not read a partner from these notes." });
  }
});
