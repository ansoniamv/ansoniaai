// Single entry point for every AI text call in the platform.
//
// Claude Opus 5 is the primary model. The Lovable gateway remains as an
// automatic fallback so a single Anthropic outage cannot take the platform
// down; set USE_ANTHROPIC=0 to force the fallback path.
//
// SECURITY: both API keys are read from the edge-function environment and are
// only ever used server-side. Nothing here reaches the browser.

import { callClaude, callClaudeRaw, isAnthropicConfigured, AnthropicRefusalError } from "./anthropic.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const USE_ANTHROPIC = Deno.env.get("USE_ANTHROPIC") !== "0";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const FALLBACK_MODEL = Deno.env.get("FALLBACK_MODEL") ?? "google/gemini-2.5-flash";

export interface CompleteOptions {
  system?: string;
  /** Keep generous: Opus 5 thinking tokens share this budget. */
  maxTokens?: number;
  /** "low" | "medium" | "high" | "xhigh" | "max" — omit for the API default. */
  effort?: string;
  timeoutMs?: number;
  /** Set false for calls that must not silently degrade to the fallback model. */
  allowFallback?: boolean;
}

export interface CompleteResult {
  text: string;
  model: string;
  provider: "anthropic" | "lovable-gateway";
  usage: any;
  /** Populated when the primary model failed and the fallback answered. */
  fallbackReason?: string;
}

async function callGateway(prompt: string, opts: CompleteOptions): Promise<CompleteResult> {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  const messages: any[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: FALLBACK_MODEL,
      max_tokens: opts.maxTokens ?? 2000,
      messages,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gateway ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  return {
    text: (data?.choices?.[0]?.message?.content ?? "").trim(),
    model: FALLBACK_MODEL,
    provider: "lovable-gateway",
    usage: data?.usage,
  };
}

/**
 * Run a prompt through Claude Opus 5, falling back to the gateway on failure.
 * A refusal is never retried on the fallback — it is surfaced to the caller.
 */
export async function completeText(prompt: string, opts: CompleteOptions = {}): Promise<CompleteResult> {
  const allowFallback = opts.allowFallback !== false;

  if (USE_ANTHROPIC && isAnthropicConfigured()) {
    try {
      const res = await callClaude(prompt, {
        system: opts.system,
        max_tokens: opts.maxTokens ?? 8000,
        effort: opts.effort,
        timeoutMs: opts.timeoutMs,
      });
      return { text: res.text, model: res.model, provider: "anthropic", usage: res.usage };
    } catch (e: any) {
      if (e instanceof AnthropicRefusalError) throw e;
      if (!allowFallback || !LOVABLE_API_KEY) throw e;
      const reason = String(e?.message ?? e);
      console.warn("Claude failed, falling back to gateway:", reason);
      const res = await callGateway(prompt, opts);
      return { ...res, fallbackReason: reason };
    }
  }

  return callGateway(prompt, opts);
}

/**
 * Vision call. Accepts `data:` URIs (inline attachments) or plain https URLs and
 * converts them to Claude image blocks, falling back to the OpenAI-compatible
 * gateway shape if Claude is unavailable.
 */
export async function completeVision(
  prompt: string,
  imageUrls: string[],
  opts: CompleteOptions = {},
): Promise<CompleteResult> {
  const allowFallback = opts.allowFallback !== false;

  if (USE_ANTHROPIC && isAnthropicConfigured()) {
    try {
      const content: any[] = [];
      for (const url of imageUrls) {
        const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
        content.push(
          m
            ? { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } }
            : { type: "image", source: { type: "url", url } },
        );
      }
      content.push({ type: "text", text: prompt });

      const res = await callClaudeRaw({
        system: opts.system,
        messages: [{ role: "user", content }],
        max_tokens: opts.maxTokens ?? 8000,
        effort: opts.effort,
        timeoutMs: opts.timeoutMs,
      });
      return { text: res.text, model: res.model, provider: "anthropic", usage: res.usage };
    } catch (e: any) {
      if (e instanceof AnthropicRefusalError) throw e;
      if (!allowFallback || !LOVABLE_API_KEY) throw e;
      console.warn("Claude vision failed, falling back to gateway:", String(e?.message ?? e));
    }
  }

  if (!LOVABLE_API_KEY) throw new Error("No vision model is configured");
  const content: any[] = [{ type: "text", text: prompt }];
  for (const url of imageUrls) content.push({ type: "image_url", image_url: { url } });
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: FALLBACK_MODEL,
      max_tokens: opts.maxTokens ?? 2000,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) throw new Error(`Vision gateway ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return {
    text: (data?.choices?.[0]?.message?.content ?? "").trim(),
    model: FALLBACK_MODEL,
    provider: "lovable-gateway",
    usage: data?.usage,
  };
}

/** completeText + JSON parsing. Tolerates prose or code fences around the object. */
export async function completeJSON<T = any>(
  prompt: string,
  opts: CompleteOptions = {},
): Promise<{ parsed: T; model: string; provider: string; usage: any }> {
  const res = await completeText(prompt, opts);
  const match = res.text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new Error(`No JSON in model response: ${res.text.slice(0, 200)}`);
  return { parsed: JSON.parse(match[0]) as T, model: res.model, provider: res.provider, usage: res.usage };
}
