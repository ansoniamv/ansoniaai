// property-research
// Claude-powered property research. Given an address (and optionally a property
// name / deal_id), Claude uses the server-side web_search tool to
// assemble a public-record + market snapshot: identity, unit mix, current rents,
// ownership, resident sentiment, and an honest "could not verify" list — plus an
// automatic buybox-fit read scored against Ansonia's investment criteria.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logAiUsage } from "../_shared/logUsage.ts";
import { corsFor, requireApprovedUser } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
// claude-opus-5 also fixes a latent mismatch: the web_search_20260209 tool used
// below requires Opus 4.6+/Sonnet 4.6+ and is not supported on claude-sonnet-4-5.
const MODEL = Deno.env.get("PROPERTY_RESEARCH_MODEL") ?? Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-5";
const RESEARCH_TIMEOUT_MS = 25_000;

const DEFAULT_BUYBOX = `Ansonia Capital Management buybox:
- Value-add multifamily, 150+ units
- 1990s–2010s vintage
- In-place rents 10%+ below market (rent-growth upside)
- Submarket with <5% new supply as a share of existing stock
- Population and job growth above the national average
- Area median income >= $55K`;

const tools = [
  { type: "web_search_20260209", name: "web_search", max_uses: 2 },
];

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
        notes: { type: "string", description: "Anything ambiguous about the match (e.g. conflicting unit counts across sources)." },
      },
      required: ["property_name", "address", "confidence", "notes"],
    },
    physical: {
      type: "object",
      additionalProperties: false,
      properties: {
        year_built: { type: "string" },
        units: { type: "string" },
        stories: { type: "string" },
        unit_types: { type: "array", items: { type: "string" } },
        sqft_range: { type: "string" },
      },
      required: ["year_built", "units", "stories", "unit_types", "sqft_range"],
    },
    rents: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        one_bed_from: { type: "string" },
        two_bed_from: { type: "string" },
        three_bed_from: { type: "string" },
        below_market_signal: { type: "string", description: "Any listing-site signal that rents are below/above area — directional only." },
      },
      required: ["summary", "one_bed_from", "two_bed_from", "three_bed_from", "below_market_signal"],
    },
    market_signals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          signal: { type: "string" },
          detail: { type: "string" },
          source_url: { type: "string" },
        },
        required: ["signal", "detail", "source_url"],
      },
    },
    ownership: {
      type: "object",
      additionalProperties: false,
      properties: {
        owner_entity: { type: "string" },
        management_company: { type: "string" },
        contact: { type: "string" },
        source_url: { type: "string" },
      },
      required: ["owner_entity", "management_company", "contact", "source_url"],
    },
    sentiment: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        positives: { type: "array", items: { type: "string" } },
        negatives: { type: "array", items: { type: "string" } },
      },
      required: ["summary", "positives", "negatives"],
    },
    buybox_fit: {
      type: "object",
      additionalProperties: false,
      properties: {
        verdict: { type: "string", enum: ["strong", "possible", "weak", "unknown"] },
        reasons: { type: "array", items: { type: "string" } },
      },
      required: ["verdict", "reasons"],
    },
    could_not_verify: {
      type: "array",
      items: { type: "string" },
      description: "What a public-web pass cannot establish (exact comps, NOI, occupancy, rent roll, T-12).",
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          url: { type: "string" },
        },
        required: ["title", "url"],
      },
    },
  },
  required: [
    "resolved", "physical", "rents", "market_signals",
    "ownership", "sentiment", "buybox_fit", "could_not_verify", "sources",
  ],
};

function systemPrompt(buybox: string) {
  return `You are a real estate acquisitions research assistant for Ansonia Capital Management. Given a multifamily property (address and/or name), use web_search to assemble a concise public-record and market snapshot.

SPEED RULES:
- Use at most 2 web searches total.
- Prefer the best available public sources over exhaustive research.
- If a detail cannot be verified quickly, write "unknown" and move on.

WHAT TO GATHER (public / findable sources):
- Identity & physical: year built, unit count, stories, unit mix, sqft range. Cross-check across listing sites; note conflicts rather than guessing.
- Current asking rents by bed type from listing aggregators (ApartmentFinder, Apartments.com, RentCafe, Rentable, Zillow, etc.).
- Any directional "below/above market" signal a listing site surfaces — clearly directional, not exact.
- Ownership / management: entity of record and management company if publicly discoverable; leasing/marketing contact if listed.
- Resident sentiment: balanced read from reviews (both positives and negatives).
- News: foreclosure, litigation, development, or transaction mentions.

HONESTY RULES (critical):
- Only report what a source supports. Put a source_url on every market signal and list all sources.
- Do NOT invent exact comps, cap rates, NOI, occupancy, rent roll, or T-12 — these are not public. List them under could_not_verify.
- When a field isn't findable, write "unknown" (or leave the array empty). Never fabricate a number.
- Flag conflicting data across sources in resolved.notes.

BUYBOX FIT:
Score the property against the buybox below. Base the verdict only on what you actually found; if key criteria are unverifiable, prefer "possible" or "unknown" and say why in reasons.

${buybox}`;
}

class AnthropicOverloadedError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "AnthropicOverloadedError";
  }
}

class AnthropicTimeoutError extends Error {
  constructor(message = "Live web research timed out before the backend request limit.") {
    super(message);
    this.name = "AnthropicTimeoutError";
  }
}

function asNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function money(value: unknown): string {
  const n = asNumber(value);
  return n == null ? "unknown" : `$${Math.round(n).toLocaleString()}`;
}

function pct(value: unknown, storedAsFraction = false): string {
  const n = asNumber(value);
  if (n == null) return "unknown";
  const normalized = storedAsFraction ? n * 100 : n;
  return `${normalized.toFixed(1)}%`;
}

function textOrUnknown(value: unknown): string {
  const text = value == null ? "" : String(value).trim();
  return text || "unknown";
}

function floorPlans(deal: any): any[] {
  return Array.isArray(deal?.floor_plans) ? deal.floor_plans : [];
}

function rentFromPlans(deal: any, bed: string): string {
  const plans = floorPlans(deal);
  const target = bed.toLowerCase();
  const plan = plans.find((p) => String(p?.beds ?? "").toLowerCase() === target)
    ?? plans.find((p) => String(p?.beds ?? "").toLowerCase().includes(target));
  return money(plan?.avg_rent);
}

function sqftRange(deal: any): string {
  const sizes = floorPlans(deal).map((p) => asNumber(p?.avg_sqft)).filter((n): n is number => n != null);
  if (!sizes.length) return "unknown";
  const min = Math.min(...sizes);
  const max = Math.max(...sizes);
  return min === max ? `${Math.round(min).toLocaleString()} sf` : `${Math.round(min).toLocaleString()}–${Math.round(max).toLocaleString()} sf`;
}

function unitTypes(deal: any): string[] {
  const labels = floorPlans(deal)
    .map((p) => String(p?.beds ?? "").trim())
    .filter(Boolean)
    .map((beds) => (beds.toLowerCase() === "studio" ? "Studio" : `${beds}BR`));
  return [...new Set(labels)];
}

function fallbackBuyboxFit(deal: any) {
  const reasons: string[] = [];
  let positive = 0;
  let negative = 0;

  const units = asNumber(deal?.unit_count);
  if (units != null) {
    if (units >= 150) {
      positive += 1;
      reasons.push(`${Math.round(units).toLocaleString()} units clears the 150+ unit scale screen.`);
    } else {
      negative += 1;
      reasons.push(`${Math.round(units).toLocaleString()} units is below the 150+ unit scale screen.`);
    }
  }

  const vintage = asNumber(deal?.vintage_year);
  if (vintage != null) {
    if (vintage >= 1990 && vintage <= 2024) {
      positive += 1;
      reasons.push(`${Math.round(vintage)} vintage fits the target post-1990 multifamily profile.`);
    } else {
      negative += 1;
      reasons.push(`${Math.round(vintage)} vintage is outside the stated 1990s–2010s target.`);
    }
  }

  const income = asNumber(deal?.median_income_tract ?? deal?.area_median_income);
  if (income != null) {
    if (income >= 55_000) {
      positive += 1;
      reasons.push(`Median income of ${money(income)} clears the $55K income screen.`);
    } else {
      negative += 1;
      reasons.push(`Median income of ${money(income)} is below the $55K income screen.`);
    }
  }

  const supply = asNumber(deal?.new_supply_pct_of_stock);
  if (supply != null) {
    if (supply <= 5) {
      positive += 1;
      reasons.push(`New supply signal of ${pct(supply)} is below the 5% screen.`);
    } else {
      negative += 1;
      reasons.push(`New supply signal of ${pct(supply)} is above the 5% screen.`);
    }
  }

  const pop = asNumber(deal?.population_growth_pct ?? deal?.annual_population_growth);
  if (pop != null) {
    if (pop > 0) {
      positive += 1;
      reasons.push(`Population growth is positive at ${pct(pop)}.`);
    } else {
      negative += 1;
      reasons.push(`Population growth is negative at ${pct(pop)}.`);
    }
  }

  const job = asNumber(deal?.job_growth_pct);
  if (job != null) {
    if (job > 0) {
      positive += 1;
      reasons.push(`Job growth is positive at ${pct(job)}.`);
    } else {
      negative += 1;
      reasons.push(`Job growth is negative at ${pct(job)}.`);
    }
  }

  if (!reasons.length) reasons.push("Not enough stored deal data is available to make a reliable buybox call.");

  const verdict = positive >= 4 && negative <= 1 ? "strong" : positive >= 3 ? "possible" : negative >= 3 ? "weak" : "unknown";
  return { verdict, reasons };
}

async function fallbackSnapshot(supabase: any, args: { address?: string; property_name?: string; deal_id?: string }, reason: string) {
  let deal: any = null;
  let enrichment: any = null;

  if (args.deal_id) {
    const [dealResult, enrichmentResult] = await Promise.all([
      supabase.from("deals").select("*").eq("id", args.deal_id).maybeSingle(),
      supabase.from("deal_enrichment").select("*").eq("deal_id", args.deal_id).maybeSingle(),
    ]);
    deal = dealResult.data;
    enrichment = enrichmentResult.data;
  }

  const propertyName = textOrUnknown(args.property_name ?? deal?.property_name);
  const address = textOrUnknown(args.address ?? deal?.property_address ?? deal?.address ?? [deal?.property_name, deal?.city, deal?.state].filter(Boolean).join(", "));
  const plans = floorPlans(deal);
  const concessions = Array.isArray(deal?.concessions_history) ? deal.concessions_history : [];

  const marketSignals = [
    deal?.msa && { signal: "MSA", detail: String(deal.msa), source_url: "" },
    deal?.median_income_tract != null && { signal: "Median household income", detail: money(deal.median_income_tract), source_url: "" },
    deal?.vacancy_rate_tract != null && { signal: "Tract vacancy", detail: pct(deal.vacancy_rate_tract, true), source_url: "" },
    deal?.population_growth_pct != null && { signal: "Population growth", detail: pct(deal.population_growth_pct), source_url: "" },
    deal?.job_growth_pct != null && { signal: "Job growth", detail: pct(deal.job_growth_pct), source_url: "" },
    deal?.new_supply_pct_of_stock != null && { signal: "New supply", detail: pct(deal.new_supply_pct_of_stock), source_url: "" },
    enrichment?.matched_address && { signal: "Geocode match", detail: String(enrichment.matched_address), source_url: "" },
  ].filter(Boolean);

  const avgRents = plans.map((p) => `${p?.beds ?? "Unit"}: ${money(p?.avg_rent)}`).join("; ");
  const concessionsSummary = concessions[0]?.description ? ` Recent concession record: ${concessions[0].description}` : "";

  return {
    resolved: {
      property_name: propertyName,
      address,
      confidence: deal ? "medium" : "low",
      notes: `${reason} This snapshot uses stored deal and enrichment fields instead of live web citations.`,
    },
    physical: {
      year_built: textOrUnknown(deal?.vintage_year),
      units: textOrUnknown(deal?.unit_count),
      stories: "unknown",
      unit_types: unitTypes(deal),
      sqft_range: sqftRange(deal),
    },
    rents: {
      summary: avgRents ? `Stored average asking rents by floor plan: ${avgRents}.${concessionsSummary}` : "unknown",
      one_bed_from: rentFromPlans(deal, "1"),
      two_bed_from: rentFromPlans(deal, "2"),
      three_bed_from: rentFromPlans(deal, "3"),
      below_market_signal: deal?.in_place_avg_rent != null ? `Stored in-place average rent: ${money(deal.in_place_avg_rent)}.` : "unknown",
    },
    market_signals: marketSignals,
    ownership: {
      owner_entity: "unknown",
      management_company: textOrUnknown(deal?.management_company),
      contact: textOrUnknown(deal?.property_phone ?? deal?.property_website),
      source_url: "",
    },
    sentiment: {
      summary: deal?.review_avg_rating != null ? `Stored review rating is ${deal.review_avg_rating} across ${deal?.review_count ?? "unknown"} reviews.` : "unknown",
      positives: [],
      negatives: [],
    },
    buybox_fit: fallbackBuyboxFit(deal),
    could_not_verify: [
      "Live public-web source citations were not completed in this run.",
      "Ownership entity, current concessions, exact market comps, NOI, occupancy, rent roll, and T-12 require source verification.",
    ],
    sources: deal ? [{ title: "Stored deal and enrichment fields", url: "" }] : [],
  };
}

async function callAnthropic(body: unknown, timeoutMs: number) {
  const maxAttempts = 1;
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let resp: Response;
    try {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
    } catch (error: any) {
      if (error?.name === "AbortError") throw new AnthropicTimeoutError();
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (resp.ok) return resp.json();
    const txt = await resp.text();
    const retriable = resp.status === 429 || resp.status === 529 || (resp.status >= 500 && resp.status < 600);
    const msg = `anthropic ${resp.status}: ${txt.slice(0, 400)}`;
    if (!retriable) throw new Error(msg);
    lastErr = resp.status === 529
      ? new AnthropicOverloadedError(resp.status, msg)
      : new Error(msg);
    console.warn(`[property-research] retriable ${resp.status}, attempt ${attempt}/${maxAttempts}`);
  }
  throw lastErr ?? new Error("anthropic request failed");
}

async function anthropicResearch(userText: string, buybox: string, ctx?: { supabase: any; deal_id?: string }) {
  const messages: any[] = [{ role: "user", content: userText }];
  const deadline = Date.now() + RESEARCH_TIMEOUT_MS;

  for (let step = 0; step < 2; step++) {
    const remaining = deadline - Date.now();
    if (remaining < 10_000) throw new AnthropicTimeoutError();

    const data = await callAnthropic({
      model: MODEL,
      // Opus 5 runs adaptive thinking by default and those tokens share this
      // budget, so it is raised from the old 2500 to leave room for the answer.
      max_tokens: 16000,
      // `thinking` is intentionally omitted: Opus 5 runs adaptive thinking when
      // the field is absent. Do not add budget_tokens — it returns a 400.
      output_config: {
        format: { type: "json_schema", schema: SNAPSHOT_SCHEMA },
      },
      system: systemPrompt(buybox),
      tools,
      messages,
    }, Math.min(remaining, RESEARCH_TIMEOUT_MS));

    if (ctx?.supabase) {
      await logAiUsage(ctx.supabase, { function_name: "property-research", model: MODEL, provider: "anthropic", usage: data?.usage, deal_id: ctx.deal_id });
    }



    if (data.stop_reason === "refusal") {
      throw new Error("Research request was refused by the model's safety system.");
    }

    if (data.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: data.content });
      continue;
    }

    const text = (data.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    try {
      return JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error("Model returned non-JSON output.");
    }
  }

  throw new Error("Research did not converge (max tool steps reached).");
}

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // `address` is free text that becomes the Opus 5 prompt, and web_search is
  // attached — unauthenticated this endpoint is a billable model proxy.
  const authz = await requireApprovedUser(req);
  if (!authz.ok) return authz.response;

  let supabase: any = null;
  let requestArgs: { address?: string; property_name?: string; deal_id?: string } = {};

  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    requestArgs = await req.json();
    const { address, property_name, deal_id } = requestArgs;
    if (!address && !property_name) {
      return new Response(JSON.stringify({ error: "Provide an address and/or property_name." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // These strings are interpolated into the model prompt. An address and a
    // property name are short; anything longer is prompt payload, not a lookup.
    const MAX_TARGET_LEN = 200;
    if ((address?.length ?? 0) > MAX_TARGET_LEN || (property_name?.length ?? 0) > MAX_TARGET_LEN) {
      return new Response(
        JSON.stringify({ error: `address and property_name must each be under ${MAX_TARGET_LEN} characters.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    let buybox = DEFAULT_BUYBOX;
    try {
      const { data: thesis } = await supabase
        .from("buy_box_thesis")
        .select("*")
        .limit(1)
        .maybeSingle();
      const text = (thesis as any)?.thesis ?? (thesis as any)?.content ?? (thesis as any)?.body;
      if (text && String(text).trim()) buybox = String(text).trim();
    } catch {
      // buy_box_thesis unavailable — use the default summary.
    }

    const target = [property_name, address].filter(Boolean).join(" — ");
    const userText = `Research this multifamily property and return the structured snapshot: ${target}`;

    let snapshot;
    let fallback = false;
    let warning: string | undefined;
    let responseModel = MODEL;

    try {
      snapshot = await anthropicResearch(userText, buybox, { supabase, deal_id });
    } catch (error: any) {
      if (!(error instanceof AnthropicTimeoutError)) throw error;
      warning = "Live web research timed out, so this run returned a stored-data snapshot instead of crashing.";
      snapshot = await fallbackSnapshot(supabase, requestArgs, warning);
      fallback = true;
      responseModel = `${MODEL} + stored-data fallback`;
    }

    if (deal_id) {
      try {
        await supabase.from("property_research").insert({
          deal_id,
          address: address ?? null,
          property_name: property_name ?? null,
          snapshot,
          model: responseModel,
        });
      } catch {
        // Table not present yet; snapshot is still returned to the caller.
      }
    }

    return new Response(
      JSON.stringify({ snapshot, model: responseModel, generated_at: new Date().toISOString(), fallback, warning }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const overloaded = e instanceof AnthropicOverloadedError || /\b(529|overloaded)\b/i.test(msg);
    const billing = /credit balance is too low|billing|insufficient[_ ]quota|quota exceeded/i.test(msg);
    const auth = /\b(401|invalid[_ ]api[_ ]key|authentication)\b/i.test(msg);

    let status = 500;
    let error = msg;
    let retryable = false;

    if (overloaded) {
      status = 503;
      error = "The research model is temporarily overloaded. Please try again in a moment.";
      retryable = true;
    } else if (billing) {
      status = 402;
      error = "Property research is unavailable: the Anthropic API credit balance is exhausted. Please top up credits in the Anthropic console (Plans & Billing) and try again.";
    } else if (auth) {
      status = 401;
      error = "Property research is unavailable: the Anthropic API key is invalid or missing.";
    }

    return new Response(JSON.stringify({ error, retryable }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
