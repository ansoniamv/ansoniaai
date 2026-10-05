-- The assets Ansonia already operates, so deal flow can be read against them.
--
-- Four of the deals currently in the pipeline are in towns where Ansonia already
-- owns a building: Meadows at Sunbury against Sunbury Commons (Sunbury OH),
-- Arlington Club against Mandalane (Wheeling IL), The Reserve on Washington and
-- Autumn Run against Fairways of Naperville (Naperville IL), and 1900 At
-- Canterfield against Villages at Canterfield (West Dundee IL). Nothing in the
-- platform knew that, because nothing in the platform knew what we own.
--
-- Adjacency is a strong, free signal — known submarket, existing management,
-- possible operating leverage — and it needs no third-party data.
--
-- Seeded from ansoniaproperties.com/portfolio on 2026-10-05. Treated as reference
-- data a human maintains, not something a sync owns: there is no feed behind it,
-- so a stale row here is a wrong answer rather than a missing one. units and
-- year_built are null where the site does not state them; nothing infers values.

create table if not exists public.owned_properties (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  city          text,
  state         text,
  units         integer,
  year_built    integer,
  status        text not null default 'current' check (status in ('current','sold')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.owned_properties is
  'Properties Ansonia owns or has owned. Reference data, maintained by hand from the public portfolio page — no sync writes here.';
comment on column public.owned_properties.status is
  'current = still owned; sold = exited. Sold assets still carry submarket knowledge, so they are kept rather than deleted.';

create index if not exists owned_properties_city_state_idx
  on public.owned_properties (lower(state), lower(city));

alter table public.owned_properties enable row level security;

-- Readable by any approved user; only service_role writes. Same posture as the
-- other reference tables: this is firm-wide knowledge, not per-user data.
drop policy if exists "owned_properties readable by authenticated" on public.owned_properties;
create policy "owned_properties readable by authenticated"
  on public.owned_properties for select to authenticated using (true);

grant select on public.owned_properties to authenticated;
grant all    on public.owned_properties to service_role;

insert into public.owned_properties (name, city, state, units, year_built, status) values
  ('Villages at Canterfield',     'West Dundee',   'IL', 352,  2001, 'current'),
  ('Sunbury Commons',             'Sunbury',       'OH', 152,  2002, 'current'),
  ('Fielder Crossing',            'Arlington',     'TX', 137,  null, 'current'),
  ('Alara North Burnet',          'Austin',        'TX', 160,  null, 'current'),
  ('Cooper Denton',               'Denton',        'TX', 240,  null, 'current'),
  ('Fairways of Naperville',      'Naperville',    'IL', 210,  1985, 'current'),
  ('The Crossings at St. Charles','St. Charles',   'IL', 208,  1988, 'current'),
  ('Mandalane',                   'Wheeling',      'IL', 264,  null, 'current'),
  ('Brighton Square',             'Madison',       'WI', null, null, 'current'),
  ('2101 S. Michigan',            'Chicago',       'IL', 250,  1971, 'current'),
  ('4700 Lake Park',              'Chicago',       'IL', 218,  null, 'current'),
  ('Brewster-Hosmer',             'Freeport',      'IL', null, null, 'current'),
  ('The Duncan',                  'Chicago',       'IL', 260,  null, 'current'),
  ('70 E. Lake St.',              'Chicago',       'IL', null, null, 'current'),
  ('Rice Building',               'Chicago',       'IL', null, null, 'current'),
  ('Woodcreek Properties',        'Downers Grove', 'IL', null, null, 'current'),
  ('Lake Land Living',            'Mattoon',       'IL', null, null, 'sold'),
  ('Lake Point Terrace',          'Madison',       'WI', 125,  null, 'sold'),
  ('Metropolitan Place',          'Chicago',       'IL', 212,  null, 'sold'),
  ('2 E. Eighth',                 'Chicago',       'IL', 330,  null, 'sold'),
  ('Lunt Properties',             'Chicago',       'IL', 110,  null, 'sold'),
  ('1412 W. Chase',               'Chicago',       'IL', 56,   null, 'sold'),
  ('6945 Ashland',                'Chicago',       'IL', 55,   null, 'sold'),
  ('St. John Homes',              'Gary',          'IN', 144,  null, 'sold'),
  ('Park Leland',                 'Chicago',       'IL', 127,  null, 'sold'),
  ('Park Edgewater',              'Chicago',       'IL', 465,  null, 'sold')
on conflict do nothing;
