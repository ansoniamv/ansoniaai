import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logAiUsage } from "../_shared/logUsage.ts";
import { requireApprovedUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Anthropic disabled — credits exhausted and it was adding latency on every request.
// Set USE_ANTHROPIC=1 to re-enable once billing is topped up.
const USE_ANTHROPIC = Deno.env.get("USE_ANTHROPIC") === "1";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-4-5";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const FALLBACK_MODEL = Deno.env.get("FALLBACK_MODEL") ?? "google/gemini-3-flash-preview";

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
    if (error) return { error: error.message };
    return { columns: row && row[0] ? Object.keys(row[0]) : [] };
  }
  if (name === "query_table") {
    const { table, select = "*", filters = {}, order_by, ascending = false, limit = 25 } = args;
    if (!ALLOWED_TABLES.includes(table)) return { error: "table not allowed" };
    let q = supabase.from(table).select(select).limit(Math.min(Number(limit) || 25, 200));
    for (const [col, val] of Object.entries(filters || {})) {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const v = val as any;
        if ("ilike" in v) q = q.ilike(col, v.ilike);
        else if ("eq" in v) q = q.eq(col, v.eq);
        else if ("neq" in v) q = q.neq(col, v.neq);
        else if ("gt" in v) q = q.gt(col, v.gt);
        else if ("gte" in v) q = q.gte(col, v.gte);
        else if ("lt" in v) q = q.lt(col, v.lt);
        else if ("lte" in v) q = q.lte(col, v.lte);
        else if ("in" in v) q = q.in(col, v.in);
      } else {
        q = q.eq(col, val);
      }
    }
    if (order_by) q = q.order(order_by, { ascending });
    const { data, error } = await q;
    if (error) return { error: error.message };
    return { rows: data, count: data?.length ?? 0 };
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

async function runAnthropic(supabase: any, serviceClient: any, initialMessages: any[]): Promise<{ text: string }> {
  const messages = [...initialMessages];
  for (let step = 0; step < 8; step++) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools,
        messages,
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`anthropic ${resp.status}: ${txt.slice(0, 300)}`);
    }
    const data = await resp.json();
    const content = data.content ?? [];
    await logAiUsage(serviceClient, { function_name: "chat", model: ANTHROPIC_MODEL, provider: "anthropic", usage: data?.usage });
    messages.push({ role: "assistant", content });

    if (data.stop_reason === "tool_use") {
      const toolResults: any[] = [];
      for (const block of content) {
        if (block.type === "tool_use") {
          const result = await runTool(supabase, block.name, block.input ?? {});
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result).slice(0, 20000),
          });
        }
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }
    const text = content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
    return { text };
  }
  return { text: "(no response — max tool steps reached)" };
}

// OpenAI-compatible tool schema for the Lovable AI Gateway
const openaiTools = tools.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}));

async function runGemini(supabase: any, serviceClient: any, incoming: any[]): Promise<{ text: string }> {
  const convo: any[] = [
    { role: "system", content: systemPrompt },
    ...incoming.map((m: any) => ({ role: m.role, content: m.content })),
  ];
  for (let step = 0; step < 8; step++) {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": LOVABLE_API_KEY!,
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
      body: JSON.stringify({ model: FALLBACK_MODEL, messages: convo, tools: openaiTools }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`gemini ${resp.status}: ${txt.slice(0, 300)}`);
    }
    const data = await resp.json();
    await logAiUsage(serviceClient, { function_name: "chat", model: FALLBACK_MODEL, provider: "lovable-gateway", usage: data?.usage });
    const msg = data.choices?.[0]?.message;
    if (!msg) return { text: "" };
    convo.push(msg);
    const calls = msg.tool_calls;
    if (calls && calls.length > 0) {
      for (const call of calls) {
        let args: any = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch {}
        const result = await runTool(supabase, call.function.name, args);
        convo.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, 20000),
        });
      }
      continue;
    }
    return { text: msg.content || "" };
  }
  return { text: "(no response — max tool steps reached)" };
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireApprovedUser(req);
    if (!auth.ok) return auth.response;

    const { thread_id, messages: incoming } = await req.json();
    if (!thread_id || !Array.isArray(incoming)) {
      return new Response(JSON.stringify({ error: "thread_id and messages required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service client used only for logging chat_messages/threads (still owned by app, not user).
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    // User-scoped client — tool queries execute under the caller's RLS.
    const supabaseUser = auth.userClient;

    const lastUser = [...incoming].reverse().find((m: any) => m.role === "user");
    if (lastUser) {
      await supabase.from("chat_messages").insert({
        thread_id, role: "user", message: lastUser,
      });
    }

    let finalText = "";
    let providerUsed: "anthropic" | "gemini" | "none" = "none";
    let fallbackReason: string | null = null;

    // ---- Try Anthropic first (only if explicitly enabled) ----
    if (USE_ANTHROPIC && ANTHROPIC_API_KEY) {
      try {
        const result = await runAnthropic(supabaseUser, supabase, toAnthropicMessages(incoming));
        finalText = result.text;
        providerUsed = "anthropic";
      } catch (e: any) {
        fallbackReason = e?.message ?? "anthropic failed";
        console.warn("Anthropic failed, falling back to Lovable AI Gateway:", fallbackReason);
      }
    }

    // ---- Lovable AI Gateway (Gemini) — default path ----
    if (providerUsed === "none") {
      if (!LOVABLE_API_KEY) {
        return new Response(
          JSON.stringify({ error: `Primary model failed (${fallbackReason}) and no fallback model is configured.` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      try {
        const result = await runGemini(supabaseUser, supabase, incoming);
        finalText = result.text;
        providerUsed = "gemini";
      } catch (e: any) {
        return new Response(
          JSON.stringify({ error: `All models failed. Primary: ${fallbackReason}. Fallback: ${e?.message ?? e}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Note which model produced the answer when we had to fall back
    // (fallback-notice footer removed — Lovable AI is the default path)




    const assistantMsg = { role: "assistant", content: finalText };
    await supabase.from("chat_messages").insert({
      thread_id, role: "assistant", message: assistantMsg,
    });
    await supabase.from("chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", thread_id);

    const { data: thread } = await supabase.from("chat_threads").select("title").eq("id", thread_id).maybeSingle();
    if (thread?.title === "New conversation" && lastUser?.content) {
      const title = String(lastUser.content).slice(0, 60).replace(/\n/g, " ");
      await supabase.from("chat_threads").update({ title }).eq("id", thread_id);
    }

    return new Response(JSON.stringify({ message: assistantMsg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
