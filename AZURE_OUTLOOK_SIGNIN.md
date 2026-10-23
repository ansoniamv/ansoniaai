# Outlook sign-in for outreach drafts

The Draft Outreach dialog writes drafts into the **sender's own Outlook**. It
does this with the sender's own Microsoft sign-in, made when they click
"Create drafts". It does not use the app-only "DPP Graph" connection.

- The token is delegated (it acts as that person, only on their mailbox) and
  lasts about an hour.
- It lives in that browser tab's sessionStorage and never reaches our servers
  or Supabase.
- The Graph app's access group stays limited to atlas@ and acquisitions@. No
  personal mailbox is added to it.

Code: `src/lib/outlookMail.ts` (sign-in and draft creation),
`ms-auth.html` + `src/msAuthRedirect.ts` (where the sign-in popup returns).

> **Status: not yet run.** The steps below follow Microsoft's single-page-app
> setup. They have not been done for this tenant. Mark each one verified here
> once it has been.

## Azure setup (Entra ID admin)

Use a **new** app registration. Do not add this to "DPP Graph": that app holds
application permissions and a client secret, and a sign-in app needs neither.

1. Entra ID → App registrations → **New registration**.
   - Name: `Ansonia.AI Outlook drafts`.
   - Supported account types: **Accounts in this organizational directory only**.
   - Redirect URI: platform **Single-page application (SPA)**,
     `https://ansoniaai.vercel.app/ms-auth.html`.
2. Authentication → Single-page application → add any other origins people use, e.g.
   `http://localhost:8080/ms-auth.html` for local development, and any custom domain.
3. API permissions → Add → Microsoft Graph → **Delegated** → `Mail.ReadWrite`.
   (`User.Read` is there by default and can stay.) This is the least permission
   that can create a draft; Microsoft has no drafts-only permission.
4. **Grant admin consent** for the tenant. Without it, each person sees a consent
   prompt on first use, or is blocked if user consent is turned off.
5. No client secret or certificate: a browser app can't keep one.
6. Optional, recommended: Enterprise applications → `Ansonia.AI Outlook drafts` →
   Properties → **Assignment required = Yes**. Then assign only the people who send
   outreach (Users and groups). Nobody else can sign in to it.
7. Copy the **Application (client) ID** and **Directory (tenant) ID** from Overview.

## App configuration

Set these in Vercel (Production, plus Preview if wanted), then redeploy:

```
VITE_MS_CLIENT_ID=<Application (client) ID>
VITE_MS_TENANT_ID=<Directory (tenant) ID>
```

Neither is a secret: both are visible in the browser by design. Until both are
set, the dialog shows "Outlook sign-in isn't set up yet" and won't make drafts.

## Check it worked

1. Open a deal's Capital Raise tab → Draft Outreach, select one recipient, click Create.
2. A Microsoft popup opens with your email filled in. After admin consent there
   is no permission prompt.
3. The result says "Drafts are in the Drafts folder of <you>". The draft is in
   your own Outlook, and "Open draft" opens it.
4. Entra ID → Enterprise applications → `Ansonia.AI Outlook drafts` → Sign-in
   logs shows the sign-in under your name.

## What it can and can't do

- It reaches only the mailbox of the person who signed in, and only while their
  token is valid (about an hour). The browser also keeps a refresh token in that
  tab's sessionStorage, so the next batch that day needs no popup. Closing the
  tab clears both.
- The app server never sees the token, so a leak of Supabase or of the DPP
  Graph secret can't reach personal mail through this path.
- `Mail.ReadWrite` technically allows reading that person's mail while the token
  lasts. Only the app's code, running in their own browser, uses it, and only
  to create drafts.
- To revoke one person: remove their assignment (with step 6 on), or revoke their
  sessions in Entra ID. To turn it off for everyone: delete the app registration.
