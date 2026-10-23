// One place where "which mailbox, over which transport" is decided.
//
// There is one transport: Microsoft Graph app-only. A token is minted from the
// GRAPH_* secrets and the mailbox is named explicitly in the path,
//   https://graph.microsoft.com/v1.0/users/{upn}/...
// so the mailbox is chosen by us rather than inferred from whoever happened to
// be signed in when someone clicked Connect. It cannot silently bind to the
// wrong one, and "reachable" and "is the right mailbox" are the same question.
//
// The legacy connector-gateway path is gone. It could not verify which mailbox
// it was talking to, which is precisely the failure this module exists to make
// impossible, and there is no fallback to fall back to.

import { getGraphToken, graphConfigured } from "./graphToken.ts";

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export type MailboxKey = "acquisitions" | "atlas";

export const MAILBOX_UPN: Record<MailboxKey, string> = {
  acquisitions: Deno.env.get("GRAPH_ACQUISITIONS_UPN") || "acquisitions@ansoniaproperties.com",
  atlas: Deno.env.get("GRAPH_ATLAS_UPN") || "atlas@ansoniaproperties.com",
};

export type MailboxTransport = {
  mailbox: MailboxKey;
  /**
   * Always "graph". The union is kept because callers compare against it and
   * persist it, and narrowing it to a single literal would turn those reads into
   * type errors in functions this change does not otherwise touch.
   */
  via: "graph" | "gateway";
  /** UPN this transport is bound to. */
  upn: string;
  /** Absolute URL for a Graph-relative path such as "/messages?$top=1". */
  url: (path: string) => string;
  /** Auth headers for that transport. */
  headers: () => Promise<Record<string, string>>;
  /** Human-readable note for status output. Never contains a secret. */
  detail: string;
};

/**
 * Resolve how to talk to a mailbox.
 *
 * Throws rather than returning null when the secrets are absent: there is no
 * second transport to try, so a null here would only travel further before
 * failing somewhere less informative.
 */
export function resolveMailbox(mailbox: MailboxKey): MailboxTransport {
  if (!graphConfigured()) {
    throw new Error(
      "GRAPH_TENANT_ID, GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET are not set — " +
        "Microsoft Graph app-only is the only mailbox transport.",
    );
  }

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
 * Follow an @odata.nextLink only when it points at Graph — never chase an
 * absolute URL a response hands us to some other host.
 */
export function safeNextLink(_mb: MailboxTransport, next: unknown): string | null {
  if (typeof next !== "string") return null;
  return next.startsWith(GRAPH_BASE) ? next : null;
}
