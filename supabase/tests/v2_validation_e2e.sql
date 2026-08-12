\set ON_ERROR_STOP on

begin;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values(
  'a1313131-a131-4131-8131-a13131313131','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','validation-e2e@example.test','',now(),'{}','{}',now(),now()
),(
  'b1313131-b131-4131-8131-b13131313131','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','review-e2e@example.test','',now(),'{}','{}',now(),now()
);

set local role service_role;

insert into public.content_versions(
  id,stable_release_id,version,assessment_locale,coaching_locale,status,
  manifest_sha256,release_channel,validation_only
) values (
  'c1313131-c131-4131-8131-c13131313131','development-validation-r-l',1,
  'en-US','ja-JP','draft',repeat('a',64),'development_validation',true
);

insert into public.content_versions(
  id,stable_release_id,version,assessment_locale,coaching_locale,status,
  linguistic_reviewed_at,azure_validated_at,activated_at,manifest_sha256
) values (
  'd1313131-d131-4131-8131-d13131313131','review-e2e',1,'en-US','ja-JP','active',
  now(),now(),now(),repeat('9',64)
);

insert into public.v2_validation_content_access(user_id,content_version_id,installation_sha256)
values(
  'a1313131-a131-4131-8131-a13131313131',
  'c1313131-c131-4131-8131-c13131313131',repeat('b',64)
);

do $$
declare result jsonb; v_session uuid;
  items jsonb := '[
    {"position":1,"slotRole":"anchor","promptRole":"anchor","practiceItemKey":"validation-light-anchor","focusGroupKey":"r-l","selectionReason":"standard","required":true,"referenceText":"light","referenceTextVersion":"seed-word-l-001","expectedFocusRepresentation":"l","targetLocator":{"wordIndex":0,"phonemeIndex":0},"nextActionKey":"l_to_r","adviceVersion":1,"coachText":"舌先を上の歯ぐきに一度当ててから声を出します。","referenceAudioStandardUrl":"/validation-audio/r-l/light.standard.wav","referenceAudioSlowUrl":"/validation-audio/r-l/light.slow.wav","referenceAudioVersion":"validation-v1","referenceAudioManifestSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
    {"position":2,"slotRole":"contrast","promptRole":"contrast","practiceItemKey":"validation-right-contrast","focusGroupKey":"r-l","selectionReason":"standard","required":true,"referenceText":"right","referenceTextVersion":"seed-word-r-001","expectedFocusRepresentation":"r","targetLocator":{"wordIndex":0,"phonemeIndex":0}},
    {"position":3,"slotRole":"transfer_word","promptRole":"transfer_word","practiceItemKey":"validation-light-transfer","focusGroupKey":"r-l","selectionReason":"standard","required":true,"referenceText":"light","referenceTextVersion":"seed-word-l-001","expectedFocusRepresentation":"l","targetLocator":{"wordIndex":0,"phonemeIndex":0}},
    {"position":4,"slotRole":"sentence","promptRole":"sentence","practiceItemKey":"validation-read-sentence","focusGroupKey":"r-l","selectionReason":"standard","required":true,"referenceText":"I read it again.","referenceTextVersion":"seed-sent-r-001","expectedFocusRepresentation":"r","targetLocator":{"wordIndex":1,"phonemeIndex":0}},
    {"position":5,"slotRole":"review","promptRole":"transfer_word","practiceItemKey":"validation-right-review-substitute","focusGroupKey":"r-l","selectionReason":"review_substitute_transfer_word","required":true,"referenceText":"right","referenceTextVersion":"seed-word-r-001","expectedFocusRepresentation":"r","targetLocator":{"wordIndex":0,"phonemeIndex":0}},
    {"position":6,"slotRole":"optional_extension","promptRole":"optional_extension","practiceItemKey":"validation-light-optional","focusGroupKey":"r-l","selectionReason":"optional_extension","required":false,"referenceText":"light","referenceTextVersion":"seed-word-l-001","expectedFocusRepresentation":"l","targetLocator":{"wordIndex":0,"phonemeIndex":0}},
    {"position":7,"slotRole":"optional_extension","promptRole":"optional_extension","practiceItemKey":"validation-right-optional","focusGroupKey":"r-l","selectionReason":"optional_extension","required":false,"referenceText":"right","referenceTextVersion":"seed-word-r-001","expectedFocusRepresentation":"r","targetLocator":{"wordIndex":0,"phonemeIndex":0}}
  ]'::jsonb;
begin
  result:=public.create_v2_validation_daily_session_secure_v2(
    'a1313131-a131-4131-8131-a13131313131','UTC','2026-08-13',
    'c1313131-c131-4131-8131-c13131313131','r-l',repeat('c',64),items,
    'development-validation-r-l:1',null,'2026-08-13T01:00:00Z',repeat('b',64)
  );
  v_session:=(result->>'session_id')::uuid;
  if (select count(*) from public.program_session_items where session_id=v_session and is_required)<>5
    or (select count(*) from public.program_session_items where session_id=v_session and not is_required)<>2
    or not exists(
      select 1 from public.program_session_items where session_id=v_session and position=5
        and slot_role='review' and prompt_role='transfer_word'
        and selection_reason='review_substitute_transfer_word'
        and review_schedule_id is null and review_due_date is null
    )
    or not exists(
      select 1 from public.program_session_items where session_id=v_session and position=1
        and coach_text is not null
        and reference_audio_standard_url='/validation-audio/r-l/light.standard.wav'
        and reference_audio_slow_url='/validation-audio/r-l/light.slow.wav'
    )
  then raise exception 'validation E2E managed item snapshot failed'; end if;

  begin
    perform public.assert_v2_validation_installation(
      'a1313131-a131-4131-8131-a13131313131',v_session,repeat('d',64),'2026-08-13T01:00:00Z'
    );
    raise exception 'wrong validation installation was accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'VALIDATION_TESTER_NOT_ALLOWED' then raise; end if;
  end;
end;
$$;

do $$
declare enrollment_id uuid; session_id uuid; basis_item uuid; review_item uuid;
  basis_attempt uuid; review_attempt uuid; evidence_id uuid; schedule_id uuid; result jsonb;
begin
  insert into public.program_enrollments(user_id,program_version)
    values('b1313131-b131-4131-8131-b13131313131','review-e2e:1') returning id into enrollment_id;
  insert into public.learning_deletion_epochs(user_id,current_epoch)
    values('b1313131-b131-4131-8131-b13131313131',0);
  insert into public.program_day_sessions(
    user_id,enrollment_id,learning_day_sequence,originating_calendar_date,timezone,
    content_version_id,focus_group_key,status,required_item_count,optional_item_count,
    current_position,started_at,review_effective_calendar_date
  ) values (
    'b1313131-b131-4131-8131-b13131313131',enrollment_id,1,'2026-08-10','UTC',
    'd1313131-d131-4131-8131-d13131313131','r-l','in_progress',5,0,1,
    '2026-08-10T01:00:00Z','2026-08-10'
  ) returning id into session_id;
  insert into public.program_session_items(
    user_id,session_id,position,content_version_id,practice_item_key,focus_group_key,
    prompt_role,slot_role,selection_reason,is_required,status,reference_text,
    reference_text_version,expected_focus_representation,target_locator
  ) values (
    'b1313131-b131-4131-8131-b13131313131',session_id,1,
    'd1313131-d131-4131-8131-d13131313131','basis-light','r-l','anchor','anchor',
    'standard',true,'planned','light','v1','l','{"wordIndex":0,"phonemeIndex":0}'
  ) returning id into basis_item;
  insert into public.learning_attempts(
    user_id,session_id,session_item_id,client_attempt_id,payload_sha256,content_version_id,
    practice_item_key,focus_group_key,prompt_role,attempt_role,attempt_sequence,
    valid_attempt_ordinal,attempted_at,attempted_calendar_date,timezone,technical_valid,
    provider,assessment_locale,normalizer_version,server_verified,normalization_status,provider_attested
  ) values (
    'b1313131-b131-4131-8131-b13131313131',session_id,basis_item,gen_random_uuid(),repeat('8',64),
    'd1313131-d131-4131-8131-d13131313131','basis-light','r-l','anchor','cold',1,1,
    '2026-08-10T01:01:00Z','2026-08-10','UTC',true,'azure','en-US','e2e',true,
    'server_normalized',false
  ) returning id into basis_attempt;
  insert into public.focus_evidence(
    user_id,focus_group_key,evidence_kind,source_attempt_id,evidence_calendar_date,
    prompt_role,prompt_context,assisted,content_version_id,server_verified,normalization_status
  ) values (
    'b1313131-b131-4131-8131-b13131313131','r-l','discovered',basis_attempt,'2026-08-10',
    'anchor','managed_prompt',false,'d1313131-d131-4131-8131-d13131313131',true,'server_normalized'
  ) returning id into evidence_id;
  insert into public.review_schedules(
    user_id,focus_group_key,interval_kind,based_on_evidence_id,based_on_calendar_date,
    review_due_date,status
  ) values (
    'b1313131-b131-4131-8131-b13131313131','r-l','day_3',evidence_id,'2026-08-10',
    '2026-08-13','due'
  ) returning id into schedule_id;
  insert into public.program_session_items(
    user_id,session_id,position,content_version_id,practice_item_key,focus_group_key,
    prompt_role,slot_role,selection_reason,is_required,review_source_evidence_id,
    review_due_date,review_schedule_id,review_interval_kind,status,reference_text,
    reference_text_version,expected_focus_representation,target_locator
  ) values (
    'b1313131-b131-4131-8131-b13131313131',session_id,2,
    'd1313131-d131-4131-8131-d13131313131','review-light','r-l','review','review',
    'due_review',true,evidence_id,'2026-08-13',schedule_id,'day_3','planned','light','v1','l',
    '{"wordIndex":0,"phonemeIndex":0}'
  ) returning id into review_item;
  insert into public.learning_attempts(
    user_id,session_id,session_item_id,client_attempt_id,payload_sha256,content_version_id,
    practice_item_key,focus_group_key,prompt_role,attempt_role,attempt_sequence,
    valid_attempt_ordinal,attempted_at,attempted_calendar_date,timezone,technical_valid,
    provider,assessment_locale,normalizer_version,server_verified,normalization_status,provider_attested
  ) values (
    'b1313131-b131-4131-8131-b13131313131',session_id,review_item,gen_random_uuid(),repeat('7',64),
    'd1313131-d131-4131-8131-d13131313131','review-light','r-l','review','review',1,1,
    '2026-08-13T01:01:00Z','2026-08-13','UTC',true,'azure','en-US','e2e',true,
    'server_normalized',false
  ) returning id into review_attempt;

  result:=public.complete_v2_review_submission_v3(
    'b1313131-b131-4131-8131-b13131313131',schedule_id,review_item,review_attempt,0,
    'e1313131-e131-4131-8131-e13131313131','2026-08-13T01:02:00Z','2026-08-13'
  );
  if result->>'schedule_status'<>'completed'
    or not exists(
      select 1 from public.review_schedules s
      join public.review_completion_receipts r on r.id=s.completion_receipt_id and r.user_id=s.user_id
      where s.id=schedule_id and s.status='completed' and s.completion_evidence_id is null
        and r.attempt_id=review_attempt and r.completed_calendar_date='2026-08-13'
    )
  then raise exception 'review completion did not bind the actual receipt/attempt'; end if;
  if not (public.complete_v2_review_submission_v3(
    'b1313131-b131-4131-8131-b13131313131',schedule_id,review_item,review_attempt,0,
    'e1313131-e131-4131-8131-e13131313131','2026-08-13T01:02:00Z','2026-08-13'
  )->>'replayed')::boolean then raise exception 'review completion replay failed'; end if;
end;
$$;

do $$
declare first_result jsonb; second_result jsonb; replay_result jsonb;
begin
  first_result:=public.delete_v2_learning_data_atomic_v2(
    'a1313131-a131-4131-8131-a13131313131',
    'f1313131-f131-4131-8131-f13131313131',0,'2026-08-13T02:00:00Z'
  );
  second_result:=public.delete_v2_learning_data_atomic_v2(
    'a1313131-a131-4131-8131-a13131313131',
    'f2323232-f232-4232-8232-f23232323232',1,'2026-08-13T02:01:00Z'
  );
  replay_result:=public.delete_v2_learning_data_atomic_v2(
    'a1313131-a131-4131-8131-a13131313131',
    'f1313131-f131-4131-8131-f13131313131',0,'2026-08-13T02:02:00Z'
  );
  if (first_result->>'canonical_deletion_epoch')::bigint<>1
    or (second_result->>'canonical_deletion_epoch')::bigint<>2
    or (replay_result->>'canonical_deletion_epoch')::bigint<>2
    or (replay_result->>'request_resulting_epoch')::bigint<>1
    or not (replay_result->>'superseded')::boolean
    or (select current_epoch from public.learning_deletion_epochs
      where user_id='a1313131-a131-4131-8131-a13131313131')<>2
  then raise exception 'stale delete replay decreased or obscured the canonical epoch'; end if;
end;
$$;

reset role;
set local role authenticated;
set local request.jwt.claim.sub='a1313131-a131-4131-8131-a13131313131';

do $$
begin
  if has_function_privilege('authenticated',
    'public.issue_v2_assessment_ticket_v4(uuid,uuid,uuid,text,text,bigint,integer,integer,integer,integer,timestamp with time zone,text,text)','EXECUTE')
    or has_function_privilege('anon',
    'public.persist_v2_attempt_v4(uuid,uuid,uuid,text,bigint,uuid,uuid,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,date,text,text,text,text,text,text,boolean,boolean,text,text,numeric,text,text,jsonb,jsonb,text,text)','EXECUTE')
    or has_function_privilege('authenticated',
    'public.create_v2_validation_daily_session_secure_v2(uuid,text,date,uuid,text,text,jsonb,text,text,timestamp with time zone,text)','EXECUTE')
  then raise exception 'S6-08.2 protected RPC leaked to client role'; end if;
end;
$$;

rollback;
