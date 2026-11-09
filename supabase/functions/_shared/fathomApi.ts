// Thin client for Fathom's external API (https://developers.fathom.ai).
//
// No Deno-only imports: src/test imports this module under vitest.
//
// Auth: a personal API key goes in X-Api-Key; an OAuth access token goes in
// Authorization: Bearer. OAuth apps cannot use include_transcript /
// include_summary on GET /meetings and must call /recordings/{id}/... instead.

export const FATHOM_API = "https://api.fathom.ai/external/v1";
// The authorize and token URLs are the ones the official TypeScript SDK
// (fathom-typescript 0.0.43, funcs/getAuthorizationUrl + withAuthorization)
// uses. The docs' curl example shows api.fathom.ai for the token URL instead;
// the SDK is the shipping code, so we follow it.
export const FATHOM_AUTHORIZE_URL = "https://fathom.video/external/v1/oauth2/authorize";
export const FATHOM_TOKEN_URL = "https://fathom.video/external/v1/oauth2/token";

export type FathomAuth = { kind: "api_key"; key: string } | { kind: "bearer"; token: string };

export class FathomError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "FathomError";
  }
}

export type FathomInvitee = {
  name?: string | null;
  email?: string | null;
  email_domain?: string | null;
  is_external?: boolean;
};

export type FathomTranscriptItem = {
  speaker: { display_name: string; matched_calendar_invitee_email?: string | null };
  text: string;
  timestamp: string;
};

export type FathomActionItem = {
  description: string;
  completed?: boolean;
  recording_timestamp?: string;
  recording_playback_url?: string;
  assignee?: { name?: string | null; email?: string | null } | null;
};

export type FathomMeeting = {
  recording_id: number;
  title: string;
  meeting_title?: string | null;
  url?: string;
  share_url?: string;
  created_at?: string;
  scheduled_start_time?: string | null;
  scheduled_end_time?: string | null;
  recording_start_time?: string | null;
  recording_end_time?: string | null;
  calendar_invitees_domains_type?: "only_internal" | "one_or_more_external";
  calendar_invitees?: FathomInvitee[];
  recorded_by?: { name: string; email: string; email_domain?: string; team?: string | null };
  transcript?: FathomTranscriptItem[] | null;
  default_summary?: { template_name?: string | null; markdown_formatted?: string | null } | null;
  action_items?: FathomActionItem[] | null;
};

export type TokenResponse = { access_token: string; refresh_token: string; expires_in: number };

type FetchLike = typeof fetch;
type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL(FATHOM_AUTHORIZE_URL);
  url.searchParams.append("client_id", clientId);
  url.searchParams.append("redirect_uri", redirectUri);
  url.searchParams.append("scope", "public_api");
  url.searchParams.append("state", state);
  url.searchParams.append("response_type", "code");
  return url.toString();
}

async function tokenRequest(
  params: Record<string, string>,
  fetchImpl: FetchLike = fetch,
): Promise<TokenResponse> {
  const res = await fetchImpl(FATHOM_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (!res.ok) throw new FathomError(res.status, `Fathom token request failed (${res.status})`);
  const json = await res.json();
  if (typeof json?.access_token !== "string" || typeof json?.refresh_token !== "string") {
    throw new FathomError(502, "Fathom token response was missing a token");
  }
  // expires_in is required by the SDK's schema; fall back to an hour, never to
  // "never expires".
  const expires = Number(json.expires_in);
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_in: Number.isFinite(expires) && expires > 0 ? expires : 3600,
  };
}

export function exchangeCode(
  opts: { clientId: string; clientSecret: string; code: string; redirectUri: string },
  fetchImpl?: FetchLike,
) {
  return tokenRequest(
    {
      grant_type: "authorization_code",
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
    },
    fetchImpl,
  );
}

/** Fathom refresh tokens are single-use: persist the new one before using the access token. */
export function refreshTokens(
  opts: { clientId: string; clientSecret: string; refreshToken: string },
  fetchImpl?: FetchLike,
) {
  return tokenRequest(
    {
      grant_type: "refresh_token",
      refresh_token: opts.refreshToken,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
    },
    fetchImpl,
  );
}

export class FathomClient {
  constructor(
    private auth: FathomAuth,
    private fetchImpl: FetchLike = fetch,
    private sleep: Sleep = defaultSleep,
  ) {}

  private headers(): Record<string, string> {
    return this.auth.kind === "api_key"
      ? { "X-Api-Key": this.auth.key }
      : { Authorization: `Bearer ${this.auth.token}` };
  }

  /**
   * One request, retrying a 429 up to twice after Retry-After (capped at 20 s,
   * so a run inside an edge function's time limit doesn't stall on one call).
   */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(`${FATHOM_API}${path}`, {
        method,
        headers: {
          ...this.headers(),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 429 && attempt < 2) {
        const wait = Number(res.headers.get("Retry-After"));
        await this.sleep(Math.min(Number.isFinite(wait) && wait > 0 ? wait : 5, 20) * 1000);
        continue;
      }
      if (!res.ok) {
        throw new FathomError(res.status, `Fathom ${method} ${path.split("?")[0]} failed (${res.status})`);
      }
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }
  }

  /**
   * One page of meetings created after `since`, external calls only. With an
   * API key, content comes inline; OAuth apps must fetch it per recording.
   */
  listMeetings(opts: { since: string; cursor?: string | null; withContent: boolean }) {
    const q = new URLSearchParams({
      created_after: opts.since,
      calendar_invitees_domains_type: "one_or_more_external",
    });
    if (opts.cursor) q.set("cursor", opts.cursor);
    // Only transcript and summary are closed to OAuth apps on this endpoint.
    q.set("include_action_items", "true");
    if (opts.withContent) {
      q.set("include_transcript", "true");
      q.set("include_summary", "true");
    }
    return this.request<{ items: FathomMeeting[]; next_cursor: string | null }>(
      "GET",
      `/meetings?${q.toString()}`,
    );
  }

  async getSummary(recordingId: number): Promise<string | null> {
    const r = await this.request<{ summary?: { markdown_formatted?: string | null } }>(
      "GET",
      `/recordings/${recordingId}/summary`,
    );
    return r.summary?.markdown_formatted ?? null;
  }

  async getTranscript(recordingId: number): Promise<FathomTranscriptItem[]> {
    const r = await this.request<{ transcript?: FathomTranscriptItem[] }>(
      "GET",
      `/recordings/${recordingId}/transcript`,
    );
    return r.transcript ?? [];
  }

  createWebhook(destinationUrl: string) {
    return this.request<{ id: string; secret: string }>("POST", "/webhooks", {
      destination_url: destinationUrl,
      triggered_for: ["my_recordings"],
      include_transcript: true,
      include_summary: true,
      include_action_items: true,
    });
  }

  deleteWebhook(id: string) {
    return this.request<void>("DELETE", `/webhooks/${encodeURIComponent(id)}`);
  }
}
