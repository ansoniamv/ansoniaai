// Shared usage logger for AI edge functions.
// Never throws — logging failures must not break the caller.

type SupabaseLike = {
  from: (table: string) => any;
};

// In-memory rate cache (per-function-instance). Refreshed on demand.
const rateCache = new Map<string, {
  input_per_mtok: number;
  output_per_mtok: number;
  cached_input_per_mtok: number;
  provider: string | null;
  fetched_at: number;
}>();
const RATE_TTL_MS = 5 * 60_000;

async function getRate(supabase: SupabaseLike, model: string) {
  const cached = rateCache.get(model);
  if (cached && Date.now() - cached.fetched_at < RATE_TTL_MS) return cached;
  try {
    const { data } = await supabase
      .from("ai_model_pricing")
      .select("input_per_mtok, output_per_mtok, cached_input_per_mtok, provider")
      .eq("model", model)
      .maybeSingle();
    const row = {
      input_per_mtok: Number(data?.input_per_mtok ?? 0),
      output_per_mtok: Number(data?.output_per_mtok ?? 0),
      cached_input_per_mtok: Number(data?.cached_input_per_mtok ?? 0),
      provider: (data?.provider as string | null) ?? null,
      fetched_at: Date.now(),
    };
    rateCache.set(model, row);
    return row;
  } catch {
    return null;
  }
}

/** Normalize usage from either OpenAI-shape or Anthropic-shape response. */
export function normalizeUsage(usage: any): {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
} {
  if (!usage || typeof usage !== "object") {
    return { input_tokens: 0, output_tokens: 0, cached_tokens: 0 };
  }
  // OpenAI/Lovable-gateway shape: prompt_tokens, completion_tokens
  //   optional prompt_tokens_details.cached_tokens
  // Anthropic shape: input_tokens, output_tokens, cache_read_input_tokens
  const input =
    Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
  const output =
    Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
  const cached =
    Number(
      usage.prompt_tokens_details?.cached_tokens ??
        usage.cache_read_input_tokens ??
        usage.cached_tokens ??
        0,
    ) || 0;
  return { input_tokens: input, output_tokens: output, cached_tokens: cached };
}

export type LogAiUsageArgs = {
  function_name: string;
  model: string;
  provider?: string;
  usage: any;
  deal_id?: string | null;
  partner_id?: string | null;
  success?: boolean;
};

export async function logAiUsage(
  supabase: SupabaseLike,
  args: LogAiUsageArgs,
): Promise<void> {
  try {
    const { input_tokens, output_tokens, cached_tokens } = normalizeUsage(args.usage);
    // Skip entirely-empty entries to keep the log meaningful.
    if (input_tokens === 0 && output_tokens === 0 && cached_tokens === 0 && args.success !== false) {
      return;
    }
    const rate = await getRate(supabase, args.model);
    // Cost: (billable input * rate) + (cached input * cached rate) + (output * rate)
    // input_tokens in OpenAI shape INCLUDES cached_tokens; subtract to avoid double-billing.
    const billableInput = Math.max(0, input_tokens - cached_tokens);
    let cost_usd: number | null = 0;
    if (rate) {
      cost_usd =
        (billableInput / 1_000_000) * rate.input_per_mtok +
        (cached_tokens / 1_000_000) * rate.cached_input_per_mtok +
        (output_tokens / 1_000_000) * rate.output_per_mtok;
      // Round to 6 decimal places
      cost_usd = Math.round(cost_usd * 1_000_000) / 1_000_000;
    } else {
      // Unknown model → still log tokens, cost 0.
      cost_usd = 0;
    }

    await supabase.from("ai_usage_log").insert({
      function_name: args.function_name,
      model: args.model,
      provider: args.provider ?? rate?.provider ?? null,
      input_tokens,
      output_tokens,
      cached_tokens,
      cost_usd,
      success: args.success !== false,
      deal_id: args.deal_id ?? null,
      partner_id: args.partner_id ?? null,
    });
  } catch (e) {
    // NEVER throw into caller.
    console.error("[logAiUsage] failed:", (e as Error)?.message);
  }
}

// --- Per-request API logging (HelloData, Esri, etc.) ---------------------
const perCallCache = new Map<string, { per_call_usd: number; provider: string | null; fetched_at: number }>();

async function getPerCallRate(supabase: SupabaseLike, service: string) {
  const cached = perCallCache.get(service);
  if (cached && Date.now() - cached.fetched_at < RATE_TTL_MS) return cached;
  try {
    const { data } = await supabase
      .from("ai_model_pricing")
      .select("per_call_usd, provider")
      .eq("model", service)
      .eq("billing_type", "request")
      .maybeSingle();
    const row = {
      per_call_usd: Number(data?.per_call_usd ?? 0),
      provider: (data?.provider as string | null) ?? null,
      fetched_at: Date.now(),
    };
    perCallCache.set(service, row);
    return row;
  } catch {
    return null;
  }
}

export type LogApiRequestArgs = {
  function_name: string;
  service: string;
  provider?: string;
  units?: number;
  deal_id?: string | null;
  partner_id?: string | null;
  success?: boolean;
};

export async function logApiRequest(
  supabase: SupabaseLike,
  args: LogApiRequestArgs,
): Promise<void> {
  try {
    const rawUnits = Number(args.units ?? 1);
    const units = Number.isFinite(rawUnits) && rawUnits >= 0 ? rawUnits : 1;
    const rate = await getPerCallRate(supabase, args.service);
    const perCall = rate?.per_call_usd ?? 0;
    const cost_usd = Math.round(perCall * units * 1_000_000) / 1_000_000;

    await supabase.from("ai_usage_log").insert({
      function_name: args.function_name,
      billing_type: "request",
      service: args.service,
      provider: args.provider ?? rate?.provider ?? null,
      units,
      cost_usd,
      success: args.success !== false,
      deal_id: args.deal_id ?? null,
      partner_id: args.partner_id ?? null,
    });
  } catch (e) {
    console.error("[logApiRequest] failed:", (e as Error)?.message);
  }
}
