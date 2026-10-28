// Check the model-run container before trusting it with a real deal: can it get
// LibreOffice, and does the skill's recalc chain work on the pro forma template?
//
// Starts one short session on the underwriter agent (capped at $2), uploads the
// template, asks the agent to run only the setup and the recalc scripts, and
// prints what it reports. It builds no model.
//
//   deno run --allow-net --allow-env --allow-read scripts/model-env-probe.ts "<path to 00. Pro Forma - Template.xlsx>"
//
// Env: ANTHROPIC_API_KEY, MODEL_AGENT_ID, MODEL_ENVIRONMENT_ID (ids from claude-lock.json; see anthropic/README.md)
import { deleteClaudeFile, uploadClaudeFile } from "../supabase/functions/_shared/anthropic.ts";
import { createSession, getSession, listEvents } from "../supabase/functions/_shared/managedAgents.ts";
import { digestEvents, listCostUsd } from "../supabase/functions/_shared/dealModel.ts";

const templatePath = Deno.args[0];
const agentId = Deno.env.get("MODEL_AGENT_ID");
const environmentId = Deno.env.get("MODEL_ENVIRONMENT_ID");
if (!templatePath || !agentId || !environmentId) {
  console.error("usage: model-env-probe.ts <template.xlsx>, with MODEL_AGENT_ID and MODEL_ENVIRONMENT_ID set");
  Deno.exit(1);
}

const template = new Blob([await Deno.readFile(templatePath)]);
const fileId = await uploadClaudeFile(template, "template.xlsx");

const session = await createSession({
  agentId,
  environmentId,
  title: "Model environment probe",
  resources: [{ type: "file", file_id: fileId, mount_path: "/template.xlsx" }],
  budgetCents: "200",
  metadata: { purpose: "env-probe" },
  message: [
    "This is an environment check, not a deal. Do not build a model and do not use the web.",
    "From the full-underwrite skill, do only the Setup section, then test the recalc chain on /mnt/session/uploads/template.xlsx:",
    "1. Report python3 --version, whether lxml and openpyxl import, soffice --version, and whether `import uno` works.",
    "2. If LibreOffice or uno is missing, try the install the skill describes, and report the exact command and its result.",
    "3. If LibreOffice works: copy the skill's scripts/ to /workspace/uw/, open the template with xlsx_xml.Workbook, save it unchanged as out.xlsx,",
    "   run lo_compat.py and recalc.py on it, then inject_cache.py for the Pro Forma and Dashboard sheets, and report the time each step took",
    "   and a few recalculated values (Pro Forma G54, Dashboard's first numbers). Write final.xlsx to /mnt/session/outputs/.",
    "4. End with one line: RECALC: works | RECALC: no LibreOffice | RECALC: fails (<why>).",
  ].join("\n"),
});
console.log(`session ${session.id} started; checking every 15 s`);

let page: string | null = null;
let lastId: string | null = null;
let digest = digestEvents([]);
for (;;) {
  await new Promise((r) => setTimeout(r, 15_000));
  const s = await getSession(session.id);
  for (;;) {
    const res = await listEvents(session.id, page);
    const at = lastId ? res.data.findIndex((e) => e.id === lastId) : -1;
    const fresh = at >= 0 ? res.data.slice(at + 1) : res.data;
    for (const e of fresh) {
      digest = digestEvents([e], digest);
      if (e.type === "agent.message") console.log(`\n${digest.lastMessage}`);
    }
    if (res.data.length) lastId = res.data[res.data.length - 1].id;
    if (!res.next_page) break;
    page = res.next_page;
  }
  const cost = listCostUsd(s.usage?.list_cost);
  if (s.status === "terminated" || (s.status === "idle" && digest.stopReason && digest.stopReason !== "requires_action")) {
    console.log(`\nsession ${s.status} (${digest.stopReason ?? "-"}), cost $${cost?.toFixed(2) ?? "?"}`);
    break;
  }
  if (digest.stopReason === "requires_action") {
    console.log("\nThe session is holding a tool call for approval; open it in the Console to answer, or stop here.");
    break;
  }
}
await deleteClaudeFile(fileId);
console.log(`The recalculated copy, if any, is in the session's outputs: ant beta:files list --scope-id ${session.id} --beta managed-agents-2026-04-01`);
