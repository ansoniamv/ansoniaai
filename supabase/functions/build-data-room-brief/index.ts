// build-data-room-brief
// Compiles the Company Brief from every ready Data Room source that is marked
// "include in brief": their summaries and key facts, and notes in full. The
// brief is the one piece of the Data Room that rides along in every scoring,
// gating, research and Atlas prompt (see _shared/companyBrief.ts).
//
// Admin only, and run on request from the Data Room page rather than after each
// upload: ten files added at once should cost one rebuild, not ten.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsFor, requireRole } from "../_shared/auth.ts";
import { callClaudeRaw } from "../_shared/anthropic.ts";
import { assertWithinBudget, BudgetExceededError } from "../_shared/aiBudget.ts";
import { logAiUsage } from "../_shared/logUsage.ts";
import { DATA_ROOM_MODEL } from "../_shared/featureModels.ts";
import { errorResponse } from "../_shared/errors.ts";
import { BRIEF_SYSTEM, briefPrompt, type BriefInput } from "../_shared/dataRoom.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const authz = await requireRole(req, "admin");
  if (!authz.ok) return authz.response;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: sources, error } = await admin
      .from("data_room_sources")
      .select("id,title,category,kind,processed_at,summary,key_facts,body")
      .eq("status", "ready")
      .eq("include_in_brief", true)
      // Newest first, so the model sees the latest view first when two disagree.
      .order("processed_at", { ascending: false });
    if (error) throw error;
    if (!sources?.length) {
      return json({ error: "Nothing to build from: add a source and wait for it to finish reading." }, 400);
    }

    await assertWithinBudget(admin, "interactive");
    let res;
    try {
      res = await callClaudeRaw({
        model: DATA_ROOM_MODEL,
        system: BRIEF_SYSTEM,
        messages: [{ role: "user", content: briefPrompt(sources as BriefInput[]) }],
        max_tokens: 16_000,
        effort: "medium",
        timeoutMs: 240_000,
        maxRetries: 1,
      });
    } catch (e: any) {
      await logAiUsage(admin, {
        function_name: "build-data-room-brief", model: DATA_ROOM_MODEL, provider: "anthropic", usage: null, success: false,
        ...({ http_status: e?.status ?? null, error_text: e?.message ?? String(e) } as any),
      });
      throw e;
    }
    await logAiUsage(admin, { function_name: "build-data-room-brief", model: res.model, provider: "anthropic", usage: res.usage });
    const content = res.text.trim();
    if (!content || res.stop_reason === "max_tokens") throw new Error(`brief incomplete (stop_reason ${res.stop_reason})`);

    const row = {
      id: 1,
      content,
      source_ids: sources.map((s: any) => s.id),
      model: res.model,
      built_at: new Date().toISOString(),
      built_by: authz.user.id,
      edited_at: null,
      edited_by: null,
    };
    const { error: upErr } = await admin.from("data_room_brief").upsert(row);
    if (upErr) throw upErr;
    return json(row);
  } catch (e) {
    if (e instanceof BudgetExceededError) return json({ error: e.message }, 429);
    return errorResponse(e, cors, { fn: "build-data-room-brief" });
  }
});
