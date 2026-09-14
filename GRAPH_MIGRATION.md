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
4. **Confirm the status page.** Both Outlook rows should read
   `Reachable as <upn> (Graph app-only)`. A 403 here is consent or the access
   policy, not the code.
5. **Measure the batch before anything runs it at full size.** `summarize-emails`
   has never billed against Anthropic, because the guard removed in this branch was
   failing it fast the whole time. The chained batch was a hardcoded 200, sized for
   the Lovable era — the comment beside it read *"larger batch + flash-lite"* — and
   that call now routes to Claude Opus 5 through `_shared/ai.ts`. A number chosen for
   flash-lite economics was about to execute on Opus, so the default is now 20.

   Measure with a **direct** call, not through the chain: `sync-acquisitions-inbox`
   fires summarization unawaited and only when `touchedDealIds.size > 0`, so its
   response tells you nothing about the batch. Invoke `summarize-emails` with
   `{"limit": 20}`, then:

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

   **Confirm it terminates on a short page, not on the depth cap.** 528 rows at 100
   per hop should clear in six, with the seventh coming back short and stopping. If
   the logs show `depth cap 10 reached`, rows are not leaving the predicate and the
   chain is re-reading the same page — a text-pass failure writes nothing, and a
   transient vision error deliberately leaves `vision_checked` false, so a
   permanently-failing row sits at the head of every oldest-first page. The chain now
   also stops on `page made no progress`; seeing that means the same thing. Kill
   switch if needed: `SUMMARIZE_EMAILS_CHAIN_DISABLED=true`.

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

10. **Only then, Atlas.** The mailbox has not synced since 2026-08-17, so the first
    pass pulls roughly a month (bounded by the 120-day lookback cap in `outlook-sync`):

    1. Leave `atlas_automation` disabled.
    2. Run `outlook-sync` with `{"mailbox":"atlas","since":"<48h ago>"}` to confirm the path.
    3. Widen `since` in steps to drain the backlog at a time you choose.
    4. Re-enable `atlas_automation` only after the backlog is drained.

    `outlook-sync` is not gated by the flag — it takes `mailbox` and `since`
    directly — so the whole drain runs with automation still off.

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
