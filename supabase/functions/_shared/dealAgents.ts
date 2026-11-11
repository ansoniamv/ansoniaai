// Pure helpers for the deal agents (deal-agents function): which email
// attachments are underwriting files, and what a CA agent session reported.
// No Deno APIs, so src/test can import them.

// ---------- Email attachments ----------

export type AttachmentMeta = {
  name: string;
  contentType: string | null;
  size: number;
  isInline?: boolean;
};

const UNDERWRITING_EXT = /\.(pdf|xlsx|xlsm|xls|csv)$/i;
/**
 * Files brokers attach that are not underwriting material: the executed CA we
 * sent back, Texas IABS forms, W-9s, flyers' logos, calendar invites. Reading
 * any of these with parse-deal-document costs money and finds nothing.
 */
const NOT_UNDERWRITING =
  /\b(iabs|information about brokerage services|confidentiality|non-?disclosure|nda|w-?9|logo|signature|invite|calendar|bid form|questionnaire|loi|letter of intent|psa|purchase (and|&) sale)\b|(^|[\s_-])ca([\s_.-]|$)/i;
/** Parser limit (deal-documents bucket). */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

/** True when an attachment looks like an OM, rent roll, T12 or other underwriting file. */
export function isUnderwritingAttachment(a: AttachmentMeta): boolean {
  if (a.isInline) return false;
  if (!UNDERWRITING_EXT.test(a.name)) return false;
  if (a.size < 5_000 || a.size > MAX_IMPORT_BYTES) return false;
  return !NOT_UNDERWRITING.test(a.name.replace(/\.[a-z0-9]+$/i, ""));
}

/** A storage-safe file name that keeps the broker's name readable. */
export function safeFileName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, " ").replace(/\s+/g, " ").trim();
  return (clean || "document").slice(0, 150);
}

// ---------- CA agent result ----------

export type CaOutcome =
  | "signed"
  | "already_signed"
  | "awaiting_access"
  | "needs_approval"
  | "needs_login"
  | "blocked"
  | "failed";

export type CaFlag = { clause: string; quote: string; why: string };

export type AgentDocument = { file: string; doc_type: "om" | "rent_roll" | "t12" | "other"; title: string };

export type CaAgentResult = {
  outcome: CaOutcome;
  platform: string | null;
  standard: boolean | null;
  summary: string | null;
  flags: CaFlag[];
  documents: AgentDocument[];
  notes: string | null;
  /** The CA is executed: signed now, signed before, or signed and then stopped at the deal room. */
  caSigned: boolean;
};

const OUTCOMES: CaOutcome[] = ["signed", "already_signed", "awaiting_access", "needs_approval", "needs_login", "blocked", "failed"];
const DOC_TYPES = ["om", "rent_roll", "t12", "other"] as const;

const str = (v: unknown, max = 2000): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

/**
 * result.json, tolerating a missing or malformed file: anything unreadable is a
 * failed run, never a signed one.
 */
export function parseCaResult(text: string | null): CaAgentResult {
  const failed: CaAgentResult = {
    outcome: "failed",
    platform: null,
    standard: null,
    summary: null,
    flags: [],
    documents: [],
    notes: text ? "result.json could not be read." : "The agent wrote no result.json.",
    caSigned: false,
  };
  if (!text) return failed;
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return failed;
  }
  if (!raw || typeof raw !== "object") return failed;
  const outcome = OUTCOMES.includes(raw.outcome) ? (raw.outcome as CaOutcome) : "failed";
  const ca = raw.ca && typeof raw.ca === "object" ? raw.ca : {};
  const flags: CaFlag[] = Array.isArray(ca.flags)
    ? ca.flags
      .map((f: any) => ({ clause: str(f?.clause, 120) ?? "", quote: str(f?.quote, 1500) ?? "", why: str(f?.why, 500) ?? "" }))
      .filter((f: CaFlag) => f.clause && f.quote)
      .slice(0, 20)
    : [];
  const documents: AgentDocument[] = Array.isArray(raw.documents)
    ? raw.documents
      .map((d: any) => ({
        file: str(d?.file, 300) ?? "",
        doc_type: (DOC_TYPES as readonly string[]).includes(d?.doc_type) ? d.doc_type : "other",
        title: str(d?.title, 200) ?? "",
      }))
      .filter((d: AgentDocument) => d.file && !d.file.includes(".."))
      .slice(0, 30)
    : [];
  return {
    outcome,
    platform: str(raw.platform, 60),
    standard: typeof ca.standard === "boolean" ? ca.standard : null,
    summary: str(ca.summary, 2000),
    flags,
    documents,
    notes: str(raw.notes, 4000),
    // Only outcomes that come after signing can say so; a needs_approval run
    // claiming ca_signed is not believed.
    caSigned: ["signed", "already_signed", "awaiting_access"].includes(outcome) ||
      (["needs_login", "blocked"].includes(outcome) && raw.ca_signed === true),
  };
}

/**
 * The run status a result maps to. A "signed" outcome that still lists flags
 * is not trusted: the agent was told to stop on any flag, so a CA with flags
 * that came back signed is surfaced for review rather than shown as routine.
 */
export function runStatusFor(r: CaAgentResult, approved: boolean): {
  status: "done" | "awaiting_access" | "needs_approval" | "needs_attention" | "failed";
  attention: string | null;
} {
  switch (r.outcome) {
    case "awaiting_access":
      if (r.flags.length && !approved) {
        return { status: "needs_attention", attention: "Signed, but the agent also flagged clauses. Review them." };
      }
      return { status: "awaiting_access", attention: null };
    case "signed":
    case "already_signed":
      if (r.flags.length && !approved) {
        return { status: "needs_attention", attention: "Signed, but the agent also flagged clauses. Review them." };
      }
      return { status: "done", attention: null };
    case "needs_approval":
      return { status: "needs_approval", attention: null };
    case "needs_login":
      return { status: "needs_attention", attention: r.notes ?? "The portal needs a login the agent doesn't have." };
    case "blocked":
      return { status: "needs_attention", attention: r.notes ?? "The agent couldn't get through the CA page." };
    default:
      return { status: "failed", attention: r.notes };
  }
}

/** Output files under docs/ that the result names, matched by base name or path suffix. */
export function documentFor(
  filename: string,
  docs: AgentDocument[],
): AgentDocument | null {
  const norm = filename.replace(/^\/?mnt\/session\/outputs\//, "").replace(/^\/+/, "");
  return docs.find((d) => {
    const f = d.file.replace(/^\/?mnt\/session\/outputs\//, "").replace(/^\/+/, "");
    return f === norm || norm.endsWith(`/${f}`) || f.endsWith(`/${norm}`) || f.split("/").pop() === norm.split("/").pop();
  }) ?? null;
}

// ---------- Waiting for deal-room access ----------

/** How often a run waiting for broker access tries the deal room again, and for how long. */
export const ACCESS_RETRY_EVERY_MS = 24 * 3600_000;
export const ACCESS_RETRY_FOR_MS = 7 * 24 * 3600_000;

/** The registrable part of a portal host: my.rcm1.com -> rcm1.com. */
export function portalDomain(url: string | null): string | null {
  if (!url) return null;
  let h: string;
  try {
    h = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const parts = h.split(".");
  return parts.length >= 2 ? parts.slice(-2).join(".") : null;
}

const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const ACCESS_WORDS = /\b(access|approved|approval|granted|deal ?room|data ?room|documents?|document center|due diligence|vault|welcome)\b/i;

/**
 * Whether a mailbox message looks like the portal saying the deal room is open:
 * it comes from (or links to) the CA's portal, names the property, and talks
 * about access or documents. Loose on purpose: a false match costs one extra
 * run, a miss costs a day.
 */
export function isAccessEmail(
  m: { from: string; subject: string; text: string },
  domain: string | null,
  propertyName: string | null,
): boolean {
  if (!domain) return false;
  const from = m.from.toLowerCase();
  const head = `${m.subject} ${m.text.slice(0, 5000)}`;
  if (!from.endsWith(`@${domain}`) && !from.endsWith(`.${domain}`) && !head.toLowerCase().includes(domain)) return false;
  const name = alnum(propertyName ?? "");
  if (name.length < 3 || !alnum(head).includes(name)) return false;
  return ACCESS_WORDS.test(head);
}
