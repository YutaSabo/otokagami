\set ON_ERROR_STOP on

begin;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  raw_app_meta_data,
  raw_user_meta_data,
  is_anonymous,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'a1111111-1111-1111-1111-111111111111',
    'authenticated',
    'authenticated',
    '{}',
    '{}',
    true,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'b2222222-2222-2222-2222-222222222222',
    'authenticated',
    'authenticated',
    '{}',
    '{}',
    true,
    now(),
    now()
  )
on conflict (id) do nothing;

set local role service_role;

insert into public.content_versions (
  id,
  stable_release_id,
  version,
  assessment_locale,
  coaching_locale,
  status,
  linguistic_reviewed_at,
  azure_validated_at,
  activated_at,
  manifest_sha256
)
values (
  'c3333333-3333-3333-3333-333333333333',
  's6-04-test',
  1,
  'en-US',
  'ja-JP',
  'active',
  now(),
  now(),
  now(),
  repeat('c', 64)
);

insert into public.program_enrollments (
  id,
  user_id,
  program_version,
  trial_status,
  trial_started_at,
  current_program_day
)
values
  (
    'a4444444-4444-4444-4444-444444444444',
    'a1111111-1111-1111-1111-111111111111',
    'mvp-v2',
    'in_progress',
    now(),
    1
  ),
  (
    'b4444444-4444-4444-4444-444444444444',
    'b2222222-2222-2222-2222-222222222222',
    'mvp-v2',
    'in_progress',
    now(),
    1
  );

do $$
begin
  begin
    insert into public.program_day_sessions (
      id,
      user_id,
      enrollment_id,
      learning_day_sequence,
      originating_calendar_date,
      timezone,
      content_version_id,
      focus_group_key,
      required_item_count
    ) values (
      'b5555555-5555-5555-5555-555555555550',
      'b2222222-2222-2222-2222-222222222222',
      'a4444444-4444-4444-4444-444444444444',
      99,
      current_date,
      'Asia/Tokyo',
      'c3333333-3333-3333-3333-333333333333',
      'r-l',
      5
    );
    raise exception 'ownership failed: cross-user enrollment session inserted';
  exception when foreign_key_violation then null;
  end;
end;
$$;

insert into public.program_day_sessions (
  id,
  user_id,
  enrollment_id,
  learning_day_sequence,
  trial_program_day,
  originating_calendar_date,
  timezone,
  content_version_id,
  focus_group_key,
  status,
  required_item_count,
  optional_item_count,
  current_position,
  started_at
)
values
  (
    'a5555555-5555-5555-5555-555555555555',
    'a1111111-1111-1111-1111-111111111111',
    'a4444444-4444-4444-4444-444444444444',
    1,
    1,
    current_date,
    'Asia/Tokyo',
    'c3333333-3333-3333-3333-333333333333',
    'r-l',
    'in_progress',
    5,
    2,
    1,
    now()
  ),
  (
    'b5555555-5555-5555-5555-555555555555',
    'b2222222-2222-2222-2222-222222222222',
    'b4444444-4444-4444-4444-444444444444',
    1,
    1,
    current_date,
    'Asia/Tokyo',
    'c3333333-3333-3333-3333-333333333333',
    'r-l',
    'in_progress',
    5,
    0,
    1,
    now()
  );

insert into public.program_day_sessions (
  id,
  user_id,
  enrollment_id,
  learning_day_sequence,
  originating_calendar_date,
  completed_calendar_date,
  timezone,
  content_version_id,
  focus_group_key,
  status,
  required_item_count,
  current_position,
  completion_idempotency_key,
  started_at,
  completed_at
)
values (
  'a5555555-5555-5555-5555-555555555556',
  'a1111111-1111-1111-1111-111111111111',
  'a4444444-4444-4444-4444-444444444444',
  2,
  current_date,
  current_date,
  'Asia/Tokyo',
  'c3333333-3333-3333-3333-333333333333',
  'r-l',
  'completed',
  3,
  3,
  'a5555555-5555-5555-5555-555555555596',
  now(),
  now()
);

do $$
begin
  begin
    insert into public.program_day_sessions (
      user_id,
      enrollment_id,
      learning_day_sequence,
      originating_calendar_date,
      completed_calendar_date,
      timezone,
      content_version_id,
      focus_group_key,
      status,
      required_item_count,
      current_position,
      completion_idempotency_key,
      started_at,
      completed_at
    ) values (
      'a1111111-1111-1111-1111-111111111111',
      'a4444444-4444-4444-4444-444444444444',
      3,
      current_date,
      current_date,
      'Asia/Tokyo',
      'c3333333-3333-3333-3333-333333333333',
      'r-l',
      'completed',
      3,
      3,
      'a5555555-5555-5555-5555-555555555597',
      now(),
      now()
    );
    raise exception 'session uniqueness failed: two completed sessions on one Calendar Date';
  exception when unique_violation then null;
  end;

  begin
    insert into public.program_day_sessions (
      user_id,
      enrollment_id,
      learning_day_sequence,
      originating_calendar_date,
      completed_calendar_date,
      timezone,
      content_version_id,
      focus_group_key,
      status,
      required_item_count,
      current_position,
      completion_idempotency_key,
      started_at,
      completed_at
    ) values (
      'a1111111-1111-1111-1111-111111111111',
      'a4444444-4444-4444-4444-444444444444',
      1,
      current_date - 1,
      current_date - 1,
      'Asia/Tokyo',
      'c3333333-3333-3333-3333-333333333333',
      'r-l',
      'completed',
      3,
      3,
      'a5555555-5555-5555-5555-555555555598',
      now(),
      now()
    );
    raise exception 'session uniqueness failed: duplicate learning day sequence';
  exception when unique_violation then null;
  end;
end;
$$;

insert into public.program_session_items (
  id,
  user_id,
  session_id,
  position,
  content_version_id,
  practice_item_key,
  focus_group_key,
  prompt_role,
  is_required
)
values
  (
    'a6666666-6666-6666-6666-666666666666',
    'a1111111-1111-1111-1111-111111111111',
    'a5555555-5555-5555-5555-555555555555',
    1,
    'c3333333-3333-3333-3333-333333333333',
    'right',
    'r-l',
    'anchor',
    true
  ),
  (
    'a6666666-6666-6666-6666-666666666667',
    'a1111111-1111-1111-1111-111111111111',
    'a5555555-5555-5555-5555-555555555555',
    2,
    'c3333333-3333-3333-3333-333333333333',
    'light',
    'r-l',
    'optional_extension',
    false
  ),
  (
    'b6666666-6666-6666-6666-666666666666',
    'b2222222-2222-2222-2222-222222222222',
    'b5555555-5555-5555-5555-555555555555',
    1,
    'c3333333-3333-3333-3333-333333333333',
    'right',
    'r-l',
    'anchor',
    true
  );

do $$
begin
  begin
    insert into public.program_session_items (
      user_id,
      session_id,
      position,
      content_version_id,
      practice_item_key,
      focus_group_key,
      prompt_role,
      is_required
    ) values (
      'b2222222-2222-2222-2222-222222222222',
      'a5555555-5555-5555-5555-555555555555',
      3,
      'c3333333-3333-3333-3333-333333333333',
      'wrong-owner',
      'r-l',
      'contrast',
      true
    );
    raise exception 'ownership failed: cross-user session item inserted';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.program_session_items (
      user_id,
      session_id,
      position,
      content_version_id,
      practice_item_key,
      focus_group_key,
      prompt_role,
      is_required
    ) values (
      'a1111111-1111-1111-1111-111111111111',
      'a5555555-5555-5555-5555-555555555555',
      1,
      'c3333333-3333-3333-3333-333333333333',
      'duplicate-position',
      'r-l',
      'contrast',
      true
    );
    raise exception 'item uniqueness failed: duplicate session position';
  exception when unique_violation then null;
  end;
end;
$$;

insert into public.learning_attempts (
  id,
  user_id,
  session_id,
  session_item_id,
  client_attempt_id,
  payload_sha256,
  content_version_id,
  practice_item_key,
  focus_group_key,
  prompt_role,
  attempt_role,
  retry_of_attempt_id,
  attempt_sequence,
  valid_attempt_ordinal,
  attempted_at,
  attempted_calendar_date,
  timezone,
  coaching_shown,
  technical_valid,
  invalid_reason,
  provider,
  assessment_locale,
  provider_version,
  normalizer_version
)
values
  (
    'a7777777-7777-7777-7777-777777777770',
    'a1111111-1111-1111-1111-111111111111',
    'a5555555-5555-5555-5555-555555555555',
    'a6666666-6666-6666-6666-666666666666',
    'ca000000-0000-0000-0000-000000000001',
    repeat('1', 64),
    'c3333333-3333-3333-3333-333333333333',
    'right',
    'r-l',
    'anchor',
    'cold',
    null,
    1,
    1,
    now(),
    current_date,
    'Asia/Tokyo',
    false,
    true,
    null,
    'azure',
    'en-US',
    'speech-sdk-test',
    'normalizer-v2'
  ),
  (
    'a7777777-7777-7777-7777-777777777771',
    'a1111111-1111-1111-1111-111111111111',
    'a5555555-5555-5555-5555-555555555555',
    'a6666666-6666-6666-6666-666666666666',
    'ca000000-0000-0000-0000-000000000002',
    repeat('2', 64),
    'c3333333-3333-3333-3333-333333333333',
    'right',
    'r-l',
    'anchor',
    'guided_retry',
    'a7777777-7777-7777-7777-777777777770',
    2,
    2,
    now(),
    current_date,
    'Asia/Tokyo',
    true,
    true,
    null,
    'azure',
    'en-US',
    'speech-sdk-test',
    'normalizer-v2'
  ),
  (
    'a7777777-7777-7777-7777-777777777772',
    'a1111111-1111-1111-1111-111111111111',
    'a5555555-5555-5555-5555-555555555555',
    'a6666666-6666-6666-6666-666666666666',
    'ca000000-0000-0000-0000-000000000003',
    repeat('3', 64),
    'c3333333-3333-3333-3333-333333333333',
    'right',
    'r-l',
    'anchor',
    'cold',
    null,
    3,
    null,
    now(),
    current_date,
    'Asia/Tokyo',
    false,
    false,
    'no_match',
    'azure',
    'en-US',
    'speech-sdk-test',
    'normalizer-v2'
  ),
  (
    'a7777777-7777-7777-7777-777777777773',
    'a1111111-1111-1111-1111-111111111111',
    'a5555555-5555-5555-5555-555555555555',
    'a6666666-6666-6666-6666-666666666667',
    'ca000000-0000-0000-0000-000000000004',
    repeat('4', 64),
    'c3333333-3333-3333-3333-333333333333',
    'light',
    'r-l',
    'optional_extension',
    'optional_extension',
    null,
    1,
    1,
    now(),
    current_date,
    'Asia/Tokyo',
    false,
    true,
    null,
    'azure',
    'en-US',
    'speech-sdk-test',
    'normalizer-v2'
  ),
  (
    'b7777777-7777-7777-7777-777777777770',
    'b2222222-2222-2222-2222-222222222222',
    'b5555555-5555-5555-5555-555555555555',
    'b6666666-6666-6666-6666-666666666666',
    'cb000000-0000-0000-0000-000000000001',
    repeat('5', 64),
    'c3333333-3333-3333-3333-333333333333',
    'right',
    'r-l',
    'anchor',
    'cold',
    null,
    1,
    1,
    now(),
    current_date,
    'Asia/Tokyo',
    false,
    true,
    null,
    'azure',
    'en-US',
    'speech-sdk-test',
    'normalizer-v2'
  );

do $$
begin
  begin
    insert into public.learning_attempts (
      user_id, session_id, session_item_id, client_attempt_id, payload_sha256,
      content_version_id, practice_item_key, focus_group_key, prompt_role,
      attempt_role, attempt_sequence, valid_attempt_ordinal, attempted_at,
      attempted_calendar_date, timezone, technical_valid, provider,
      assessment_locale, normalizer_version
    ) values (
      'b2222222-2222-2222-2222-222222222222',
      'a5555555-5555-5555-5555-555555555555',
      'a6666666-6666-6666-6666-666666666666',
      'cb000000-0000-0000-0000-000000000099', repeat('9', 64),
      'c3333333-3333-3333-3333-333333333333', 'right', 'r-l', 'anchor',
      'cold', 99, 3, now(), current_date, 'Asia/Tokyo', true,
      'azure', 'en-US', 'normalizer-v2'
    );
    raise exception 'ownership failed: cross-user attempt inserted';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.learning_attempts (
      user_id, session_id, session_item_id, client_attempt_id, payload_sha256,
      content_version_id, practice_item_key, focus_group_key, prompt_role,
      attempt_role, attempt_sequence, valid_attempt_ordinal, attempted_at,
      attempted_calendar_date, timezone, technical_valid, provider,
      assessment_locale, normalizer_version
    ) values (
      'a1111111-1111-1111-1111-111111111111',
      'a5555555-5555-5555-5555-555555555555',
      'a6666666-6666-6666-6666-666666666666',
      'ca000000-0000-0000-0000-000000000001', repeat('9', 64),
      'c3333333-3333-3333-3333-333333333333', 'right', 'r-l', 'anchor',
      'cold', 10, 3, now(), current_date, 'Asia/Tokyo', true,
      'azure', 'en-US', 'normalizer-v2'
    );
    raise exception 'idempotency failed: duplicate client ID with conflicting hash inserted';
  exception when unique_violation then null;
  end;

  begin
    insert into public.learning_attempts (
      user_id, session_id, session_item_id, client_attempt_id, payload_sha256,
      content_version_id, practice_item_key, focus_group_key, prompt_role,
      attempt_role, attempt_sequence, valid_attempt_ordinal, attempted_at,
      attempted_calendar_date, timezone, technical_valid, provider,
      assessment_locale, normalizer_version
    ) values (
      'a1111111-1111-1111-1111-111111111111',
      'a5555555-5555-5555-5555-555555555555',
      'a6666666-6666-6666-6666-666666666666',
      'ca000000-0000-0000-0000-000000000005', repeat('5', 64),
      'c3333333-3333-3333-3333-333333333333', 'right', 'r-l', 'anchor',
      'cold', 5, 1, now(), current_date, 'Asia/Tokyo', true,
      'azure', 'en-US', 'normalizer-v2'
    );
    raise exception 'attempt ordinal failed: duplicate valid ordinal inserted';
  exception when unique_violation then null;
  end;

  begin
    insert into public.learning_attempts (
      user_id, session_id, session_item_id, client_attempt_id, payload_sha256,
      content_version_id, practice_item_key, focus_group_key, prompt_role,
      attempt_role, attempt_sequence, valid_attempt_ordinal, attempted_at,
      attempted_calendar_date, timezone, technical_valid, invalid_reason, provider,
      assessment_locale, normalizer_version
    ) values (
      'a1111111-1111-1111-1111-111111111111',
      'a5555555-5555-5555-5555-555555555555',
      'a6666666-6666-6666-6666-666666666666',
      'ca000000-0000-0000-0000-000000000006', repeat('6', 64),
      'c3333333-3333-3333-3333-333333333333', 'right', 'r-l', 'anchor',
      'cold', 6, 3, now(), current_date, 'Asia/Tokyo', false, 'no_match',
      'azure', 'en-US', 'normalizer-v2'
    );
    raise exception 'attempt validity failed: invalid attempt consumed a valid ordinal';
  exception when check_violation then null;
  end;

  begin
    insert into public.learning_attempts (
      user_id, session_id, session_item_id, client_attempt_id, payload_sha256,
      content_version_id, practice_item_key, focus_group_key, prompt_role,
      attempt_role, attempt_sequence, valid_attempt_ordinal, attempted_at,
      attempted_calendar_date, timezone, coaching_shown, technical_valid, provider,
      assessment_locale, normalizer_version
    ) values (
      'a1111111-1111-1111-1111-111111111111',
      'a5555555-5555-5555-5555-555555555555',
      'a6666666-6666-6666-6666-666666666666',
      'ca000000-0000-0000-0000-000000000007', repeat('7', 64),
      'c3333333-3333-3333-3333-333333333333', 'right', 'r-l', 'anchor',
      'guided_retry', 7, 3, now(), current_date, 'Asia/Tokyo', true, true,
      'azure', 'en-US', 'normalizer-v2'
    );
    raise exception 'guided retry failed: retry source was not required';
  exception
    when check_violation then null;
    when raise_exception then
      if sqlerrm <> 'Guided retry must reference a valid unassisted attempt for the same owner and item' then
        raise;
      end if;
  end;

  begin
    insert into public.learning_attempts (
      user_id, session_id, session_item_id, client_attempt_id, payload_sha256,
      content_version_id, practice_item_key, focus_group_key, prompt_role,
      attempt_role, retry_of_attempt_id, attempt_sequence, valid_attempt_ordinal,
      attempted_at, attempted_calendar_date, timezone, coaching_shown,
      technical_valid, provider, assessment_locale, normalizer_version
    ) values (
      'a1111111-1111-1111-1111-111111111111',
      'a5555555-5555-5555-5555-555555555555',
      'a6666666-6666-6666-6666-666666666666',
      'ca000000-0000-0000-0000-000000000008', repeat('8', 64),
      'c3333333-3333-3333-3333-333333333333', 'right', 'r-l', 'anchor',
      'guided_retry', 'a7777777-7777-7777-7777-777777777772',
      8, 3, now(), current_date, 'Asia/Tokyo', true, true,
      'azure', 'en-US', 'normalizer-v2'
    );
    raise exception 'guided retry failed: technically invalid retry source was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Guided retry must reference a valid unassisted attempt for the same owner and item' then
      raise;
    end if;
  end;
end;
$$;

insert into public.learning_attempt_results (
  attempt_id,
  user_id,
  provider,
  assessment_locale,
  normalizer_version,
  reference_text_version,
  expected_focus_representation,
  observed_candidate,
  target_score,
  technical_valid,
  result_label,
  next_action_key
)
values
  (
    'a7777777-7777-7777-7777-777777777770',
    'a1111111-1111-1111-1111-111111111111',
    'azure', 'en-US', 'normalizer-v2', 'right-v1', '/r/', '/r/', 82, true,
    'focus_good', 'continue'
  ),
  (
    'b7777777-7777-7777-7777-777777777770',
    'b2222222-2222-2222-2222-222222222222',
    'azure', 'en-US', 'normalizer-v2', 'right-v1', '/r/', null, null, true,
    'focus_uncertain', 'retry_later'
  );

insert into public.correction_cycles (
  id,
  user_id,
  session_item_id,
  focus_group_key,
  before_attempt_id,
  advice_stable_key,
  advice_version,
  coaching_locale,
  after_attempt_id,
  candidate_change_type,
  immediate_change_status
)
values (
  'a9999999-9999-9999-9999-999999999999',
  'a1111111-1111-1111-1111-111111111111',
  'a6666666-6666-6666-6666-666666666666',
  'r-l',
  'a7777777-7777-7777-7777-777777777770',
  'tongue-r-v1',
  1,
  'ja-JP',
  'a7777777-7777-7777-7777-777777777771',
  'target_score_increase',
  'improved'
);

do $$
begin
  begin
    insert into public.correction_cycles (
      user_id, session_item_id, focus_group_key, before_attempt_id,
      advice_stable_key, advice_version, coaching_locale, after_attempt_id
    ) values (
      'a1111111-1111-1111-1111-111111111111',
      'a6666666-6666-6666-6666-666666666666',
      'r-l',
      'a7777777-7777-7777-7777-777777777770',
      'invalid-cycle', 1, 'ja-JP',
      'a7777777-7777-7777-7777-777777777770'
    );
    raise exception 'correction guard failed: cold attempt accepted as guided after';
  exception
    when check_violation then null;
    when raise_exception then
      if sqlerrm <> 'Correction after attempt must be a valid guided retry of the before attempt' then
        raise;
      end if;
  end;
end;
$$;

insert into public.focus_evidence (
  id,
  user_id,
  focus_group_key,
  evidence_kind,
  source_attempt_id,
  correction_cycle_id,
  evidence_calendar_date,
  prompt_role,
  prompt_context,
  assisted,
  content_version_id,
  server_verified
)
values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa0',
    'a1111111-1111-1111-1111-111111111111',
    'r-l',
    'discovered',
    'a7777777-7777-7777-7777-777777777770',
    null,
    current_date,
    'anchor',
    'word',
    false,
    'c3333333-3333-3333-3333-333333333333',
    true
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'a1111111-1111-1111-1111-111111111111',
    'r-l',
    'immediate_change',
    null,
    'a9999999-9999-9999-9999-999999999999',
    current_date,
    'anchor',
    'guided word retry',
    true,
    'c3333333-3333-3333-3333-333333333333',
    true
  ),
  (
    'baaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa0',
    'b2222222-2222-2222-2222-222222222222',
    'r-l',
    'discovered',
    'b7777777-7777-7777-7777-777777777770',
    null,
    current_date,
    'anchor',
    'word',
    false,
    'c3333333-3333-3333-3333-333333333333',
    true
  );

do $$
begin
  begin
    insert into public.focus_evidence (
      user_id, focus_group_key, evidence_kind, source_attempt_id,
      evidence_calendar_date, prompt_role, prompt_context, assisted,
      content_version_id, server_verified
    ) values (
      'a1111111-1111-1111-1111-111111111111', 'r-l', 'held',
      'a7777777-7777-7777-7777-777777777771', current_date + 1,
      'anchor', 'word', false,
      'c3333333-3333-3333-3333-333333333333', true
    );
    raise exception 'evidence guard failed: guided retry became durable evidence';
  exception when raise_exception then
    if sqlerrm <> 'Durable evidence must use a valid unassisted attempt for the same owner, focus, and prompt role' then
      raise;
    end if;
  end;

  begin
    insert into public.focus_evidence (
      user_id, focus_group_key, evidence_kind, source_attempt_id,
      evidence_calendar_date, prompt_role, prompt_context, assisted,
      content_version_id, server_verified
    ) values (
      'a1111111-1111-1111-1111-111111111111', 'r-l', 'discovered',
      'a7777777-7777-7777-7777-777777777770', current_date,
      'anchor', 'duplicate', false,
      'c3333333-3333-3333-3333-333333333333', true
    );
    raise exception 'evidence uniqueness failed: duplicate durable evidence inserted';
  exception when unique_violation then null;
  end;
end;
$$;

insert into public.focus_states_v2 (
  user_id,
  focus_group_key,
  current_state,
  last_unassisted_success_date,
  next_prompt_role,
  next_review_due_date,
  source_evidence_id,
  content_version_id
)
values
  (
    'a1111111-1111-1111-1111-111111111111', 'r-l', 'discovered',
    current_date, 'review', current_date + 1,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa0',
    'c3333333-3333-3333-3333-333333333333'
  ),
  (
    'b2222222-2222-2222-2222-222222222222', 'r-l', 'discovered',
    current_date, 'review', current_date + 1,
    'baaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa0',
    'c3333333-3333-3333-3333-333333333333'
  );

do $$
begin
  begin
    insert into public.focus_states_v2 (
      user_id, focus_group_key, current_state, source_evidence_id, content_version_id
    ) values (
      'a1111111-1111-1111-1111-111111111111', 'other-focus', 'stable',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa0',
      'c3333333-3333-3333-3333-333333333333'
    );
    raise exception 'focus state failed: state/source evidence mismatch inserted';
  exception when foreign_key_violation then null;
  end;
end;
$$;

insert into public.review_schedules (
  id,
  user_id,
  focus_group_key,
  interval_kind,
  based_on_evidence_id,
  based_on_calendar_date,
  review_due_date
)
values
  (
    'abbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb0',
    'a1111111-1111-1111-1111-111111111111', 'r-l', 'day_1',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa0', current_date, current_date + 1
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb0',
    'b2222222-2222-2222-2222-222222222222', 'r-l', 'day_1',
    'baaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa0', current_date, current_date + 1
  );

do $$
begin
  begin
    insert into public.review_schedules (
      user_id, focus_group_key, interval_kind, based_on_evidence_id,
      based_on_calendar_date, review_due_date
    ) values (
      'a1111111-1111-1111-1111-111111111111', 'r-l', 'day_1',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa0', current_date, current_date + 1
    );
    raise exception 'review uniqueness failed: duplicate evidence interval inserted';
  exception when unique_violation then null;
  end;

  begin
    insert into public.review_schedules (
      user_id, focus_group_key, interval_kind, based_on_evidence_id,
      based_on_calendar_date, review_due_date
    ) values (
      'a1111111-1111-1111-1111-111111111111', 'r-l', 'day_3',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa0', current_date - 1, current_date + 2
    );
    raise exception 'review basis failed: evidence Calendar Date mismatch inserted';
  exception when foreign_key_violation then null;
  end;
end;
$$;

insert into public.learning_reports (
  id,
  user_id,
  report_type,
  idempotency_key,
  trial_program_day_start,
  trial_program_day_end,
  learning_day_sequence_start,
  learning_day_sequence_end,
  calendar_date_start,
  calendar_date_end,
  generated_content_version_id,
  summary,
  next_review_due_date,
  next_focus_group_key
)
values
  (
    'accccccc-cccc-cccc-cccc-ccccccccccc0',
    'a1111111-1111-1111-1111-111111111111', 'daily',
    'ad000000-0000-0000-0000-000000000001',
    1, 1, 1, 1, current_date, current_date,
    'c3333333-3333-3333-3333-333333333333',
    '{"state":"discovered"}', current_date + 1, 'r-l'
  ),
  (
    'bccccccc-cccc-cccc-cccc-ccccccccccc0',
    'b2222222-2222-2222-2222-222222222222', 'daily',
    'bd000000-0000-0000-0000-000000000001',
    1, 1, 1, 1, current_date, current_date,
    'c3333333-3333-3333-3333-333333333333',
    '{"state":"discovered"}', current_date + 1, 'r-l'
  );

insert into public.learning_report_evidence (report_id, evidence_id, user_id)
values
  (
    'accccccc-cccc-cccc-cccc-ccccccccccc0',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa0',
    'a1111111-1111-1111-1111-111111111111'
  ),
  (
    'bccccccc-cccc-cccc-cccc-ccccccccccc0',
    'baaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa0',
    'b2222222-2222-2222-2222-222222222222'
  );

insert into public.learning_report_correction_cycles (report_id, correction_cycle_id, user_id)
values (
  'accccccc-cccc-cccc-cccc-ccccccccccc0',
  'a9999999-9999-9999-9999-999999999999',
  'a1111111-1111-1111-1111-111111111111'
);

do $$
begin
  begin
    insert into public.learning_reports (
      user_id, report_type, idempotency_key,
      calendar_date_start, calendar_date_end, generated_content_version_id
    ) values (
      'a1111111-1111-1111-1111-111111111111', 'daily',
      'ad000000-0000-0000-0000-000000000001',
      current_date, current_date,
      'c3333333-3333-3333-3333-333333333333'
    );
    raise exception 'report idempotency failed: duplicate key inserted';
  exception when unique_violation then null;
  end;

  begin
    insert into public.learning_report_evidence (report_id, evidence_id, user_id)
    values (
      'accccccc-cccc-cccc-cccc-ccccccccccc0',
      'baaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa0',
      'a1111111-1111-1111-1111-111111111111'
    );
    raise exception 'ownership failed: cross-user report evidence inserted';
  exception when foreign_key_violation then null;
  end;
end;
$$;

update public.program_session_items
set selected_before_attempt_id = 'a7777777-7777-7777-7777-777777777770',
    selected_after_attempt_id = 'a7777777-7777-7777-7777-777777777771'
where id = 'a6666666-6666-6666-6666-666666666666';

do $$
begin
  begin
    update public.program_enrollments
    set first_valid_learning_attempt_id = 'a7777777-7777-7777-7777-777777777772'
    where user_id = 'a1111111-1111-1111-1111-111111111111';
    raise exception 'enrollment guard failed: technically invalid first attempt was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Enrollment first learning attempt must be valid and owned by the enrolled user' then
      raise;
    end if;
  end;
end;
$$;

update public.program_enrollments
set first_valid_learning_attempt_id = 'a7777777-7777-7777-7777-777777777770'
where user_id = 'a1111111-1111-1111-1111-111111111111';

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a1111111-1111-1111-1111-111111111111';

do $$
declare
  visible_count bigint;
begin
  select count(*) into visible_count from public.program_day_sessions;
  if visible_count <> 2 then
    raise exception 'RLS failed: user A session visibility is incorrect';
  end if;

  if exists (select 1 from public.program_day_sessions where user_id <> auth.uid())
    or exists (select 1 from public.program_session_items where user_id <> auth.uid())
    or exists (select 1 from public.learning_attempts where user_id <> auth.uid())
    or exists (select 1 from public.learning_attempt_results where user_id <> auth.uid())
    or exists (select 1 from public.correction_cycles where user_id <> auth.uid())
    or exists (select 1 from public.focus_evidence where user_id <> auth.uid())
    or exists (select 1 from public.focus_states_v2 where user_id <> auth.uid())
    or exists (select 1 from public.review_schedules where user_id <> auth.uid())
    or exists (select 1 from public.learning_reports where user_id <> auth.uid())
    or exists (select 1 from public.learning_report_evidence where user_id <> auth.uid())
    or exists (select 1 from public.learning_report_correction_cycles where user_id <> auth.uid())
  then
    raise exception 'RLS failed: user A can read user B v2 learning data';
  end if;

  if (select count(*) from public.program_session_items) <> 2
    or (select count(*) from public.learning_attempts) <> 4
    or (select count(*) from public.learning_attempt_results) <> 1
    or (select count(*) from public.correction_cycles) <> 1
    or (select count(*) from public.focus_evidence) <> 2
    or (select count(*) from public.focus_states_v2) <> 1
    or (select count(*) from public.review_schedules) <> 1
    or (select count(*) from public.learning_reports) <> 1
    or (select count(*) from public.learning_report_evidence) <> 1
    or (select count(*) from public.learning_report_correction_cycles) <> 1
  then
    raise exception 'RLS failed: user A own-row visibility is incomplete';
  end if;
end;
$$;

do $$
begin
  begin
    insert into public.learning_reports (
      user_id, report_type, idempotency_key,
      calendar_date_start, calendar_date_end, generated_content_version_id
    ) values (
      auth.uid(), 'daily', gen_random_uuid(), current_date, current_date,
      'c3333333-3333-3333-3333-333333333333'
    );
    raise exception 'trusted boundary failed: authenticated client inserted report';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.focus_states_v2
    set current_state = 'stable'
    where user_id = auth.uid();
    raise exception 'trusted boundary failed: authenticated client updated focus state';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.learning_attempts where user_id = auth.uid();
    raise exception 'trusted boundary failed: authenticated client deleted attempts';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;

do $$
begin
  if (select count(*) from public.learning_attempts where not technical_valid and valid_attempt_ordinal is null) <> 1 then
    raise exception 'attempt validity failed: invalid attempt was not retained without consuming a valid ordinal';
  end if;

  if (select count(*) from public.learning_attempts where user_id = 'a1111111-1111-1111-1111-111111111111') <> 4 then
    raise exception 'trusted boundary failed: client denial tests changed attempts';
  end if;
end;
$$;

rollback;
