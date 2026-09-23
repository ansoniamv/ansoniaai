// supabase/functions/property-research/index.ts
//
// Property Research v2 — a Claude Opus 5 research agent that reads the public
// web about a property and returns a structured, sourced dossier.
//
// Architecture note (this is the important one):
// Real multi-source research on Opus 5 runs for minutes, which is longer than
// an HTTP request should stay open. So this function has two modes:
//
//   POST { deal_id, ... }                   -> creates a job, returns job_id immediately
//   POST { job_id, _internal_secret }       -> runs that job to completion in the background
//
// The UI starts a job and subscribes to the row. Nothing blocks on the model.
//
// Cost posture: this feature was paused for cost review, so every run is gated
// by a month-to-date budget check, a per-run ceiling, a per-deal cooldown, and
// hard caps on search/fetch counts. Every run is logged to ai_usage_log.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logAiUsage, logApiRequest, normalizeUsage } from "../_shared/logUsage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const CRON_SHARED_SECRET = Deno.env.get("CRON_SHARED_SECRET") ?? "";

// Opus 5. Override only to roll back — do not downgrade silently.
// Sonnet 5, not Opus 5. Sonnet 5 supports the web_search_20260209 /
// web_fetch_20260209 tools this agent is built on (they need Opus 4.6+ /
// Sonnet 4.6+), at roughly 40% of Opus token cost. Do not lower this to an
// older Sonnet to save money: claude-sonnet-4-5 does NOT support those tool
// versions and the agent would silently lose its ability to search.
const MODEL = Deno.env.get("PROPERTY_RESEARCH_MODEL") ?? "claude-sonnet-5";

type Depth = "quick" | "standard" | "deep";

// Depth controls how much the agent is allowed to spend. `effort` is Opus 5's
// own thinking/spend dial; the tool caps bound the server-side search bill.
const DEPTH_CONFIG: Record<Depth, {
  effort: "low" | "medium" | "high" | "xhigh";
  maxSearches: number;
  maxFetches: number;
  maxSteps: number;
  maxTokens: number;
  wallClockMs: number;
}> = {
  quick:    { effort: "low",    maxSearches: 4,  maxFetches: 3,  maxSteps: 6,  maxTokens: 8000,  wallClockMs: 120_000 },
  standard: { effort: "high",   maxSearches: 12, maxFetches: 10, maxSteps: 14, maxTokens: 16000, wallClockMs: 300_000 },
  deep:     { effort: "xhigh",  maxSearches: 25, maxFetches: 20, maxSteps: 24, maxTokens: 32000, wallClockMs: 600_000 },
};

// Sites that reliably carry what we care about. Not a whitelist — the agent can
// go anywhere — but naming them in the prompt measurably improves first-search
// quality and cuts wasted searches.
const SOURCE_HINTS = `
Resident reviews:      Google Maps/Reviews, Yelp, ApartmentRatings, Apartments.com,
                       Rent.com, Zillow rentals, Niche, Reddit (r/<city>, r/Tenant),
                       Facebook community groups, BBB complaints
Listings & rents:      Apartments.com, Zillow, RentCafe, Rentable, ApartmentFinder,
                       Zumper, the property's own website, Craigslist
Ownership & records:   county assessor / recorder, state Secretary of State entity
                       search, SEC filings, HUD & LIHTC databases, property tax rolls
News & litigation:     local newspapers and TV, business journals, court dockets
                       (UniCourt, CourtListener, county clerk), code-enforcement
                       and health-department databases, city council agendas
Supply & demand:       city/county permit portals, planning-commission minutes,
                       economic-development announcements, major-employer news,
                       school ratings, transit and infrastructure projects
`.trim();

// ---------------------------------------------------------------------------
// Output contract
// ---------------------------------------------------------------------------
// Every section carries sources. `confidence` and `could_not_verify` are
// required so the agent has a legitimate place to admit ignorance instead of
// inventing a number — this is what keeps the output usable for underwriting.

const sourced = (extra: Record<string, unknown>, required: string[]) => ({
  type: "object",
  additionalProperties: false,
  properties: { ...extra, source_url: { type: "string" } },
  required: [...required, "source_url"],
});

const SNAPSHOT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    resolved: {
      type: "object",
      additionalProperties: false,
      properties: {
        property_name: { type: "string" },
        address: { type: "string" },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        notes: { type: "string", description: "Ambiguity in the match: conflicting unit counts, similarly named properties, renamed after a sale." },
        also_known_as: { type: "array", items: { type: "string" }, description: "Former or alternate names. Properties are frequently rebranded after a trade — prior names unlock older reviews and news." },
      },
      required: ["property_name", "address", "confidence", "notes", "also_known_as"],
    },

    physical: {
      type: "object",
      additionalProperties: false,
      properties: {
        year_built: { type: "string" },
        year_renovated: { type: "string" },
        units: { type: "string" },
        stories: { type: "string" },
        unit_types: { type: "array", items: { type: "string" } },
        sqft_range: { type: "string" },
        amenities: { type: "array", items: { type: "string" } },
        construction_type: { type: "string", description: "Garden, mid-rise, wrap, podium, etc." },
      },
      required: ["year_built", "year_renovated", "units", "stories", "unit_types", "sqft_range", "amenities", "construction_type"],
    },

    rents: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        one_bed_from: { type: "string" },
        two_bed_from: { type: "string" },
        three_bed_from: { type: "string" },
        concessions: { type: "string", description: "Free rent, waived fees, lookback specials. A heavy concession stack is a soft-demand tell the asking rent hides." },
        below_market_signal: { type: "string", description: "Directional only — how asking rents compare to the submarket." },
        renovated_premium: { type: "string", description: "If listings distinguish renovated from classic units, the spread. This is the single most valuable public data point for a value-add thesis." },
      },
      required: ["summary", "one_bed_from", "two_bed_from", "three_bed_from", "concessions", "below_market_signal", "renovated_premium"],
    },

    // The heart of the ask: what residents actually say.
    resident_sentiment: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        platforms: {
          type: "array",
          items: sourced({
            platform: { type: "string" },
            rating: { type: "string", description: "e.g. '3.4 / 5'" },
            review_count: { type: "string" },
            recency: { type: "string", description: "Date range the reviews span." },
          }, ["platform", "rating", "review_count", "recency"]),
        },
        recurring_complaints: {
          type: "array",
          items: sourced({
            theme: { type: "string", description: "e.g. pests, HVAC failures, package theft, towing, unreturned deposits, mold." },
            frequency: { type: "string", enum: ["isolated", "repeated", "dominant"] },
            capex_implication: { type: "string", description: "What this implies about deferred maintenance or a capex line. 'unknown' if it implies nothing specific." },
          }, ["theme", "frequency", "capex_implication"]),
        },
        recurring_praise: { type: "array", items: { type: "string" } },
        management_responsiveness: { type: "string", description: "Whether ownership/management replies to reviews and how. Silence across hundreds of negative reviews is itself a signal." },
        sentiment_trend: { type: "string", enum: ["improving", "stable", "declining", "unknown"], description: "Direction over the last 24 months. A decline that starts at a specific month often marks an ownership or management change." },
      },
      required: ["summary", "platforms", "recurring_complaints", "recurring_praise", "management_responsiveness", "sentiment_trend"],
    },

    ownership: {
      type: "object",
      additionalProperties: false,
      properties: {
        owner_entity: { type: "string" },
        parent_sponsor: { type: "string", description: "The real sponsor behind the SPE, if traceable." },
        management_company: { type: "string" },
        acquired: { type: "string", description: "Date and price of the last recorded trade." },
        hold_period_signal: { type: "string", description: "Anything suggesting the owner is a seller: fund life, loan maturity, portfolio marketing, broker listing." },
        contact: { type: "string" },
        other_properties: { type: "array", items: { type: "string" }, description: "Other assets under the same sponsor — a portfolio angle, and a read on how they operate." },
      },
      required: ["owner_entity", "parent_sponsor", "management_company", "acquired", "hold_period_signal", "contact", "other_properties"],
    },

    debt_and_distress: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        signals: {
          type: "array",
          items: sourced({
            signal: { type: "string", description: "Loan maturity, CMBS watchlist or special servicing, lis pendens, foreclosure notice, tax delinquency, receivership, mechanics lien." },
            detail: { type: "string" },
            date: { type: "string" },
            severity: { type: "string", enum: ["informational", "notable", "material"] },
          }, ["signal", "detail", "date", "severity"]),
        },
      },
      required: ["summary", "signals"],
    },

    news_mentions: {
      type: "array",
      items: sourced({
        headline: { type: "string" },
        date: { type: "string" },
        publication: { type: "string" },
        why_it_matters: { type: "string", description: "One line connecting it to the investment decision. Omit the item entirely if there is no such line." },
        category: { type: "string", enum: ["transaction", "litigation", "crime_safety", "development", "regulatory", "operations", "community", "other"] },
      }, ["headline", "date", "publication", "why_it_matters", "category"]),
    },

    legal_and_regulatory: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        items: {
          type: "array",
          items: sourced({
            item: { type: "string", description: "Tenant suits, habitability or fair-housing actions, code-enforcement history, rent control or stabilization, tax abatement/LIHTC/TIF, pending local ordinances." },
            detail: { type: "string" },
            status: { type: "string" },
          }, ["item", "detail", "status"]),
        },
      },
      required: ["summary", "items"],
    },

    submarket: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        major_employers: { type: "array", items: { type: "string" } },
        employment_news: { type: "string", description: "Expansions, relocations, layoffs, plant closures within commuting distance." },
        new_supply: { type: "string", description: "Named projects under construction or permitted nearby, with unit counts and delivery dates where findable." },
        infrastructure: { type: "string", description: "Transit, highway, hospital, university, stadium projects." },
        schools: { type: "string" },
        safety: { type: "string", description: "Publicly reported crime context. Report sourced facts; do not characterize a neighborhood or its residents." },
      },
      required: ["summary", "major_employers", "employment_news", "new_supply", "infrastructure", "schools", "safety"],
    },

    competitive_set: {
      type: "array",
      items: sourced({
        name: { type: "string" },
        distance: { type: "string" },
        year_built: { type: "string" },
        units: { type: "string" },
        asking_rents: { type: "string" },
        positioning: { type: "string", description: "How it sits against the subject: newer, cheaper, better amenitized." },
      }, ["name", "distance", "year_built", "units", "asking_rents", "positioning"]),
    },

    // The literal "what did we miss" section.
    overlooked: {
      type: "array",
      items: sourced({
        finding: { type: "string" },
        why_it_matters: { type: "string" },
        impact: { type: "string", enum: ["opportunity", "risk", "context"] },
      }, ["finding", "why_it_matters", "impact"]),
      description: "Anything materially relevant that the standard sections above do not have a home for, and that an underwriter working from an OM would plausibly miss. Leave empty rather than padding.",
    },

    buybox_fit: {
      type: "object",
      additionalProperties: false,
      properties: {
        verdict: { type: "string", enum: ["strong", "possible", "weak", "unknown"] },
        criterion_reads: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              criterion: { type: "string" },
              read: { type: "string", enum: ["pass", "fail", "unknown"] },
              evidence: { type: "string" },
            },
            required: ["criterion", "read", "evidence"],
          },
        },
        reasons: { type: "array", items: { type: "string" } },
      },
      required: ["verdict", "criterion_reads", "reasons"],
    },

    diligence_questions: {
      type: "array",
      items: { type: "string" },
      description: "Specific questions to put to the broker or seller that this research raised and cannot answer. These should be sharp and property-specific, not generic diligence boilerplate.",
    },

    could_not_verify: {
      type: "array",
      items: { type: "string" },
      description: "What a public-web pass cannot establish: rent roll, T-12, NOI, actual occupancy, real comps, in-place debt terms.",
    },

    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          used_for: { type: "string" },
        },
        required: ["title", "url", "used_for"],
      },
    },
  },
  required: [
    "resolved", "physical", "rents", "resident_sentiment", "ownership",
    "debt_and_distress", "news_mentions", "legal_and_regulatory", "submarket",
    "competitive_set", "overlooked", "buybox_fit", "diligence_questions",
    "could_not_verify", "sources",
  ],
};

const DEFAULT_BUYBOX = `Ansonia Capital Management buybox:
- Value-add multifamily, 150+ units
- 1990s–2010s vintage
- In-place rents 10%+ below market (rent-growth upside)
- Submarket with <5% new supply as a share of existing stock
- Population and job growth above the national average
- Area median income >= $55K`;

function systemPrompt(buybox: string, depth: Depth, cfg: typeof DEPTH_CONFIG[Depth]) {
  return `You are a property research agent for Ansonia Capital Management, a value-add multifamily acquirer. You are given one property. Your job is to find everything the public web knows about it that bears on an acquisition decision, and to return it as structured, sourced findings.

You are not summarizing an offering memorandum. Assume the team already has the OM. Your value is entirely in what the OM does not say: what residents report, what local news covers, what public records show, what the seller has no incentive to volunteer.

RESEARCH METHOD
- Start by pinning down identity. Confirm you have the right property before gathering anything else — same-name properties in the same metro are common, and properties are renamed after a trade. If the property was renamed, search the prior name too; older reviews and news live under it.
- Search broadly first, then fetch the specific pages worth reading in full. Use web_fetch on review pages, news articles, and record pages where the search snippet is not enough.
- Budget: at most ${cfg.maxSearches} searches and ${cfg.maxFetches} page fetches. Spend them on what is most decision-relevant, not on completing every field.
- Prefer primary sources (county records, court dockets, the city's own permit portal) over aggregators repeating each other.
- When two sources disagree, report both and say so in resolved.notes. Do not average them or pick one silently.

WHERE TO LOOK
${SOURCE_HINTS}

HOW TO READ RESIDENT REVIEWS
This is the highest-value and most easily misread section.
- Weight recent reviews far above old ones, and say so when the trend has shifted. A decline beginning in a specific month usually marks an ownership or management change — name the month if you can find it.
- Distinguish a one-off angry reviewer from a theme repeated by many residents across platforms and months. Only the repeated ones belong in recurring_complaints.
- Translate complaints into operating and capital implications where the connection is real: repeated HVAC failures suggest end-of-life systems; repeated pest reports suggest a unit-turn and sanitation problem; repeated towing and package-theft complaints suggest a security and access-control spend. Where a complaint implies nothing specific, write "unknown" rather than inventing a capex number.
- Read the manager's replies. A management company that answers substantively is a different operating risk than one that has not replied in two years.
- Report what residents say. Do not characterize residents, and do not draw inferences about the people who live there — only about the physical asset and its operations.

HONESTY RULES — these override everything above
- Every finding needs a source_url that actually supports it. No source, no finding.
- Never invent, estimate, or interpolate: cap rates, NOI, occupancy, rent roll, T-12, expense ratios, debt terms, or exact comps. These are not public. They go in could_not_verify.
- When a field is not findable, write "unknown" or leave the array empty. An honest gap is more useful than a plausible guess, because a guess will be underwritten.
- Do not pad. An empty overlooked array is a fine answer. Listing weak findings to fill the section destroys the section's signal.
- If you cannot confidently identify the property at all, say so in resolved with low confidence and return empty sections rather than researching the wrong asset.

BUYBOX
Score against the criteria below. Give each criterion its own read with the evidence behind it. Where a criterion cannot be verified from public sources, mark it unknown — do not infer a pass. The overall verdict should not be "strong" if the criteria driving it are unknown.

${buybox}

Depth for this run: ${depth}. Return the structured snapshot and nothing else.`;
}

// ---------------------------------------------------------------------------
// Anthropic transport
// ---------------------------------------------------------------------------

class ResearchTimeout extends Error {
  constructor() { super("Research exceeded its wall-clock budget."); this.name = "ResearchTimeout"; }
}
class BudgetExceeded extends Error {
  constructor(msg: string) { super(msg); this.name = "BudgetExceeded"; }
}

async function callAnthropic(body: unknown, timeoutMs: number): Promise<any> {
  const maxAttempts = 3;
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let resp: Response;
    try {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
          // Server-side fallback: if a safety classifier declines the request,
          // the API re-runs it on a fallback model inside the same call rather
          // than returning an empty result.
          "anthropic-beta": "server-side-fallback-2026-07-01",
        },
        body: JSON.stringify(body),
      });
    } catch (err: any) {
      clearTimeout(timer);
      if (err?.name === "AbortError") throw new ResearchTimeout();
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (resp.ok) return resp.json();

    const txt = await resp.text();
    const msg = `anthropic ${resp.status}: ${txt.slice(0, 400)}`;
    const retriable = resp.status === 429 || resp.status === 529 || (resp.status >= 500 && resp.status < 600);
    if (!retriable) throw new Error(msg);
    lastErr = new Error(msg);
    console.warn(`[property-research] retriable ${resp.status}, attempt ${attempt}/${maxAttempts}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt * attempt));
  }
  throw lastErr ?? new Error("anthropic request failed");
}

type RunResult = {
  snapshot: any;
  costUsd: number;
  searches: number;
  fetches: number;
  model: string;
};

/**
 * Token rates for the model actually in use, read from ai_model_pricing.
 *
 * These were hardcoded at Opus 5 rates (5 / 25). Wrong rates here do not just
 * misreport spend — costUsd feeds the per-run ceiling, so an over-estimate
 * trips it early and an under-estimate never trips it at all.
 *
 * The fallback is deliberately Sonnet 5 list rates, NOT 0. A 0 rate would make
 * costUsd permanently 0, which disables the ceiling entirely — the opposite of
 * what that control exists for.
 */
async function loadModelRates(supabase: any): Promise<{ input: number; output: number }> {
  try {
    const { data } = await supabase
      .from("ai_model_pricing")
      .select("input_per_mtok, output_per_mtok")
      .eq("model", MODEL)
      .maybeSingle();
    const input = Number(data?.input_per_mtok);
    const output = Number(data?.output_per_mtok);
    if (Number.isFinite(input) && Number.isFinite(output) && input > 0) {
      return { input, output };
    }
  } catch (e) {
    console.warn(`[property-research] ai_model_pricing lookup failed: ${String(e)}`);
  }
  console.warn(`[property-research] no usable ai_model_pricing row for ${MODEL}; using Sonnet 5 list rates`);
  return { input: 2.00, output: 10.00 };
}

async function runAgent(opts: {
  supabase: any;
  userText: string;
  buybox: string;
  depth: Depth;
  dealId?: string | null;
  maxCostPerRun: number;
  onProgress: (note: string) => Promise<void>;
}): Promise<RunResult> {
  const cfg = DEPTH_CONFIG[opts.depth];
  const deadline = Date.now() + cfg.wallClockMs;
  const messages: any[] = [{ role: "user", content: opts.userText }];

  let searches = 0;
  let fetches = 0;
  let costUsd = 0;

  // Once per invocation: the rate cannot change mid-run, and this sits
  // inside the agent loop.
  const rates = await loadModelRates(opts.supabase);

  const tools = [
    { type: "web_search_20260209", name: "web_search", max_uses: cfg.maxSearches },
    { type: "web_fetch_20260209",  name: "web_fetch",  max_uses: cfg.maxFetches, max_content_tokens: 20000 },
  ];

  for (let step = 0; step < cfg.maxSteps; step++) {
    if (Date.now() > deadline) throw new ResearchTimeout();

    const data = await callAnthropic({
      model: MODEL,
      max_tokens: cfg.maxTokens,
      // Sonnet 5 runs adaptive thinking. `summarized` gives us readable
      // progress notes instead of an opaque multi-minute pause.
      thinking: { type: "adaptive", display: "summarized" },
      output_config: {
        effort: cfg.effort,
        format: { type: "json_schema", schema: SNAPSHOT_SCHEMA },
      },
      fallbacks: "default",
      system: systemPrompt(opts.buybox, opts.depth, cfg),
      tools,
      messages,
    }, Math.min(deadline - Date.now(), 240_000));

    // --- accounting, every step, before anything can throw ------------------
    const usage = normalizeUsage(data?.usage);
    await logAiUsage(opts.supabase, {
      function_name: "property-research",
      model: MODEL,
      provider: "anthropic",
      usage: data?.usage,
      deal_id: opts.dealId ?? null,
    });
    costUsd += (usage.input_tokens / 1e6) * rates.input + (usage.output_tokens / 1e6) * rates.output;

    const stepSearches = (data?.content ?? []).filter((b: any) => b.type === "server_tool_use" && b.name === "web_search").length;
    const stepFetches  = (data?.content ?? []).filter((b: any) => b.type === "server_tool_use" && b.name === "web_fetch").length;
    searches += stepSearches;
    fetches  += stepFetches;
    if (stepSearches > 0) {
      await logApiRequest(opts.supabase, {
        function_name: "property-research",
        service: "anthropic_web_search",
        provider: "anthropic",
        units: stepSearches,
        deal_id: opts.dealId ?? null,
      });
    }

    if (costUsd > opts.maxCostPerRun) {
      throw new BudgetExceeded(
        `Run stopped at $${costUsd.toFixed(2)}, over the $${opts.maxCostPerRun.toFixed(2)} per-run ceiling.`,
      );
    }

    // --- surface progress ---------------------------------------------------
    const note = (data?.content ?? [])
      .filter((b: any) => b.type === "thinking" && b.thinking)
      .map((b: any) => String(b.thinking))
      .join(" ")
      .slice(0, 180);
    if (note) await opts.onProgress(note);
    else await opts.onProgress(`Searched ${searches}, read ${fetches} pages…`);

    // --- stop reasons -------------------------------------------------------
    if (data.stop_reason === "refusal") {
      const cat = data?.stop_details?.category ?? "unspecified";
      throw new Error(`Research was declined by the model's safety system (${cat}).`);
    }

    // A server tool is still working. Push the turn back and continue.
    if (data.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: data.content });
      continue;
    }

    if (data.stop_reason === "max_tokens") {
      throw new Error("Research output was truncated. Try a shallower depth or raise max_tokens.");
    }

    const text = (data.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    if (!text.trim()) {
      // No text and not paused — the model used tools and stopped. Continue.
      messages.push({ role: "assistant", content: data.content });
      continue;
    }

    let snapshot: any;
    try {
      snapshot = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("Model returned non-JSON output.");
      snapshot = JSON.parse(m[0]);
    }

    return { snapshot, costUsd, searches, fetches, model: MODEL };
  }

  throw new Error(`Research did not converge within ${cfg.maxSteps} steps.`);
}

// ---------------------------------------------------------------------------
// Job execution
// ---------------------------------------------------------------------------

async function executeJob(supabase: any, jobId: string) {
  const started = Date.now();

  const { data: job } = await supabase
    .from("property_research_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!job) return;
  if (job.status !== "queued") return; // already picked up

  await supabase.from("property_research_jobs")
    .update({ status: "running", started_at: new Date().toISOString(), progress: "Starting research…" })
    .eq("id", jobId);

  const setProgress = async (progress: string) => {
    await supabase.from("property_research_jobs").update({ progress }).eq("id", jobId);
  };

  try {
    const { data: settings } = await supabase
      .from("property_research_settings").select("*").eq("id", 1).maybeSingle();

    const maxCost = Number(settings?.max_cost_per_run_usd ?? 2);

    // Buybox: prefer the stored thesis over the hardcoded default.
    let buybox = DEFAULT_BUYBOX;
    try {
      const { data: thesis } = await supabase.from("buy_box_thesis").select("*").limit(1).maybeSingle();
      const t = (thesis as any)?.thesis ?? (thesis as any)?.content ?? (thesis as any)?.body;
      if (t && String(t).trim()) buybox = String(t).trim();
    } catch { /* fall back to the default */ }

    // Give the agent what we already know, so it spends searches on what we don't.
    let known = "";
    if (job.deal_id) {
      const { data: deal } = await supabase
        .from("deals")
        .select("property_name, address, city, state, unit_count, vintage_year, asking_price, broker")
        .eq("id", job.deal_id).maybeSingle();
      if (deal) {
        const facts = Object.entries(deal)
          .filter(([, v]) => v != null && v !== "")
          .map(([k, v]) => `- ${k}: ${v}`).join("\n");
        if (facts) known = `\n\nAlready on file (verify rather than re-derive; flag any conflict):\n${facts}`;
      }
    }

    const target = [job.property_name, job.address].filter(Boolean).join(" — ");
    const userText = `Research this multifamily property: ${target}${known}`;

    const result = await runAgent({
      supabase,
      userText,
      buybox,
      depth: (job.depth ?? "standard") as Depth,
      dealId: job.deal_id,
      maxCostPerRun: maxCost,
      onProgress: setProgress,
    });

    const { data: inserted } = await supabase.from("property_research").insert({
      deal_id: job.deal_id,
      address: job.address,
      property_name: job.property_name,
      snapshot: result.snapshot,
      model: result.model,
      cost_usd: Number(result.costUsd.toFixed(6)),
      searches_used: result.searches,
      fetches_used: result.fetches,
      duration_ms: Date.now() - started,
      created_by: job.created_by,
    }).select("id").maybeSingle();

    await supabase.from("property_research_jobs").update({
      status: "succeeded",
      snapshot: result.snapshot,
      research_id: inserted?.id ?? null,
      model: result.model,
      cost_usd: Number(result.costUsd.toFixed(6)),
      progress: null,
      finished_at: new Date().toISOString(),
    }).eq("id", jobId);

  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error(`[property-research] job ${jobId} failed:`, msg);
    await supabase.from("property_research_jobs").update({
      status: "failed",
      error: msg.slice(0, 1000),
      progress: null,
      finished_at: new Date().toISOString(),
    }).eq("id", jobId);
  }
}

// ---------------------------------------------------------------------------
// HTTP entry
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));

    // --- internal worker invocation ----------------------------------------
    if (body.job_id && body._internal_secret) {
      if (!CRON_SHARED_SECRET || body._internal_secret !== CRON_SHARED_SECRET) {
        return json({ error: "forbidden" }, 403);
      }
      // @ts-ignore EdgeRuntime is provided by the Supabase runtime
      EdgeRuntime.waitUntil(executeJob(supabase, body.job_id));
      return json({ accepted: true });
    }

    // --- public: start a job ------------------------------------------------
    const { deal_id, address, property_name, depth, force } = body as {
      deal_id?: string; address?: string; property_name?: string; depth?: Depth; force?: boolean;
    };

    if (!address && !property_name) {
      return json({ error: "Provide an address and/or property_name." }, 400);
    }

    const { data: settings } = await supabase
      .from("property_research_settings").select("*").eq("id", 1).maybeSingle();

    if (!settings?.enabled) {
      return json({ error: "Property research is turned off. An admin can enable it in settings." }, 409);
    }

    // Budget gate — the reason this feature was paused.
    const { data: spend } = await supabase.rpc("property_research_mtd_spend");
    const mtd = Number(spend ?? 0);
    const budget = Number(settings.monthly_budget_usd ?? 0);
    if (budget > 0 && mtd >= budget) {
      return json({
        error: `Month-to-date research spend is $${mtd.toFixed(2)} against a $${budget.toFixed(2)} budget. Raise the budget in settings or wait for the month to roll over.`,
      }, 429);
    }

    // Reuse a recent snapshot instead of paying twice.
    if (deal_id && !force) {
      const cooldownHours = Number(settings.cooldown_hours ?? 168);
      const since = new Date(Date.now() - cooldownHours * 3600_000).toISOString();
      const { data: recent } = await supabase
        .from("property_research")
        .select("id, snapshot, created_at, model")
        .eq("deal_id", deal_id).gte("created_at", since)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (recent) {
        return json({
          cached: true, research_id: recent.id, snapshot: recent.snapshot,
          generated_at: recent.created_at, model: recent.model,
        });
      }
    }

    // One live job per deal.
    if (deal_id) {
      const { data: live } = await supabase
        .from("property_research_jobs").select("id")
        .eq("deal_id", deal_id).in("status", ["queued", "running"]).maybeSingle();
      if (live) return json({ job_id: live.id, already_running: true });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    let userId: string | null = null;
    try {
      const token = authHeader.replace("Bearer ", "");
      const { data } = await supabase.auth.getUser(token);
      userId = data?.user?.id ?? null;
    } catch { /* anonymous is acceptable */ }

    const { data: job, error: jobErr } = await supabase
      .from("property_research_jobs").insert({
        deal_id: deal_id ?? null,
        address: address ?? null,
        property_name: property_name ?? null,
        depth: depth ?? settings.default_depth ?? "standard",
        created_by: userId,
      }).select("id").single();

    if (jobErr) return json({ error: `Could not queue research: ${jobErr.message}` }, 500);

    // Hand the job to a fresh invocation so this request returns immediately
    // and the work gets its own wall-clock allowance.
    fetch(`${SUPABASE_URL}/functions/v1/property-research`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ job_id: job.id, _internal_secret: CRON_SHARED_SECRET }),
    }).catch((e) => console.error("[property-research] worker dispatch failed:", e?.message));

    return json({ job_id: job.id, status: "queued" });

  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const billing = /credit balance is too low|billing|insufficient[_ ]quota|quota exceeded/i.test(msg);
    const auth = /\b(401|invalid[_ ]api[_ ]key|authentication)\b/i.test(msg);
    if (billing) return json({ error: "The Anthropic API credit balance is exhausted. Top up in the Anthropic console and try again." }, 402);
    if (auth) return json({ error: "The Anthropic API key is invalid or missing." }, 401);
    return json({ error: msg }, 500);
  }
});
