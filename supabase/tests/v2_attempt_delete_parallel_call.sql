\set ON_ERROR_STOP on
begin;
set role service_role;
select public.lock_v2_user_mutation('93939393-9393-4939-8939-939393939393');
select pg_sleep(0.35);
select public.persist_v2_attempt_v4(
  '93939393-9393-4939-8939-939393939393',
  (select id from public.program_session_items where user_id='93939393-9393-4939-8939-939393939393' and position=1),
  '90909090-9090-4090-8090-909090909090',repeat('6',64),0,
  (select id from public.assessment_tickets where user_id='93939393-9393-4939-8939-939393939393' and status='issued'),
  '91919191-9191-4919-8919-919191919191',repeat('a',64),
  now()-interval '3 seconds',now()-interval '4 seconds',now()-interval '2 seconds',now(),now(),
  current_date,'UTC','azure','en-US',null,'validation-race','server_normalized',false,true,
  null,'t',null,'measured',null,'{}','{"recognitionStatus":"Success"}',null,null
);
commit;
