\set ON_ERROR_STOP on

begin;

insert into auth.users (instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at)
values (
  '00000000-0000-0000-0000-000000000000',
  'a7777777-7777-4777-8777-777777777777',
  'authenticated', 'authenticated', '{}', '{}', true, now(), now()
) on conflict (id) do nothing;

set local role service_role;

insert into public.content_versions(
  id, stable_release_id, version, assessment_locale, coaching_locale, status,
  linguistic_reviewed_at, azure_validated_at, activated_at, manifest_sha256
) values (
  'c7777777-7777-4777-8777-777777777777', 's6-07-rpc-test', 1, 'en-US', 'ja-JP', 'active',
  now(), now(), now(), repeat('7', 64)
);

do $$
declare
  created jsonb;
  v_session_id uuid;
  item_ids uuid[];
  first_attempt jsonb;
  replay jsonb;
  index integer;
  failed boolean;
begin
  created := public.create_v2_daily_session(
    'a7777777-7777-4777-8777-777777777777',
    'Asia/Tokyo', '2026-08-09', 'c7777777-7777-4777-8777-777777777777',
    'theta-s-t', repeat('a', 64),
    '[
      {"position":1,"slotRole":"anchor","promptRole":"anchor","practiceItemKey":"anchor-1","focusGroupKey":"theta-s-t","selectionReason":"standard","required":true,"referenceText":"think","referenceTextVersion":"v1","expectedFocusRepresentation":"θ","nextActionKey":"tongue_forward"},
      {"position":2,"slotRole":"contrast","promptRole":"contrast","practiceItemKey":"contrast-1","focusGroupKey":"theta-s-t","selectionReason":"standard","required":true,"referenceText":"sink","referenceTextVersion":"v1","expectedFocusRepresentation":"θ","nextActionKey":"tongue_forward"},
      {"position":3,"slotRole":"transfer_word","promptRole":"transfer_word","practiceItemKey":"transfer-1","focusGroupKey":"theta-s-t","selectionReason":"standard","required":true,"referenceText":"thought","referenceTextVersion":"v1","expectedFocusRepresentation":"θ","nextActionKey":"tongue_forward"},
      {"position":4,"slotRole":"sentence","promptRole":"sentence","practiceItemKey":"sentence-1","focusGroupKey":"theta-s-t","selectionReason":"standard","required":true,"referenceText":"Think about it","referenceTextVersion":"v1","expectedFocusRepresentation":"θ","nextActionKey":"tongue_forward"},
      {"position":5,"slotRole":"review","promptRole":"transfer_word","practiceItemKey":"transfer-2","focusGroupKey":"theta-s-t","selectionReason":"review_substitute_transfer_word","required":true,"referenceText":"thick","referenceTextVersion":"v1","expectedFocusRepresentation":"θ","nextActionKey":"tongue_forward"}
    ]'::jsonb,
    'otokagami-v2-mvp'
  );
  v_session_id := (created->>'session_id')::uuid;
  if (select trial_status from public.program_enrollments where user_id = 'a7777777-7777-4777-8777-777777777777') <> 'not_started' then
    raise exception 'Session creation started the trial';
  end if;
  select array_agg(id order by position) into item_ids from public.program_session_items where session_id = v_session_id;

  perform public.refresh_v2_review_slot(
    'a7777777-7777-4777-8777-777777777777', v_session_id, '2026-08-10',
    '{
      "practiceItemKey":"review-vb","focusGroupKey":"v-b","promptRole":"review",
      "selectionReason":"due_review","reviewSourceEvidenceId":null,"reviewDueDate":"2026-08-10",
      "referenceText":"very","referenceTextVersion":"v2","expectedFocusRepresentation":"v",
      "nextActionKey":"lower_lip"
    }'::jsonb
  );
  if (select focus_group_key from public.program_session_items where id = item_ids[5]) <> 'v-b'
    or (select review_effective_calendar_date from public.program_day_sessions where id = v_session_id) <> '2026-08-10'
  then raise exception 'Unstarted rollover review slot was not refreshed'; end if;

  update public.program_enrollments
  set completed_program_days = 7, current_program_day = 7, trial_status = 'day_7_completed',
      trial_started_at = '2026-08-01T00:00:00Z', last_completed_calendar_date = '2026-08-08',
      day_7_report_status = 'pending'
  where user_id = 'a7777777-7777-4777-8777-777777777777';
  failed := false;
  begin
    perform public.persist_v2_attempt(
      'a7777777-7777-4777-8777-777777777777', v_session_id, item_ids[1],
      'e7777777-7777-4777-8777-777777777770', repeat('0', 64), 0,
      'cold', null, '2026-08-09T03:00:00Z', '2026-08-09', 'Asia/Tokyo',
      'azure', 'en-US', null, 'azure-en-us-focus-v1', true, null, 's', 46,
      'measured', 'tongue_forward', '{"targetScore":true,"observedCandidate":true}',
      '{"recognitionStatus":"Success"}'
    );
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'Attempt bypassed server-side access recheck'; end if;
  update public.program_enrollments
  set completed_program_days = 0, current_program_day = 0, trial_status = 'not_started',
      trial_started_at = null, last_completed_calendar_date = null, day_7_report_status = 'not_started'
  where user_id = 'a7777777-7777-4777-8777-777777777777';

  begin
    perform public.complete_v2_program_day(
      'a7777777-7777-4777-8777-777777777777', v_session_id,
      'f7777777-7777-4777-8777-777777777777', repeat('f', 64),
      '2026-08-09T03:00:00Z', '2026-08-09'
    );
    raise exception 'Completion unexpectedly succeeded before attempts';
  exception when check_violation then
    null;
  end;
  if (select status from public.program_day_sessions where id = v_session_id) <> 'planned' then
    raise exception 'Failed completion did not roll back';
  end if;

  first_attempt := public.persist_v2_attempt(
    'a7777777-7777-4777-8777-777777777777', v_session_id, item_ids[1],
    'e7777777-7777-4777-8777-777777777771', repeat('1', 64), 0,
    'cold', null, '2026-08-09T03:01:00Z', '2026-08-09', 'Asia/Tokyo',
    'azure', 'en-US', null, 'azure-en-us-focus-v1', true, null, 's', 46,
    'measured', 'tongue_forward', '{"targetScore":true,"observedCandidate":true}',
    '{"recognitionStatus":"Success"}'
  );
  replay := public.persist_v2_attempt(
    'a7777777-7777-4777-8777-777777777777', v_session_id, item_ids[1],
    'e7777777-7777-4777-8777-777777777771', repeat('1', 64), 0,
    'cold', null, '2026-08-09T03:01:00Z', '2026-08-09', 'Asia/Tokyo',
    'azure', 'en-US', null, 'azure-en-us-focus-v1', true, null, 's', 46,
    'measured', 'tongue_forward', '{"targetScore":true,"observedCandidate":true}',
    '{"recognitionStatus":"Success"}'
  );
  if not (replay->>'replayed')::boolean or replay->>'attempt_id' <> first_attempt->>'attempt_id' then
    raise exception 'Idempotent replay did not return the canonical attempt';
  end if;

  failed := false;
  begin
    perform public.persist_v2_attempt(
      'a7777777-7777-4777-8777-777777777777', v_session_id, item_ids[1],
      'e7777777-7777-4777-8777-777777777771', repeat('2', 64), 0,
      'cold', null, '2026-08-09T03:01:00Z', '2026-08-09', 'Asia/Tokyo',
      'azure', 'en-US', null, 'azure-en-us-focus-v1', true, null, 's', 46,
      'measured', 'tongue_forward', '{"targetScore":true,"observedCandidate":true}',
      '{"recognitionStatus":"Success"}'
    );
  exception when unique_violation then failed := true;
  end;
  if not failed then raise exception 'Payload conflict was not rejected'; end if;

  perform public.persist_v2_attempt(
    'a7777777-7777-4777-8777-777777777777', v_session_id, item_ids[2],
    'e7777777-7777-4777-8777-777777777772', repeat('3', 64), 0,
    'cold', null, '2026-08-09T03:02:00Z', '2026-08-09', 'Asia/Tokyo',
    'azure', 'en-US', null, 'azure-en-us-focus-v1', false, 'no_match', null, null,
    'technical_invalid', 'tongue_forward', '{"targetScore":false,"observedCandidate":false}',
    '{"recognitionStatus":"NoMatch"}'
  );
  if exists (
    select 1 from public.learning_attempts
    where client_attempt_id = 'e7777777-7777-4777-8777-777777777772' and valid_attempt_ordinal is not null
  ) then raise exception 'Invalid attempt consumed a valid ordinal'; end if;

  for index in 2..5 loop
    perform public.persist_v2_attempt(
      'a7777777-7777-4777-8777-777777777777', v_session_id, item_ids[index],
      ('a8888888-8888-4888-8888-88888888888' || index)::uuid, repeat(index::text, 64), 0,
      case when index = 3 then 'transfer' when index = 5 then 'review' else 'cold' end,
      null, ('2026-08-09T03:0' || (index + 1) || ':00Z')::timestamptz,
      '2026-08-09', 'Asia/Tokyo', 'azure', 'en-US', null, 'azure-en-us-focus-v1',
      true, null, 's', 46, 'measured', 'tongue_forward',
      '{"targetScore":true,"observedCandidate":true}', '{"recognitionStatus":"Success"}'
    );
  end loop;

  perform public.refresh_v2_review_slot(
    'a7777777-7777-4777-8777-777777777777', v_session_id, '2026-08-11',
    '{
      "practiceItemKey":"review-should-not-replace","focusGroupKey":"i-long-i","promptRole":"review",
      "selectionReason":"due_review","reviewSourceEvidenceId":null,"reviewDueDate":"2026-08-11",
      "referenceText":"sit","referenceTextVersion":"v2","expectedFocusRepresentation":"ɪ",
      "nextActionKey":null
    }'::jsonb
  );
  if (select practice_item_key from public.program_session_items where id = item_ids[5]) <> 'review-vb' then
    raise exception 'Started review slot was replaced';
  end if;

  perform public.complete_v2_program_day(
    'a7777777-7777-4777-8777-777777777777', v_session_id,
    'f7777777-7777-4777-8777-777777777777', repeat('f', 64),
    '2026-08-10T03:10:00Z', '2026-08-10'
  );
  if (select completed_program_days from public.program_enrollments where user_id = 'a7777777-7777-4777-8777-777777777777') <> 1
    or (select trial_status from public.program_enrollments where user_id = 'a7777777-7777-4777-8777-777777777777') <> 'in_progress'
  then raise exception 'Trial did not start and complete exactly one active learning day'; end if;

  perform public.complete_v2_program_day(
    'a7777777-7777-4777-8777-777777777777', v_session_id,
    'f7777777-7777-4777-8777-777777777777', repeat('f', 64),
    '2026-08-09T03:10:00Z', '2026-08-09'
  );
  if (select completed_program_days from public.program_enrollments where user_id = 'a7777777-7777-4777-8777-777777777777') <> 1 then
    raise exception 'Completion replay advanced the Program Day twice';
  end if;

  failed := false;
  begin
    update public.learning_attempts set provider_version = 'mutated' where id = (first_attempt->>'attempt_id')::uuid;
  exception when object_not_in_prerequisite_state then failed := true;
  end;
  if not failed then raise exception 'Attempt append-only update was not rejected'; end if;

  insert into public.focus_evidence(
    id, user_id, focus_group_key, evidence_kind, source_attempt_id,
    evidence_calendar_date, prompt_role, prompt_context, assisted,
    content_version_id, server_verified
  ) values (
    'd7777777-7777-4777-8777-777777777777', 'a7777777-7777-4777-8777-777777777777',
    'theta-s-t', 'discovered', (first_attempt->>'attempt_id')::uuid,
    '2026-08-09', 'anchor', 'anchor-1', false,
    'c7777777-7777-4777-8777-777777777777', false
  );
  failed := false;
  begin
    insert into public.focus_states_v2(
      user_id, focus_group_key, current_state, source_evidence_id, content_version_id
    ) values (
      'a7777777-7777-4777-8777-777777777777', 'theta-s-t', 'discovered',
      'd7777777-7777-4777-8777-777777777777', 'c7777777-7777-4777-8777-777777777777'
    );
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'Unverified evidence created focus state'; end if;
end;
$$;

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a7777777-7777-4777-8777-777777777777';

do $$
declare failed boolean := false;
begin
  begin
    perform public.complete_v2_program_day(
      'a7777777-7777-4777-8777-777777777777',
      'b7777777-7777-4777-8777-777777777777',
      'f7777777-7777-4777-8777-777777777777', repeat('f', 64), now(), current_date
    );
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'Authenticated client executed protected RPC'; end if;
end;
$$;

rollback;
