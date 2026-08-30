-- Scout schema. Run once in the Supabase SQL editor.
-- Safe to re-run: every statement is idempotent.

create extension if not exists pg_trgm;

create table if not exists studies (
  id             text primary key,
  source         text        not null,
  source_ref     text        not null,
  source_url     text        not null,
  title          text        not null,
  condition      text        not null,
  -- Normalised form of `condition`, written by the app. Registries spell one
  -- condition several ways, and grouping on the raw string splits the counts.
  condition_key  text        not null,
  intervention   text,
  study_type     text        not null default 'other',
  sample_size    integer,
  countries      text[]      not null default '{}',
  population_note text       not null,
  representation text        not null default 'unclear',
  year           integer,
  confidence     real        not null default 0,
  content_hash   text        not null,
  enriched       boolean     not null default false,
  extracted_by   text        not null,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  constraint representation_values
    check (representation in ('none','partial','primary','unclear')),
  constraint study_type_values
    check (study_type in ('interventional','observational','review','case-report','other')),
  constraint confidence_range check (confidence >= 0 and confidence <= 1)
);

-- The dashboard groups by condition constantly, so this index carries the app.
create index if not exists studies_condition_idx on studies (condition_key);
create index if not exists studies_representation_idx on studies (representation);
create index if not exists studies_year_idx on studies (year desc nulls last);
create index if not exists studies_countries_idx on studies using gin (countries);
-- Trigram index backs the free-text search box without a separate search service.
create index if not exists studies_search_idx
  on studies using gin ((title || ' ' || condition || ' ' || population_note) gin_trgm_ops);

-- Derived from `studies` on every ingest. Replaced wholesale rather than merged,
-- so a condition that stops appearing cannot linger as a stale row.
create table if not exists gaps (
  condition               text primary key,
  total_studies           integer     not null,
  primary_count           integer     not null default 0,
  partial_count           integer     not null default 0,
  none_count              integer     not null default 0,
  unclear_count           integer     not null default 0,
  represented_participants bigint     not null default 0,
  total_participants      bigint      not null default 0,
  gap_score               real        not null,
  computed_at             timestamptz not null default now()
);
create index if not exists gaps_score_idx on gaps (gap_score desc);

create table if not exists ingest_runs (
  id              text primary key,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  trigger         text        not null,
  scrape_provider text        not null,
  llm_provider    text        not null,
  records_seen    int         not null default 0,
  records_skipped int         not null default 0,
  enriched        int         not null default 0,
  extracted       int         not null default 0,
  rejected        int         not null default 0,
  errors          text[]      not null default '{}'
);
create index if not exists ingest_runs_started_idx on ingest_runs (started_at desc);

-- RLS: the dashboard reads with the anon key, so reads are public and every
-- write path goes through the service-role key in the ingest job.
alter table studies     enable row level security;
alter table gaps        enable row level security;
alter table ingest_runs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'studies' and policyname = 'public read') then
    create policy "public read" on studies for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'gaps' and policyname = 'public read') then
    create policy "public read" on gaps for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ingest_runs' and policyname = 'public read') then
    create policy "public read" on ingest_runs for select using (true);
  end if;
end $$;
