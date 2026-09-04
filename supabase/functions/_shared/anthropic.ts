// Shared Anthropic (Claude) client for all edge functions.
//
// SECURITY: ANTHROPIC_API_KEY is read from the edge-function environment only.
// Edge functions run server-side on Supabase, so the key is never sent to the
// browser and cannot be recovered by inspecting the site. Never move this key
// into a VITE_-prefixed variable — Vite compiles those into the public bundle.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

/** Every AI call in the platform runs on this model unless explicitly overridden. */
export const DEFAULT_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-5";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export class AnthropicNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not configured for this project");
    this.name = "AnthropicNotConfiguredError";
  }
}

export class AnthropicRefusalError extends Error {
  category: string | null;
  constructor(category: string | null, explanation?: string) {
    super(`Claude declined this request${category ? ` (${category})` : ""}${explanation ? `: ${explanation}` : ""}`);
    this.name = "AnthropicRefusalError";
    this.category = category;
  }
}

export function isAnthropicConfigured(): boolean {
  return Boolean(ANTHROPIC_API_KEY);
}

export interface ClaudeRequest {
  system?: string;
  messages: any[];
  /** Defaults to DEFAULT_MODEL (claude-opus-5). */
  model?: string;
  /**
   * Thinking is ON by default on Opus 5 and its tokens count against max_tokens,
   * so keep this generous. Small ceilings (a few hundred) can be consumed
   * entirely by thinking and return no visible text.
   */
  max_tokens?: number;
  tools?: any[];
  /** "low" | "medium" | "high" | "xhigh" | "max" — omit to use the API default. */
  effort?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ClaudeResponse {
  /** Concatenated text blocks. Thinking blocks are excluded. */
  text: string;
  /** Full content array — pass back verbatim when continuing a tool-use loop. */
  content: any[];
  stop_reason: string | null;
  usage: any;
  model: string;
}

function extractText(content: any[]): string {
  return (content ?? [])
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
}

/**
 * Low-level call. Returns the full response so tool-use loops can echo content back.
 * Retries 429 / 529 / 5xx with exponential backoff.
 */
export async function callClaudeRaw(req: ClaudeRequest): Promise<ClaudeResponse> {
  if (!ANTHROPIC_API_KEY) throw new AnthropicNotConfiguredError();

  const model = req.model ?? DEFAULT_MODEL;
  const maxRetries = req.maxRetries ?? 2;
  const timeoutMs = req.timeoutMs ?? 120_000;

  // NOTE: temperature / top_p / top_k and thinking.budget_tokens are rejected
  // with a 400 on Opus 5 — deliberately not sent.
  const body: Record<string, unknown> = {
    model,
    max_tokens: req.max_tokens ?? 8000,
    messages: req.messages,
  };
  if (req.system) body.system = req.system;
  if (req.tools?.length) body.tools = req.tools;
  if (req.effort) body.output_config = { effort: req.effort };

  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(API_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify(body),
      });
    } catch (e: any) {
      lastErr = e?.name === "AbortError" ? new Error(`anthropic request timed out after ${timeoutMs}ms`) : e;
      if (attempt === maxRetries) throw lastErr;
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (resp.ok) {
      const data = await resp.json();
      // stop_details is populated only on refusal; guard before reading.
      if (data?.stop_reason === "refusal") {
        throw new AnthropicRefusalError(data?.stop_details?.category ?? null, data?.stop_details?.explanation);
      }
      return {
        text: extractText(data?.content),
        content: data?.content ?? [],
        stop_reason: data?.stop_reason ?? null,
        usage: data?.usage,
        model: data?.model ?? model,
      };
    }

    const txt = await resp.text();
    const msg = `anthropic ${resp.status}: ${txt.slice(0, 400)}`;
    const retriable = resp.status === 429 || resp.status === 529 || (resp.status >= 500 && resp.status < 600);
    if (!retriable || attempt === maxRetries) throw new Error(msg);
    lastErr = new Error(msg);
    const retryAfter = Number(resp.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
    await new Promise((r) => setTimeout(r, delay));
  }

  throw lastErr ?? new Error("anthropic call failed");
}

/** Convenience wrapper: single prompt in, text out. */
export async function callClaude(
  prompt: string,
  opts: Omit<ClaudeRequest, "messages"> = {},
): Promise<ClaudeResponse> {
  return callClaudeRaw({ ...opts, messages: [{ role: "user", content: prompt }] });
}

/**
 * Ask Claude for JSON and parse it. Tolerates prose or code fences around the object.
 * `max_tokens` defaults high because thinking shares the budget.
 */
export async function callClaudeJSON<T = any>(
  prompt: string,
  opts: Omit<ClaudeRequest, "messages"> = {},
): Promise<{ parsed: T; usage: any; model: string }> {
  const res = await callClaude(prompt, { max_tokens: 8000, ...opts });
  const match = res.text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) {
    throw new Error(`No JSON found in Claude response: ${res.text.slice(0, 300)}`);
  }
  return { parsed: JSON.parse(match[0]) as T, usage: res.usage, model: res.model };
}
