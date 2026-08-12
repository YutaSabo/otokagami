\set ON_ERROR_STOP on

begin;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('81818181-8181-4818-8818-818181818181','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','validation-a@example.test','',now(),'{}','{}',now(),now()),
  ('82828282-8282-4828-8828-828282828282','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','validation-b@example.test','',now(),'{}','{}',now(),now());

set local role service_role;

insert into public.content_versions(
  id,stable_release_id,version,assessment_locale,coaching_locale,status,
  manifest_sha256,release_channel,validation_only
) values (
  '83838383-8383-4838-8838-838383838383','development-validation-r-l',1,
  'en-US','ja-JP','draft',repeat('a',64),'development_validation',true
);

insert into public.v2_validation_content_access(user_id,content_version_id,installation_sha256)
values(
  '81818181-8181-4818-8818-818181818181',
  '83838383-8383-4838-8838-838383838383',repeat('b',64)
);

do $$
declare result jsonb; v_session_id uuid;
  items jsonb := '[
    {"position":1,"slotRole":"anchor","promptRole":"anchor","practiceItemKey":"validation-light-anchor","focusGroupKey":"r-l","selectionReason":"standard","required":true,"referenceText":"light","referenceTextVersion":"seed-word-l-001","expectedFocusRepresentation":"l","targetLocator":{"wordIndex":0,"phonemeIndex":0}},
    {"position":2,"slotRole":"contrast","promptRole":"contrast","practiceItemKey":"validation-right-contrast","focusGroupKey":"r-l","selectionReason":"standard","required":true,"referenceText":"right","referenceTextVersion":"seed-word-r-001","expectedFocusRepresentation":"r","targetLocator":{"wordIndex":0,"phonemeIndex":0}},
    {"position":3,"slotRole":"transfer_word","promptRole":"transfer_word","practiceItemKey":"validation-light-transfer","focusGroupKey":"r-l","selectionReason":"standard","required":true,"referenceText":"light","referenceTextVersion":"seed-word-l-001","expectedFocusRepresentation":"l","targetLocator":{"wordIndex":0,"phonemeIndex":0}},
    {"position":4,"slotRole":"sentence","promptRole":"sentence","practiceItemKey":"validation-read-sentence","focusGroupKey":"r-l","selectionReason":"standard","required":true,"referenceText":"I read it again.","referenceTextVersion":"seed-sent-r-001","expectedFocusRepresentation":"r","targetLocator":{"wordIndex":1,"phonemeIndex":0}},
    {"position":5,"slotRole":"transfer_word","promptRole":"transfer_word","practiceItemKey":"validation-right-substitute","focusGroupKey":"r-l","selectionReason":"review_substitute_transfer_word","required":true,"referenceText":"right","referenceTextVersion":"seed-word-r-001","expectedFocusRepresentation":"r","targetLocator":{"wordIndex":0,"phonemeIndex":0}},
    {"position":6,"slotRole":"optional_extension","promptRole":"optional_extension","practiceItemKey":"validation-light-optional","focusGroupKey":"r-l","selectionReason":"optional_extension","required":false,"referenceText":"light","referenceTextVersion":"seed-word-l-001","expectedFocusRepresentation":"l","targetLocator":{"wordIndex":0,"phonemeIndex":0}},
    {"position":7,"slotRole":"optional_extension","promptRole":"optional_extension","practiceItemKey":"validation-right-optional","focusGroupKey":"r-l","selectionReason":"optional_extension","required":false,"referenceText":"right","referenceTextVersion":"seed-word-r-001","expectedFocusRepresentation":"r","targetLocator":{"wordIndex":0,"phonemeIndex":0}}
  ]'::jsonb;
begin
  result:=public.create_v2_validation_daily_session_secure(
    '81818181-8181-4818-8818-818181818181','UTC','2026-08-12',
    '83838383-8383-4838-8838-838383838383','r-l',repeat('c',64),items,
    'development-validation-r-l:1',null,'2026-08-12T01:00:00Z',repeat('b',64)
  );
  v_session_id:=(result->>'session_id')::uuid;
  if not (result->>'validation_only')::boolean
    or not (select validation_only and trial_program_day is null from public.program_day_sessions where id=v_session_id)
    or (select count(*) from public.program_session_items where session_id=v_session_id)<>7
    or (select trial_grant_consumed or trial_started_at is not null or completed_program_days<>0
        from public.program_enrollments where user_id='81818181-8181-4818-8818-818181818181')
  then raise exception 'validation session escaped trial/content isolation'; end if;

  if not (public.create_v2_validation_daily_session_secure(
    '81818181-8181-4818-8818-818181818181','UTC','2026-08-12',
    '83838383-8383-4838-8838-838383838383','r-l',repeat('c',64),items,
    'development-validation-r-l:1',null,'2026-08-12T01:00:00Z',repeat('b',64)
  )->>'replayed')::boolean then raise exception 'validation session replay failed'; end if;

  perform set_config('app.v2_trusted_command','on',true);
  insert into public.learning_attempts(
    user_id,session_id,session_item_id,client_attempt_id,payload_sha256,content_version_id,
    practice_item_key,focus_group_key,prompt_role,attempt_role,attempt_sequence,
    valid_attempt_ordinal,attempted_at,attempted_calendar_date,timezone,technical_valid,
    provider,assessment_locale,normalizer_version,normalization_status,provider_attested
  )
  select i.user_id,i.session_id,i.id,gen_random_uuid(),repeat('e',64),i.content_version_id,
    i.practice_item_key,i.focus_group_key,i.prompt_role,
    case when i.prompt_role in ('transfer_word','sentence','practical_sentence') then 'transfer' else 'cold' end,
    1,1,'2026-08-12T01:01:00Z','2026-08-12','UTC',true,
    'azure','en-US','validation-test','server_normalized',false
  from public.program_session_items i where i.session_id=v_session_id and i.is_required;
  update public.program_session_items set status='completed',completion_reason='completed',
    completed_at='2026-08-12T01:01:00Z' where session_id=v_session_id and is_required;
  update public.program_day_sessions set status='in_progress',started_at='2026-08-12T01:00:00Z',
    current_position=5 where id=v_session_id;
  perform set_config('app.v2_trusted_command','off',true);

  result:=public.complete_v2_validation_session_secure(
    '81818181-8181-4818-8818-818181818181',v_session_id,
    '84848484-8484-4848-8848-848484848484',repeat('f',64),
    '2026-08-12T01:02:00Z','2026-08-12'
  );
  if not (select status='completed' from public.program_day_sessions where id=v_session_id)
    or (select trial_grant_consumed or trial_started_at is not null or completed_program_days<>0
        from public.program_enrollments where user_id='81818181-8181-4818-8818-818181818181')
    or (result->>'validation_only')::boolean is not true
  then raise exception 'validation completion mutated formal learning state'; end if;
  if not (public.complete_v2_validation_session_secure(
    '81818181-8181-4818-8818-818181818181',v_session_id,
    '84848484-8484-4848-8848-848484848484',repeat('f',64),
    '2026-08-12T01:02:00Z','2026-08-12'
  )->>'replayed')::boolean then raise exception 'validation completion replay failed'; end if;

  begin
    perform public.create_v2_validation_daily_session_secure(
      '82828282-8282-4828-8828-828282828282','UTC','2026-08-12',
      '83838383-8383-4838-8838-838383838383','r-l',repeat('d',64),items,
      'development-validation-r-l:1',null,'2026-08-12T01:00:00Z',repeat('b',64)
    );
    raise exception 'user without exact validation access was accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'VALIDATION_TESTER_NOT_ALLOWED' then raise; end if;
  end;

  begin
    insert into public.learning_reports(
      user_id,report_type,idempotency_key,calendar_date_start,calendar_date_end,
      generated_content_version_id,summary
    ) values (
      '81818181-8181-4818-8818-818181818181','daily',gen_random_uuid(),
      '2026-08-12','2026-08-12','83838383-8383-4838-8838-838383838383','{}'
    );
    raise exception 'formal validation report was accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'V2_VALIDATION_DURABLE_DERIVATION_FORBIDDEN' then raise; end if;
  end;
end;
$$;

reset role;
set local role authenticated;
set local request.jwt.claim.sub='81818181-8181-4818-8818-818181818181';

do $$
begin
  if exists(select 1 from public.content_versions where id='83838383-8383-4838-8838-838383838383')
    or has_table_privilege('authenticated','public.v2_validation_content_access','SELECT')
  then raise exception 'validation release/access leaked through authenticated boundary'; end if;
  begin
    perform 1 from public.v2_validation_content_access;
    raise exception 'authenticated client read validation access ledger';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_v2_validation_daily_session_secure(
      '81818181-8181-4818-8818-818181818181','UTC','2026-08-12',
      '83838383-8383-4838-8838-838383838383','r-l',repeat('c',64),'[]',
      'development-validation-r-l:1',null,'2026-08-12T01:00:00Z',repeat('b',64)
    );
    raise exception 'authenticated client executed validation session RPC';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.complete_v2_validation_session_secure(
      '81818181-8181-4818-8818-818181818181','85858585-8585-4858-8858-858585858585',
      '86868686-8686-4868-8868-868686868686',repeat('f',64),
      '2026-08-12T01:02:00Z','2026-08-12'
    );
    raise exception 'authenticated client executed validation completion RPC';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
