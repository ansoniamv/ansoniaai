// Read-only access to Ansonia's SharePoint through Microsoft Graph app-only
// (the same app registration as the mailboxes, see graphToken.ts).
//
// The app holds Sites.Selected, and IT granted it `read` on exactly two sites.
// Verified 2026-11-11: both sites list, a folder create returns 403
// accessDenied on both, and an ungranted site (the root site) returns 403. So
// writes are impossible by permission, not just by this code having no write
// path. Reading any other site's files is refused by Graph.
//
// SEARCH IS THE EXCEPTION. Tenant-wide /search/query under this app-only token
// returns hits (names, links, text snippets) from sites that were never granted:
// HR, other team sites, personal OneDrives (seen 2026-11-11). And drive-scoped
// search (/drive/root/search) fails with a 500 under Sites.Selected. So
// searchSite scopes the query with KQL path: AND drops every hit whose
// driveId is not the site's own document library. The driveId filter is the
// guarantee; the path: scope only keeps result pages useful.
//
// Pure helpers (no Deno globals) so vitest can import this file; the network
// calls take an injectable fetcher.

export const SHAREPOINT_SITES = {
  acquisitions: {
    label: "Acquisitions",
    // /sites/Acquisitions2 — where every deal file lives (NOT /sites/Acquisitions).
    siteId: "ansoniaproperties.sharepoint.com,c439aeb2-fc7a-4223-9636-25f457e59aa9,7b935861-6d80-44fd-a1c7-c4ac37276295",
    driveId: "b!sq45xHr8I0KWNiX0V-WaqWFYk3uAbf1EocfErDcnYpVApWJ7MSvTSpDWgIbGmGV_",
    libraryUrl: "https://ansoniaproperties.sharepoint.com/sites/Acquisitions2/Shared Documents",
  },
  asset_management: {
    label: "Asset Management",
    siteId: "ansoniaproperties.sharepoint.com,b7ab1842-f5ab-4064-91ae-f72c3779b623,ea715851-4a14-4852-bf0e-29337d079999",
    driveId: "b!Qhirt6v1ZECRrvcsN3m2I1FYceoUSlJIvw4pM30HmZmoojawuEaQS7RIxLwV20oE",
    libraryUrl: "https://ansoniaproperties.sharepoint.com/sites/AssetManagement/Shared Documents",
  },
} as const;

export type SharePointSite = keyof typeof SHAREPOINT_SITES;
export const SHAREPOINT_SITE_KEYS = Object.keys(SHAREPOINT_SITES) as SharePointSite[];

export function isSharePointSite(v: unknown): v is SharePointSite {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(SHAREPOINT_SITES, v);
}

const GRAPH = "https://graph.microsoft.com/v1.0";
/** Largest file read_file downloads. Graph streams the whole file into memory. */
export const SHAREPOINT_MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Most text read_file returns at once: chat cuts tool results at 20,000 JSON characters. */
export const SHAREPOINT_READ_CHARS = 14_000;

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * A folder path inside a site's document library, as the user or model wrote
 * it ("04. Chicago Properties/Kenwood Deal"), normalized and checked.
 * Returns "" for the library root, or null when the path is not acceptable.
 */
export function cleanFolderPath(raw: unknown): string | null {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") return null;
  let p = raw.trim().replace(/\\/g, "/");
  // Accept a pasted SharePoint URL or "Shared Documents/..." prefix.
  p = p.replace(/^https?:\/\/[^/]+\/sites\/[^/]+\//i, "");
  try {
    if (/%[0-9a-f]{2}/i.test(p)) p = decodeURIComponent(p);
  } catch { /* leave as written */ }
  p = p.replace(/^\/+|\/+$/g, "").replace(/^(Shared Documents|Documents)(\/|$)/i, "");
  const parts = p.split("/").filter((s) => s.length > 0);
  if (parts.some((s) => s === "." || s === ".." || s.includes(":") || s.length > 255)) return null;
  return parts.join("/");
}

/** Graph URL for a path under the default document library's root. */
export function driveRootPathUrl(site: SharePointSite, path: string, suffix: string): string {
  const base = `${GRAPH}/sites/${SHAREPOINT_SITES[site].siteId}/drive/root`;
  if (!path) return `${base}${suffix.replace(/^:/, "")}`;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${base}:/${encoded}:${suffix.replace(/^:/, "")}`;
}

/** A Graph driveItem id: base32-ish letters and digits, sometimes with ! (OneDrive personal). */
const ITEM_ID_RE = /^[A-Za-z0-9!]{10,80}$/;
export function isItemId(v: unknown): v is string {
  return typeof v === "string" && ITEM_ID_RE.test(v);
}

/**
 * The KQL sent to /search/query: the user's words, grouped so an OR in them
 * can't escape the scope, AND path: limited to the site's library (or a
 * folder under it). Parentheses, quotes-imbalance and scope operators the
 * user wrote are dropped; the driveId filter still applies afterwards.
 */
export function searchKql(raw: unknown, site: SharePointSite, folder: string): string | null {
  if (typeof raw !== "string") return null;
  let q = raw.replace(/[()]/g, " ").replace(/\b(path|site|siteid|driveid)\s*:\s*("[^"]*"|\S+)/gi, " ");
  if ((q.match(/"/g) ?? []).length % 2) q = q.replace(/"/g, " ");
  q = q.trim().replace(/\s+/g, " ").slice(0, 200);
  if (!q) return null;
  const scope = folder ? `${SHAREPOINT_SITES[site].libraryUrl}/${folder}` : SHAREPOINT_SITES[site].libraryUrl;
  return `(${q}) path:"${scope.replace(/"/g, "")}"`;
}

/** Folder of a file inside a site's library, from its webUrl. "" when at the top or not in the library. */
export function folderFromWebUrl(site: SharePointSite, webUrl: unknown): string {
  if (typeof webUrl !== "string") return "";
  let u = webUrl;
  try {
    u = decodeURI(webUrl);
  } catch { /* keep raw */ }
  const lib = `${SHAREPOINT_SITES[site].libraryUrl}/`;
  if (!u.toLowerCase().startsWith(lib.toLowerCase())) return "";
  const rest = u.slice(lib.length).split("?")[0];
  const i = rest.lastIndexOf("/");
  return i < 0 ? "" : rest.slice(0, i);
}

/** Search hit summaries mark matches with <c0>…</c0> and gaps with <ddd/>. */
export function cleanSnippet(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.replace(/<ddd\/>/g, " … ").replace(/<\/?c0>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 300) : null;
}

export type SharePointEntry = {
  site: SharePointSite;
  item_id: string;
  name: string;
  kind: "folder" | "file";
  /** Folder path within the library, e.g. "04. Chicago Properties/Kenwood Deal". */
  folder: string;
  size_bytes: number | null;
  modified: string | null;
  modified_by: string | null;
  web_url: string | null;
  child_count?: number;
};

/** parentReference.path looks like "/drives/{id}/root:/04. Chicago Properties". */
export function folderFromParentPath(p: unknown): string {
  if (typeof p !== "string") return "";
  const i = p.indexOf("root:");
  if (i < 0) return "";
  const rest = p.slice(i + 5).replace(/^\/+/, "");
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

// deno-lint-ignore no-explicit-any
export function toEntry(site: SharePointSite, item: any): SharePointEntry {
  const isFolder = !!item?.folder;
  return {
    site,
    item_id: String(item?.id ?? ""),
    name: String(item?.name ?? ""),
    kind: isFolder ? "folder" : "file",
    folder: folderFromParentPath(item?.parentReference?.path),
    size_bytes: typeof item?.size === "number" ? item.size : null,
    modified: item?.lastModifiedDateTime ?? null,
    modified_by: item?.lastModifiedBy?.user?.displayName ?? null,
    web_url: item?.webUrl ?? null,
    ...(isFolder && typeof item.folder.childCount === "number" ? { child_count: item.folder.childCount } : {}),
  };
}

const ITEM_SELECT = "id,name,size,folder,file,parentReference,lastModifiedDateTime,lastModifiedBy,webUrl";

export class SharePointError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
  }
}

/** Turn a Graph error response into a short, user-safe message. */
async function graphError(r: Response, what: string): Promise<SharePointError> {
  // deno-lint-ignore no-explicit-any
  const j: any = await r.json().catch(() => ({}));
  const code = j?.error?.code ?? "";
  if (r.status === 404) return new SharePointError(`${what}: not found`, 404);
  if (r.status === 403 || r.status === 401) {
    return new SharePointError(`${what}: access denied (${code || r.status})`, r.status);
  }
  if (r.status === 429 || r.status === 503) return new SharePointError(`${what}: SharePoint is busy, try again shortly`, r.status);
  return new SharePointError(`${what}: SharePoint error ${r.status} ${code}`.trim(), r.status);
}

async function getJson(fetcher: Fetcher, token: string, url: string, what: string) {
  const r = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw await graphError(r, what);
  return await r.json();
}

/** List one folder (the library root when path is ""). Folders first, then newest files. */
export async function listFolder(
  fetcher: Fetcher,
  token: string,
  site: SharePointSite,
  path: string,
  limit = 200,
): Promise<{ entries: SharePointEntry[]; truncated: boolean }> {
  const url = driveRootPathUrl(site, path, `:/children?$select=${ITEM_SELECT}&$top=${Math.min(limit, 999)}`);
  const j = await getJson(fetcher, token, url, path ? `Folder "${path}"` : "Library root");
  const entries = ((j?.value ?? []) as unknown[]).map((i) => toEntry(site, i));
  entries.sort((a, b) =>
    a.kind !== b.kind ? (a.kind === "folder" ? -1 : 1)
    : a.kind === "folder" ? a.name.localeCompare(b.name)
    : String(b.modified ?? "").localeCompare(String(a.modified ?? ""))
  );
  return { entries: entries.slice(0, limit), truncated: !!j?.["@odata.nextLink"] || entries.length > limit };
}

export type SearchHit = SharePointEntry & { snippet: string | null };

/**
 * Search hits never carry a folder facet: a folder comes back as a zero-byte
 * application/octet-stream "file" with no extension (seen 2026-11-11). An
 * extensionless empty file is misread as a folder, which is harmless:
 * read_file looks the item up again and says what it really is.
 */
// deno-lint-ignore no-explicit-any
export function isFolderHit(res: any): boolean {
  if (res?.folder) return true;
  if (!res?.file) return true;
  return res.size === 0 && (res.file.mimeType ?? "application/octet-stream") === "application/octet-stream" &&
    !/\.[A-Za-z0-9]{1,6}$/.test(String(res.name ?? ""));
}

/**
 * Search file and folder names and contents in one site's library, optionally
 * under one folder. See the header comment: results outside the site's own
 * library are dropped here, whatever the search service returns.
 */
export async function searchSite(
  fetcher: Fetcher,
  token: string,
  site: SharePointSite,
  query: string,
  folder: string,
  limit = 25,
): Promise<SearchHit[]> {
  const kql = searchKql(query, site, folder);
  if (!kql) throw new SharePointError("query is required");
  const r = await fetcher(`${GRAPH}/search/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      // App-only search requires a region; the tenant is in North America.
      requests: [{ entityTypes: ["driveItem"], query: { queryString: kql }, region: "NAM", from: 0, size: Math.min(limit, 50) }],
    }),
  });
  if (!r.ok) throw await graphError(r, `Search in ${SHAREPOINT_SITES[site].label}`);
  const j = await r.json();
  // deno-lint-ignore no-explicit-any
  const hits: any[] = j?.value?.[0]?.hitsContainers?.[0]?.hits ?? [];
  const lib = SHAREPOINT_SITES[site];
  return hits
    .filter((h) => h?.resource?.parentReference?.driveId === lib.driveId)
    .map((h) => {
      const res = h.resource;
      const e = toEntry(site, res);
      return { ...e, kind: isFolderHit(res) ? ("folder" as const) : ("file" as const), folder: folderFromWebUrl(site, res.webUrl), snippet: cleanSnippet(h.summary) };
    })
    .filter((e) => inFolder(e.folder, folder))
    .slice(0, limit);
}

/** True when `folder` is `root` or below it (case-insensitive, as SharePoint is). */
export function inFolder(folder: string, root: string): boolean {
  if (!root) return true;
  const f = folder.toLowerCase();
  const r = root.toLowerCase();
  return f === r || f.startsWith(`${r}/`);
}

/** Metadata for one item, by id or by path. */
export async function getItem(
  fetcher: Fetcher,
  token: string,
  site: SharePointSite,
  ref: { item_id?: string; path?: string },
): Promise<SharePointEntry & { content_type: string | null }> {
  const url = ref.item_id
    ? `${GRAPH}/sites/${SHAREPOINT_SITES[site].siteId}/drive/items/${encodeURIComponent(ref.item_id)}?$select=${ITEM_SELECT}`
    : driveRootPathUrl(site, ref.path ?? "", `?$select=${ITEM_SELECT}`);
  const j = await getJson(fetcher, token, url, "File");
  return { ...toEntry(site, j), content_type: j?.file?.mimeType ?? null };
}

/** Download a file's bytes (Graph 302s to a short-lived pre-authenticated URL). */
export async function downloadItem(
  fetcher: Fetcher,
  token: string,
  site: SharePointSite,
  itemId: string,
): Promise<Uint8Array> {
  const url = `${GRAPH}/sites/${SHAREPOINT_SITES[site].siteId}/drive/items/${encodeURIComponent(itemId)}/content`;
  const r = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw await graphError(r, "Download");
  const len = Number(r.headers.get("content-length"));
  if (Number.isFinite(len) && len > SHAREPOINT_MAX_FILE_BYTES) {
    await r.body?.cancel();
    throw new SharePointError(`File is ${Math.round(len / 1048576)}MB; the limit is ${SHAREPOINT_MAX_FILE_BYTES / 1048576}MB`);
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length > SHAREPOINT_MAX_FILE_BYTES) {
    throw new SharePointError(`File is ${Math.round(bytes.length / 1048576)}MB; the limit is ${SHAREPOINT_MAX_FILE_BYTES / 1048576}MB`);
  }
  return bytes;
}

export type TextSection = { locator: string | null; text: string };

/**
 * Pick what to hand the model from a read file: optionally one section
 * (sheet / page / slide named `section`: an exact name such as "Page 3" or
 * "T12" wins, otherwise every name containing it), from character `start`,
 * at most `max` characters. Says what was left out.
 */
export function windowSections(
  sections: TextSection[],
  opts: { section?: string; start?: number; max: number; allNames?: string[] },
): { text: string; total_chars: number; returned: [number, number]; sections: string[]; note?: string } {
  const all = sections.filter((s) => s.text.trim());
  const names = opts.allNames ?? all.map((s) => s.locator).filter((l): l is string => !!l);
  const want = opts.section?.trim().toLowerCase();
  const loc = (s: TextSection) => (s.locator ?? "").toLowerCase();
  const exact = want ? all.filter((s) => loc(s) === want || loc(s).replace(/^[a-z]+:\s*/, "") === want) : [];
  const picked = !want ? all : exact.length ? exact : all.filter((s) => loc(s).includes(want));
  const body = picked.map((s) => (s.locator ? `## ${s.locator}\n${s.text.trim()}` : s.text.trim())).join("\n\n");
  const start = Math.min(Math.max(Math.floor(opts.start ?? 0), 0), body.length);
  const end = Math.min(body.length, start + opts.max);
  const notes: string[] = [];
  if (want && !picked.length) notes.push(`No section matches "${opts.section}". Sections: ${names.join(", ") || "none"}.`);
  if (end < body.length) notes.push(`Cut off at character ${end} of ${body.length}; call again with start=${end} for more.`);
  return {
    text: body.slice(start, end),
    total_chars: body.length,
    returned: [start, end],
    sections: names,
    ...(notes.length ? { note: notes.join(" ") } : {}),
  };
}
