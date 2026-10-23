import type { AccountInfo, IPublicClientApplication } from "@azure/msal-browser";

/**
 * Outreach drafts are written into the sender's own Outlook with their own
 * Microsoft sign-in, made at the moment they click. The short-lived token stays
 * in this browser tab (sessionStorage) and never reaches our servers, so the
 * app holds no standing access to anyone's mailbox. Setup: AZURE_OUTLOOK_SIGNIN.md.
 */

const CLIENT_ID = import.meta.env.VITE_MS_CLIENT_ID as string | undefined;
const TENANT_ID = import.meta.env.VITE_MS_TENANT_ID as string | undefined;

// Creating a draft (POST /me/messages) needs Mail.ReadWrite; Microsoft has no
// narrower drafts-only permission.
const SCOPES = ["Mail.ReadWrite"];

export const outlookSignInConfigured = Boolean(CLIENT_ID && TENANT_ID);

let msal: Promise<IPublicClientApplication> | null = null;

function client(): Promise<IPublicClientApplication> {
  if (!outlookSignInConfigured) throw new Error("Outlook sign-in isn't set up yet");
  // Loaded on first use: the library is only needed when someone makes drafts.
  msal ??= import("@azure/msal-browser").then(({ createStandardPublicClientApplication }) =>
    createStandardPublicClientApplication({
      auth: {
        clientId: CLIENT_ID!,
        // Single tenant: only Ansonia's Microsoft 365 accounts can sign in.
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
        redirectUri: `${window.location.origin}/ms-auth.html`,
      },
      cache: { cacheLocation: "sessionStorage" },
      // Leave time for MFA in the popup.
      system: { popupBridgeTimeout: 180_000 },
    }),
  );
  return msal;
}

export type OutlookSession = { token: string; account: AccountInfo };

/**
 * A token for the signed-in person's own mailbox. Uses this tab's cached
 * sign-in when it is still good, otherwise opens the Microsoft sign-in popup.
 * Call it straight from the click, before any other await, so the popup isn't
 * blocked.
 */
export async function signInToOutlook(loginHint?: string | null): Promise<OutlookSession> {
  const { CacheLookupPolicy, InteractionRequiredAuthError } = await import("@azure/msal-browser");
  const app = await client();
  const hint = loginHint?.toLowerCase();
  const account =
    app.getAllAccounts().find((a) => a.username.toLowerCase() === hint) ?? app.getAllAccounts()[0];
  if (account) {
    try {
      // Cache and refresh token only: a hidden-iframe renewal would be blocked
      // by this site's frame headers and only delay the popup.
      const r = await app.acquireTokenSilent({
        scopes: SCOPES,
        account,
        cacheLookupPolicy: CacheLookupPolicy.AccessTokenAndRefreshToken,
      });
      return { token: r.accessToken, account: r.account };
    } catch (e) {
      if (!(e instanceof InteractionRequiredAuthError)) console.warn("Outlook silent sign-in failed", e);
    }
  }
  const r = await app.acquireTokenPopup({ scopes: SCOPES, loginHint: loginHint ?? undefined });
  return { token: r.accessToken, account: r.account };
}

export type DraftMessage = { to: string[]; subject: string; html: string };

/** Creates an unsent draft in the signed-in person's Drafts folder. */
export async function createOutlookDraft(
  session: OutlookSession,
  msg: DraftMessage,
): Promise<{ id: string; webLink: string }> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: msg.subject,
      body: { contentType: "HTML", content: msg.html },
      toRecipients: msg.to.map((address) => ({ emailAddress: { address } })),
    }),
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const b = await res.json();
      detail = b?.error?.message || detail;
    } catch {
      /* ignore */
    }
    throw new Error(`Outlook refused the draft: ${detail}`);
  }
  const draft = await res.json();
  return { id: draft.id, webLink: draft.webLink };
}

/**
 * Loads the sign-in library ahead of the click. A browser only allows a popup
 * within a few seconds of the click, so the popup must not wait on a download.
 */
export function prepareOutlookSignIn() {
  if (!outlookSignInConfigured) return;
  client().catch((e) => console.warn("Outlook sign-in failed to load", e));
}
