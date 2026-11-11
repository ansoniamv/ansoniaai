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
  { value: "partner_outreach", label: "Partner outreach template" },
  // Added to the live category check by hand before this list knew them.
  { value: "model_template", label: "Model template" },
  { value: "affordability", label: "Affordability" },
  { value: "other", label: "Other" },
] as const;
export type DataRoomCategory = (typeof DATA_ROOM_CATEGORIES)[number]["value"];

/**
 * Partner outreach templates teach the email drafter how Ansonia writes to
 * capital partners. They are not facts about the firm, so they stay out of the
 * Company Brief.
 */
export const keptOutOfBrief = (c: string) => c === "partner_outreach";

export const categoryLabel = (c: string) => DATA_ROOM_CATEGORIES.find((x) => x.value === c)?.label ?? c;

export type SharePointSiteKey = "acquisitions" | "asset_management";

export const SHAREPOINT_SITE_LABELS: Record<SharePointSiteKey, string> = {
  acquisitions: "Acquisitions",
  asset_management: "Asset Management",
};

export type DataRoomSource = {
  id: string;
  /** "file" = uploaded to the platform (legacy); "sharepoint" = a pinned SharePoint file. */
  kind: "file" | "website" | "note" | "sharepoint";
  sp_site: SharePointSiteKey | null;
  sp_item_id: string | null;
  sp_web_url: string | null;
  sp_folder: string | null;
  /** SharePoint's last-modified time of the version that was read. */
  sp_modified: string | null;
  /** Last-modified time seen at the latest check. */
  sp_current_modified: string | null;
  sp_checked_at: string | null;
  sp_missing: boolean;
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
 * A pinned SharePoint file that was edited in SharePoint after the Brain read
 * it. Reading it again brings its summary and passages up to date.
 */
export function changedInSharePoint(s: Pick<DataRoomSource, "kind" | "sp_modified" | "sp_current_modified" | "sp_missing">): boolean {
  if (s.kind !== "sharepoint" || s.sp_missing || !s.sp_modified || !s.sp_current_modified) return false;
  return new Date(s.sp_current_modified).getTime() > new Date(s.sp_modified).getTime();
}

/** One entry from the sharepoint function's folder listing or search. */
export type SharePointEntry = {
  site: SharePointSiteKey;
  item_id: string;
  name: string;
  kind: "folder" | "file";
  folder: string;
  size_kb?: number;
  items?: number;
  modified: string | null;
  modified_by: string | null;
  link: string | null;
  snippet?: string;
};

/** File types the Brain can read (same rule as the reader: dataRoomFileKind). */
export function brainCanRead(name: string): boolean {
  return /\.(pdf|docx|pptx|xlsx|xlsm|xls|xlsb|ods|csv|tsv|txt|md|markdown)$/i.test(name);
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
