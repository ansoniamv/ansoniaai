// Atlas's SharePoint tools (sharepoint_search / _list_folder / _read_file).
// Read-only: see sharePoint.ts for the permission model.
import { getGraphToken, graphConfigured } from "./graphToken.ts";
import { fileToText } from "./fileText.ts";
import {
  cleanFolderPath,
  downloadItem,
  getItem,
  isItemId,
  isSharePointSite,
  listFolder,
  searchSite,
  SHAREPOINT_MAX_FILE_BYTES,
  SHAREPOINT_READ_CHARS,
  SHAREPOINT_SITE_KEYS,
  SHAREPOINT_SITES,
  type SharePointEntry,
  type SharePointSite,
  SharePointError,
  windowSections,
} from "./sharePoint.ts";


const fetcher = (u: string, i?: RequestInit) => fetch(u, i);

function shape(e: SharePointEntry & { snippet?: string | null }) {
  return {
    site: e.site,
    item_id: e.item_id,
    name: e.name,
    kind: e.kind,
    folder: e.folder || "(top level)",
    ...(e.kind === "file" && e.size_bytes !== null ? { size_kb: Math.round(e.size_bytes / 1024) } : {}),
    ...(e.child_count !== undefined ? { items: e.child_count } : {}),
    modified: e.modified?.slice(0, 10) ?? null,
    modified_by: e.modified_by,
    link: e.web_url,
    ...(e.snippet ? { snippet: e.snippet } : {}),
  };
}

// deno-lint-ignore no-explicit-any
export async function runSharePointTool(name: string, args: any): Promise<unknown> {
  if (!graphConfigured()) return { error: "SharePoint is not connected (Microsoft Graph secrets missing)." };
  try {
    const { token } = await getGraphToken();

    if (name === "sharepoint_search") {
      const query = String(args?.query ?? "").trim();
      if (!query) return { error: "query is required" };
      if (args?.site && !isSharePointSite(args.site)) return { error: `site must be one of ${SHAREPOINT_SITE_KEYS.join(", ")}` };
      const folder = cleanFolderPath(args?.folder);
      if (folder === null) return { error: "folder is not a valid folder path" };
      const sites: SharePointSite[] = args?.site ? [args.site] : SHAREPOINT_SITE_KEYS;
      const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 50);
      const settled = await Promise.allSettled(sites.map((s) => searchSite(fetcher, token, s, query, folder, limit)));
      const results = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      const failed = settled.flatMap((r, i) => (r.status === "rejected" ? [`${SHAREPOINT_SITES[sites[i]].label}: ${msg(r.reason)}`] : []));
      results.sort((a, b) => String(b.modified ?? "").localeCompare(String(a.modified ?? "")));
      return {
        results: results.slice(0, limit).map(shape),
        ...(failed.length ? { errors: failed } : {}),
        ...(!results.length && !failed.length ? { note: "Nothing matched. Try fewer or different words, or browse with sharepoint_list_folder." } : {}),
      };
    }

    if (!isSharePointSite(args?.site)) return { error: `site must be one of ${SHAREPOINT_SITE_KEYS.join(", ")}` };
    const site: SharePointSite = args.site;

    if (name === "sharepoint_list_folder") {
      const path = cleanFolderPath(args?.path);
      if (path === null) return { error: "path is not a valid folder path" };
      const { entries, truncated } = await listFolder(fetcher, token, site, path);
      return {
        site,
        folder: path || "(top level)",
        entries: entries.map(shape),
        ...(truncated ? { note: "Only the first 200 entries are shown; use sharepoint_search to find a specific file." } : {}),
      };
    }

    if (name === "sharepoint_read_file") {
      let ref: { item_id?: string; path?: string };
      if (args?.item_id) {
        if (!isItemId(args.item_id)) return { error: "item_id is not a SharePoint item id" };
        ref = { item_id: args.item_id };
      } else {
        const path = cleanFolderPath(args?.path);
        if (!path) return { error: "item_id or path is required" };
        ref = { path };
      }
      const item = await getItem(fetcher, token, site, ref);
      if (item.kind === "folder") return { error: "That is a folder; use sharepoint_list_folder." };
      const meta = { file: item.name, folder: item.folder || "(top level)", modified: item.modified?.slice(0, 10) ?? null, link: item.web_url };
      if (item.size_bytes !== null && item.size_bytes > SHAREPOINT_MAX_FILE_BYTES) {
        return { ...meta, error: `File is ${Math.round(item.size_bytes / 1048576)}MB, too large to read here (limit ${SHAREPOINT_MAX_FILE_BYTES / 1048576}MB). Open it from the link.` };
      }
      const bytes = await downloadItem(fetcher, token, site, item.item_id);
      const section = typeof args?.section === "string" ? args.section : undefined;
      const read = await fileToText(bytes, item.name, item.content_type, { section });
      if (read.unsupported) return { ...meta, error: "This file type can't be read as text (PDF, Excel, CSV, Word .docx, PowerPoint .pptx and text files can)." };
      if (read.scanned) {
        return {
          ...meta,
          error: `This PDF is a scan (${read.scanned.pages} pages) with little or no text layer, so it can't be read here. Open it from the link.`,
        };
      }
      const start = Number(args?.start);
      const win = windowSections(read.sections, {
        section,
        start: Number.isFinite(start) ? start : 0,
        max: SHAREPOINT_READ_CHARS,
        allNames: read.allSections,
      });
      const note = [read.note, win.note].filter(Boolean).join(" ");
      return { ...meta, ...win, ...(note ? { note } : {}) };
    }

    return { error: "unknown tool" };
  } catch (e) {
    console.error(`[sharepoint] ${name}`, e);
    return { error: msg(e) };
  }
}

function msg(e: unknown): string {
  // SharePointError messages are written to be shown; anything else (a parser
  // crash, a token failure) gets a generic message plus its first line.
  if (e instanceof SharePointError) return e.message;
  const m = e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : "unknown error";
  return `could not read SharePoint (${m})`;
}
