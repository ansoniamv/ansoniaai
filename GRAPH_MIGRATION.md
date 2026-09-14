# Outlook → Microsoft Graph direct (route B)

Replaces the Lovable connector gateway with app-only Microsoft Graph calls, so a
mailbox is named by us (`/users/{upn}`) instead of inferred from whoever was
signed in at connect time. That is what makes the wrong-mailbox failure permanent-proof.

## What changed

| File | Change |
|---|---|
| `supabase/functions/_shared/graphToken.ts` | **New.** Cached client-credentials minter, modeled on `arcgisToken.ts`. Secret values never logged. |
| `supabase/functions/_shared/graphMail.ts` | **New.** One place that decides mailbox + transport. Graph when `GRAPH_*` secrets exist; legacy gateway otherwise, so this ships before consent lands. |
| `outlook-sync/index.ts` | Mailboxes now carry a transport, not a connection key. `$skip` paging fallback **deleted** — Graph always returns a followable `@odata.nextLink`. Per-mailbox result now reports `via`. |
| `sync-acquisitions-inbox/index.ts` | `/me/messages` → `/users/{acq upn}/messages`. Query string unchanged. |
| `summarize-emails/index.ts` | Inline-attachment fetch moved onto the shared transport; `outlookKey` plumbing removed. |
| `outlook-draft/index.ts` | Draft created in the Atlas mailbox by UPN. |
| `outlook-send/index.ts` | `sendMail` / `reply` from the acquisitions mailbox by UPN. |
| `api-status/index.ts` | Both Outlook probes rewritten: single `probeMailbox()`. On Graph, reachable == right mailbox, and 401/403/404 are each explained. On the gateway it reports **degraded** and says identity is unverifiable. |

Graph resource paths and every `$select`/`$filter` string are byte-identical to before —
the gateway was never rewriting them.

## Secrets to add (Supabase → Edge Functions → Secrets)

```
GRAPH_TENANT_ID        <tenant GUID>
GRAPH_CLIENT_ID        <app registration client id>
GRAPH_CLIENT_SECRET    <client secret value>
GRAPH_ACQUISITIONS_UPN acquisitions@ansoniaproperties.com   # optional, this is the default
GRAPH_ATLAS_UPN        atlas@ansoniaproperties.com          # optional, this is the default
```

Until all three of the first three exist, every function keeps using the gateway
unchanged — so you can deploy now and flip by adding secrets.

## Azure setup (needs a Global Admin / Privileged Role Admin for step 3)

1. Entra ID → App registrations → New registration ("DPP Graph", single tenant, no redirect URI).
2. Certificates & secrets → New client secret → copy the **Value**.
3. API permissions → Microsoft Graph → **Application** permissions →
   `Mail.Read`, `Mail.ReadWrite` (drafts), `Mail.Send` → **Grant admin consent**.
4. Recommended, since application permissions otherwise reach *every* mailbox in the
   tenant — scope the app to just these two mailboxes with an application access policy:

```powershell
New-ApplicationAccessPolicy -AppId <client-id> `
  -PolicyScopeGroupId dpp-graph-mailboxes@ansoniaproperties.com `
  -AccessRight RestrictAccess -Description "DPP: acquisitions + atlas only"
```

(mail-enabled security group containing the two mailboxes; Exchange Online PowerShell).

## Verify

1. Deploy functions, add secrets.
2. Open the status page — both Outlook rows should read `Reachable as <upn> (Graph app-only)`.
   A 403 there means step 3 or 4 above, not a code problem.
3. `outlook-sync` with `{"mailbox":"atlas","top":10}` — check `via` in the response.
4. Once Atlas is confirmed green, re-enable `atlas_automation` deliberately (see below).

## Atlas backlog — re-enable on purpose, not by surprise

`atlas_automation` has been off in `connectors` since Sep 11 and the Atlas mailbox
has not synced since Aug 17. First successful sync pulls roughly a month of mail
(bounded by the 120-day lookback cap in `outlook-sync`) and fans out into analysis.

Safer order:
1. Leave `atlas_automation` disabled.
2. Run `outlook-sync` manually with `{"mailbox":"atlas","since":"<48h ago>"}` to confirm the path.
3. Widen `since` in steps to drain the backlog at a time you choose.
4. Re-enable `atlas_automation` only after the backlog is drained.

**Verified 2026-09-14.** The Atlas cadence is a real `pg_cron` job, not the card's
`interval_hours`:

    select jobid, jobname, schedule, active from cron.job;
    -- scheduled-atlas-run | */30 * * * * | active
    -- daily-digest        | 0 4 * * *    | active

The job POSTs to `scheduled-atlas-run` and reads its credentials from Vault at call
time rather than embedding them in the job body (see SECURITY.md on why the old
project's approach was wrong).

`scheduled-atlas-run` checks `connectors.atlas_automation` immediately after the
cron-secret check and returns `{ok: true, skipped: "disabled"}` before any stage
runs. So disabling the flag genuinely stops the work — **but the job keeps firing
every 30 minutes regardless, and still writes `last_run_at` into `connectors.config`
each time.** A moving `last_run_at` is therefore not evidence that anything ran;
`last_status` is, and while disabled it reads `"disabled"`.

Consequence for the drain: setting the `GRAPH_*` secrets does not wake the backlog.
The job will keep no-opping until someone flips the flag deliberately, so secrets can
go in during a workday. `outlook-sync` is not gated by the flag at all — it takes
`mailbox` and `since` directly — so the manual widening-`since` drain works with
automation still off.

## Cleanup once Graph is live

Delete the gateway branch in `graphMail.ts`, `_shared/outlookKeys.ts`, and the
`MICROSOFT_OUTLOOK_*` secrets.
