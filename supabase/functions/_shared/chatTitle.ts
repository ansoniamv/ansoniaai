// Short AI titles for Ask Atlas conversations ("DRA deals in pipeline"
// instead of the first 60 characters of the opening message).

import { callClaudeJSON } from "./anthropic.ts";
import { assertWithinBudget } from "./aiBudget.ts";
import { logAiFailure, logAiUsage } from "./logUsage.ts";
import { TITLE_MODEL } from "./featureModels.ts";
import { cleanTitle, fallbackTitle, titlePrompt } from "./chatTitleText.ts";

const SCHEMA = {
  type: "object",
  properties: { title: { type: "string" } },
  required: ["title"],
  additionalProperties: false,
};

/**
 * A title for a conversation from its opening message. Never throws: on a
 * budget stop, an API error or an unusable answer it returns the opening
 * message cut at a word boundary.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped client, as in the other functions
export async function generateChatTitle(supabase: any, message: string, functionName = "chat-title"): Promise<string> {
  const fallback = fallbackTitle(message);
  if (!message.trim()) return fallback;
  try {
    await assertWithinBudget(supabase, "interactive");
    const { parsed, usage, model } = await callClaudeJSON<{ title?: string }>(titlePrompt(message), {
      model: TITLE_MODEL,
      effort: "low",
      max_tokens: 2000,
      schema: SCHEMA,
      timeoutMs: 20_000,
      maxRetries: 1,
    });
    await logAiUsage(supabase, { function_name: functionName, model, provider: "anthropic", usage });
    return cleanTitle(parsed?.title) ?? fallback;
  } catch (e) {
    await logAiFailure(supabase, { function_name: functionName, model: TITLE_MODEL, error: e }).catch(() => {});
    return fallback;
  }
}
