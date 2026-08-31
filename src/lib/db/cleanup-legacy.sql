-- OPTIONAL, and DESTRUCTIVE. Read this before running it.
--
-- Scout used to track research funding calls. It now tracks study records and
-- population coverage. Anyone who ran the old schema has three tables left over
-- that nothing reads any more.
--
-- Running this permanently deletes those three tables and everything in them.
-- It does NOT touch `studies`, `gaps` or `ingest_runs`, which are the tables the
-- current app uses.
--
-- Skip it if you are unsure. Stale tables cost nothing and break nothing. The
-- only reason to run it is so `check.sql` shows a clean list.

drop table if exists matches cascade;
drop table if exists profiles cascade;
drop table if exists opportunities cascade;
