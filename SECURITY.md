# Security posture and deployment checklist

> Repo `ansoniamv/ansoniaai` is **public**. History was scanned before publishing:
> no `.env`, archive or provider key in any commit; the only credential present
> is the Supabase anon JWT, which is public by design.

Two things happened here: the September 2026 audit fixes (commits `bece34c`,
`2dcd035`, `46c7e99`, `53c4086`), and the migration of the whole app off
Supabase project `fmodmsxhujqzkibjnggo` onto `bkkphsiikibgzeakleqn`.

## Migration status

**Done on `bkkphsiikibgzeakleqn`:**

- All 101 migrations replayed in order and recorded in
  `supabase_migrations.schema_migrations`, so the CLI will recognise them.
  45 tables in `public`.
- All 34 edge functions deployed. `niche-schools-test` was deleted and never
  existed on this project.
- `partner-attachments` storage bucket created, private, with the
  approved-user policies from the lockdown migration.
- `CRON_SHARED_SECRET` generated and stored both as a function secret and in
  Vault; the public anon JWT is in Vault as `anon_key`.
- `pg_cron` jobs recreated from the cadences documented in `api-status`:
  `daily-digest` at `0 4 * * *`, `scheduled-atlas-run` at `*/30 * * * *`. Both
  read their credentials from Vault at call time, so no key is written into the
  job body — this is the thing the old project got wrong.
- Auth config corrected: `site_url` was `http://localhost:3000` (password-reset
  links pointed at a dead host); the redirect allow-list is now four explicit
  entries with no bare wildcard; `password_min_length` raised 6 → 8 to match
  what `AuthPage.tsx` enforces client-side.
- Frontend repointed: `.env`, all three Vercel environments, `config.toml`, and
  the CSP `connect-src`. Verified the built bundle contains only the new project
  ref and zero references to the old one.

**Verified by probe:** `deals`, `partners`, `inbox_deals`, `learned_strategy`,
`team_members` and `connectors` all return 401 to the publishable key. Every
edge function returns 401 to it, and `daily-digest` returns 403 from its cron
guard. That is the audit's central finding closed on the new project.

**Not migrated: your data.** The old project holds the real deals, partners,
notes and email history. This project's tables are empty. Moving that data needs
a `pg_dump`/restore run from an account that can reach
`fmodmsxhujqzkibjnggo`, which this token cannot.

## Open item 1 — nobody can log in yet

`auth.users` is empty, the app has no signup UI, and `admin-invite-user`
requires an existing admin. So there is a bootstrap gap.

`handle_new_user` auto-approves and grants admin to exactly one hardcoded
address: `dstevens@ansoniaproperties.com`. Signup is currently **enabled** so
this is possible; pick one route:

- Sign up once as `dstevens@ansoniaproperties.com` and you land approved + admin
  automatically, then invite everyone else from `/admin/users`.
- Or create your own user in Authentication → Users, then promote it:

  ```sql
  update public.profiles set status = 'approved', approved_at = now()
  where lower(email) = 'you@ansoniaproperties.com';

  insert into public.user_roles (user_id, role)
  select id, 'admin' from public.profiles
  where lower(email) = 'you@ansoniaproperties.com'
  on conflict do nothing;
  ```

**Then turn signup off** — Authentication → Sign In / Providers → Email →
uncheck "Allow new users to sign up". It is only open for the bootstrap. While
it is open, anyone can `POST /auth/v1/signup` and get a valid `authenticated`
JWT; the data layer holds because a `pending` profile fails every policy, but
there is no reason to leave it open once you are in.

## Vercel — resolved, and live

Root cause: the CLI was authenticated as the wrong Vercel account.
`mvasylechko-3546` / `vasylechko@principesclub.com` owns a team called
`maxym-vasylechkos-projects`, and every deploy under it was rejected with
`seatBlock: TEAM_ACCESS_REQUIRED, isVerified: false` — an unverified account.
That looked like a platform fault but was simply the wrong identity: commits
are authored `MVasylechko@ansoniaproperties.com` on the GitHub `ansoniamv`
account, which that Vercel account has no relationship to.

The correct account is `ansoniamv` / `mvasylechko@ansoniaproperties.com`, team
`ansoniamv`. It already had a project `ansoniaai` **linked to
`ansoniamv/ansoniaai` on branch `main`**, so pushes auto-deploy. It had no
environment variables, which is why its first build produced a bundle with no
Supabase config.

Current state:

- Live: **https://ansoniaai.vercel.app** (also `ansoniaai-ansoniamv.vercel.app`)
- Deployment `READY`, no seat block.
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID` and
  `VITE_SUPABASE_PUBLISHABLE_KEY` set for production, preview and development.
- Verified served: all six security headers present, the SPA rewrite resolves
  deep links (`/deals/test` returns 200), and the shipped bundle references
  only `bkkphsiikibgzeakleqn`.
- The old `deal-pipeline-pro` project on the `principesclub` account is
  abandoned. Its blocked deploys and env vars can be deleted.

Note on CORS preflight: an `OPTIONS` request returns
`Access-Control-Allow-Origin: *` because the Supabase functions gateway answers
preflight itself, before the function runs. The response that actually governs
whether a browser exposes the body comes from `corsFor()`, and it is correct —
a POST from `https://ansoniaai.vercel.app` is echoed back with `Vary: Origin`,
while a POST from another origin gets no allow-origin header at all.

## Open item 2 — third-party API keys are missing

Supabase secrets are write-only: they cannot be read back, and they lived only
on the old project. I set what I had; the rest have to be re-entered from the
provider dashboards or wherever they were originally stored.

**Set:** `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `USE_ANTHROPIC`,
`ALLOWED_ORIGINS`, `CRON_SHARED_SECRET` (plus the `SUPABASE_*` values the
platform injects).

**Missing — these features will fail until they are set:**

| Secret | What breaks without it |
| --- | --- |
| `LOVABLE_API_KEY` | The gateway fallback when Anthropic errors, **and** all Outlook calls, which route through the Lovable connector gateway |
| `MICROSOFT_OUTLOOK_API_KEY`, `..._API_KEY_1`, `..._ATLAS_API_KEY` | `outlook-sync`, `outlook-send`, `outlook-draft`, `sync-acquisitions-inbox` — so the whole email ingest pipeline and `/suggestions` |
| `HELLODATA_API_KEY` | Property search on the New Deal form, `fetch-hellodata`, `hellodata-detail`, `hellodata-enrich` |
| `ESRI_API_KEY`, `ESRI_CLIENT_ID`, `ESRI_CLIENT_SECRET`, `ESRI_AUTH_MODE` | `esri-enrich` (the demographics panel), and `market-metrics-enrich` indirectly, since it reads Esri ring data |
| `FIRECRAWL_API_KEY` | `schools-enrich`, `find-partner-website` |
| `BLS_API_KEY` | Job-growth metric only. Optional — it just raises the rate limit |

Set them with:

```bash
supabase secrets set --project-ref bkkphsiikibgzeakleqn HELLODATA_API_KEY=... ESRI_API_KEY=...
```

Note the CLI rejects the `sbp_v0_` token format (v2.116.0 is current and still
does), so either use a classic `sbp_` token or set them in the dashboard under
Edge Functions → Secrets.

`ALLOWED_ORIGINS` is set to the live hostnames, so `corsFor()` is enforcing.
`site_url` and the auth redirect allow-list point at
`https://ansoniaai.vercel.app`. Edge functions read secrets at boot, so after
changing `ALLOWED_ORIGINS` the functions must be redeployed to observe it.

## Still worth doing

1. **Enforce the CSP.** `vercel.json` ships
   `Content-Security-Policy-Report-Only` deliberately — it could not be verified
   against a running app, and a wrong `connect-src` or `frame-src` would take
   the app down. Watch the console for a release, then rename the key to
   `Content-Security-Policy`.

   `X-Frame-Options: DENY` **is** enforced. It fixes clickjacking against
   `/admin/users` but breaks the Lovable in-editor preview iframe. If you still
   need that preview, drop `X-Frame-Options` and use
   `frame-ancestors 'self' https://lovable.dev`, since XFO cannot express an
   allowlist.

2. **Re-verify headers** after any hosting change:

   ```bash
   curl -sSI https://ansoniaai.vercel.app/ | grep -iE \
     "content-security-policy|x-frame-options|referrer-policy|strict-transport|x-content-type|permissions-policy"
   ```

3. **The warmth-import bypass is still open.** `warmth_import_log` is now
   admin-only, but the import's actual effect is an UPDATE of
   `partners.relationship_strength`, gated only by `is_approved()`. Closing it
   means moving the import loop into an admin-gated edge function; a column
   trigger would also block the `partner_suggestions` acceptance flow, which
   legitimately writes that column as a non-admin. Needs a decision about who
   may change warmth.

4. **Two moderate `react-router` advisories** need a v7 major bump. One is
   SSR-hydration only and does not apply to this Vite SPA; the other is an open
   redirect. Left for a deliberate decision.

5. **~100 lower-value `.message` sites remain in `src/`**, mostly on paths whose
   server side no longer returns sensitive detail. Worth a sweep, not a blocker.

## Credential rotation

Nothing found in the audit requires rotation.

The only key committed to a repo is a Supabase **anon** JWT, in
`supabase/migrations/20260630153238_*.sql` and inside
`Deal Pipeline Pro (20).zip` in commit `002b5e1` of the older `Ansonia-AI-Code`
repo. It decodes to `{"role":"anon"}`, is public by design, and ships in the
browser bundle regardless. No rotation needed — but it is permanent in that
repo's history, so if that project ref is ever treated as private, the repo is
not the place to hold the line. That migration no longer embeds it; the trigger
it powered had been silently 401-ing since deploy and now records intent
instead.

No provider key was found in the repo, in `src/`, or in the compiled `dist/`
bundle. One caveat: `esri-enrich` used to return an advisory naming
`ESRI_API_KEY` and describing whether it was referrer-restricted to any
unauthenticated caller. That disclosed the key's posture, not its value, so
rotation is optional — but if that endpoint saw traffic you cannot account for,
regenerating the ArcGIS key is cheap.

## What the audit found already correct

- The `is_approved()` gate itself: profiles default to `pending`, the
  self-update policy blocks self-approval with a `WITH CHECK` subquery, `anon`
  is revoked on the core tables, and there is no `signUp` call anywhere in
  `src/`.
- `ANTHROPIC_API_KEY` is read only from the edge-function environment. No key is
  `VITE_`-prefixed, and none appears in `dist/`.
- `analyze-partner-emails` is the reference implementation for untrusted text: a
  real system prompt, explicit speaker attribution, a verbatim-quote
  requirement, untrusted bodies passed as structured JSON, and output queued as
  `status: "pending"` for human approval.
- `summarize-partners` is the reference implementation for cost control: auth,
  `MAX_IDS_PER_CALL`, bounded concurrency, and a SHA-256 short-circuit.
- `esri-enrich` is the only function with a monthly spend cap. That pattern
  (`getEsriBudget`) is worth lifting into `_shared/logUsage.ts` so every LLM call
  inherits a ceiling.
- `summarize-emails`' backfill chain has a depth counter, a hard cap and an env
  kill switch. No unbounded recursion exists in the function graph.
- `chat` runs its tool queries under the caller's RLS, not the service role.
