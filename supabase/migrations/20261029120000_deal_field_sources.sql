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
  nv       jsonb;
  ov       jsonb;
  k        text;
begin
  if tg_op = 'INSERT' then
    merged := coalesce(new.field_sources, '{}'::jsonb);
  else
    -- An update that does not touch field_sources carries the old object
    -- through unchanged; that is not a writer supplying entries.
    if new.field_sources is distinct from old.field_sources then
      supplied := coalesce(new.field_sources, '{}'::jsonb);
    end if;
    merged := coalesce(old.field_sources, '{}'::jsonb) || supplied;
  end if;

  -- Each entry's column is read on its own. Never to_jsonb(new): a deal row
  -- carries its HelloData payload and raw copy (up to ~1 MB compressed each),
  -- and turning the whole row into JSON unpacks both on every update. The first
  -- attempt at this migration did that; it timed out and the database restarted.
  for k in select jsonb_object_keys(merged) loop
    -- An entry has to be an object describing a real column.
    if jsonb_typeof(merged -> k) is distinct from 'object' or not exists (
         select 1 from pg_attribute
         where attrelid = 'public.deals'::regclass and attname = k and attnum > 0 and not attisdropped
       ) then
      merged := merged - k;
      continue;
    end if;
    execute format('select to_jsonb(($1).%I)', k) into nv using new;
    -- A column with no value has no source; a writer clears one by sending null.
    if coalesce(nv, 'null'::jsonb) = 'null'::jsonb then
      merged := merged - k;
      continue;
    end if;
    -- A value that changed without a new entry no longer has the old one's
    -- source. jsonb comparison is numeric, so 260 and 260.0 are the same value.
    if tg_op = 'UPDATE' and not (supplied ? k) then
      execute format('select to_jsonb(($1).%I)', k) into ov using old;
      if nv is distinct from ov then
        merged := merged - k;
      end if;
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
  -- The document fields only, not to_jsonb(d): see the trigger above.
  where jsonb_build_object(
          'unit_count', d.unit_count, 'vintage_year', d.vintage_year, 'total_sqft', d.total_sqft,
          'occupancy_pct', d.occupancy_pct, 'in_place_avg_rent', d.in_place_avg_rent,
          'gross_scheduled_rent', d.gross_scheduled_rent, 't12_noi', d.t12_noi, 't12_opex', d.t12_opex,
          'expense_ratio', d.expense_ratio, 'asking_price', d.asking_price
        ) -> p.field = p.value
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

-- 3) HelloData figures checked against the HelloData record stored on the deal
--    (hellodata_payload, the payload fetch-hellodata matched to this building).
--    Each figure is recomputed from it the way mapHelloDataProperty does, and
--    cited only where it equals the deal's value, so the citation is exact and
--    not marked backfilled. Units and vintage are fill-if-null and are never
--    rewritten by a refresh, so this is the only way they get a source.
--    A document entry for units, vintage or rent is kept over HelloData's; the
--    exact HelloData entries replace step 2's backfilled ones for tract rent and
--    income.

-- pickNum: the first of the values that is present (not null, not ""), and
-- only if that one is a number.
create function pg_temp.hd_num(vals jsonb[]) returns numeric
language sql immutable as $$
  select case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric end
  from unnest(vals) with ordinality as t(v, i)
  where v is not null and jsonb_typeof(v) <> 'null' and v <> '""'::jsonb
  order by i
  limit 1
$$;

-- One deal at a time, its payload unpacked once into a variable: a reference
-- to a stored jsonb column in a query unpacks it again each time, and the
-- first attempt, which read each payload ~20 times across every deal in one
-- statement, timed out and the database restarted.
do $backfill$
declare
  d               record;
  p               jsonb;
  avail           jsonb;
  filed_units     numeric;
  predicted_units numeric;
  filed_year      numeric;
  predicted_year  numeric;
  listed_rent     numeric;
  listed_units    bigint;
  property_rent   numeric;
  tract_rent      numeric;
  tract_income    numeric;
  intake          jsonb;
  demographics    jsonb;
begin
  for d in
    select id, unit_count, vintage_year, in_place_avg_rent, median_rent_tract, median_income_tract,
           coalesce(hellodata_last_synced_at, now()) as at
    from public.deals
    where hellodata_status = 'fetched' and hellodata_payload is not null
  loop
    select hellodata_payload into p from public.deals where id = d.id;
    continue when jsonb_typeof(p) is distinct from 'object';

    filed_units     := pg_temp.hd_num(array[p -> 'number_units', p -> 'unit_count', p -> 'units']);
    predicted_units := pg_temp.hd_num(array[p -> 'number_units_prediction']);
    filed_year      := pg_temp.hd_num(array[p -> 'year_built', p -> 'vintage_year', p -> 'built_year']);
    predicted_year  := pg_temp.hd_num(array[p -> 'year_built_prediction']);
    property_rent   := pg_temp.hd_num(array[
      p -> 'avg_effective_price', p -> 'avg_price', p -> 'avg_rent', p -> 'average_rent', p -> 'effective_rent',
      p -> 'asking_rent', p -> 'market_rent', p -> 'median_rent', p -> 'rent',
      p #> '{pricing_strategy,avg_effective_price}', p #> '{pricing_strategy,avg_price}',
      p #> '{pricing_strategy,avg_rent}', p #> '{pricing_strategy,average_rent}',
      p #> '{pricing_strategy,effective_rent}', p #> '{pricing_strategy,asking_rent}',
      p #> '{pricing_strategy,market_rent}'
    ]);
    tract_rent   := pg_temp.hd_num(array[p #> '{demographics,median_rent}', p #> '{demographics,median_gross_rent}']);
    tract_income := pg_temp.hd_num(array[
      p #> '{demographics,median_income}', p #> '{demographics,median_household_income}',
      p #> '{demographics,household_median_income}'
    ]);

    -- The units the mapper averages: the first of these that is an array.
    avail := case
      when jsonb_typeof(p -> 'building_availability') = 'array' then p -> 'building_availability'
      when jsonb_typeof(p -> 'availability') = 'array' then p -> 'availability'
      when jsonb_typeof(p -> 'units') = 'array' then p -> 'units'
      when jsonb_typeof(p -> 'floor_plans') = 'array' then p -> 'floor_plans'
      else '[]'::jsonb
    end;
    select round(avg(r)), count(r) into listed_rent, listed_units
    from jsonb_array_elements(avail) u
    cross join lateral (select pg_temp.hd_num(array[
      u -> 'effective_price', u -> 'price', u -> 'min_effective_price', u -> 'min_price', u -> 'rent',
      u -> 'asking_rent', u -> 'market_rent', u -> 'monthly_rent', u -> 'list_price', u -> 'avg_price',
      u -> 'avg_effective_price', u -> 'avg_rent'
    ]) as r) rent;

    intake := jsonb_strip_nulls(jsonb_build_object(
      'unit_count', case
        when filed_units is not null and d.unit_count = filed_units then jsonb_build_object(
          'kind', 'api', 'provider', 'HelloData', 'recorded_at', d.at,
          'label', 'Unit count on HelloData''s property record')
        when filed_units is null and d.unit_count = predicted_units then jsonb_build_object(
          'kind', 'api', 'provider', 'HelloData', 'recorded_at', d.at,
          'label', 'HelloData''s predicted unit count. HelloData has no filed count for this property.')
      end,
      'vintage_year', case
        when filed_year is not null and d.vintage_year = filed_year then jsonb_build_object(
          'kind', 'api', 'provider', 'HelloData', 'recorded_at', d.at,
          'label', 'Year built on HelloData''s property record')
        when filed_year is null and d.vintage_year = predicted_year then jsonb_build_object(
          'kind', 'api', 'provider', 'HelloData', 'recorded_at', d.at,
          'label', 'HelloData''s predicted year built. HelloData has no filed year for this property.')
      end,
      'in_place_avg_rent', case
        when listed_units > 0 and d.in_place_avg_rent = listed_rent then jsonb_build_object(
          'kind', 'api', 'provider', 'HelloData', 'recorded_at', d.at,
          'label', format(
            'Average asking rent across %s unit%s HelloData lists as available. Asking rent, not what current residents pay.',
            listed_units, case when listed_units = 1 then '' else 's' end))
        when listed_units = 0 and d.in_place_avg_rent = round(property_rent) then jsonb_build_object(
          'kind', 'api', 'provider', 'HelloData', 'recorded_at', d.at,
          'label', 'HelloData''s property-level average rent (no units were listed as available). Asking rent, not what current residents pay.')
      end
    ));
    demographics := jsonb_strip_nulls(jsonb_build_object(
      'median_rent_tract', case when d.median_rent_tract = tract_rent then jsonb_build_object(
        'kind', 'api', 'provider', 'HelloData', 'recorded_at', d.at,
        'label', 'Census-tract median rent, from HelloData''s demographics') end,
      'median_income_tract', case when d.median_income_tract = tract_income then jsonb_build_object(
        'kind', 'api', 'provider', 'HelloData', 'recorded_at', d.at,
        'label', 'Census-tract median household income, from HelloData''s demographics') end
    ));

    if intake <> '{}'::jsonb or demographics <> '{}'::jsonb then
      update public.deals
         set field_sources = intake || field_sources || demographics
       where id = d.id;
    end if;
  end loop;
end
$backfill$;

alter table public.deals enable trigger update_deals_updated_at;
