# Security posture and deployment checklist

Written alongside the September 2026 audit fixes (commits `bece34c`, `2dcd035`,
`46c7e99` and this one). The code changes are in the repo; the items below
cannot be done from the repo and are still open.

## Deploy order matters

The edge-function guards and the database migration are independent, but the
migration's `is_approved()` gate on `merge_partners` / `accept_inbox_deal` will
start rejecting any caller whose profile is not `approved`. Confirm the staff
accounts are approved **before** applying it:

```sql
select status, count(*) from public.profiles group by 1;
```

Then:

```bash
supabase link --project-ref bkkphsiikibgzeakleqn
supabase db push          # applies 20260904120000 and 20260904120100
supabase functions deploy # all 34 functions; niche-schools-test was deleted
```

`supabase functions delete niche-schools-test` — removing the directory does not
undeploy it, and until it is deleted the unauthenticated Firecrawl endpoint is
still live.

## Required secrets

| Secret | Why | Status |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | `corsFor()` reads this. **Until it is set, CORS stays wildcard** — the fallback exists so this deploy cannot break the app, but it means the CORS finding is not actually closed yet. | **not set** |
| `ANTHROPIC_API_KEY` | Server-side only. Never `VITE_`-prefixed. | set |
| `CRON_SHARED_SECRET` | `requireCronSecret()` reads this. It appears in no migration, so the live pg_cron jobs are probably passing the service-role key instead — see below. | verify |

Set the first one to the exact origins, no wildcards:

```bash
supabase secrets set ALLOWED_ORIGINS="https://<production domain>,https://deal-pipeline-pro.vercel.app,http://localhost:5173"
```

## Still open — needs the dashboard or a live query

1. **Check for pending/rejected profiles.** Every finding about the approval
   gate is only exploitable if such an account exists. Each one is a live
   principal.

   ```sql
   select id, email, status, created_at from public.profiles
   where status <> 'approved' order by created_at desc;
   ```

2. **Close public signup.** The UI has no signup form, but `enable_signup` is
   almost certainly still on, and anyone can `POST /auth/v1/signup` with the
   publishable key. The data layer holds — a `pending` profile fails every
   policy — but it hands out a valid `authenticated` JWT.
   Authentication → Sign In / Providers → Email → uncheck "Allow new users to
   sign up".

3. **Audit the redirect allow-list.** Authentication → URL Configuration. A
   wildcard entry combined with the recovery flow is an account-takeover path.
   This one is worth checking first.

4. **Confirm the seed admin is claimed.** `handle_new_user()` grants admin to
   whoever registers `dstevens@ansoniaproperties.com`. If that account does not
   exist and signup is open, it is a self-service admin grant.

   ```sql
   select id, email, created_at, last_sign_in_at from auth.users
   where lower(email) = 'dstevens@ansoniaproperties.com';
   ```

5. **Get the pg_cron jobs into version control.** Zero migrations contain
   `cron.schedule`, yet `scheduled-atlas-run` documents "job 11" and
   `api-status` advertises six schedules. They cannot be audited from here, and
   since `CRON_SHARED_SECRET` appears in no SQL they most likely embed the
   service-role key inline, readable by anyone who can `select * from cron.job`.

   ```sql
   select jobid, jobname, schedule, command from cron.job;
   ```

   Move any inline key to Supabase Vault and commit the schedule definitions.

6. **Enforce the CSP.** `vercel.json` ships
   `Content-Security-Policy-Report-Only` deliberately — an enforcing policy
   could not be verified against a running app, and a wrong `connect-src` or
   `frame-src` would take the app down. Watch the browser console for a release,
   then rename the key to `Content-Security-Policy`.

   Note `X-Frame-Options: DENY` **is** enforced. It fixes clickjacking against
   `/admin/users` but will break the Lovable in-editor preview iframe. If that
   preview is still needed, drop `X-Frame-Options` and use
   `frame-ancestors 'self' https://lovable.dev` instead, since XFO cannot
   express an allowlist.

7. **Verify the headers actually land.**

   ```bash
   curl -sSI https://<production domain>/ | grep -iE \
     "content-security-policy|x-frame-options|referrer-policy|strict-transport|x-content-type|permissions-policy"
   ```

8. **Confirm the guards work.** Every one of these should now be `401`:

   ```bash
   for fn in hellodata-search property-research score-deals gate-deals \
             outlook-draft score-backtest esri-enrich classify-note; do
     printf '%s ' "$fn"
     curl -s -o /dev/null -w '%{http_code}\n' -X POST \
       "https://bkkphsiikibgzeakleqn.supabase.co/functions/v1/$fn" \
       -H 'Content-Type: application/json' -d '{}'
   done
   ```

9. **Two moderate react-router advisories remain** and need a v7 major bump.
   One (`GHSA-337j-9hxr-rhxg`) is SSR-hydration only and does not apply to this
   Vite SPA; the other is an open redirect. Left for a deliberate decision
   rather than bundled into a security patch.

## Credential rotation

Nothing found in the audit requires rotation.

The only key committed to a repo is a Supabase **anon** JWT, which appears in
`supabase/migrations/20260630153238_*.sql` and inside
`Deal Pipeline Pro (20).zip` in commit `002b5e1` of the older
`Ansonia-AI-Code` repo. It decodes to `{"role":"anon"}`, is public by design,
and ships in the browser bundle regardless. No rotation needed — but note it is
permanent in that repo's history, so if that project ref is ever treated as
private, the repo is not the place to hold the line.

`ANTHROPIC_API_KEY`, `HELLODATA_API_KEY`, `ESRI_API_KEY`, `LOVABLE_API_KEY`,
`MICROSOFT_OUTLOOK_*` and the service-role key were **not** found in the repo,
the `src/` tree, or the compiled `dist/` bundle. They live only in the Supabase
function environment.

One caveat: `esri-enrich` used to return an advisory naming `ESRI_API_KEY` and
describing whether it was referrer-restricted, to anyone who called the endpoint
unauthenticated. That disclosed the key's *posture*, not its value, so rotation
is optional — but if that endpoint saw traffic you cannot account for,
regenerating the ArcGIS key is cheap.

## What the audit found already correct

- The `is_approved()` gate itself: profiles default to `pending`, the
  self-update policy blocks self-approval with a `WITH CHECK` subquery, `anon`
  is revoked on the core tables, and there is no `signUp` call anywhere in
  `src/`.
- `ANTHROPIC_API_KEY` is read only from the edge-function environment. No key
  is `VITE_`-prefixed, and none appears in `dist/`.
- `analyze-partner-emails` is the reference implementation for untrusted text:
  a real system prompt, explicit speaker attribution, verbatim-quote
  requirement, untrusted bodies passed as structured JSON, and output queued as
  `status: "pending"` for human approval.
- `summarize-partners` is the reference implementation for cost control:
  auth, `MAX_IDS_PER_CALL`, bounded concurrency, and a SHA-256 short-circuit.
- `esri-enrich` is the only function with a monthly spend cap. That pattern
  (`getEsriBudget`) is worth lifting into `_shared/logUsage.ts` so every LLM
  call in the platform inherits a ceiling.
- `summarize-emails`' backfill chain has a depth counter, a hard cap and an env
  kill switch. No unbounded recursion exists anywhere in the function graph.
- `chat` runs its tool queries under the caller's RLS, not the service role.
