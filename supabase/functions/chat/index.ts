import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logAiUsage } from "../_shared/logUsage.ts";
import { requireApprovedUser } from "../_shared/auth.ts";
import { runQueryTable } from "../_shared/chatQueryTable.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Atlas runs natively on the Anthropic API. There is exactly one provider.
// `claude-sonnet-5` is the only other model we intend to run; select it by
// changing the ANTHROPIC_MODEL secret, not by changing this code.
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-5";
const ANTHROPIC_EFFORT = Deno.env.get("ANTHROPIC_EFFORT") ?? "medium";
const MAX_TOOL_STEPS = 8;

const ALLOWED_TABLES = [
  "deals", "deal_enrichment", "partners", "partner_contacts", "partner_interactions",
  "capital_raise_entries", "notes", "tags", "entity_tags",
  "buy_box_pillars", "buy_box_signals", "buy_box_thesis", "permits_data",
];

const tools = [
  {
    name: "list_tables",
    description: "List all queryable tables in the platform with brief descriptions.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "describe_table",
    description: "Get the column names for a given table.",
    input_schema: {
      type: "object",
      properties: { table: { type: "string", enum: ALLOWED_TABLES } },
      required: ["table"],
    },
  },
  {
    name: "query_table",
    description:
      "Read rows from a table. Supports equality, ilike, gt/gte/lt/lte/neq/in filters, ordering, and limit.",
    input_schema: {
      type: "object",
      properties: {
        table: { type: "string", enum: ALLOWED_TABLES },
        select: { type: "string", description: "Comma-separated columns or '*'. Default '*'." },
        filters: {
          type: "object",
          description:
            "Equality filters by default. For operators use {col: {ilike: '%term%'}} or {col: {gte: 100}} / lte / gt / lt / neq / in.",
        },
        order_by: { type: "string" },
        ascending: { type: "boolean", description: "Default false" },
        limit: { type: "number", description: "Max 200, default 25" },
      },
      required: ["table"],
    },
  },
];

const TABLE_DESCRIPTIONS: Record<string, string> = {
  deals: "Real estate deal pipeline. Each row is a property/deal with status, score, market, units, price, dates.",
  deal_enrichment: "Enrichment data (demographics, schools, etc.) per deal.",
  partners: "Capital partners (LPs, lenders, JV partners).",
  partner_contacts: "Individual contacts at each partner.",
  partner_interactions: "Log of touchpoints / meetings with partners.",
  capital_raise_entries: "Tracked capital commitments per raise.",
  notes: "Free-form notes attached to deals/partners/etc.",
  tags: "Tag library.",
  entity_tags: "Many-to-many: which tags are applied to which entities.",
  buy_box_pillars: "Weighted scoring pillars used by the AI score.",
  buy_box_signals: "Individual data signals under each pillar.",
  buy_box_thesis: "Natural-language investment thesis.",
  permits_data: "Multifamily permit (supply) data by market.",
};

async function runTool(supabase: any, name: string, args: any) {
  if (name === "list_tables") {
    return Object.entries(TABLE_DESCRIPTIONS).map(([t, d]) => ({ table: t, description: d }));
  }
  if (name === "describe_table") {
    const { data: row, error } = await supabase.from(args.table).select("*").limit(1);
    // Postgres error text names tables, columns and constraints, and for an RLS
    // denial describes the policy. This value is returned as a tool result, so
    // the model will paraphrase it into the visible transcript — keep it generic.
    if (error) {
      console.error("[chat] describe_table", error);
      return { error: "could not describe table" };
    }
    return { columns: row && row[0] ? Object.keys(row[0]) : [] };
  }
  if (name === "query_table") {
    // Ansonia's own record lives in `partners` and is not a capital source.
    // Surfacing it to chat produces answers that describe us as an outside
    // investor. runQueryTable always filters it out of `partners` reads and
    // rejects `partners(...)` embeds on other tables. See _shared/chatQueryTable.
    return await runQueryTable(supabase, args, ALLOWED_TABLES);
  }
  return { error: "unknown tool" };
}

const systemPrompt = `You are **Atlas**, the built-in AI guide for the Ansonia Properties acquisitions platform — a real-estate private-equity deal-flow and capital-raising system used by the Ansonia acquisitions team.

You have two jobs, and you should infer which one the user needs:

1. **Teach the portal.** Help users (especially new ones) understand what the platform does, where things live, what terms mean, and how to accomplish tasks. Answer "how do I…", "where is…", "what does … mean" questions from your knowledge below — you do NOT need to query the database for these.

2. **Answer data questions accurately.** For questions about actual deals, partners, raises, notes, or the buy box, use the query tools. Start with list_tables / describe_table if unsure of the schema. Cite specific names and numbers — never invent them. If a query returns no rows, say so plainly rather than guessing.

## Platform map (what each area does and where it lives)

- **Dashboard (\`/\`)** — executive overview: pipeline value, status breakdown, recent activity.

- **Pipeline Dashboard (\`/pipeline-dashboard\`)** — higher-level pipeline analytics.

- **Deal Inbox (\`/pipeline\`)** — broker emails auto-ingested from the shared acquisitions inbox, deduped and screened against the investment mandate. New deal flow starts here.

- **Pipeline (\`/deals\`)** — the working deal table: inline edit, status, $/unit, equity, filters, saved column views. Open any deal for full detail.

- **Buy Box (\`/buy-box\`)** — the investment thesis and scoring criteria the team screens against.

- **New Deal (\`/deals/new\`)** — manually add a deal.

- **Capital Partners (\`/partners\`)** — CRM for LPs, lenders, and JV partners: warmth, equity range, contacts, and a log of interactions. Add via New Partner.

- **Capital Raise (\`/capital-raise\`)** — tracks capital commitments and where each partner stands in a raise.

- **Notes & Tags (\`/notes\`)** — free-form notes and user-defined tags across deals and partners.

- **Outlook (\`/outlook\`)** — connected email for deal and partner correspondence.

- **Roadmap (\`/roadmap\`)** — product roadmap and status.

- **API Status (\`/api-status\`)** — health of connected data sources.

- **Admin → Users / Connectors** — admin-only user and integration management.

## Key terms (the glossary new users need)

- **Buy box**: Ansonia targets value-add multifamily — 150+ units, 1990s–2010s vintage, in-place rents ~10%+ below market, submarkets with <5% new supply, population & job growth above the national average, and median income around $55K+.

- **Deal score & tier**: each deal gets a 0–100 composite (\`total_score\`) that rolls up to a **deal_tier**: Tier 1 – Strong Fit (≥80), Tier 2 – Fit (≥65), Tier 3 – Marginal (≥50), Tier 4 – Weak, or Disqualified (failed a hard screen).

- **Scoring factors & weights**: Rent lag 22%, Value-add opportunity 18%, Submarket quality 15%, Occupancy/concessions 10%, Property fundamentals 10%, Opex benchmark 10%, Capital-markets/exit 8%, Regulatory/tax 7%.

- **Hard filters** disqualify egregious misses (too few units, wrong vintage, income below floor, excess new supply, or both population and jobs declining).

- **Warmth**: how strong the relationship is with a capital partner.

- **Data sources**: HelloData (rent comps/market data), ESRI (demographics), BLS (job growth), permits data (new supply).

## IMPORTANT — which score to report

The authoritative deal score is **\`total_score\`** and **\`deal_tier\`** (with detail in \`factor_scores\`). There is a legacy \`ai_score\` column that is NOT the current score — do not report \`ai_score\` unless the user explicitly asks about it. When asked "the score" or "highest scoring deal," always use \`total_score\` / \`deal_tier\`.

## Common how-to answers

- Add a deal → New Deal in the sidebar, or the Deal Inbox for broker-sourced deals.

- Add a partner → Capital Partners → New Partner.

- Log a partner touchpoint → open the partner, add an interaction.

- Change a deal's status or fields → edit inline in the Pipeline table.

- Understand a deal's score → open the deal; the score breakdown shows each factor.

## Style

Write in a concise, institutional tone appropriate for an investment team — precise, no filler, no hype. Use markdown. Money uses $ and commas; scores round to 2 decimals. When a new user seems unsure what to ask, briefly orient them (what you can help with) and suggest 2–3 concrete questions.

When presenting tabular data, ALWAYS use valid GitHub-Flavored Markdown tables: header row, separator row of dashes, one row per record, every row starting and ending with \`|\` and the same column count, single-line cells, and a blank line before and after the table. Prefer a table for any comparison of 2+ items across 2+ attributes.`;

// Convert stored {role, content} messages into Anthropic format.
function toAnthropicMessages(incoming: any[]) {
  return incoming
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));
}

/** Every failure reaches the client as {error:{code,message}} with a usable status. */
class AtlasError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const trunc = (s: string) => s.slice(0, 300);

/** Anthropic errors are {error:{type,message}}; fall back to the raw body. */
function upstreamMessage(body: string): string {
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.message ?? body;
  } catch {
    return body;
  }
}

function errorResponse(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Maps an Anthropic HTTP failure onto our error contract. */
function anthropicError(status: number, body: string): AtlasError {
  console.error(`[chat] anthropic ${status}: ${body}`);
  if (status === 401 || status === 403) {
    return new AtlasError(
      502,
      "auth_failed",
      "Atlas could not authenticate with Anthropic. The API key is invalid or revoked.",
    );
  }
  if (status === 429) {
    return new AtlasError(429, "rate_limited", "Atlas is rate limited right now. Try again in a moment.");
  }
  if (status === 400) return new AtlasError(502, "bad_request", trunc(upstreamMessage(body)));
  return new AtlasError(502, "upstream_error", trunc(upstreamMessage(body)));
}

/**
 * The request body is identical for tool rounds and the final streamed turn —
 * only `stream` differs. Keeping it in one place means the cached system prefix
 * is byte-identical across both, so the final turn still hits the prompt cache.
 */
function requestBody(messages: any[], stream: boolean) {
  return JSON.stringify({
    model: ANTHROPIC_MODEL,
    // Streaming removes the HTTP-timeout ceiling that forced a small cap.
    max_tokens: 32000,
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    tools,
    messages,
    thinking: { type: "adaptive" },
    output_config: { effort: ANTHROPIC_EFFORT },
    fallbacks: "default",
    ...(stream ? { stream: true } : {}),
  });
}

const anthropicHeaders = {
  "content-type": "application/json",
  "x-api-key": ANTHROPIC_API_KEY!,
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "server-side-fallback-2026-07-01",
};

async function callAnthropic(messages: any[], stream: boolean): Promise<Response> {
  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: anthropicHeaders,
      body: requestBody(messages, stream),
    });
  } catch (e: any) {
    console.error("[chat] anthropic network error", e);
    throw new AtlasError(502, "upstream_error", trunc(String(e?.message ?? e)));
  }
  if (!resp.ok) throw anthropicError(resp.status, await resp.text());
  return resp;
}

/** Human-readable status for the tool the model just asked for. */
function statusEvent(name: string, input: any) {
  if (name === "query_table") return { type: "status", tool: name, table: input?.table ?? null };
  if (name === "describe_table") return { type: "status", tool: name, table: input?.table ?? null };
  return { type: "status", tool: name, table: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Everything before the stream opens can still fail as plain JSON, which is
  // what the client's non-OK path reads.
  let auth: any;
  let thread_id: string;
  let incoming: any[];
  let supabase: any;
  let supabaseUser: any;

  try {
    auth = await requireApprovedUser(req);
    if (!auth.ok) return auth.response;

    const body = await req.json();
    thread_id = body?.thread_id;
    incoming = body?.messages;
    if (!thread_id || !Array.isArray(incoming)) {
      return errorResponse(400, "bad_request", "thread_id and messages are required.");
    }

    if (!ANTHROPIC_API_KEY) {
      console.error("[chat] ANTHROPIC_API_KEY is not set");
      return errorResponse(
        503,
        "no_api_key",
        "Atlas is not configured — ANTHROPIC_API_KEY is not set on this project.",
      );
    }

    // Service client used only for logging chat_messages/threads (still owned by app, not user).
    supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    // User-scoped client — tool queries execute under the caller's RLS.
    supabaseUser = auth.userClient;

    // The bookkeeping writes below use the service client, which bypasses RLS, so
    // thread ownership has to be proven here. Without this an approved user can
    // post into, and read the title of, another user's thread by passing its id.
    const { data: ownedThread } = await supabaseUser
      .from("chat_threads")
      .select("id")
      .eq("id", thread_id)
      .maybeSingle();
    if (!ownedThread) return errorResponse(404, "not_found", "Thread not found.");
  } catch (e: any) {
    console.error("[chat] pre-stream failure", e);
    if (e instanceof AtlasError) return errorResponse(e.status, e.code, e.message);
    return errorResponse(500, "internal_error", String(e?.message ?? e));
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      let fullText = "";
      try {
        const messages = [...toAnthropicMessages(incoming)];

        // ---- Tool rounds: non-streaming, because a tool_use block has to be
        // complete before the query can run. ----
        let finalTurn: any = null;
        for (let step = 0; step < MAX_TOOL_STEPS; step++) {
          const resp = await callAnthropic(messages, false);
          const data = await resp.json();
          await logAiUsage(supabase, {
            function_name: "chat",
            model: ANTHROPIC_MODEL,
            provider: "anthropic",
            usage: data?.usage,
          });

          // stop_details is populated ONLY for a refusal and is null otherwise.
          if (data.stop_reason === "refusal") {
            const text = data.stop_details?.explanation ?? "Atlas declined to answer that request.";
            emit({ type: "delta", text });
            fullText = text;
            finalTurn = "refusal";
            break;
          }

          if (data.stop_reason !== "tool_use") {
            // This turn is the prose answer. Discard it and re-issue the SAME
            // request with stream:true so the user sees tokens as they arrive.
            finalTurn = "stream";
            break;
          }

          const content = data.content ?? [];
          messages.push({ role: "assistant", content });

          const toolResults: any[] = [];
          for (const block of content) {
            if (block.type === "tool_use") {
              emit(statusEvent(block.name, block.input ?? {}));
              const result = await runTool(supabaseUser, block.name, block.input ?? {});
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify(result).slice(0, 20000),
              });
            }
          }
          // All results in ONE user message — splitting them trains the model
          // out of parallel calls.
          messages.push({ role: "user", content: toolResults });
        }

        let usage: any = null;

        if (finalTurn === "stream") {
          const resp = await callAnthropic(messages, true);
          const reader = resp.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          // Anthropic's SSE: accumulate, split on blank lines, forward only the
          // text deltas. message_delta carries the terminating usage.
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split("\n\n");
            buffer = frames.pop() ?? "";
            for (const frame of frames) {
              for (const line of frame.split("\n")) {
                if (!line.startsWith("data:")) continue;
                const payload = line.slice(5).trim();
                if (!payload || payload === "[DONE]") continue;
                let evt: any;
                try {
                  evt = JSON.parse(payload);
                } catch {
                  continue;
                }
                if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                  fullText += evt.delta.text;
                  emit({ type: "delta", text: evt.delta.text });
                } else if (evt.type === "message_delta") {
                  if (evt.usage) usage = evt.usage;
                } else if (evt.type === "error") {
                  throw new AtlasError(
                    502,
                    "upstream_error",
                    trunc(evt.error?.message ?? "stream error"),
                  );
                }
              }
            }
          }

          await logAiUsage(supabase, {
            function_name: "chat",
            model: ANTHROPIC_MODEL,
            provider: "anthropic",
            usage,
          });
        }

        if (!finalTurn) {
          fullText = "(no response — max tool steps reached)";
          emit({ type: "delta", text: fullText });
        }

        // ---- Persist only after a clean stream. Same rule as before: a failed
        // turn leaves the thread untouched. ----
        const lastUser = [...incoming].reverse().find((m: any) => m.role === "user");
        const assistantMsg = { role: "assistant", content: fullText };

        if (lastUser) {
          await supabase.from("chat_messages").insert({ thread_id, role: "user", message: lastUser });
        }
        await supabase.from("chat_messages").insert({
          thread_id, role: "assistant", message: assistantMsg,
        });
        await supabase.from("chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", thread_id);

        const { data: thread } = await supabase.from("chat_threads").select("title").eq("id", thread_id).maybeSingle();
        if (thread?.title === "New conversation" && lastUser?.content) {
          const title = String(lastUser.content).slice(0, 60).replace(/\n/g, " ");
          await supabase.from("chat_threads").update({ title }).eq("id", thread_id);
        }

        emit({ type: "done", model: ANTHROPIC_MODEL, usage });
      } catch (e: any) {
        // Never leave the client hanging: emit a typed error, then close.
        console.error("[chat] stream failure", e);
        const code = e instanceof AtlasError ? e.code : "internal_error";
        const message = e instanceof AtlasError ? e.message : String(e?.message ?? e);
        emit({ type: "error", code, message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
});
