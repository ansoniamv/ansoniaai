# Data migration: `fmodmsxhujqzkibjnggo` → `bkkphsiikibgzeakleqn`

The schema on the target is already correct — all 101 migrations were replayed,
45 tables, and it is verified locked down. What is missing is **data**, which is
why `ansoniaai.vercel.app` rejects logins that work on the old deployment:
`auth.users` on the target is empty. This is a data copy, not an auth fix.

Everything below was derived by inspecting the **target** schema, which is
migration-identical to the source.

---

## What I need from you

Only one thing: the **database password** for the source project. It is separate
from the personal access token — my token cannot see `fmodmsxhujqzkibjnggo` at
all, and a PAT would not grant SQL access anyway.

Dashboard → Project `fmodmsxhujqzkibjnggo` → **Project Settings → Database →
Connection string → URI**, plus **Database password** (reset it there if it was
never recorded).

**You do not have to give it to me.** Every command below is runnable by you and
nothing needs my involvement. Given the repo is now public, keeping the source
DB password out of this conversation entirely is the better posture. If you
would rather I drive it, paste the source URI and I will run it — but running it
yourself is strictly safer.

I already hold what is needed on the **target** side.

---

## Preflight

```bash
# Server is PostgreSQL 17.6 — a pg_dump older than 17 will refuse the dump.
pg_dump --version    # must be >= 17
```

Use **session mode** (port `5432`). The transaction pooler on `6543` cannot run
`pg_dump` or hold the session-level setting the load depends on.

```bash
# Prefer the pooler host: the direct db.<ref>.supabase.co host is IPv6-only on
# newer projects and will silently fail to resolve on IPv4-only networks.
OLD='postgresql://postgres.fmodmsxhujqzkibjnggo:SOURCE_PW@aws-0-<region>.pooler.supabase.com:5432/postgres'
NEW='postgresql://postgres.bkkphsiikibgzeakleqn:TARGET_PW@aws-0-<region>.pooler.supabase.com:5432/postgres'

psql "$OLD" -c 'select count(*) from auth.users'   # sanity: source reachable
psql "$NEW" -c 'select count(*) from auth.users'   # expect 0
```

---

## Step 1 — dump the auth rows that matter

Password hashes are bcrypt strings in `auth.users.encrypted_password`. They are
**not** tied to the project's JWT secret, so they are fully portable — copy the
row and the password keeps working.

```bash
pg_dump "$OLD" \
  --data-only --no-owner --no-privileges --no-comments \
  --table=auth.users \
  --table=auth.identities \
  --table=auth.mfa_factors \
  --table=auth.mfa_amr_claims \
  -f auth_data.sql
```

Deliberately **excluded**, and why:

| Skipped | Reason |
| --- | --- |
| `auth.schema_migrations` | GoTrue's own version ledger. Overwriting it desynchronises the target's auth service from its binary. Never copy this. |
| `auth.sessions`, `auth.refresh_tokens` | Bound to the old project's signing key. Copying them yields tokens the new project cannot validate. Everyone re-logs in once — that is the whole cost. |
| `auth.one_time_tokens`, `auth.flow_state` | In-flight recovery/OAuth state, seconds-to-minutes lived. |
| `auth.audit_log_entries` | Append-only log; large and worthless here. |
| `auth.sso_*`, `auth.saml_*`, `auth.oauth_*`, `auth.webauthn_*` | Empty unless you configured SSO/passkeys. Add them to the dump if you did. |

---

## Step 2 — dump the application data

```bash
pg_dump "$OLD" \
  --data-only --no-owner --no-privileges --no-comments \
  --schema=public \
  -f public_data.sql
```

**Do not add `--disable-triggers`.** It emits `ALTER TABLE … DISABLE TRIGGER
ALL`, which requires superuser. Supabase's `postgres` role is not superuser, so
the restore fails partway. The `session_replication_role` approach in step 4 is
what works, and it also suppresses foreign-key checks, which this schema needs
(see step 3).

---

## Step 3 — clear the migration-seeded tables on the target

Eight tables are **already populated on the target** by seed data inside the
migrations. Loading the source rows on top produces primary-key collisions and
aborts the transaction. The source is authoritative for all of them, so empty
them first:

| Table | Rows currently on target |
| --- | --- |
| `roadmap_items` | 35 |
| `buy_box_signals` | 24 |
| `buy_box_pillars` | 6 |
| `ai_model_pricing` | 6 |
| `connectors` | 2 |
| `buy_box_thesis` | 1 |
| `learned_strategy` | 1 |
| `learned_partner_strategy` | 1 |

```bash
psql "$NEW" -v ON_ERROR_STOP=1 -c "
TRUNCATE
  public.roadmap_items,
  public.buy_box_signals,
  public.buy_box_pillars,
  public.ai_model_pricing,
  public.connectors,
  public.buy_box_thesis,
  public.learned_strategy,
  public.learned_partner_strategy
CASCADE;"
```

`CASCADE` is required — `buy_box_signals` references `buy_box_pillars`, and
`roadmap_events` references `roadmap_items`. Both dependents are empty on the
target, so nothing real is lost.

---

## Step 4 — load, with FK enforcement and triggers off

This is the one step where order matters, and the reason is worth stating: the
schema contains a **circular foreign key**.

```
inbox_deals.accepted_deal_id  →  deals.id
deals.inbox_deal_id           →  inbox_deals.id
```

Neither is `DEFERRABLE`, and `partner_suggestions.superseded_by` is a
non-deferrable self-reference. **No load order can satisfy these** — you cannot
insert either table first. Suppressing FK checks for the load is not a shortcut
here, it is the only option.

`SET session_replication_role = replica` does both jobs at once: it skips FK
validation *and* stops user triggers firing.

```bash
psql "$NEW" \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --command 'SET session_replication_role = replica' \
  --file auth_data.sql \
  --file public_data.sql
```

Both files must go in **one** `psql` invocation. The setting is session-scoped,
so a second command would run with triggers live again. `--single-transaction`
means a failure anywhere rolls the whole thing back, leaving the target as it
was.

### Triggers this suppresses, and what they would have done

Without `replica` mode the load silently corrupts data. The damaging ones:

| Trigger | Damage if it fires during load |
| --- | --- |
| `auth.users` → `on_auth_user_created` | Creates a fresh `profiles` row per inserted user, colliding with the real `profiles` rows from the source — and auto-approves `dstevens@ansoniaproperties.com` |
| `deals` → `deals_mark_hellodata_pending` (BEFORE INSERT) | Rewrites `hellodata_status` to `'pending'`, discarding real enrichment state |
| `deals` → `deals_log_field_events` (AFTER INSERT) | Injects two bogus `'baseline'` audit rows per deal, on top of the genuine history being copied |
| `outlook_messages` → `outlook_advance_engagement` | **Advances capital-raise engagement stages** as historical email replays. Corrupts the pipeline. |
| `capital_raise_engagements` → `engagement_recompute_total_{ins,upd,del}` | Recomputes `deals.total_committed` mid-load against partially-loaded rows |
| `partners` → `partners_touch_last_edited` (BEFORE INSERT) | Overwrites `last_edited_at` with now(), destroying the real timestamps |
| `notes`, `note_links`, `partner_contacts`, `partner_interactions`, `partner_attachments` → `*_bump_partner_last_edited` | Same: stamps every parent partner with now() |

---

## Step 5 — verify

FK checks were skipped, so confirm nothing is orphaned. This walks every
single-column FK in `public` and counts violations:

```sql
DO $$
DECLARE r record; n bigint; bad text := '';
BEGIN
  FOR r IN
    SELECT src.relname AS child, a.attname AS col,
           tn.nspname AS psch, tgt.relname AS parent, fa.attname AS pcol
    FROM pg_constraint con
    JOIN pg_class src ON src.oid = con.conrelid
    JOIN pg_namespace sn ON sn.oid = src.relnamespace
    JOIN pg_class tgt ON tgt.oid = con.confrelid
    JOIN pg_namespace tn ON tn.oid = tgt.relnamespace
    JOIN pg_attribute a  ON a.attrelid  = con.conrelid  AND a.attnum  = con.conkey[1]
    JOIN pg_attribute fa ON fa.attrelid = con.confrelid AND fa.attnum = con.confkey[1]
    WHERE con.contype = 'f' AND sn.nspname = 'public'
      AND array_length(con.conkey, 1) = 1
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I c WHERE c.%I IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM %I.%I p WHERE p.%I = c.%I)',
      r.child, r.col, r.psch, r.parent, r.pcol, r.col) INTO n;
    IF n > 0 THEN
      bad := bad || format('%s.%s->%s.%s:%s  ', r.child, r.col, r.psch, r.parent, n);
    END IF;
  END LOOP;
  IF bad = '' THEN RAISE NOTICE 'FK integrity OK';
  ELSE RAISE WARNING 'ORPHANED ROWS: %', bad; END IF;
END $$;
```

Row-count comparison — run on both and diff:

```bash
for DB in "$OLD" "$NEW"; do
  psql "$DB" -At -F',' -c "
    SELECT 'auth.users', count(*) FROM auth.users
    UNION ALL SELECT 'profiles', count(*) FROM public.profiles
    UNION ALL SELECT 'user_roles', count(*) FROM public.user_roles
    UNION ALL SELECT 'deals', count(*) FROM public.deals
    UNION ALL SELECT 'partners', count(*) FROM public.partners
    UNION ALL SELECT 'inbox_deals', count(*) FROM public.inbox_deals
    UNION ALL SELECT 'notes', count(*) FROM public.notes
    UNION ALL SELECT 'outlook_messages', count(*) FROM public.outlook_messages
    UNION ALL SELECT 'capital_raise_engagements', count(*) FROM public.capital_raise_engagements
    ORDER BY 1"
done
```

Then the real test: log in at https://ansoniaai.vercel.app with an existing
password. That also confirms `profiles.status` came across as `approved` — which
retires the bootstrap problem, since real approved users now exist.

---

## Sequences: nothing to do

Checked explicitly. **There are no sequences and no identity columns anywhere in
`public`** — every primary key is a `uuid` with `gen_random_uuid()`. So there is
no `setval` step, and no risk of a post-load ID collision. This is the one thing
that usually bites a data-only migration and it simply does not apply here.

---

## Storage files do NOT travel in the dump

`pg_dump` moves `storage.objects` **rows**, not the file bytes, which live in
S3. The target bucket `partner-attachments` exists, is private, and holds **0
objects**. Copy the files separately, before or after the SQL load:

```bash
# Dashboard -> Storage -> S3 Access Keys, on BOTH projects.
# Source and target bucket names are identical, so paths line up.
rclone copy \
  ":s3,provider=Other,endpoint=https://fmodmsxhujqzkibjnggo.supabase.co/storage/v1/s3,access_key_id=SRC_KEY,secret_access_key=SRC_SECRET,region=<region>:partner-attachments" \
  ":s3,provider=Other,endpoint=https://bkkphsiikibgzeakleqn.supabase.co/storage/v1/s3,access_key_id=DST_KEY,secret_access_key=DST_SECRET,region=<region>:partner-attachments" \
  --progress
```

Recommendation: copy the **files** and let the upload create the
`storage.objects` rows naturally — do not hand-copy those rows.
`storage.objects.owner` is a FK to `auth.users`, and the app resolves
attachments by path (`usePartners.ts` calls `createSignedUrl(storagePath)`), not
by object id. Matching paths is sufficient; matching ids buys nothing and adds a
dependency.

If you do copy the rows, load `auth.users` first or `owner` dangles.

---

## Everything else that will not survive

| Thing | Status | Action |
| --- | --- | --- |
| Password hashes | ✅ Portable | bcrypt in `auth.users`, independent of JWT secret |
| TOTP/MFA enrolments | ✅ Portable | covered by `auth.mfa_factors` in step 1 |
| Active sessions | ❌ Lost | signed with the old project's key. Everyone logs in once |
| Storage file bytes | ❌ Not in dump | separate `rclone`/S3 copy above |
| Edge-function secrets | ⚠️ Partly done | `ANTHROPIC_*`, `ALLOWED_ORIGINS`, `CRON_SHARED_SECRET` set. Six third-party keys still missing — see `SECURITY.md` |
| `pg_cron` jobs | ✅ Already recreated | `daily-digest` 04:00 UTC, `scheduled-atlas-run` every 30 min, credentials read from Vault |
| Vault secrets | ✅ Already recreated | `cron_shared_secret`, `anon_key` |
| Auth settings | ✅ Already set | `site_url`, redirect allow-list, `password_min_length` 8 |
| **Realtime publication** | ✅ Fixed | migration `20260904190000`, applied |

### Realtime publication — fixed

Publication membership is schema state, not row data, so it does not travel in a
data-only dump. The target's `supabase_realtime` held only
`capital_raise_entries`, `inbox_deals` and `roadmap_items`, while the frontend
subscribes to four tables — so `connectors`
(`src/hooks/useConnectorEnabled.ts:30-40`) and `roadmap_events`
(`src/hooks/useRoadmap.ts:84-88`) were publishing nothing and their live updates
silently never fired.

Migration `20260904190000_add_missing_realtime_publication_tables.sql` adds both
and is applied. Current state:

| Table | In publication | Replica identity |
| --- | --- | --- |
| `capital_raise_entries` | yes | default |
| `connectors` | **added** | **FULL** |
| `inbox_deals` | yes | FULL |
| `roadmap_events` | **added** | default |
| `roadmap_items` | yes | default |

`connectors` got `REPLICA IDENTITY FULL` because it is subscribed with a
server-side filter (`key=eq.<key>`) and the handler reads
`payload.new.enabled`; FULL puts every column in the payload so the filter
resolves on UPDATE and DELETE, not just INSERT. It holds 2 rows, so the WAL cost
is nil. `roadmap_events` was left at default deliberately — its handler ignores
the payload and only invalidates a query, and it is an append-heavy audit table
where FULL would add volume for nothing.

This gap was pre-existing and came from the migrations, so the **source project
almost certainly has it too**. Worth confirming there, since it means anyone
watching the roadmap or connector toggles on the old deployment has been
getting stale UI:

```sql
-- run against the source
SELECT schemaname, tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' ORDER BY 2;
```

---

## Rollback

`--single-transaction` means a failed load leaves the target untouched. If a
load *succeeds* but the result is wrong, the target had no real data before this
so a clean reset is safe:

```sql
-- Wipe application + auth data, keep the schema. Then re-run from step 3.
SET session_replication_role = replica;
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public'
  LOOP EXECUTE format('TRUNCATE public.%I CASCADE', t); END LOOP;
END $$;
TRUNCATE auth.mfa_amr_claims, auth.mfa_factors, auth.identities, auth.users CASCADE;
RESET session_replication_role;
```

Then re-apply the migration seed data by re-running the two seed-bearing
migrations, or just re-run steps 3–4 with the source dump.

The source project is only read by this process — nothing above writes to
`fmodmsxhujqzkibjnggo`.
