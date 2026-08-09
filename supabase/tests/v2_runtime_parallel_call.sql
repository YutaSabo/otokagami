\set ON_ERROR_STOP on
set role service_role;
select public.persist_v2_attempt_with_ticket(
  'a9090909-9090-4909-8909-909090909090',
  (select id from public.program_session_items where user_id='a9090909-9090-4909-8909-909090909090' and position=1),
  'e9090909-9090-4909-8909-909090909090', repeat('7',64), 0,
  (select id from public.assessment_tickets where user_id='a9090909-9090-4909-8909-909090909090' and status='issued'),
  repeat('8',64), now(), current_date, 'UTC', 'azure', 'en-US', null,
  'azure-en-us-focus-v2', 'server_normalized', false, true, null, 'θ', 46,
  'measured', null, '{"targetScore":true,"observedCandidate":true}',
  '{"recognitionStatus":"Success"}', null
);
reset role;
