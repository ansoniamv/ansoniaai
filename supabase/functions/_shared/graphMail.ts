// One place where "which mailbox, over which transport" is decided.
//
// Graph path (preferred): app-only token + an explicit mailbox UPN in the path,
//   https://graph.microsoft.com/v1.0/users/{upn}/...
//   The mailbox is named by us, not inferred from whoever happened to be signed
//   in when someone clicked Connect — so it cannot silently bind to the wrong one.
//
// Gateway path (legacy, Lovable): kept only as a fallback while GRAPH_* secrets
//   are not yet set, so this code can ship before admin consent lands. Delete the
//   gateway branch — and _shared/outlookKeys.ts with it — once Graph is live.
//
// Graph resource paths and $select/$filter query strings are IDENTICAL on both
// transports; the gateway was never rewriting them. Only the prefix and the
// auth headers differ.

import { getGraphToken, graphConfigured } from "./graphToken.ts";
import { resolveAcquisitionsKey, resolveAtlasKey } from "./outlookKeys.ts";

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const GATEWAY_BASE = "https://connector-gateway.lovable.dev/microsoft_outlook";

export type MailboxKey = "acquisitions" | "atlas";

export const MAILBOX_UPN: Record<MailboxKey, string> = {
  acquisitions: Deno.env.get("GRAPH_ACQUISITIONS_UPN") || "acquisitions@ansoniaproperties.com",
  atlas: Deno.env.get("GRAPH_ATLAS_UPN") || "atlas@ansoniaproperties.com",
};

export type MailboxTransport = {
  mailbox: MailboxKey;
  /** "graph" | "gateway" — safe to log and surface on the status page. */
  via: "graph" | "gateway";
  /** UPN on the Graph path, null on the gateway path (identity is implicit there). */
  upn: string | null;
  /** Absolute URL for a Graph-relative path such as "/messages?$top=1". */
  url: (path: string) => string;
  /** Auth headers for that transport. */
  headers: () => Promise<Record<string, string>>;
  /** Human-readable note for status output. Never contains a secret. */
  detail: string;
};

/**
 * Resolve how to talk to a mailbox. Returns null when neither transport is
 * configured for it (caller decides whether that is fatal).
 */
export function resolveMailbox(mailbox: MailboxKey): MailboxTransport | null {
  if (graphConfigured()) {
    const upn = MAILBOX_UPN[mailbox];
    const prefix = `${GRAPH_BASE}/users/${encodeURIComponent(upn)}`;
    return {
      mailbox,
      via: "graph",
      upn,
      url: (path: string) => (path.startsWith("http") ? path : `${prefix}${path}`),
      headers: async () => {
        const { token } = await getGraphToken();
        return { Authorization: `Bearer ${token}` };
      },
      detail: `Graph app-only as ${upn}`,
    };
  }

  // ---- legacy gateway fallback ----
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const acq = resolveAcquisitionsKey();
  const atlasRes = resolveAtlasKey();
  const connectionKey = mailbox === "atlas"
    ? (atlasRes.collidesWithAcquisitions ? null : atlasRes.key)
    : acq.key;
  const keyName = mailbox === "atlas" ? atlasRes.name : acq.name;
  if (!lovableKey || !connectionKey) return null;

  return {
    mailbox,
    via: "gateway",
    upn: null,
    url: (path: string) => (path.startsWith("http") ? path : `${GATEWAY_BASE}/me${path}`),
    headers: async () => ({
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": connectionKey,
    }),
    detail: `Lovable gateway via ${keyName} (mailbox identity unverified)`,
  };
}

/** fetch() against a mailbox, with the right prefix and auth headers applied. */
export async function graphFetch(
  mb: MailboxTransport,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const auth = await mb.headers();
  return fetch(mb.url(path), {
    ...init,
    headers: { ...auth, ...(init.headers as Record<string, string> | undefined) },
  });
}

/**
 * Follow an @odata.nextLink only when it points at the transport we are already
 * using — never chase an absolute URL a response hands us to some other host.
 */
export function safeNextLink(mb: MailboxTransport, next: unknown): string | null {
  if (typeof next !== "string") return null;
  const allowed = mb.via === "graph" ? GRAPH_BASE : GATEWAY_BASE;
  return next.startsWith(allowed) ? next : null;
}
