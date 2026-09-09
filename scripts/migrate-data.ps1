<#
.SYNOPSIS
  Copies auth + application data from the old Supabase project to the new one.

.DESCRIPTION
  Implements MIGRATION.md end to end. Prompts for both database passwords as
  secure strings, so nothing is echoed to the console, written to disk, or kept
  in shell history. Validates both connections before touching anything.

  Safe to re-run: it aborts if the target already has users unless -Force.
  The source project is only ever read.

.EXAMPLE
  .\scripts\migrate-data.ps1
  .\scripts\migrate-data.ps1 -KeepDumps      # leave the .sql files for inspection
#>
[CmdletBinding()]
param(
  [string]$SourceHost = 'aws-0-us-west-2.pooler.supabase.com',
  [string]$SourceUser = 'postgres.fmodmsxhujqzkibjnggo',
  [string]$TargetHost = 'aws-0-us-east-2.pooler.supabase.com',
  [string]$TargetUser = 'postgres.pyndxntvoixxndbwiawd',
  [int]$Port = 5432,
  [switch]$KeepDumps,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

# --- locate client tools (server is PG 17.6, so pg_dump must be >= 17) --------
$pgBin = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\pg_dump.exe' -ErrorAction SilentlyContinue |
         Sort-Object { [int]($_.Directory.Parent.Name) } -Descending | Select-Object -First 1
if (-not $pgBin) { throw "pg_dump not found. Install with: winget install PostgreSQL.PostgreSQL.17" }
$pgDump = $pgBin.FullName
$psql   = Join-Path $pgBin.Directory 'psql.exe'
$ver    = (& $pgDump --version) -replace '[^\d.]', '' -split '\.' | Select-Object -First 1
if ([int]$ver -lt 17) { throw "pg_dump $ver is too old; the servers run 17.6. Install PostgreSQL 17+." }
Write-Host "Using $pgDump (v$ver)" -ForegroundColor DarkGray

function Read-Pw($label) {
  $s = Read-Host -Prompt $label -AsSecureString
  # Marshal back to plain text only in-process, for the child process env var.
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

function Invoke-Psql($pw, $dbHost, $user, $sqlOrArgs, [switch]$File) {
  # Windows PowerShell 5.1 wraps a native command's redirected stderr in
  # NativeCommandError records, which $ErrorActionPreference='Stop' promotes to
  # terminating. psql writes NOTICE to stderr (the orphan check ends in
  # RAISE NOTICE), so Stop would abort on a *successful* run. Function-scoped,
  # so the rest of the script keeps Stop semantics; exit codes are still checked
  # via $LASTEXITCODE at every call site.
  $ErrorActionPreference = 'Continue'
  $env:PGPASSWORD = $pw
  try {
    if ($File) { & $psql -h $dbHost -p $Port -U $user -d postgres -v ON_ERROR_STOP=1 @sqlOrArgs 2>&1 }
    else       { & $psql -h $dbHost -p $Port -U $user -d postgres -v ON_ERROR_STOP=1 -tAc $sqlOrArgs 2>&1 }
  } finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
}

# --- credentials -------------------------------------------------------------
Write-Host ''
Write-Host 'Database passwords (Dashboard -> Project Settings -> Database -> Reset database password).' -ForegroundColor Cyan
Write-Host 'These are the POSTGRES passwords, not API keys and not the JWT secret.' -ForegroundColor DarkGray
$srcPw = Read-Pw "  SOURCE  fmodmsxhujqzkibjnggo (us-west-2) password"
$dstPw = Read-Pw "  TARGET  pyndxntvoixxndbwiawd (us-east-2) password"

# --- validate both before doing anything -------------------------------------
Write-Host ''
Write-Host 'Validating connections...' -ForegroundColor Cyan
$srcCheck = Invoke-Psql $srcPw $SourceHost $SourceUser "select count(*) from auth.users"
if ($LASTEXITCODE -ne 0) { Write-Host "  SOURCE failed: $srcCheck" -ForegroundColor Red; throw 'Source connection failed.' }
$srcUsers = [int]($srcCheck | Select-Object -Last 1).Trim()
Write-Host "  SOURCE ok - auth.users = $srcUsers" -ForegroundColor Green

$dstCheck = Invoke-Psql $dstPw $TargetHost $TargetUser "select count(*) from auth.users"
if ($LASTEXITCODE -ne 0) { Write-Host "  TARGET failed: $dstCheck" -ForegroundColor Red; throw 'Target connection failed.' }
$dstUsers = [int]($dstCheck | Select-Object -Last 1).Trim()
Write-Host "  TARGET ok - auth.users = $dstUsers" -ForegroundColor Green

if ($srcUsers -eq 0) { throw "Source has 0 users - wrong project? Refusing to copy an empty database over your target." }
if ($dstUsers -gt 0 -and -not $Force) {
  throw "Target already has $dstUsers users. Re-run with -Force only if you intend to load on top (see the rollback section of MIGRATION.md)."
}

# --- dump --------------------------------------------------------------------
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$authSql = "auth_data_$stamp.sql"
$pubSql  = "public_data_$stamp.sql"

Write-Host ''
Write-Host 'Dumping auth rows (users, identities, MFA)...' -ForegroundColor Cyan
# Password hashes are bcrypt in auth.users.encrypted_password and are portable.
# auth.schema_migrations is deliberately NOT copied: it is GoTrue's own version
# ledger and overwriting it desynchronises the target's auth service.
# Sessions/refresh tokens are signed with the old project's key, so they are
# skipped too - everyone simply logs in once.
$env:PGPASSWORD = $srcPw
try {
  & $pgDump -h $SourceHost -p $Port -U $SourceUser -d postgres `
    --data-only --no-owner --no-privileges --no-comments `
    --table=auth.users --table=auth.identities `
    --table=auth.mfa_factors --table=auth.mfa_amr_claims `
    -f $authSql
  if ($LASTEXITCODE -ne 0) { throw "auth dump failed" }

  Write-Host 'Dumping public schema...' -ForegroundColor Cyan
  # No --disable-triggers: it emits ALTER TABLE ... DISABLE TRIGGER ALL, which
  # needs superuser, and Supabase's postgres role is not one.
  & $pgDump -h $SourceHost -p $Port -U $SourceUser -d postgres `
    --data-only --no-owner --no-privileges --no-comments --schema=public `
    -f $pubSql
  if ($LASTEXITCODE -ne 0) { throw "public dump failed" }
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }

foreach ($f in @($authSql, $pubSql)) {
  Write-Host ("  {0} - {1:N1} MB" -f $f, ((Get-Item $f).Length / 1MB)) -ForegroundColor DarkGray
}

# --- clear migration-seeded rows on the target -------------------------------
# These eight are populated by seed data inside the migrations. Loading the
# source rows on top collides on the primary key and aborts the transaction.
Write-Host ''
Write-Host 'Clearing migration-seeded tables on target...' -ForegroundColor Cyan
$truncate = @'
TRUNCATE public.roadmap_items, public.buy_box_signals, public.buy_box_pillars,
         public.ai_model_pricing, public.connectors, public.buy_box_thesis,
         public.learned_strategy, public.learned_partner_strategy CASCADE;
'@
$out = Invoke-Psql $dstPw $TargetHost $TargetUser $truncate
if ($LASTEXITCODE -ne 0) { Write-Host $out -ForegroundColor Red; throw 'Truncate failed.' }
Write-Host '  done' -ForegroundColor Green

# --- load --------------------------------------------------------------------
# The schema has a circular FK (inbox_deals.accepted_deal_id -> deals.id and
# deals.inbox_deal_id -> inbox_deals.id), neither deferrable, so NO load order
# can work. session_replication_role = replica skips FK checks AND stops the
# triggers that would otherwise advance engagement stages, fabricate profiles
# rows, and overwrite real timestamps with now().
# Both files must go in ONE psql call: the setting is session-scoped.
Write-Host ''
Write-Host 'Loading into target (FK checks + triggers suppressed, single transaction)...' -ForegroundColor Cyan
$loadArgs = @(
  '--single-transaction'
  '--command'; 'SET session_replication_role = replica'
  '--file';    $authSql
  '--file';    $pubSql
)
$out = Invoke-Psql $dstPw $TargetHost $TargetUser $loadArgs -File
if ($LASTEXITCODE -ne 0) {
  Write-Host $out -ForegroundColor Red
  throw 'Load failed. --single-transaction means the target was rolled back and is unchanged.'
}
Write-Host '  loaded' -ForegroundColor Green

# --- verify ------------------------------------------------------------------
Write-Host ''
Write-Host 'Verifying...' -ForegroundColor Cyan
$counts = @'
select 'auth.users='||(select count(*) from auth.users)
    ||'  profiles='||(select count(*) from public.profiles)
    ||'  approved='||(select count(*) from public.profiles where status='approved')
    ||'  deals='||(select count(*) from public.deals)
    ||'  partners='||(select count(*) from public.partners)
    ||'  inbox_deals='||(select count(*) from public.inbox_deals)
'@
Write-Host ("  target: " + ((Invoke-Psql $dstPw $TargetHost $TargetUser $counts | Select-Object -Last 1).Trim())) -ForegroundColor Green

# FK checks were skipped during the load, so confirm nothing is orphaned.
$orphans = @'
DO $$
DECLARE r record; n bigint; bad text := '';
BEGIN
  FOR r IN
    SELECT src.relname AS child, a.attname AS col,
           tn.nspname AS psch, tgt.relname AS parent, fa.attname AS pcol
    FROM pg_constraint con
    JOIN pg_class src ON src.oid=con.conrelid
    JOIN pg_namespace sn ON sn.oid=src.relnamespace
    JOIN pg_class tgt ON tgt.oid=con.confrelid
    JOIN pg_namespace tn ON tn.oid=tgt.relnamespace
    JOIN pg_attribute a  ON a.attrelid=con.conrelid  AND a.attnum=con.conkey[1]
    JOIN pg_attribute fa ON fa.attrelid=con.confrelid AND fa.attnum=con.confkey[1]
    WHERE con.contype='f' AND sn.nspname='public' AND array_length(con.conkey,1)=1
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I c WHERE c.%I IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM %I.%I p WHERE p.%I = c.%I)',
      r.child, r.col, r.psch, r.parent, r.pcol, r.col) INTO n;
    IF n > 0 THEN bad := bad || format('%s.%s:%s ', r.child, r.col, n); END IF;
  END LOOP;
  IF bad = '' THEN RAISE NOTICE 'FK integrity OK';
  ELSE RAISE WARNING 'ORPHANS: %', bad; END IF;
END $$;
'@
Write-Host ("  " + ((Invoke-Psql $dstPw $TargetHost $TargetUser $orphans) -join ' ').Trim()) -ForegroundColor Green

if (-not $KeepDumps) {
  Remove-Item $authSql, $pubSql -ErrorAction SilentlyContinue
  Write-Host '  dump files removed (use -KeepDumps to retain them)' -ForegroundColor DarkGray
}

Write-Host ''
Write-Host 'Done. Remaining steps:' -ForegroundColor Cyan
Write-Host '  1. Log in at https://ansoniaai.vercel.app with an existing password.'
Write-Host '  2. Storage files are NOT in the dump - see the rclone step in MIGRATION.md.'
Write-Host '  3. Close public signup once you confirm you can get in.'
Write-Host '  4. Take deal-pipeline-pro.vercel.app down so there is one platform.'
