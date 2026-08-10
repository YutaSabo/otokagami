\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '81818181-8181-4818-8818-818181818181','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s608@example.test','',now(),'{}','{}',now(),now()
);

insert into public.profiles(user_id,anon_public_id,timezone)
values('81818181-8181-4818-8818-818181818181','s608-public','UTC');
insert into public.installations(device_install_id_hash,user_id)
values(repeat('1',64),'81818181-8181-4818-8818-818181818181');
insert into public.subscriptions(
  user_id,revenuecat_app_user_id,entitlement_id,product_id,status,is_active,raw_event
) values (
  '81818181-8181-4818-8818-818181818181','81818181-8181-4818-8818-818181818181',
  'pro','s608-product','active',true,'{"serviceOnly":"must-not-export"}'
);
insert into public.content_versions(
  id,stable_release_id,version,assessment_locale,coaching_locale,status,
  linguistic_reviewed_at,azure_validated_at,activated_at,manifest_sha256
) values (
  '82828282-8282-4828-8828-828282828282','s608-lifecycle',1,'en-US','ja-JP','active',
  now(),now(),now(),repeat('2',64)
);

set local role service_role;

do $$
declare
  session_result jsonb;
  ticket_result jsonb;
  attempt_result jsonb;
  export_result jsonb;
  delete_result jsonb;
  replay_result jsonb;
  v_session_id uuid;
  item_id uuid;
  attempt_id uuid;
  evidence_id uuid;
  schedule_id uuid;
  preserved_trial_started timestamptz;
  items jsonb := '[
    {"position":1,"slotRole":"anchor","promptRole":"anchor","practiceItemKey":"s608-1","focusGroupKey":"s608-focus","selectionReason":"standard","required":true,"referenceText":"think","referenceTextVersion":"v1","expectedFocusRepresentation":"θ","targetLocator":{"wordIndex":0,"phonemeIndex":0},"nextActionKey":"tongue-forward","adviceVersion":1},
    {"position":2,"slotRole":"contrast","promptRole":"contrast","practiceItemKey":"s608-2","focusGroupKey":"s608-focus","selectionReason":"standard","required":true,"referenceText":"sink","referenceTextVersion":"v1","expectedFocusRepresentation":"s","targetLocator":{"wordIndex":0,"phonemeIndex":0}},
    {"position":3,"slotRole":"transfer_word","promptRole":"transfer_word","practiceItemKey":"s608-3","focusGroupKey":"s608-focus","selectionReason":"standard","required":true,"referenceText":"thought","referenceTextVersion":"v1","expectedFocusRepresentation":"θ","targetLocator":{"wordIndex":0,"phonemeIndex":0}},
    {"position":4,"slotRole":"sentence","promptRole":"sentence","practiceItemKey":"s608-4","focusGroupKey":"s608-focus","selectionReason":"standard","required":true,"referenceText":"Think now","referenceTextVersion":"v1","expectedFocusRepresentation":"θ","targetLocator":{"wordIndex":0,"phonemeIndex":0}},
    {"position":5,"slotRole":"practical_sentence","promptRole":"practical_sentence","practiceItemKey":"s608-5","focusGroupKey":"s608-focus","selectionReason":"standard","required":true,"referenceText":"I think so","referenceTextVersion":"v1","expectedFocusRepresentation":"θ","targetLocator":{"wordIndex":1,"phonemeIndex":0}}
  ]'::jsonb;
begin
  session_result:=public.create_v2_daily_session_secure(
    '81818181-8181-4818-8818-818181818181','UTC','2026-08-10',
    '82828282-8282-4828-8828-828282828282','s608-focus',repeat('3',64),items,
    's608-lifecycle:1',null,'2026-08-10T01:00:00Z'
  );
  v_session_id:=(session_result->>'session_id')::uuid;
  select id into item_id from public.program_session_items where session_id=v_session_id and position=1;

  ticket_result:=public.issue_v2_assessment_ticket_v2(
    '81818181-8181-4818-8818-818181818181',item_id,'initial',repeat('4',64),0,
    300,3600,60,3,'2026-08-10T01:01:00Z',null
  );
  attempt_result:=public.persist_v2_attempt_v2(
    '81818181-8181-4818-8818-818181818181',item_id,
    '83838383-8383-4838-8838-838383838383',repeat('5',64),0,
    (ticket_result->>'ticket_id')::uuid,repeat('4',64),
    '2026-08-10T01:02:00Z','2026-08-10T01:03:00Z','2026-08-10T01:02:00Z',
    '2026-08-10','UTC','azure','en-US',null,'azure-en-us-focus-v2',
    'server_normalized',false,true,null,'θ',55,'measured','tongue-forward',
    '{"targetScore":true,"observedCandidate":true}',
    '{"recognitionStatus":"Success"}',null
  );
  attempt_id:=(attempt_result->>'attempt_id')::uuid;
  select trial_started_at into preserved_trial_started from public.program_enrollments
    where user_id='81818181-8181-4818-8818-818181818181';

  insert into public.focus_evidence(
    user_id,focus_group_key,evidence_kind,source_attempt_id,evidence_calendar_date,
    prompt_role,prompt_context,assisted,content_version_id,normalization_status
  ) values (
    '81818181-8181-4818-8818-818181818181','s608-focus','discovered',attempt_id,
    '2026-08-10','anchor','managed_prompt',false,
    '82828282-8282-4828-8828-828282828282','server_normalized'
  ) returning id into evidence_id;
  insert into public.review_schedules(
    user_id,focus_group_key,interval_kind,based_on_evidence_id,based_on_calendar_date,
    review_due_date,status
  ) values (
    '81818181-8181-4818-8818-818181818181','s608-focus','day_1',evidence_id,
    '2026-08-10','2026-08-11','scheduled'
  ) returning id into schedule_id;

  -- A bound review row proves delete ordering across item -> schedule -> evidence.
  insert into public.program_session_items(
    user_id,session_id,position,content_version_id,practice_item_key,focus_group_key,
    prompt_role,is_required,review_source_evidence_id,review_due_date,status,
    slot_role,selection_reason,reference_text,reference_text_version,
    expected_focus_representation,target_locator,review_schedule_id,review_interval_kind
  ) values (
    '81818181-8181-4818-8818-818181818181',v_session_id,6,
    '82828282-8282-4828-8828-828282828282','s608-review','s608-focus',
    'review',true,evidence_id,'2026-08-11','planned','review','due_review',
    'think again','v1','θ','{"wordIndex":0,"phonemeIndex":0}',schedule_id,'day_1'
  );

  export_result:=public.export_v2_learning_data_snapshot(
    '81818181-8181-4818-8818-818181818181',1048576,'2026-08-10T01:04:00Z'
  );
  if (export_result->>'schema_version')<>'otokagami-learning-export-v2'
    or (export_result->>'export_bytes')::integer<=0
    or export_result::text ~* '(nonce|payload_sha256|assessment_ticket|serviceOnly|authorization|raw_azure|file_uri|audio_base64)'
  then raise exception 'S6-08 snapshot export redaction failed'; end if;
  begin
    perform public.export_v2_learning_data_snapshot(
      '81818181-8181-4818-8818-818181818181',16,'2026-08-10T01:04:00Z'
    );
    raise exception 'undersized export limit was accepted';
  exception when program_limit_exceeded then
    if sqlerrm<>'EXPORT_SIZE_LIMIT_EXCEEDED' then raise; end if;
  end;

  delete_result:=public.delete_v2_learning_data_atomic(
    '81818181-8181-4818-8818-818181818181',
    '84848484-8484-4848-8848-848484848484',0,'2026-08-10T01:05:00Z'
  );
  if (delete_result->>'resulting_epoch')::bigint<>1
    or coalesce((delete_result->>'replayed')::boolean,true)
  then raise exception 'atomic delete result was invalid'; end if;

  if not exists(select 1 from public.profiles where user_id='81818181-8181-4818-8818-818181818181')
    or not exists(select 1 from public.installations where user_id='81818181-8181-4818-8818-818181818181')
    or not exists(select 1 from public.subscriptions where user_id='81818181-8181-4818-8818-818181818181')
    or not exists(select 1 from public.program_enrollments where user_id='81818181-8181-4818-8818-818181818181'
      and trial_grant_consumed and trial_started_at=preserved_trial_started)
    or not exists(select 1 from public.learning_deletion_epochs where user_id='81818181-8181-4818-8818-818181818181'
      and current_epoch=1)
    or not exists(select 1 from public.learning_deletion_requests where request_id='84848484-8484-4848-8848-848484848484')
  then raise exception 'atomic delete removed preserved identity/access/trial ledgers'; end if;

  if exists(select 1 from public.program_day_sessions where user_id='81818181-8181-4818-8818-818181818181')
    or exists(select 1 from public.program_session_items where user_id='81818181-8181-4818-8818-818181818181')
    or exists(select 1 from public.learning_attempts where user_id='81818181-8181-4818-8818-818181818181')
    or exists(select 1 from public.focus_evidence where user_id='81818181-8181-4818-8818-818181818181')
    or exists(select 1 from public.review_schedules where user_id='81818181-8181-4818-8818-818181818181')
  then raise exception 'atomic delete left v2 learning data'; end if;

  replay_result:=public.delete_v2_learning_data_atomic(
    '81818181-8181-4818-8818-818181818181',
    '84848484-8484-4848-8848-848484848484',0,'2026-08-10T01:06:00Z'
  );
  if not (replay_result->>'replayed')::boolean
    or (replay_result->>'resulting_epoch')::bigint<>1
  then raise exception 'delete replay advanced epoch or changed result'; end if;

  begin
    insert into public.daily_sessions(user_id,session_date,timezone)
    values('81818181-8181-4818-8818-818181818181','2026-08-12','UTC');
    raise exception 'legacy delayed write resurrected deleted learning data';
  exception when insufficient_privilege then
    if sqlerrm<>'LEGACY_LEARNING_WRITE_AFTER_DELETION_FORBIDDEN' then raise; end if;
  end;
end;
$$;

reset role;

do $$
begin
  if not exists(select 1 from auth.users where id='81818181-8181-4818-8818-818181818181') then
    raise exception 'atomic delete removed auth identity';
  end if;
end;
$$;

do $$
begin
  if has_function_privilege('authenticated','public.delete_v2_learning_data_atomic(uuid,uuid,bigint,timestamp with time zone)','EXECUTE')
    or has_function_privilege('anon','public.export_v2_learning_data_snapshot(uuid,integer,timestamp with time zone)','EXECUTE')
    or has_table_privilege('authenticated','public.learning_deletion_requests','SELECT')
  then raise exception 'S6-08 client privilege boundary failed'; end if;
end;
$$;

rollback;
