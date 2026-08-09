\set ON_ERROR_STOP on
set role service_role;
select public.persist_v2_attempt(
  'a9090909-9090-4909-8909-909090909090',
  (select id from public.program_day_sessions where user_id = 'a9090909-9090-4909-8909-909090909090' and status in ('planned', 'in_progress')),
  (select id from public.program_session_items where user_id = 'a9090909-9090-4909-8909-909090909090' and position = 1),
  'e9090909-9090-4909-8909-909090909090', repeat('9', 64), 0,
  'cold', null, now(), current_date, 'UTC', 'azure', 'en-US', null,
  'azure-en-us-focus-v1', true, null, 's', 46, 'measured', null,
  '{"targetScore":true,"observedCandidate":true}', '{"recognitionStatus":"Success"}'
);
reset role;
