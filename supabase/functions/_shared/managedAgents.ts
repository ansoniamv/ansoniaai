// Anthropic Managed Agents: the calls generate-model makes, as plain fetches
// in the style of _shared/anthropic.ts.
//
// A session is one model run: Anthropic runs the agent loop and hosts the
// container the full-underwrite skill works in. The agent, its environment and
// the skill are created by generate-model's admin "setup" action from the
// bundled copy of anthropic/, and their ids are kept in model_agent_config.

import { AnthropicHttpError, AnthropicNotConfiguredError } from "./anthropic.ts";
import type { SessionEvent } from "./dealModel.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const BASE = "https://api.anthropic.com/v1";
const HEADERS = () => {
  if (!ANTHROPIC_API_KEY) throw new AnthropicNotConfiguredError();
  return {
    "x-api-key": ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "managed-agents-2026-04-01",
  };
};

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...HEADERS(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await resp.text();
  if (!resp.ok) {
    throw new AnthropicHttpError(resp.status, txt.slice(0, 2000), `anthropic ${method} ${path} ${resp.status}: ${txt.slice(0, 400)}`);
  }
  return (txt ? JSON.parse(txt) : null) as T;
}

export const createEnvironment = (body: Record<string, unknown>) => call<{ id: string }>("POST", "/environments", body);

export const createAgent = (body: Record<string, unknown>) => call<{ id: string; version: number }>("POST", "/agents", body);

/**
 * Create a custom skill, or a new version of one (a full snapshot: every file,
 * each named <skill folder>/<path>). Skills take no beta header.
 */
export async function uploadSkill(
  files: readonly { path: string; content: string }[],
  skillId?: string,
): Promise<{ id: string; version: string | null }> {
  if (!ANTHROPIC_API_KEY) throw new AnthropicNotConfiguredError();
  const form = new FormData();
  for (const f of files) form.append("files[]", new Blob([f.content], { type: "text/plain" }), f.path);
  const path = skillId ? `/skills/${encodeURIComponent(skillId)}/versions` : "/skills";
  const resp = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: form,
  });
  const txt = await resp.text();
  if (!resp.ok) {
    throw new AnthropicHttpError(resp.status, txt.slice(0, 2000), `anthropic POST ${path} ${resp.status}: ${txt.slice(0, 400)}`);
  }
  const data = JSON.parse(txt);
  // A new skill carries its version as latest_version_id; a new version is the version itself.
  return skillId
    ? { id: skillId, version: data?.version ?? data?.id ?? null }
    : { id: data.id, version: data?.latest_version_id ?? data?.latest_version ?? null };
}

export type Session = {
  id: string;
  status: "idle" | "running" | "rescheduling" | "terminated";
  usage?: { list_cost?: { amount: string; currency: string } } & Record<string, unknown>;
};

export type SessionResource = { type: "file"; file_id: string; mount_path: string };

export function createSession(args: {
  agentId: string;
  environmentId: string;
  title: string;
  resources: SessionResource[];
  budgetCents: string;
  message: string;
  metadata: Record<string, string>;
}): Promise<Session> {
  return call<Session>("POST", "/sessions", {
    agent: args.agentId,
    environment_id: args.environmentId,
    title: args.title,
    resources: args.resources,
    budget: { type: "limit", max_list_cost: { amount: args.budgetCents, currency: "USD" } },
    metadata: args.metadata,
    // Starts the run in the same call; the session is created 'running'.
    initial_events: [{ type: "user.message", content: [{ type: "text", text: args.message }] }],
  });
}

export const getSession = (id: string) => call<Session>("GET", `/sessions/${encodeURIComponent(id)}`);

/** One page of a session's events, oldest first. */
export function listEvents(id: string, page: string | null): Promise<{ data: SessionEvent[]; next_page: string | null }> {
  const q = page ? `?page=${encodeURIComponent(page)}` : "";
  return call("GET", `/sessions/${encodeURIComponent(id)}/events${q}`);
}

export function sendEvents(id: string, events: unknown[]): Promise<unknown> {
  return call("POST", `/sessions/${encodeURIComponent(id)}/events`, { events });
}

/** Files the agent wrote to /mnt/session/outputs/ (Files API, after_id pagination). */
export async function listSessionFiles(id: string): Promise<{ id: string; filename: string; created_at: string }[]> {
  const out: { id: string; filename: string; created_at: string }[] = [];
  let after: string | null = null;
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ scope_id: id, limit: "100" });
    if (after) q.set("after_id", after);
    const page = await call<{ data: { id: string; filename: string; created_at: string }[]; has_more?: boolean; last_id?: string }>(
      "GET",
      `/files?${q}`,
    );
    out.push(...(page.data ?? []));
    if (!page.has_more || !page.last_id) break;
    after = page.last_id;
  }
  return out;
}

export async function downloadFile(fileId: string): Promise<Blob> {
  const resp = await fetch(`${BASE}/files/${encodeURIComponent(fileId)}/content`, { headers: HEADERS() });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new AnthropicHttpError(resp.status, txt.slice(0, 2000), `anthropic file download ${resp.status}: ${txt.slice(0, 400)}`);
  }
  return await resp.blob();
}
