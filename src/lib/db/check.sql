-- Read-only. Shows what your database currently looks like.
-- Paste into the Supabase SQL editor and Run. It changes nothing.

select
  t.table_name,
  count(c.column_name) as columns,
  string_agg(c.column_name, ', ' order by c.ordinal_position) as column_list
from information_schema.tables t
join information_schema.columns c
  on c.table_schema = t.table_schema and c.table_name = t.table_name
where t.table_schema = 'public'
group by t.table_name
order by t.table_name;

-- What you want to see afterwards:
--
--   studies       with a `condition_key` column
--   gaps
--   ingest_runs   with `llm_calls`, `input_tokens`, `output_tokens`
--
-- If you also see `opportunities`, `profiles` or `matches`, those are left over
-- from an earlier version of this project and are no longer used. They are
-- harmless, but `cleanup-legacy.sql` removes them.
