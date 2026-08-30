-- Scout schema. Run once in the Supabase SQL editor.
-- Safe to re-run: every statement is idempotent.

create extension if not exists pg_trgm;

create table if not exists opportunities (
  id             text primary key,
  source         text        not null,
  source_url     text        not null,
  title          text        not null,
  funder         text        not null,
  programme      text,
  summary        text        not null,
  disciplines    text[]      not null default '{}',
  eligibility    text,
  award          jsonb,
  deadline       date,
  status         text        not null default 'unknown',
  confidence     real        not null default 0,
  content_hash   text        not null,
  extracted_by   text        not null,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  constraint status_values check (status in ('open','closed','rolling','unknown')),
  constraint confidence_range check (confidence >= 0 and confidence <= 1)
);

-- The dashboard's default view is "open calls, soonest deadline first".
create index if not exists opportunities_deadline_idx
  on opportunities (deadline asc nulls last) where status <> 'closed';
create index if not exists opportunities_source_idx on opportunities (source);
create index if not exists opportunities_disciplines_idx on opportunities using gin (disciplines);
-- Trigram index backs the free-text search box without a separate search service.
create index if not exists opportunities_search_idx
  on opportunities using gin ((title || ' ' || funder || ' ' || summary) gin_trgm_ops);

create table if not exists profiles (
  id           text primary key,
  name         text   not null,
  disciplines  text[] not null default '{}',
  keywords     text[] not null default '{}',
  career_stage text   not null default 'early-career',
  country      text   not null default 'PK',
  min_award    numeric
);

create table if not exists matches (
  opportunity_id text        not null references opportunities(id) on delete cascade,
  profile_id     text        not null references profiles(id) on delete cascade,
  score          real        not null,
  reasons        text[]      not null default '{}',
  scored_at      timestamptz not null default now(),
  primary key (opportunity_id, profile_id)
);
create index if not exists matches_profile_score_idx on matches (profile_id, score desc);

create table if not exists ingest_runs (
  id              text primary key,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  trigger         text        not null,
  scrape_provider text        not null,
  llm_provider    text        not null,
  pages_fetched   int         not null default 0,
  pages_skipped   int         not null default 0,
  extracted       int         not null default 0,
  rejected        int         not null default 0,
  errors          text[]      not null default '{}'
);
create index if not exists ingest_runs_started_idx on ingest_runs (started_at desc);

-- RLS: the dashboard reads with the anon key, so reads are public and every
-- write path goes through the service-role key in the ingest job.
alter table opportunities enable row level security;
alter table profiles      enable row level security;
alter table matches       enable row level security;
alter table ingest_runs   enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'opportunities' and policyname = 'public read') then
    create policy "public read" on opportunities for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'matches' and policyname = 'public read') then
    create policy "public read" on matches for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'public read') then
    create policy "public read" on profiles for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ingest_runs' and policyname = 'public read') then
    create policy "public read" on ingest_runs for select using (true);
  end if;
end $$;
