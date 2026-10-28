// Generated models: pure helpers shared by generate-model, the deal page and
// the tests. No Deno or network code here, so vitest can import it directly.

/** The deal documents a model run reads, by role. */
export type ModelInputRole = "rent_roll" | "t12" | "om" | "comps";

export type ModelInputDoc = {
  id: string;
  file_name: string;
  doc_type: string | null;
  doc_as_of: string | null;
  created_at: string;
};

export type ModelInputPick = Partial<Record<ModelInputRole, string>>;

export const RENOVATION_LEVELS = ["unknown", "classic", "partial", "full", "mixed"] as const;
export type RenovationLevel = (typeof RENOVATION_LEVELS)[number];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function ymd(y: number, m: number, d: number): number | null {
  if (!Number.isInteger(y) || y < 1990 || y > 2100) return null;
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (!Number.isInteger(d) || d < 1 || d > last) return null;
  return Date.UTC(y, m - 1, d);
}

/**
 * The latest date written in a document's "as of" text, as a UTC timestamp, or
 * null when it names none. The text is whatever the document said ("As of
 * 10/13/2026", "T12 ending Sep 2026", "Oct 2025 - Sep 2026"), so every date in
 * it is read and the latest wins: for a period that is its end. A bare month
 * counts as the last day of that month.
 */
export function asOfDate(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const found: number[] = [];
  const add = (v: number | null) => {
    if (v !== null) found.push(v);
  };
  for (const m of t.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) add(ymd(+m[1], +m[2], +m[3]));
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g)) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    add(ymd(y, +m[1], +m[2]));
  }
  // "Sep 30, 2026", "September 2026", "Sept. 2026", "Sep-26". A day must be
  // followed by a space, or "September 2026" would read as the 20th.
  for (const m of t.matchAll(/\b([a-z]{3})[a-z]*\.?[\s-]*(?:(\d{1,2})(?:st|nd|rd|th)?,?\s+)?'?(\d{4}|\d{2})\b/g)) {
    const mo = MONTHS.indexOf(m[1]) + 1;
    if (mo === 0) continue;
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    add(ymd(y, mo, m[2] ? +m[2] : lastDay));
  }
  return found.length ? Math.max(...found) : null;
}

const uploaded = (d: ModelInputDoc) => {
  const v = Date.parse(d.created_at);
  return Number.isFinite(v) ? v : 0;
};
/** The document's own date when it states one, else when it was uploaded. */
const docDate = (d: ModelInputDoc) => asOfDate(d.doc_as_of) ?? uploaded(d);
const newest = (docs: ModelInputDoc[]) =>
  [...docs].sort((a, b) => docDate(b) - docDate(a) || uploaded(b) - uploaded(a))[0];

/**
 * The files a run uses unless the user picks others: the newest T12, the rent
 * roll dated closest to it, and the newest OM (UNDERWRITE.md, Workflow step 1).
 * A comps export is never guessed: the parser files it as "other", alongside
 * anything else, so the user picks it.
 */
export function pickModelInputs(docs: ModelInputDoc[]): ModelInputPick {
  const of = (type: string) => docs.filter((d) => d.doc_type === type);
  const pick: ModelInputPick = {};
  const t12 = newest(of("t12"));
  if (t12) pick.t12 = t12.id;
  const rrs = of("rent_roll");
  const t12Date = t12 ? asOfDate(t12.doc_as_of) : null;
  if (rrs.length) {
    pick.rent_roll = t12Date === null
      ? newest(rrs).id
      : [...rrs].sort((a, b) =>
        Math.abs(docDate(a) - t12Date) - Math.abs(docDate(b) - t12Date) || uploaded(b) - uploaded(a)
      )[0].id;
  }
  const om = newest(of("om"));
  if (om) pick.om = om.id;
  return pick;
}

/** The file extension to mount a document under, lower case with the dot ("" when it has none). */
export function fileExtension(fileName: string): string {
  const m = fileName.match(/\.([A-Za-z0-9]{1,5})$/);
  return m ? `.${m[1].toLowerCase()}` : "";
}

/** Dollars to the session budget's minor-unit string ("15" -> "1500"). */
export function budgetAmount(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) throw new Error(`bad model run budget: ${usd}`);
  return String(Math.round(usd * 100));
}

/** A list-cost object ({amount: "1234", currency: "USD"}) in dollars, or null. */
export function listCostUsd(cost: unknown): number | null {
  const amount = (cost as { amount?: unknown } | null)?.amount;
  if (typeof amount !== "string" || !/^\d+$/.test(amount)) return null;
  return Number(amount) / 100;
}

// ---------- Session events ----------

export type SessionEvent = {
  id: string;
  type: string;
  [k: string]: unknown;
};

export type EventDigest = {
  /** The latest PROGRESS: line the agent sent, without the prefix. */
  progress: string | null;
  /** The latest agent message of any kind, for an error when the run ends without a model. */
  lastMessage: string | null;
  /** stop_reason.type of the latest session.status_idle. */
  stopReason: string | null;
  terminated: boolean;
  /** Held tool calls (evaluated_permission "ask") not yet answered. */
  pendingAsks: string[];
  errors: string[];
};

const messageText = (e: SessionEvent): string => {
  const content = e.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is { type: string; text: string } => b?.type === "text" && typeof b?.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
};

/** Folds new events onto what earlier polls found. Events are in session order. */
export function digestEvents(events: SessionEvent[], prev?: Partial<EventDigest>): EventDigest {
  const out: EventDigest = {
    progress: prev?.progress ?? null,
    lastMessage: prev?.lastMessage ?? null,
    stopReason: prev?.stopReason ?? null,
    terminated: prev?.terminated ?? false,
    pendingAsks: [...(prev?.pendingAsks ?? [])],
    errors: [...(prev?.errors ?? [])],
  };
  for (const e of events) {
    switch (e.type) {
      case "agent.message": {
        const text = messageText(e);
        if (!text) break;
        out.lastMessage = text;
        const lines = text.split("\n").filter((l) => /^\s*PROGRESS:/i.test(l));
        if (lines.length) out.progress = lines[lines.length - 1].replace(/^\s*PROGRESS:\s*/i, "").slice(0, 200);
        break;
      }
      case "agent.tool_use":
      case "agent.mcp_tool_use":
        if (e.evaluated_permission === "ask") out.pendingAsks.push(e.id);
        break;
      case "user.tool_confirmation":
        out.pendingAsks = out.pendingAsks.filter((id) => id !== e.tool_use_id);
        break;
      case "session.status_running":
        out.stopReason = null;
        break;
      case "session.status_idle":
        out.stopReason = (e.stop_reason as { type?: string } | undefined)?.type ?? null;
        break;
      case "session.status_terminated":
        out.terminated = true;
        break;
      case "session.error": {
        const err = e.error as { message?: string } | undefined;
        out.errors.push(String(err?.message ?? e.message ?? "session error").slice(0, 500));
        break;
      }
    }
  }
  return out;
}

/** Stop reasons after which the agent does no more work without us. */
const FINAL_STOPS = new Set(["end_turn", "retries_exhausted", "budget_reached"]);

/** True when the run is over and its outputs can be collected. */
export function runIsOver(status: string, digest: EventDigest): boolean {
  if (status === "terminated" || digest.terminated) return true;
  return status === "idle" && digest.stopReason !== null && FINAL_STOPS.has(digest.stopReason);
}

// ---------- Session outputs ----------

export type OutputFile = { id: string; filename: string; created_at: string };

/**
 * The run's three outputs. The skill saves the model after each tab, so a name
 * can appear more than once; the newest copy wins. The model is the newest
 * .xlsx, so a capped run still yields its last save.
 */
export function pickOutputs(files: OutputFile[]): { model?: OutputFile; qc?: OutputFile; result?: OutputFile } {
  const base = (f: OutputFile) => f.filename.split("/").pop() ?? f.filename;
  const byNewest = [...files].sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
  return {
    model: byNewest.find((f) => /\.xlsx$/i.test(base(f))),
    qc: byNewest.find((f) => base(f).toLowerCase() === "qc.md"),
    result: byNewest.find((f) => base(f).toLowerCase() === "result.json"),
  };
}

export type RunResult = { complete: boolean; skipped: string[] };

/** result.json, tolerating a missing or malformed file (then the run is not known to be complete). */
export function parseRunResult(text: string | null): RunResult {
  if (!text) return { complete: false, skipped: [] };
  try {
    const raw = JSON.parse(text);
    return {
      complete: raw?.complete === true,
      skipped: Array.isArray(raw?.skipped) ? raw.skipped.map(String).slice(0, 50) : [],
    };
  } catch {
    return { complete: false, skipped: [] };
  }
}

/** Why a run that saved no model ended, in words for the deal page. */
export function failureMessage(digest: EventDigest, budgetUsd: number): string {
  if (digest.stopReason === "budget_reached") {
    return `The run reached its $${budgetUsd} cost cap before it saved a model.`;
  }
  if (digest.errors.length) return `The run failed: ${digest.errors[digest.errors.length - 1]}`;
  if (digest.stopReason === "retries_exhausted") return "The run failed after repeated errors on Anthropic's side.";
  return digest.lastMessage
    ? `The run ended without saving a model. Its last message: ${digest.lastMessage.slice(0, 400)}`
    : "The run ended without saving a model.";
}

/** "00. Pro Forma - <Property> vCURRENT.xlsx", with characters storage paths and Windows reject removed. */
export function modelFileName(propertyName: string): string {
  const clean = propertyName.replace(/[\\/:*?"<>|#%]+/g, " ").replace(/\s+/g, " ").trim() || "Deal";
  return `00. Pro Forma - ${clean} vCURRENT.xlsx`;
}
