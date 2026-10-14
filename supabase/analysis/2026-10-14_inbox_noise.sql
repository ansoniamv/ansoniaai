-- Read-only analysis for the inbox-noise work. NOTHING HERE WRITES.
--
-- Every statement is a SELECT. There is no INSERT, UPDATE, DELETE, ALTER or
-- CREATE in this file, deliberately: it exists to decide what to change, not to
-- change it. Run it in the SQL editor against the live project.
--
-- Query 1 answers "how many current inbox rows would have matched a pipeline
-- deal", which is the number to look at before backfilling duplicate_of_deal_id.
-- Queries 2–4 are for the geography proposal.

-- ---------------------------------------------------------------------------
-- 1. Inbox rows that would be marked as pipeline duplicates
-- ---------------------------------------------------------------------------
-- Mirrors supabase/functions/_shared/dealMatch.ts. Keep the two in step: if the
-- matcher changes, this stops describing it.
--
--   canon       lowercase, non-alphanumerics to space, collapse, drop "the "
--   canon_loose canon minus ONE trailing generic word
--   exact       canon = canon,          no location needed
--   strong      canon_loose = canon_loose AND state agrees
--                                       AND cities agree when both are known
--
-- The one-word floor and the empty-name rule are both applied: a name that
-- canonicalises to a single word, or to nothing, never matches.

with gen as (
  select array['apartments','apartment','apts','apt',
               'townhomes','townhome','townhouses','townhouse',
               'residences','residence','lofts','loft','flats',
               'homes','living','community','communities',
               'portfolio','property','properties'] as words
),
canon as (
  select
    'inbox'::text as side, i.id, i.property_name,
    i.location_city as city, i.location_state as state,
    i.fit_tier, i.gate_status, i.email_received_at,
    regexp_replace(
      regexp_replace(lower(coalesce(i.property_name, '')), '[^a-z0-9]+', ' ', 'g'),
      '^(the )?\s*|\s+$', '', 'g') as c
  from public.inbox_deals i
  where i.accepted_deal_id is null
    and i.denied = false
    and coalesce(i.reviewed, false) = false
  union all
  select
    'deal', d.id::text, d.property_name, d.city, d.state,
    null, null, null,
    regexp_replace(
      regexp_replace(lower(coalesce(d.property_name, '')), '[^a-z0-9]+', ' ', 'g'),
      '^(the )?\s*|\s+$', '', 'g')
  from public.deals d
),
keyed as (
  select k.*,
    nullif(btrim(regexp_replace(k.c, '\s+', ' ', 'g')), '') as canon,
    -- canon minus one trailing generic word, when something identifying is left
    case
      when array_length(string_to_array(btrim(regexp_replace(k.c, '\s+', ' ', 'g')), ' '), 1) > 1
       and (select g.words from gen g) @>
           array[ (string_to_array(btrim(regexp_replace(k.c, '\s+', ' ', 'g')), ' '))
                  [array_length(string_to_array(btrim(regexp_replace(k.c, '\s+', ' ', 'g')), ' '), 1)] ]
      then array_to_string(
             (string_to_array(btrim(regexp_replace(k.c, '\s+', ' ', 'g')), ' '))
             [1 : array_length(string_to_array(btrim(regexp_replace(k.c, '\s+', ' ', 'g')), ' '), 1) - 1],
             ' ')
      else nullif(btrim(regexp_replace(k.c, '\s+', ' ', 'g')), '')
    end as canon_loose
  from canon k
),
eligible as (
  -- The one-word floor: "Westview" is not evidence.
  select * from keyed
  where canon is not null
    and array_length(string_to_array(canon, ' '), 1) >= 2
),
matches as (
  select
    inb.id              as inbox_id,
    inb.property_name   as inbox_name,
    inb.state           as inbox_state,
    inb.fit_tier,
    inb.gate_status,
    inb.email_received_at,
    dl.id               as deal_id,
    dl.property_name    as deal_name,
    dl.state            as deal_state,
    case when inb.canon = dl.canon then 'exact' else 'strong' end as confidence
  from eligible inb
  join eligible dl
    on dl.side = 'deal'
   and (
        inb.canon = dl.canon
     or (
          inb.canon_loose = dl.canon_loose
          and upper(left(coalesce(inb.state, ''), 2)) = upper(left(coalesce(dl.state, ''), 2))
          and coalesce(inb.state, '') <> ''
          and (
               coalesce(lower(regexp_replace(inb.city, '[^a-zA-Z0-9]+', ' ', 'g')), '') = ''
            or coalesce(lower(regexp_replace(dl.city,  '[^a-zA-Z0-9]+', ' ', 'g')), '') = ''
            or lower(regexp_replace(inb.city, '[^a-zA-Z0-9]+', ' ', 'g'))
             = lower(regexp_replace(dl.city,  '[^a-zA-Z0-9]+', ' ', 'g'))
          )
        )
   )
  where inb.side = 'inbox'
)
-- The headline number, split by how confident the rule is and by which section
-- the row is sitting in today. Anything in strong/medium/unscored is noise the
-- team is currently working through.
select
  confidence,
  coalesce(fit_tier, '(unscored)') as current_tier,
  coalesce(gate_status, '(none)')  as gate_status,
  count(*)                         as rows_hidden
from matches
group by 1, 2, 3
order by 1, 4 desc;

-- Swap the final SELECT for this to read the actual list before backfilling:
--
--   select confidence, inbox_name, inbox_state, deal_name, deal_state,
--          fit_tier, email_received_at
--   from matches
--   order by confidence, email_received_at desc;

-- ---------------------------------------------------------------------------
-- 2. Geography: what is in the inbox now, by state
-- ---------------------------------------------------------------------------
-- The "would move to Screened Out" list for the proposal. Target geography is
-- the 7 MSAs plus NC/SC statewide; everything else moves.
select
  upper(left(coalesce(location_state, ''), 2)) as state,
  count(*) as rows,
  count(*) filter (where fit_tier in ('strong', 'Strong')) as strong,
  count(*) filter (where fit_tier in ('medium', 'Medium')) as medium,
  count(*) filter (where fit_tier is null)                 as unscored,
  bool_or(
    coalesce(lower(msa), '') ~ '(chicago|naperville|elgin|columbus|madison|austin|round rock|san marcos|dallas|fort worth|dfw|arlington|denver|aurora|centennial|salt lake)'
  ) as any_row_in_a_target_msa
from public.inbox_deals
where accepted_deal_id is null
  and denied = false
  and coalesce(reviewed, false) = false
group by 1
order by rows desc;

-- ---------------------------------------------------------------------------
-- 3. Geography: row-by-row verdict under the proposal
-- ---------------------------------------------------------------------------
select
  property_name,
  location_city, location_state, msa, fit_tier, gate_status, gate_reason,
  case
    when upper(left(coalesce(location_state, ''), 2)) in ('NC', 'SC') then 'stays — Carolinas statewide'
    when coalesce(lower(msa), '') ~ '(chicago|naperville|elgin|columbus|madison|austin|round rock|san marcos|dallas|fort worth|dfw|arlington|denver|aurora|centennial|salt lake)'
      then 'stays — target MSA'
    when coalesce(location_state, '') = '' then 'MOVES — no state'
    else 'MOVES — ' || upper(left(location_state, 2))
  end as verdict_under_proposal
from public.inbox_deals
where accepted_deal_id is null
  and denied = false
  and coalesce(reviewed, false) = false
order by verdict_under_proposal, property_name;

-- ---------------------------------------------------------------------------
-- 4. Where does the market "Other" come from?
-- ---------------------------------------------------------------------------
-- I could not find anything in the code that writes "Other" into msa. The
-- inbox's market dropdown is built from the distinct msa values present, with
-- no "Other" bucket, and the only literal "Other" nearby is a DENIAL CATEGORY
-- and the section title "Screened Out / Other Deals". So before changing
-- anything, this says whether "Other" is a stored value or a misread label.
select
  coalesce(nullif(btrim(msa), ''), '(null or empty)') as msa_value,
  count(*) as rows,
  count(*) filter (where location_state is null or btrim(location_state) = '') as also_missing_state
from public.inbox_deals
where accepted_deal_id is null
  and denied = false
  and coalesce(reviewed, false) = false
group by 1
order by rows desc
limit 40;
