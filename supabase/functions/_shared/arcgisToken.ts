// Shared ArcGIS token selection used by BOTH esri-enrich (production path) and
// the api-status probe, so the status page tests exactly what production does.
//
// Mode: ESRI_AUTH_MODE=oauth forces the client-credentials minting path.
// Otherwise a static ESRI_API_KEY wins when present.
// Never log the client secret or any token value (not even a prefix).

export type TokenSource = "oauth" | "api_key" | "api_key_fallback";
export type ArcGISToken = { token: string; source: TokenSource; note?: string };

type TokenCache = { token: string; expiresAt: number } | null;
let cachedToken: TokenCache = null;
const TOKEN_REFRESH_BUFFER_MS = 120_000; // 2 minutes

export async function getArcGISToken(
  fetcher: (url: string, init: RequestInit) => Promise<Response> = (u, i) => fetch(u, i),
): Promise<ArcGISToken> {
  const clientId = Deno.env.get("ESRI_CLIENT_ID");
  const clientSecret = Deno.env.get("ESRI_CLIENT_SECRET");
  const apiKey = Deno.env.get("ESRI_API_KEY");
  const authMode = Deno.env.get("ESRI_AUTH_MODE")?.toLowerCase();

  if (apiKey && authMode !== "oauth") {
    console.log("ArcGIS token source: static ESRI_API_KEY (ESRI_AUTH_MODE not 'oauth')");
    return { token: apiKey, source: "api_key" };
  }

  if (clientId && clientSecret) {
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAt - TOKEN_REFRESH_BUFFER_MS > now) {
      console.log("ArcGIS token source: oauth (cached minted token)");
      return { token: cachedToken.token, source: "oauth" };
    }
    try {
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        expiration: "120",
        f: "json",
      });
      const res = await fetcher("https://www.arcgis.com/sharing/rest/oauth2/token", {
        method: "POST",
        body,
      });
      const json = await res.json();
      if (json?.error) {
        throw new Error(`OAuth token error: ${JSON.stringify(json.error)}`);
      }
      const token = json.access_token as string;
      if (!token) throw new Error("OAuth token error: no access_token in response");
      const expiresInSec = typeof json.expires_in === "number" ? json.expires_in : 7200;
      cachedToken = { token, expiresAt: Date.now() + expiresInSec * 1000 };
      console.log("ArcGIS token source: oauth (freshly minted token)");
      return { token, source: "oauth" };
    } catch (err) {
      const msg = (err as Error).message;
      if (apiKey) {
        console.warn("ArcGIS OAuth failed, falling back to ESRI_API_KEY:", msg);
        return { token: apiKey, source: "api_key_fallback", note: msg };
      }
      throw new Error(
        `${msg}. ESRI_CLIENT_ID / ESRI_CLIENT_SECRET are invalid; update them or configure ESRI_API_KEY.`,
      );
    }
  }

  if (apiKey) {
    console.log("ArcGIS token source: static ESRI_API_KEY (no OAuth client credentials)");
    return { token: apiKey, source: "api_key" };
  }
  throw new Error("ArcGIS not configured. Add ESRI_API_KEY (or ESRI_CLIENT_ID + ESRI_CLIENT_SECRET).");
}
