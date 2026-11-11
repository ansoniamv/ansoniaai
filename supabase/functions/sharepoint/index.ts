// Read-only SharePoint reader (Acquisitions + Asset Management sites).
//
// POST { tool: "sharepoint_search" | "sharepoint_list_folder" | "sharepoint_read_file", args }
// → the tool's JSON result (errors are { error } with HTTP 200, like a tool result).
//
// Atlas (chat) calls this function-to-function with the service key rather than
// reading files in its own worker: a large spreadsheet can exhaust a worker's
// memory/CPU, and here that kills one tool call instead of the whole chat reply.
// Approved users may call it directly too (for a future SharePoint browser).
import { corsFor, requireUserOrService } from "../_shared/auth.ts";
import { runSharePointTool } from "../_shared/sharePointTools.ts";

const TOOLS = new Set(["sharepoint_search", "sharepoint_list_folder", "sharepoint_read_file"]);

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const auth = await requireUserOrService(req);
  if (auth && !auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const tool = body?.tool;
  if (typeof tool !== "string" || !TOOLS.has(tool)) return json({ error: "unknown tool" }, 400);
  return json(await runSharePointTool(tool, body?.args ?? {}));
});
