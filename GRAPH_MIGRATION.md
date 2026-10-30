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
| `sync-acquisitions-inbox/index.ts` | `/me/messages` → `/users/{acq upn}/messages`. Query string unchanged. The chained `summarize-emails` batch is now `SUMMARIZE_BATCH_SIZE` (default 20, was a hardcoded 200). |
| `summarize-emails/index.ts` | Inline-attachment fetch moved onto the shared transport; `outlookKey` plumbing removed. Also drops the vestigial `LOVABLE_API_KEY` guard — the file has no gateway call left, so summarization now runs via Anthropic instead of failing fast. Changes what the first post-deploy batch costs; see step 5. |
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
SUMMARIZE_BATCH_SIZE   20                                   # optional, this is the default
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
  -PolicyScopeGroupId <mail-enabled-security-group> `
  -AccessRight RestrictAccess -Description "DPP: acquisitions + atlas only"
```

(mail-enabled security group containing the two mailboxes; Exchange Online PowerShell).
(group name is in the Azure setup notes, not in this repo — the repo is public.)

## Verify

Step by step in **Deploy and first-run sequence** below — it supersedes a bare
checklist, because the order and the gates are the part that matters.

## What each gate actually covers

**Verified 2026-09-14.** This was modelled wrong twice, in opposite directions,
before anyone checked it — once assuming the flag stopped everything, once
assuming secrets woke nothing. Trust the checks below, not the plausible version:

- `connectors.atlas_automation` gates **the Atlas path only**. `scheduled-atlas-run`
  reads the flag immediately after its cron-secret check and returns
  `{ok: true, skipped: "disabled"}` before any stage. Its stages are
  `outlook-sync {mailbox:"atlas"}`, `analyze-partner-emails` and
  `compute-partner-warmth` — no gating, no scoring.
- **Nothing gates the acquisitions chain.** `sync-acquisitions-inbox` reads a fixed
  24-hour Graph window, writes `deal_emails` / `inbox_deals`, and invokes
  `summarize-emails` with `limit: 200`. That is the app's largest cost driver.
- `daily-digest` (pg_cron job 1, `0 4 * * *`, active) is what drives it unattended:
  it calls `sync-acquisitions-inbox`, then `score-deals {since_days: 1}`. Gated by
  `requireCronSecret` and nothing else.

So setting the `GRAPH_*` secrets does **not** wake Atlas, but it does wake
acquisitions at the next 04:00 UTC.

`outlook-sync {mailbox:"acquisitions"}` is not the expensive path — it writes
`outlook_messages` and `partner_suggestions` only, with no LLM call. Do not use it
as a proxy for watching the cascade; it does not drive one.

The pg_cron facts:

    select jobid, jobname, schedule, active from cron.job;
    -- daily-digest        | 0 4 * * *    | active
    -- scheduled-atlas-run | */30 * * * * | active

Both jobs POST to their function and read credentials from Vault at call time
rather than embedding them in the job body (see SECURITY.md on why the old
project's approach was wrong).

**`last_run_at` is not evidence that anything ran.** While `atlas_automation` is
disabled the job still fires every 30 minutes and still writes `last_run_at` into
`connectors.config` each time. `last_status` is the field that tells you; while
disabled it reads `"disabled"`.

## Deploy and first-run sequence

Each step is deliberate. Do not collapse them.

1. **Deactivate the unattended driver**, so the first acquisitions run is one you
   are watching rather than one that happens at 04:00 UTC:

       update cron.job set active = false where jobname = 'daily-digest';

2. **Set the secrets** — `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`.
3. **Deploy the functions.** Secrets first, then deploy: functions read secrets at
   boot, so deploying first leaves running instances on the gateway until replaced.
4. **Confirm the connection with a direct call, not the status page.** The status
   page needs an approved-user JWT and has never been loaded successfully during
   this work; do not make the first confirmation of a deploy depend on a surface
   that has never worked. Call `outlook-sync` with a deliberately tiny window —
   it does no LLM work, and it is not gated by `atlas_automation`, so both
   mailboxes can be tested with the flag still off:

       {"mailbox": "acquisitions", "since": "<2 hours ago ISO>", "top": 5}
       {"mailbox": "atlas",        "since": "<2 hours ago ISO>", "top": 5}

   Success looks like `via: Graph app-only as <upn>`. Load the status page
   afterwards as confirmation if you can, but not as the test.

   **Reading a failure.** Four distinct layers produce what looks like one error,
   and the error text tells you which — read it before changing anything:

   | What you see | Layer | Meaning |
   |---|---|---|
   | `AADSTS700016` at token mint | Entra | Client ID not in that directory. Wrong `GRAPH_CLIENT_ID` (Object ID and Secret ID are both look-alike GUIDs) or wrong `GRAPH_TENANT_ID`. Nothing to do with consent. |
   | Token mints, Graph `403 ErrorAccessDenied … [RAOP]` | Exchange | Consent **is** granted. An application access policy is denying this mailbox. |
   | Token mints, Graph `403` with a permissions message | Entra | Admin consent missing, or the application permissions are wrong. |
   | Token mints, Graph `404` | Ours | That UPN does not exist. Check `GRAPH_ACQUISITIONS_UPN` / `GRAPH_ATLAS_UPN`. The only branch that is our config rather than the tenant's. |

   Three signals that read as reassurance while sitting next to the thing they
   appear to confirm:

   - **Entra sign-in logs show success for a `[RAOP]` denial.** The token mint
     genuinely succeeded; the denial is Exchange's, downstream, with no presence in
     those logs. "Check the sign-in logs" is the first thing most people reach for
     and here it actively misleads — it confirms auth, which was never the question.
   - **`Get-ApplicationAccessPolicy` returning empty does not mean no policy.** It
     usually means the tenant is on RBAC for Applications rather than classic access
     policies. Both produce the same `[RAOP]` error. Check
     `Get-ManagementRoleAssignment -App <appid>` and its attached scope.
   - **`Test-ApplicationAccessPolicy` returning `Granted` on both mailboxes proves
     reachability, not containment.** An app with no effective scope returns
     `Granted` too. Only a control mailbox that should be blocked, returning
     `Denied`, demonstrates the blast radius is closed.

5. **Measure the batch before anything runs it at full size.** `summarize-emails`
   has never billed against Anthropic, because the guard removed in this branch was
   failing it fast the whole time. The chained batch was a hardcoded 200, sized for
   the Lovable era — the comment beside it read *"larger batch + flash-lite"* — and
   that call now routes to Claude Opus 5 through `_shared/ai.ts`. A number chosen for
   flash-lite economics was about to execute on Opus, so the default is now 20.

   Measure with a **direct** call, not through the chain: `sync-acquisitions-inbox`
   fires summarization unawaited and only when `touchedDealIds.size > 0`, so its
   response tells you nothing about the batch.

   **Sample the population you are about to price.** Default ordering is
   newest-first, so a plain `{"limit": 20}` measures the 20 *newest* emails — but the
   528 in step 7 are the *oldest*. They are not interchangeable: the vision pass is
   the expensive branch, and whether year-old broker mail carries more inline
   marketing images than last week's is not known. Invoke `summarize-emails` with
   `{"limit": 20, "oldest": true}` — ascending order, same rows a drain reaches, and
   `oldest` does not chain the way `backfill` does. Then:

       select count(*) as calls,
              round(sum(cost_usd)::numeric, 4)  as total_usd,
              round(avg(cost_usd)::numeric, 5)  as avg_per_call_usd
       from ai_usage_log
       where function_name = 'summarize-emails'
         and created_at > now() - interval '1 hour';

6. **Size the nightly from peak inflow, not the mean.** The batch defaults to 20 and
   is read from the `SUMMARIZE_BATCH_SIZE` secret, so changing it is a secret change
   with no deploy. Two constraints, and the throughput one binds harder than cost:

   Measured 2026-09-14 — business days bring **40-60 `deal_emails`, of which 15-22
   need work**; weekends bring 0-2. A nightly batch of 20 is therefore break-even at
   the mean and underwater on the peak, and because steady state is newest-first,
   every day that exceeds the batch leaves a residue that is never revisited. Size
   from *max observed daily need × ~2* — about **40** — not from the average. The
   weekend lull absorbs the rest.

   The headroom is the point: undersizing is invisible. Nothing errors, nothing goes
   red, the backlog just grows.

7. **Drain the standing backlog, deliberately and with a number in front of you.**
   As of 2026-09-14 there are **528 rows needing work** (81 with no summary at all)
   out of 2,227 total. A backfill run orders oldest-first, so it reaches exactly the
   rows the nightly batch keeps outranking.

   **Compute the spend before triggering it.** From step 5: `total_usd ÷ 20` is the
   per-email cost on the current model; × 528 is what this step costs. 528 emails
   through Opus 5 is the largest single spend in this sequence. Read the number
   first.

   Invoke `summarize-emails` with `{"backfill": true, "limit": 100}`.

   **Expect exactly six hops.** The drain pages by keyset: each hop starts after the
   last `received_at` the previous one saw, rather than re-running the predicate from
   the top. That makes the walk strictly monotonic, so 528 rows at 100 per hop clear
   in six, with the seventh coming back short and stopping. It also means a
   permanently-failing row — a text pass that wrote nothing, or a transient vision
   error that left `vision_checked` false — is paid for **once per drain** instead of
   once per hop. Under top-of-predicate paging those rows sorted to the head of every
   oldest-first page and were re-billed on each one.

   `depth cap 10 reached` or `page made no progress` in the logs now means something
   is genuinely wrong rather than merely slow; both remain as backstops. Kill switch:
   `SUMMARIZE_EMAILS_CHAIN_DISABLED=true`.

   The cursor is composite — `(received_at, id)` — because `received_at` is not
   unique: broker blasts and bulk Graph delivery land several emails on the same
   second (2 such clusters in the current 2,227 rows, none of them in the backlog).
   A bare `received_at >` would step over the rest of a boundary cluster and `>=`
   would re-process it, re-paying for exactly the stuck rows. The composite cursor
   skips nothing and re-pays for nothing, so there is no caveat to work around.

8. **Run `sync-acquisitions-inbox` manually and watch it.** Its 24-hour window
   self-limits the Graph read.

   **This step has no failure surface.** The chained summarization is invoked
   unawaited, so a batch that fails entirely never reaches the caller — the response
   reads the same either way. Same shape as the `last_run_at` trap above: the
   obvious signal is not the one that carries the information. Watch `ai_usage_log`
   and the function logs, not the HTTP response.

9. **Reactivate the driver. This is a step, not a footnote:**

       update cron.job set active = true where jobname = 'daily-digest';

   While `daily-digest` is off, `score-deals` does not run either, so deals silently
   stop being scored. Nothing logs an error and nothing on the status page goes red.
   That is the kind of quiet failure that stays broken for a week. Do it in the same
   sitting as step 8.

10. **Atlas — done.** ~~The mailbox has not synced since 2026-08-17~~. No longer
    true: verified against Main Ansonia on **2026-09-16**, the Atlas mailbox is
    live and current. `[RAOP]` is resolved for **both** mailboxes, not just atlas:
    acquisitions last synced 2026-09-16 13:17:56Z with its newest mail 95 minutes
    old and 272 messages in the trailing 7 days (2,048 total). No drain or
    re-test is needed for either mailbox. Still unmeasured: the `via` transport
    (Graph app-only vs a residual gateway path), which affects the Lovable-exit
    dependency but nothing about sync health.

    | measure | value at 2026-09-16 14:41Z |
    | --- | --- |
    | `max(synced_at)` | 2026-09-16 13:18Z (83 min earlier) |
    | `max(received_at)` | 2026-09-15 00:07Z |
    | received in last 7d | 10 |
    | total rows, `mailbox='atlas'` | 284 |

    The backlog described here was drained, and weekly counts run continuously
    across the claimed 2026-08-17 gap (2 · 42 · 93 · 16 · 5 for the weeks from
    08-17 to 09-14). Nothing to do; the drain procedure below is kept only in
    case the mailbox is re-blocked and has to be restarted.

    <details><summary>Original drain procedure</summary>

    1. Leave `atlas_automation` disabled.
    2. Run `outlook-sync` with `{"mailbox":"atlas","since":"<48h ago>"}` to confirm the path.
    3. Widen `since` in steps to drain the backlog at a time you choose.
    4. Re-enable `atlas_automation` only after the backlog is drained.

    `outlook-sync` is not gated by the flag — it takes `mailbox` and `since`
    directly — so the whole drain runs with automation still off.

    </details>

    **Row count alone does not prove this.** 284 rows is equally consistent with a
    mailbox that died months ago; freshness is `max(received_at)` / `max(synced_at)`,
    and key collision is a separate question again — it surfaces as the Atlas key
    resolving identical to the acquisitions key (`keysCollide` in `outlook-sync`),
    never as an empty table.

## Cleanup once Graph is live

Delete the gateway branch in `graphMail.ts`, `_shared/outlookKeys.ts`, and the
`MICROSOFT_OUTLOOK_*` secrets.

**Do not sweep further than that.** A "remove all the Lovable gateway code" pass
breaks the two remaining exit items, silently, and at call time rather than at boot:

- `GATEWAY` in `api-status/index.ts` has exactly one use left — Firecrawl's
  `/api/v1/verify_credentials` probe. Same host as the Outlook connector gateway,
  different path. It stays.
- `LOVABLE_API_KEY` is read in 14 files. Firecrawl's probe needs it as the bearer
  token, and `_shared/ai.ts` plus nine functions use it for the AI-gateway
  fallback. It stays.
- Anything on `ai.gateway.lovable.dev` is a separate exit item from the connector
  gateway. Out of scope here.

Neither remaining item is a live migration. `FIRECRAWL_API_KEY` and
`LOVABLE_API_KEY` are both absent from the project, so Firecrawl is dead code with
a dead key, and the AI gateway is an unreachable fallback behind a configured
Anthropic path. That makes the rest of the Lovable exit a deletion job that can
happen whenever — nothing is currently calling either.
