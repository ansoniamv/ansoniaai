// Single entry point for every AI text call in the platform.
//
// Anthropic is the only provider. There is no fallback: if Claude cannot be
// reached the call throws and the caller decides what that means. The previous
// third-party gateway fallback is gone — it could not succeed, because that
// gateway is dead, and all it did was replace a diagnosable Anthropic error
// carrying a status and a verbatim body with a misleading gateway one. That is
// how a real failure stayed invisible for a week.
//
// Model selection: DEFAULT_MODEL unless a caller passes opts.model. The Deal
// Inbox call sites pass DEAL_INBOX_MODEL.
//
// SECURITY: the API key is read from the edge-function environment and is only
// ever used server-side. Nothing here reaches the browser.

import {
  callClaude,
  callClaudeRaw,
  isAnthropicConfigured,
  AnthropicNotConfiguredError,
} from "./anthropic.ts";

export interface CompleteOptions {
  system?: string;
  /**
   * Overrides the platform default for this one call. The Deal Inbox call sites
   * pass DEAL_INBOX_MODEL; everything else omits it and resolves DEFAULT_MODEL.
   */
  model?: string;
  /** Keep generous: thinking is adaptive on these models and shares this budget. */
  maxTokens?: number;
  /** "low" | "medium" | "high" | "xhigh" | "max" — omit for the API default. */
  effort?: string;
  timeoutMs?: number;
  /**
   * Accepted and ignored. With the gateway gone every call already behaves as
   * allowFallback: false, so this stays only to keep the existing call sites
   * compiling — dropping it from them is a separate, unhurried edit rather than
   * a sweep across functions this task does not otherwise touch.
   */
  allowFallback?: boolean;
  /** JSON Schema constraining the response. Anthropic enforces it server-side. */
  schema?: Record<string, unknown>;
}

export interface CompleteResult {
  text: string;
  model: string;
  provider: "anthropic";
  usage: any;
}

/** One message for "Claude is not configured", so every caller reads the same. */
function assertConfigured(): void {
  if (!isAnthropicConfigured()) throw new AnthropicNotConfiguredError();
}

/**
 * Run a prompt through Claude.
 *
 * A refusal arrives as AnthropicRefusalError and an HTTP failure as
 * AnthropicHttpError, both carrying enough detail to diagnose from the log.
 */
export async function completeText(prompt: string, opts: CompleteOptions = {}): Promise<CompleteResult> {
  assertConfigured();
  const res = await callClaude(prompt, {
    system: opts.system,
    model: opts.model,
    max_tokens: opts.maxTokens ?? 8000,
    effort: opts.effort,
    schema: opts.schema,
    timeoutMs: opts.timeoutMs,
  });
  return { text: res.text, model: res.model, provider: "anthropic", usage: res.usage };
}

/**
 * Vision call. Accepts `data:` URIs (inline attachments) or plain https URLs and
 * converts them to Claude image blocks.
 */
export async function completeVision(
  prompt: string,
  imageUrls: string[],
  opts: CompleteOptions = {},
): Promise<CompleteResult> {
  assertConfigured();

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
    model: opts.model,
    messages: [{ role: "user", content }],
    max_tokens: opts.maxTokens ?? 8000,
    effort: opts.effort,
    schema: opts.schema,
    timeoutMs: opts.timeoutMs,
  });
  return { text: res.text, model: res.model, provider: "anthropic", usage: res.usage };
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
