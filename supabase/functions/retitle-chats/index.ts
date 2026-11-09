// retitle-chats
// One-off backfill: gives existing Ask Atlas conversations the same short AI
// titles new ones get. Admin, or a server-side call with the scheduler secret.
//
// Only conversations still carrying the old automatic title (the first 60
// characters of the opening message) are touched, so a title someone set by
// hand is never overwritten. Safe to run again: a retitled conversation no
// longer matches.
//
// POST body: {limit?: number}  (default 40, max 100 per call; call again for more)
//            {mode: "recase"}  Title Case for every existing title, no AI call:
//                              only capitalization changes, never the words.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsFor, requireCronSecret, requireRole } from "../_shared/auth.ts";
import { errorResponse } from "../_shared/errors.ts";
import { generateChatTitle } from "../_shared/chatTitle.ts";
import { legacyTitle, NEW_THREAD_TITLE, toTitleCase } from "../_shared/chatTitleText.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FN = "retitle-chats";
const RUN_BUDGET_MS = 100_000;

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    // An admin, or a server-side call carrying the scheduler secret (pg_net),
    // so the backfill can run without anyone's browser session.
    if (requireCronSecret(req) !== null) {
      const authz = await requireRole(req, "admin");
      if (!authz.ok) return authz.response;
    }
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body?.limit) || 40, 1), 100);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const deadline = Date.now() + RUN_BUDGET_MS;

    const { data: threads, error } = await admin
      .from("chat_threads")
      .select("id, title")
      .neq("title", NEW_THREAD_TITLE)
      .order("updated_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(`chat_threads: ${error.message}`);

    if (body?.mode === "recase") {
      let recased = 0;
      const examples: { before: string; after: string }[] = [];
      for (const t of threads ?? []) {
        const next = toTitleCase(t.title);
        if (next === t.title) continue;
        const { error: upErr } = await admin.from("chat_threads").update({ title: next }).eq("id", t.id).eq("title", t.title);
        if (upErr) throw new Error(`chat_threads update: ${upErr.message}`);
        recased++;
        if (examples.length < 15) examples.push({ before: t.title, after: next });
      }
      return json({ mode: "recase", total: threads?.length ?? 0, recased, examples });
    }

    let checked = 0;
    let retitled = 0;
    let remaining = 0;
    const examples: { before: string; after: string }[] = [];

    for (const t of threads ?? []) {
      const { data: first } = await admin
        .from("chat_messages")
        .select("message")
        .eq("thread_id", t.id)
        .eq("role", "user")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      const opening = first?.message?.content;
      if (typeof opening !== "string" || legacyTitle(opening) !== t.title) continue;
      checked++;
      if (retitled >= limit || Date.now() > deadline) {
        remaining++;
        continue;
      }
      const title = await generateChatTitle(admin, opening, FN);
      const { error: upErr } = await admin.from("chat_threads").update({ title }).eq("id", t.id).eq("title", t.title);
      if (upErr) throw new Error(`chat_threads update: ${upErr.message}`);
      retitled++;
      if (examples.length < 15) examples.push({ before: t.title, after: title });
    }

    return json({ matched: checked, retitled, remaining, examples });
  } catch (e) {
    return errorResponse(e, cors, { fn: FN });
  }
});
