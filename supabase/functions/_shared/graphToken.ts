// Shared Microsoft Graph app-only token minter, used by every Outlook function
// and by the api-status probe, so the status page tests exactly what production does.
//
// Auth model: client credentials (application permissions) against the tenant's
// v2.0 token endpoint, scope https://graph.microsoft.com/.default. There is no
// signed-in user, so there is no /me — every call must name a mailbox
// (see graphMail.ts). That is what removes the "wrong mailbox authorized"
// failure mode permanently.
//
// Required secrets: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET.
// Never log the client secret or any token value (not even a prefix).

export type GraphToken = { token: string; expiresIn: number; cached: boolean };

type TokenCache = { token: string; expiresAt: number } | null;
let cachedToken: TokenCache = null;
const TOKEN_REFRESH_BUFFER_MS = 120_000; // 2 minutes

/** True when the three app-only secrets are present. Callers use this to decide
 *  between the Graph path and the legacy Lovable connector gateway. */
export function graphConfigured(): boolean {
  return !!(
    Deno.env.get("GRAPH_TENANT_ID") &&
    Deno.env.get("GRAPH_CLIENT_ID") &&
    Deno.env.get("GRAPH_CLIENT_SECRET")
  );
}

/** Names of the secrets that are present — safe to log/display. Values never are. */
export function graphSecretsPresent(): string[] {
  return ["GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET"].filter((n) =>
    !!Deno.env.get(n)
  );
}

/** Drop the cached token. Used by tests and by api-status when it wants a cold mint. */
export function resetGraphTokenCache(): void {
  cachedToken = null;
}

export async function getGraphToken(
  fetcher: (url: string, init: RequestInit) => Promise<Response> = (u, i) => fetch(u, i),
): Promise<GraphToken> {
  const tenantId = Deno.env.get("GRAPH_TENANT_ID");
  const clientId = Deno.env.get("GRAPH_CLIENT_ID");
  const clientSecret = Deno.env.get("GRAPH_CLIENT_SECRET");

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "Microsoft Graph not configured. Add GRAPH_TENANT_ID, GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET.",
    );
  }

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - TOKEN_REFRESH_BUFFER_MS > now) {
    return { token: cachedToken.token, expiresIn: Math.round((cachedToken.expiresAt - now) / 1000), cached: true };
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetcher(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
  );
  const json = await res.json().catch(() => ({}));

  if (!res.ok || json?.error) {
    // AAD returns { error, error_description } — the description names the real
    // problem (bad secret, wrong tenant, consent not granted). It contains no secret.
    const desc = String(json?.error_description || json?.error || `HTTP ${res.status}`)
      .split("\n")[0]
      .slice(0, 300);
    throw new Error(`Graph token error: ${desc}`);
  }

  const token = json.access_token as string;
  if (!token) throw new Error("Graph token error: no access_token in response");
  const expiresInSec = typeof json.expires_in === "number" ? json.expires_in : 3600;
  cachedToken = { token, expiresAt: Date.now() + expiresInSec * 1000 };
  console.log("Graph token: freshly minted (client credentials)");
  return { token, expiresIn: expiresInSec, cached: false };
}
