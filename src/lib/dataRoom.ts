/**
 * Data Room types and the rules the page shows, kept free of the Supabase
 * client so they can be tested on their own. The queries live in
 * src/hooks/useDataRoom.ts.
 */

export const DATA_ROOM_CATEGORIES = [
  { value: "company", label: "Company" },
  { value: "strategy", label: "Strategy" },
  { value: "investor_deck", label: "Investor deck" },
  { value: "pro_forma", label: "Pro forma" },
  { value: "track_record", label: "Track record" },
  { value: "market", label: "Market research" },
  { value: "operations", label: "Operations" },
  { value: "other", label: "Other" },
] as const;
export type DataRoomCategory = (typeof DATA_ROOM_CATEGORIES)[number]["value"];

export const categoryLabel = (c: string) => DATA_ROOM_CATEGORIES.find((x) => x.value === c)?.label ?? c;

export type DataRoomSource = {
  id: string;
  kind: "file" | "website" | "note";
  title: string;
  category: DataRoomCategory;
  storage_path: string | null;
  file_name: string | null;
  file_size: number | null;
  content_type: string | null;
  url: string | null;
  pages_read: { url: string; title: string | null }[] | null;
  body: string | null;
  include_in_brief: boolean;
  status: "pending" | "processing" | "ready" | "failed";
  error: string | null;
  notes: string | null;
  summary: string | null;
  key_facts: { fact: string; where: string }[];
  char_count: number | null;
  process_started_at: string | null;
  processed_at: string | null;
  created_at: string;
};

export type DataRoomBrief = {
  content: string;
  source_ids: string[];
  model: string | null;
  built_at: string | null;
  edited_at: string | null;
};

export type DataRoomHit = {
  source_id: string;
  title: string;
  category: string;
  kind: string;
  locator: string | null;
  content: string;
  headline: string;
  rank: number;
};

/** A run older than this was killed, not slow. Matches STALE_PROCESS_MS in the function. */
export const STALE_PROCESS_MS = 7 * 60_000;

export function sourceState(s: DataRoomSource): "reading" | "stopped" | "ready" | "failed" {
  if (s.status === "ready") return "ready";
  if (s.status === "failed") return "failed";
  const started = s.process_started_at ? new Date(s.process_started_at).getTime() : 0;
  return s.status === "processing" && Date.now() - started > STALE_PROCESS_MS ? "stopped" : "reading";
}

/**
 * Whether the brief is behind the library: a source it was built from has gone
 * or left the brief, a new one is ready, or one was re-read after the build.
 */
export function briefIsStale(brief: DataRoomBrief | null | undefined, sources: DataRoomSource[]): boolean {
  const included = sources.filter((s) => s.status === "ready" && s.include_in_brief);
  if (!brief) return included.length > 0;
  const built = new Set(brief.source_ids);
  if (included.length !== built.size || included.some((s) => !built.has(s.id))) return true;
  const builtAt = brief.built_at ? new Date(brief.built_at).getTime() : 0;
  return included.some((s) => s.processed_at && new Date(s.processed_at).getTime() > builtAt);
}
