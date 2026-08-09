\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

select 'auth_users|' || count(*) from auth.users;
select 'public_tables|' || count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE';
select 'policies|' || count(*) from pg_policies where schemaname = 'public';
select 'policy_digest|' || md5(string_agg(tablename || ':' || policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), E'\n' order by tablename, policyname))
from pg_policies where schemaname = 'public';
select format('select %L || ''|'' || count(*) from %I.%I;', table_name, table_schema, table_name)
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name
\gexec
select 'v2_runtime_rows|' || (
  (select count(*) from public.program_enrollments)
  + (select count(*) from public.content_versions)
  + (select count(*) from public.learning_deletion_epochs)
  + (select count(*) from public.program_day_sessions)
  + (select count(*) from public.program_session_items)
  + (select count(*) from public.learning_attempts)
  + (select count(*) from public.learning_attempt_results)
  + (select count(*) from public.focus_evidence)
  + (select count(*) from public.focus_states_v2)
  + (select count(*) from public.review_schedules)
  + (select count(*) from public.learning_reports)
);
select 'session_item_orphans|' || count(*)
from public.daily_session_items i left join public.daily_sessions s on s.id = i.daily_session_id where s.id is null;
select 'attempt_orphans|' || count(*)
from public.attempts a left join public.daily_sessions s on s.id = a.daily_session_id
where a.daily_session_id is not null and s.id is null;
select 'phoneme_result_orphans|' || count(*)
from public.attempt_phoneme_results r left join public.attempts a on a.id = r.attempt_id where a.id is null;
