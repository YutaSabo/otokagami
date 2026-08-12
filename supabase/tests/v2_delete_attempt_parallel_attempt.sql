\set ON_ERROR_STOP on
set role service_role;
do $$
begin
  begin
    perform public.persist_v2_attempt_v4(
      '95959595-9595-4959-8959-959595959595',
      (select id from public.program_session_items where user_id='95959595-9595-4959-8959-959595959595' and position=1),
      '98989898-9898-4989-8989-989898989898',repeat('5',64),0,
      (select id from public.assessment_tickets where user_id='95959595-9595-4959-8959-959595959595' and status='issued'),
      '92929292-9292-4929-8929-929292929292',repeat('b',64),
      now()-interval '3 seconds',now()-interval '4 seconds',now()-interval '2 seconds',now(),now(),
      current_date,'UTC','azure','en-US',null,'validation-race','server_normalized',false,true,
      null,'t',null,'measured',null,'{}','{"recognitionStatus":"Success"}',null,null
    );
    raise exception 'stale attempt unexpectedly persisted after delete';
  exception when serialization_failure then
    if sqlerrm<>'DELETION_EPOCH_CONFLICT' then raise; end if;
  end;
end;
$$;
reset role;
