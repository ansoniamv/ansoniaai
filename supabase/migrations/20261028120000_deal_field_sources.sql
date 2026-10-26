-- Where each figure on a deal came from, so the Key Stats boxes on the deal
-- page can show it: the quote from the OM or rent roll, or the dataset, area
-- and period an API figure describes.
--
-- deals.field_sources holds one entry per column, keyed by column name. Its
-- shape is FieldSource in supabase/functions/_shared/fieldSources.ts.
--
-- Writers put entries in the same update as the values they describe. The
-- trigger below merges them into what is already there, so a writer names only
-- the fields it wrote. It also drops an entry whose column changes without a new
-- entry, so a source never outlives its value: a hand edit of the unit count
-- loses the OM quote, which no longer says what the deal says.

alter table public.deals
  add column if not exists field_sources jsonb not null default '{}'::jsonb;

comment on column public.deals.field_sources is
  'Per-column source of the figure: {column: FieldSource}. See supabase/functions/_shared/fieldSources.ts. Maintained by keep_deal_field_sources; write entries, not the whole object.';

-- What the parser copied from the document for each proposal, and whether that
-- text was found in the document. An unverified quote is the model's wording.
alter table public.deal_document_proposals
  add column if not exists quote          text,
  add column if not exists quote_verified boolean not null default false,
  add column if not exists location       text;

-- ---------------------------------------------------------------- trigger
create or replace function public.keep_deal_field_sources()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  supplied jsonb := '{}'::jsonb;
  merged   jsonb;
  n        jsonb := to_jsonb(new);
  o        jsonb;
  k        text;
begin
  if tg_op = 'INSERT' then
    merged := coalesce(new.field_sources, '{}'::jsonb);
  else
    o := to_jsonb(old);
    -- An update that does not touch field_sources carries the old object
    -- through unchanged; that is not a writer supplying entries.
    if new.field_sources is distinct from old.field_sources then
      supplied := coalesce(new.field_sources, '{}'::jsonb);
    end if;
    merged := coalesce(old.field_sources, '{}'::jsonb) || supplied;
    -- jsonb comparison is numeric for numbers, so 260 and 260.0 are the same value.
    for k in select jsonb_object_keys(merged) loop
      if not (supplied ? k) and (n -> k) is distinct from (o -> k) then
        merged := merged - k;
      end if;
    end loop;
  end if;

  -- An entry has to be an object describing a column that holds a value. A
  -- writer clears one by sending it as null.
  for k in select jsonb_object_keys(merged) loop
    if jsonb_typeof(merged -> k) is distinct from 'object'
       or coalesce(n -> k, 'null'::jsonb) = 'null'::jsonb then
      merged := merged - k;
    end if;
  end loop;

  -- A CoStar supply figure replaces whatever was written (apply_costar_supply,
  -- which runs first: triggers fire in name order). The page cites it from the
  -- submarket's own row, so an Esri entry here would describe the wrong figure.
  if new.new_supply_source = 'costar_uc' then
    merged := merged - 'new_supply_pct_of_stock';
  end if;

  new.field_sources := merged;
  return new;
end $$;

drop trigger if exists deals_field_sources on public.deals;
create trigger deals_field_sources
  before insert or update on public.deals
  for each row execute function public.keep_deal_field_sources();

-- One proposal as a FieldSource. Shared by apply and the backfill below.
create or replace function public.deal_document_field_source(
  p   public.deal_document_proposals,
  doc public.deal_documents,
  at  timestamptz
)
returns jsonb
language sql
immutable
set search_path to 'public'
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'kind', 'document',
    'provider', 'Deal document',
    'label', case doc.doc_type
               when 'om' then 'Offering memorandum'
               when 'rent_roll' then 'Rent roll'
               when 't12' then 'T12 operating statement'
               else 'Deal document'
             end,
    'quote', nullif(btrim(p.quote), ''),
    'quote_verified', p.quote_verified,
    'location', nullif(btrim(p.location), ''),
    'note', nullif(btrim(p.evidence), ''),
    'document_id', p.document_id,
    'file_name', doc.file_name,
    'as_of', nullif(btrim(doc.doc_as_of), ''),
    'recorded_at', at
  ))
$$;

-- ---------------------------------------------------------------- apply
-- As in 20261021120000_deal_documents.sql, plus the field's source written in
-- the same UPDATE as its value.
create or replace function public.apply_deal_document_proposals(_proposal_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  allowed constant text[] := array[
    'unit_count', 'vintage_year', 'total_sqft', 'occupancy_pct',
    'in_place_avg_rent', 'gross_scheduled_rent', 't12_noi', 't12_opex',
    'expense_ratio', 'asking_price'
  ];
  p        public.deal_document_proposals%rowtype;
  doc      public.deal_documents%rowtype;
  col_type text;
  source   jsonb;
  applied  integer := 0;
begin
  if not public.is_approved(auth.uid()) then
    raise exception 'not approved' using errcode = 'insufficient_privilege';
  end if;

  if (select count(*) from (
        select deal_id, field from public.deal_document_proposals
        where id = any(_proposal_ids)
        group by deal_id, field having count(*) > 1
      ) dup) > 0 then
    raise exception 'more than one proposal chosen for the same field' using errcode = 'invalid_parameter_value';
  end if;

  for p in
    select * from public.deal_document_proposals
    where id = any(_proposal_ids) and status = 'pending'
    for update
  loop
    if not (p.field = any(allowed)) then
      raise exception 'field % cannot be applied from a document', p.field using errcode = 'invalid_parameter_value';
    end if;

    select format_type(a.atttypid, a.atttypmod) into col_type
    from pg_attribute a
    where a.attrelid = 'public.deals'::regclass and a.attname = p.field and not a.attisdropped;

    select * into doc from public.deal_documents where id = p.document_id;
    source := public.deal_document_field_source(p, doc, now());

    execute format(
      'UPDATE public.deals SET %I = ($1 #>> ''{}'')::%s, field_sources = $3 WHERE id = $2',
      p.field, col_type
    ) using p.value, p.deal_id, jsonb_build_object(p.field, source);

    update public.deal_document_proposals
       set status = 'applied', decided_by = auth.uid(), decided_at = now()
     where id = p.id;

    update public.deal_document_proposals
       set status = 'superseded', decided_by = auth.uid(), decided_at = now()
     where deal_id = p.deal_id and field = p.field and status = 'pending' and id <> p.id;

    applied := applied + 1;
  end loop;

  return applied;
end;
$function$;

revoke all on function public.apply_deal_document_proposals(uuid[]) from public, anon;
grant execute on function public.apply_deal_document_proposals(uuid[]) to authenticated;

-- ---------------------------------------------------------------- backfill
-- Only field_sources changes here, so updated_at is left alone: bumping it on
-- every deal would reorder anything sorted by last update.
alter table public.deals disable trigger update_deals_updated_at;

-- 1) Figures applied from a document, where the deal still holds that value.
--    These were recorded at the time, in the proposal, so they are not marked
--    as backfilled. None has a checked quote: quotes start with this release.
with latest as (
  select distinct on (p.deal_id, p.field) p.id
  from public.deal_document_proposals p
  where p.status = 'applied'
  order by p.deal_id, p.field, p.decided_at desc nulls last
), entries as (
  select p.deal_id,
         jsonb_object_agg(p.field, public.deal_document_field_source(p, doc, coalesce(p.decided_at, p.created_at))) as e
  from latest l
  join public.deal_document_proposals p on p.id = l.id
  join public.deal_documents doc on doc.id = p.document_id
  join public.deals d on d.id = p.deal_id
  where (to_jsonb(d) -> p.field) = p.value
  group by p.deal_id
)
update public.deals d
   set field_sources = d.field_sources || entries.e
  from entries
 where d.id = entries.deal_id;

-- 2) Columns that have only ever had one writer. The writer is certain; the
--    exact series, area and period were not kept, so each is marked backfilled
--    and the page says to refresh market data for the full citation.
--      median_rent_tract, median_income_tract: only the HelloData mapper
--      job_growth_pct, population_growth_pct:  only _shared/marketMetrics.ts
--      new_supply_pct_of_stock (esri_housing_units): only marketMetrics.ts
update public.deals d
   set field_sources = jsonb_strip_nulls(jsonb_build_object(
         'median_rent_tract', case when d.median_rent_tract is not null then jsonb_build_object(
           'kind', 'api', 'provider', 'HelloData', 'backfilled', true,
           'label', 'Census-tract median rent, from HelloData''s demographics',
           'recorded_at', coalesce(d.hellodata_last_synced_at, now())) end,
         'median_income_tract', case when d.median_income_tract is not null then jsonb_build_object(
           'kind', 'api', 'provider', 'HelloData', 'backfilled', true,
           'label', 'Census-tract median household income, from HelloData''s demographics',
           'recorded_at', coalesce(d.hellodata_last_synced_at, now())) end,
         'job_growth_pct', case when d.job_growth_pct is not null then jsonb_build_object(
           'kind', 'api', 'provider', 'BLS', 'backfilled', true,
           'label', 'BLS total nonfarm employment, year over year, for the property''s metro area',
           'recorded_at', now()) end,
         'population_growth_pct', case when d.population_growth_pct is not null then jsonb_build_object(
           'kind', 'api', 'provider', 'Esri', 'backfilled', true,
           'label', 'Esri annual population growth over the next five years, ring around the property',
           'recorded_at', now()) end,
         'new_supply_pct_of_stock', case when d.new_supply_pct_of_stock is not null
                                          and d.new_supply_source = 'esri_housing_units' then jsonb_build_object(
           'kind', 'api', 'provider', 'Esri', 'backfilled', true,
           'label', 'Esri annual housing-unit growth over the next five years, ring around the property',
           'recorded_at', now()) end
       )) || d.field_sources
 where d.median_rent_tract is not null
    or d.median_income_tract is not null
    or d.job_growth_pct is not null
    or d.population_growth_pct is not null
    or (d.new_supply_pct_of_stock is not null and d.new_supply_source = 'esri_housing_units');

alter table public.deals enable trigger update_deals_updated_at;
