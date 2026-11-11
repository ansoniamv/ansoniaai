// Read-only SharePoint reader (Acquisitions + Asset Management sites).
//
// POST { tool: "sharepoint_search" | "sharepoint_list_folder" | "sharepoint_read_file", args }
// → the tool's JSON result (errors are { error } with HTTP 200, like a tool result).
//
// POST { action: "check_brain_sources" }
// → looks up every Brain source pinned from SharePoint and records whether the
//   file changed since it was read, or is gone. Writes only those bookkeeping
//   columns; re-reading a source stays an admin action (process-data-room-source).
//
// Atlas (chat) calls this function-to-function with the service key rather than
// reading files in its own worker: a large spreadsheet can exhaust a worker's
// memory/CPU, and here that kills one tool call instead of the whole chat reply.
// Approved users call it from the Brain page to browse SharePoint.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsFor, requireUserOrService } from "../_shared/auth.ts";
import { runSharePointTool } from "../_shared/sharePointTools.ts";
import { getGraphToken, graphConfigured } from "../_shared/graphToken.ts";
import { getItem, isItemId, isSharePointSite, SharePointError } from "../_shared/sharePoint.ts";

const TOOLS = new Set(["sharepoint_search", "sharepoint_list_folder", "sharepoint_read_file"]);
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const auth = await requireUserOrService(req);
  if (auth && !auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  if (body?.action === "check_brain_sources") return json(await checkBrainSources());

  const tool = body?.tool;
  if (typeof tool !== "string" || !TOOLS.has(tool)) return json({ error: "unknown tool" }, 400);
  return json(await runSharePointTool(tool, body?.args ?? {}));
});

type Pinned = { id: string; sp_site: string; sp_item_id: string };

async function checkBrainSources() {
  if (!graphConfigured()) return { error: "SharePoint is not connected (Microsoft Graph secrets missing)." };
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await admin
    .from("data_room_sources")
    .select("id, sp_site, sp_item_id")
    .eq("kind", "sharepoint");
  if (error) {
    console.error("[sharepoint] check_brain_sources select", error);
    return { error: "could not load Brain sources" };
  }
  const pinned = (data ?? []) as Pinned[];
  const { token } = await getGraphToken();
  const fetcher = (u: string, i?: RequestInit) => fetch(u, i);
  const now = new Date().toISOString();
  let missing = 0;
  let failed = 0;

  // A handful at a time: Graph throttles bursts, and there are tens of these, not thousands.
  for (let i = 0; i < pinned.length; i += 5) {
    await Promise.all(pinned.slice(i, i + 5).map(async (p) => {
      if (!isSharePointSite(p.sp_site) || !isItemId(p.sp_item_id)) return;
      let fields: Record<string, unknown>;
      try {
        const item = await getItem(fetcher, token, p.sp_site, { item_id: p.sp_item_id });
        fields = {
          sp_current_modified: item.modified,
          sp_web_url: item.web_url,
          sp_folder: item.folder,
          sp_missing: false,
          sp_checked_at: now,
        };
      } catch (e) {
        if (e instanceof SharePointError && e.status === 404) {
          missing++;
          fields = { sp_missing: true, sp_checked_at: now };
        } else {
          failed++;
          console.error("[sharepoint] check", p.id, e);
          return;
        }
      }
      const { error: upErr } = await admin.from("data_room_sources").update(fields).eq("id", p.id);
      if (upErr) {
        failed++;
        console.error("[sharepoint] check update", p.id, upErr);
      }
    }));
  }
  return { checked: pinned.length, missing, failed };
}
