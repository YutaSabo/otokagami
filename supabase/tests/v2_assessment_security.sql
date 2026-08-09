\set ON_ERROR_STOP on

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('71717171-7171-4717-8717-717171717171','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s607-a@example.test','',now(),'{}','{}',now(),now());

insert into public.content_versions(
  id,stable_release_id,version,assessment_locale,coaching_locale,status,
  linguistic_reviewed_at,azure_validated_at,activated_at,manifest_sha256
) values (
  '72727272-7272-4727-8727-727272727272','s607-security',1,'en-US','ja-JP','active',
  now(),now(),now(),repeat('a',64)
);

set local role service_role;

do $$
declare result jsonb; v_session_id uuid; item_id uuid; second_item_id uuid;
  ticket jsonb; expired_ticket jsonb; invalid_ticket jsonb; guided_ticket jsonb;
  attempt jsonb; guided_attempt jsonb;
  items jsonb := '[
    {"position":1,"slotRole":"anchor","promptRole":"anchor","practiceItemKey":"think-1","focusGroupKey":"theta","selectionReason":"standard","required":true,"referenceText":"think now","referenceTextVersion":"text-v1","expectedFocusRepresentation":"θ","targetLocator":{"wordIndex":0,"phonemeIndex":0},"nextActionKey":"tongue-forward","adviceVersion":1},
    {"position":2,"slotRole":"contrast","promptRole":"contrast","practiceItemKey":"think-2","focusGroupKey":"theta","selectionReason":"standard","required":true,"referenceText":"think now","referenceTextVersion":"text-v1","expectedFocusRepresentation":"θ","targetLocator":{"wordIndex":0,"phonemeIndex":0},"nextActionKey":"tongue-forward"},
    {"position":3,"slotRole":"transfer_word","promptRole":"transfer_word","practiceItemKey":"think-3","focusGroupKey":"theta","selectionReason":"standard","required":true,"referenceText":"think now","referenceTextVersion":"text-v1","expectedFocusRepresentation":"θ","targetLocator":{"wordIndex":0,"phonemeIndex":0},"nextActionKey":"tongue-forward"},
    {"position":4,"slotRole":"sentence","promptRole":"sentence","practiceItemKey":"think-4","focusGroupKey":"theta","selectionReason":"standard","required":true,"referenceText":"think now","referenceTextVersion":"text-v1","expectedFocusRepresentation":"θ","targetLocator":{"wordIndex":0,"phonemeIndex":0},"nextActionKey":"tongue-forward"},
    {"position":5,"slotRole":"practical_sentence","promptRole":"practical_sentence","practiceItemKey":"think-5","focusGroupKey":"theta","selectionReason":"standard","required":true,"referenceText":"think now","referenceTextVersion":"text-v1","expectedFocusRepresentation":"θ","targetLocator":{"wordIndex":0,"phonemeIndex":0},"nextActionKey":"tongue-forward"},
    {"position":6,"slotRole":"optional_extension","promptRole":"optional_extension","practiceItemKey":"think-6","focusGroupKey":"theta","selectionReason":"optional_extension","required":false,"referenceText":"think now","referenceTextVersion":"text-v1","expectedFocusRepresentation":"θ","targetLocator":{"wordIndex":0,"phonemeIndex":0},"nextActionKey":"tongue-forward"}
  ]'::jsonb;
begin
  result := public.create_v2_daily_session_secure(
    '71717171-7171-4717-8717-717171717171','UTC','2026-08-10',
    '72727272-7272-4727-8727-727272727272','theta',repeat('b',64),items,
    's607-security:1',null,'2026-08-10T01:00:00Z'
  );
  v_session_id := (result->>'session_id')::uuid;
  select id into item_id from public.program_session_items where session_id=v_session_id and position=1;
  select id into second_item_id from public.program_session_items where session_id=v_session_id and position=2;

  begin
    perform public.issue_v2_assessment_ticket(
      '71717171-7171-4717-8717-717171717171',
      (select id from public.program_session_items where session_id=v_session_id and position=6),
      'initial',repeat('c',64),0,600,60,3,'2026-08-10T01:01:00Z',null
    );
    raise exception 'optional extension was available before required completion';
  exception when check_violation then
    if sqlerrm <> 'OPTIONAL_EXTENSION_NOT_AVAILABLE' then raise; end if;
  end;

  ticket := public.issue_v2_assessment_ticket(
    '71717171-7171-4717-8717-717171717171',item_id,'initial',repeat('c',64),0,600,60,3,
    '2026-08-10T01:01:00Z',null
  );
  begin
    perform public.issue_v2_assessment_ticket(
      '71717171-7171-4717-8717-717171717171',item_id,'initial',repeat('d',64),0,600,60,3,
      '2026-08-10T01:01:01Z',null
    );
    raise exception 'multiple unconsumed tickets were accepted';
  exception when unique_violation then
    if sqlerrm <> 'UNCONSUMED_TICKET_EXISTS' then raise; end if;
  end;

  attempt := public.persist_v2_attempt_with_ticket(
    '71717171-7171-4717-8717-717171717171',item_id,
    '73737373-7373-4737-8737-737373737373',repeat('e',64),0,(ticket->>'ticket_id')::uuid,
    repeat('c',64),'2026-08-10T01:02:00Z','2026-08-10','UTC','azure','en-US',null,
    'azure-en-us-focus-v2','server_normalized',false,true,null,'θ',46,'measured',
    'tongue-forward','{"targetScore":true,"observedCandidate":true}',
    '{"recognitionStatus":"Success"}',null
  );
  if (attempt->>'attempt_role') <> 'cold' then raise exception 'attempt role was not server-derived'; end if;
  if (select server_verified or normalization_status<>'server_normalized' or provider_attested
      from public.learning_attempts where id=(attempt->>'attempt_id')::uuid)
  then raise exception 'trust state was overstated'; end if;
  if (select status <> 'consumed' from public.assessment_tickets where id=(ticket->>'ticket_id')::uuid)
  then raise exception 'ticket was not consumed'; end if;

  if (public.persist_v2_attempt_with_ticket(
    '71717171-7171-4717-8717-717171717171',item_id,
    '73737373-7373-4737-8737-737373737373',repeat('e',64),0,(ticket->>'ticket_id')::uuid,
    repeat('c',64),'2026-08-10T01:02:00Z','2026-08-10','UTC','azure','en-US',null,
    'azure-en-us-focus-v2','server_normalized',false,true,null,'θ',46,'measured',
    'tongue-forward','{"targetScore":true,"observedCandidate":true}',
    '{"recognitionStatus":"Success"}',null
  )->>'replayed')::boolean is not true then raise exception 'canonical replay failed'; end if;

  begin
    perform public.persist_v2_attempt_with_ticket(
      '71717171-7171-4717-8717-717171717171',item_id,
      '73737373-7373-4737-8737-737373737373',repeat('f',64),0,(ticket->>'ticket_id')::uuid,
      repeat('c',64),'2026-08-10T01:02:00Z','2026-08-10','UTC','azure','en-US',null,
      'azure-en-us-focus-v2','server_normalized',false,true,null,'θ',47,'measured',
      'tongue-forward','{"targetScore":true,"observedCandidate":true}',
      '{"recognitionStatus":"Success"}',null
    );
    raise exception 'changed canonical replay was accepted';
  exception when unique_violation then
    if sqlerrm <> 'IDEMPOTENCY_PAYLOAD_CONFLICT' then raise; end if;
  end;

  expired_ticket := public.issue_v2_assessment_ticket(
    '71717171-7171-4717-8717-717171717171',second_item_id,'initial',repeat('d',64),0,30,60,3,
    '2026-08-10T01:03:00Z',null
  );
  begin
    perform public.persist_v2_attempt_with_ticket(
      '71717171-7171-4717-8717-717171717171',second_item_id,
      '74747474-7474-4747-8747-747474747474',repeat('1',64),0,(expired_ticket->>'ticket_id')::uuid,
      repeat('d',64),'2026-08-10T01:04:00Z','2026-08-10','UTC','azure','en-US',null,
      'azure-en-us-focus-v2','server_normalized',false,true,null,'θ',46,'measured',null,
      '{"targetScore":true,"observedCandidate":true}','{"recognitionStatus":"Success"}',null
    );
    raise exception 'expired ticket was accepted';
  exception when insufficient_privilege then
    if sqlerrm <> 'ASSESSMENT_TICKET_INVALID' then raise; end if;
  end;
  if exists(select 1 from public.learning_attempts where client_attempt_id='74747474-7474-4747-8747-747474747474')
    or (select status from public.assessment_tickets where id=(expired_ticket->>'ticket_id')::uuid) <> 'issued'
  then raise exception 'expired attempt was partially persisted'; end if;

  invalid_ticket := public.issue_v2_assessment_ticket(
    '71717171-7171-4717-8717-717171717171',second_item_id,'initial',repeat('e',64),0,600,60,3,
    '2026-08-10T01:05:00Z',null
  );
  perform public.persist_v2_attempt_with_ticket(
    '71717171-7171-4717-8717-717171717171',second_item_id,
    '75757575-7575-4757-8757-757575757575',repeat('2',64),0,(invalid_ticket->>'ticket_id')::uuid,
    repeat('e',64),'2026-08-10T01:05:30Z','2026-08-10','UTC','azure','en-US',null,
    'azure-en-us-focus-v2','rejected',false,false,'provider_recognition_failed',null,null,
    'technical_invalid',null,'{"targetScore":false,"observedCandidate":false}',
    '{"recognitionStatus":"NoMatch"}',null
  );
  begin
    perform public.issue_v2_assessment_ticket(
      '71717171-7171-4717-8717-717171717171',second_item_id,'guided_retry',repeat('3',64),0,600,60,3,
      '2026-08-10T01:06:00Z',null
    );
    raise exception 'guided retry accepted an invalid source';
  exception when check_violation then
    if sqlerrm <> 'GUIDED_RETRY_NOT_AVAILABLE' then raise; end if;
  end;

  guided_ticket := public.issue_v2_assessment_ticket(
    '71717171-7171-4717-8717-717171717171',item_id,'guided_retry',repeat('4',64),0,600,60,3,
    '2026-08-10T01:07:00Z',null
  );
  begin
    perform public.persist_v2_attempt_with_ticket(
      '71717171-7171-4717-8717-717171717171',second_item_id,
      '76767676-7676-4767-8767-767676767676',repeat('5',64),0,(guided_ticket->>'ticket_id')::uuid,
      repeat('4',64),'2026-08-10T01:07:30Z','2026-08-10','UTC','azure','en-US',null,
      'azure-en-us-focus-v2','server_normalized',false,true,null,'θ',60,'measured',
      'tongue-forward','{"targetScore":true,"observedCandidate":true}',
      '{"recognitionStatus":"Success"}',null
    );
    raise exception 'cross-item assessment ticket was accepted';
  exception when insufficient_privilege then
    if sqlerrm <> 'ASSESSMENT_TICKET_INVALID' then raise; end if;
  end;
  guided_attempt := public.persist_v2_attempt_with_ticket(
    '71717171-7171-4717-8717-717171717171',item_id,
    '76767676-7676-4767-8767-767676767676',repeat('5',64),0,(guided_ticket->>'ticket_id')::uuid,
    repeat('4',64),'2026-08-10T01:07:30Z','2026-08-10','UTC','azure','en-US',null,
    'azure-en-us-focus-v2','server_normalized',false,true,null,'θ',60,'measured',
    'tongue-forward','{"targetScore":true,"observedCandidate":true}',
    '{"recognitionStatus":"Success"}',null
  );
  if (guided_attempt->>'attempt_role') <> 'guided_retry'
    or not exists(select 1 from public.correction_cycles where after_attempt_id=(guided_attempt->>'attempt_id')::uuid
      and immediate_change_status='inconclusive')
  then raise exception 'guided correction structure was not derived atomically'; end if;

  begin
    update public.learning_attempts set provider='changed' where id=(attempt->>'attempt_id')::uuid;
    raise exception 'direct attempt update succeeded';
  exception when others then
    if sqlerrm not in ('V2_APPEND_ONLY_ROW','V2_APPEND_ONLY_UPDATE_FORBIDDEN','V2_DIRECT_MUTATION_FORBIDDEN') then raise; end if;
  end;
  begin
    delete from public.learning_attempts where id=(attempt->>'attempt_id')::uuid;
    raise exception 'direct attempt delete succeeded';
  exception when insufficient_privilege then
    if sqlerrm <> 'V2_DIRECT_MUTATION_FORBIDDEN' then raise; end if;
  end;
  begin
    update public.correction_cycles set immediate_change_status='improved'
      where after_attempt_id=(guided_attempt->>'attempt_id')::uuid;
    raise exception 'direct correction cycle update succeeded';
  exception when insufficient_privilege then
    if sqlerrm <> 'V2_DIRECT_MUTATION_FORBIDDEN' then raise; end if;
  end;
  begin
    delete from public.learning_deletion_epochs where user_id='71717171-7171-4717-8717-717171717171';
    raise exception 'deletion epoch delete succeeded';
  exception when insufficient_privilege then
    if sqlerrm <> 'V2_DELETION_EPOCH_DELETE_FORBIDDEN' then raise; end if;
  end;
  begin
    update public.learning_deletion_epochs set current_epoch=1
      where user_id='71717171-7171-4717-8717-717171717171';
    raise exception 'direct deletion epoch update succeeded';
  exception when insufficient_privilege then
    if sqlerrm <> 'V2_DIRECT_MUTATION_FORBIDDEN' then raise; end if;
  end;
  begin
    update public.program_enrollments set day_7_report_status='pending'
      where user_id='71717171-7171-4717-8717-717171717171';
    raise exception 'direct enrollment update succeeded';
  exception when insufficient_privilege then
    if sqlerrm <> 'V2_DIRECT_MUTATION_FORBIDDEN' then raise; end if;
  end;
end;
$$;

do $$
begin
  if has_function_privilege('anon','public.issue_v2_assessment_ticket(uuid,uuid,text,text,bigint,integer,integer,integer,timestamptz,text)','EXECUTE')
    or has_function_privilege('authenticated','public.persist_v2_attempt_with_ticket(uuid,uuid,uuid,text,bigint,uuid,text,timestamptz,date,text,text,text,text,text,text,boolean,boolean,text,text,numeric,text,text,jsonb,jsonb,text)','EXECUTE')
    or has_function_privilege('service_role','public.persist_v2_attempt(uuid,uuid,uuid,uuid,text,bigint,text,uuid,timestamptz,date,text,text,text,text,text,boolean,text,text,numeric,text,text,jsonb,jsonb)','EXECUTE')
  then raise exception 'RPC privilege boundary failed'; end if;
end;
$$;

rollback;
