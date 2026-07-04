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
    '11111111-1111-1111-1111-111111111111',
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
    '22222222-2222-2222-2222-222222222222',
    'authenticated',
    'authenticated',
    '{}',
    '{}',
    true,
    now(),
    now()
  )
on conflict (id) do nothing;

insert into public.profiles (user_id, anon_public_id, timezone)
values
  ('11111111-1111-1111-1111-111111111111', 'rls-user-a', 'Asia/Tokyo'),
  ('22222222-2222-2222-2222-222222222222', 'rls-user-b', 'Asia/Tokyo')
on conflict (user_id) do nothing;

insert into public.subscriptions (
  id,
  user_id,
  revenuecat_app_user_id,
  entitlement_id,
  product_id,
  status,
  is_active
)
values (
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  'pro',
  'pm_monthly',
  'active',
  true
)
on conflict (id) do nothing;

insert into public.daily_sessions (id, user_id, session_date, timezone)
values
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', current_date, 'Asia/Tokyo'),
  ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', current_date, 'Asia/Tokyo')
on conflict (user_id, session_date) do nothing;

insert into public.daily_session_items (
  id,
  daily_session_id,
  position,
  slot_type,
  practice_item_id,
  target_phoneme_ids
)
values
  ('66666666-6666-6666-6666-666666666666', '44444444-4444-4444-4444-444444444444', 1, 'weak', 'word_r_001', array['r']),
  ('77777777-7777-7777-7777-777777777777', '55555555-5555-5555-5555-555555555555', 1, 'weak', 'word_l_001', array['l'])
on conflict (daily_session_id, position) do nothing;

insert into public.attempts (
  id,
  user_id,
  daily_session_id,
  daily_session_item_id,
  practice_item_id,
  practice_mode,
  attempt_no,
  practiced_at,
  practiced_date,
  timezone,
  target_phoneme_ids,
  overall_score,
  target_score_avg,
  is_correct,
  is_perfect,
  is_best,
  azure_raw_json
)
values
  (
    '88888888-8888-8888-8888-888888888888',
    '11111111-1111-1111-1111-111111111111',
    '44444444-4444-4444-4444-444444444444',
    '66666666-6666-6666-6666-666666666666',
    'word_r_001',
    'daily',
    1,
    now(),
    current_date,
    'Asia/Tokyo',
    array['r'],
    88,
    88,
    true,
    true,
    true,
    '{"audio_saved":false}'
  ),
  (
    '99999999-9999-9999-9999-999999999999',
    '22222222-2222-2222-2222-222222222222',
    '55555555-5555-5555-5555-555555555555',
    '77777777-7777-7777-7777-777777777777',
    'word_l_001',
    'daily',
    1,
    now(),
    current_date,
    'Asia/Tokyo',
    array['l'],
    72,
    72,
    false,
    false,
    true,
    '{"audio_saved":false}'
  )
on conflict (id) do nothing;

insert into public.attempt_phoneme_results (
  attempt_id,
  index,
  expected_phoneme_id,
  expected_ipa,
  observed_phoneme_id,
  observed_ipa,
  score,
  color,
  is_target
)
values
  ('88888888-8888-8888-8888-888888888888', 0, 'r', '/r/', 'r', '/r/', 88, 'green', true),
  ('99999999-9999-9999-9999-999999999999', 0, 'l', '/l/', 'r', '/r/', 72, 'yellow', true)
on conflict (attempt_id, index) do nothing;

insert into public.free_attempts (
  id,
  user_id,
  attempted_at,
  attempted_date,
  timezone,
  input_text,
  normalized_text,
  oov_words,
  phoneme_scores,
  azure_raw_json,
  consent_version
)
values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    now(),
    current_date,
    'Asia/Tokyo',
    'right',
    'right',
    '{}',
    '{"r":88}',
    '{"audio_saved":false}',
    'v1'
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '22222222-2222-2222-2222-222222222222',
    now(),
    current_date,
    'Asia/Tokyo',
    'light',
    'light',
    '{}',
    '{"l":72}',
    '{"audio_saved":false}',
    'v1'
  )
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
begin
  if (select count(*) from public.attempts) <> 1 then
    raise exception 'RLS failed: user A should read only own attempts';
  end if;

  if (select count(*) from public.attempts where id = '99999999-9999-9999-9999-999999999999') <> 0 then
    raise exception 'RLS failed: user A can read user B attempts';
  end if;

  if (select count(*) from public.attempt_phoneme_results) <> 1 then
    raise exception 'RLS failed: attempt_phoneme_results should follow parent attempt ownership';
  end if;

  if (select count(*) from public.daily_session_items) <> 1 then
    raise exception 'RLS failed: daily_session_items should follow parent session ownership';
  end if;

  if (select count(*) from public.free_attempts) <> 1 then
    raise exception 'RLS failed: user A should read only own free_attempts';
  end if;

  if (select count(*) from public.phonemes) <> 41 then
    raise exception 'RLS failed: authenticated users should read phoneme master data';
  end if;

  if (select count(*) from public.phoneme_clusters) <> 20 then
    raise exception 'RLS failed: authenticated users should read phoneme cluster master data';
  end if;

  if (select count(*) from public.subscriptions) <> 1 then
    raise exception 'RLS failed: user A should read own subscription';
  end if;
end;
$$;

do $$
begin
  begin
    insert into public.practice_items (
      practice_item_id,
      item_type,
      text,
      normalized_text,
      accent,
      ja_difficulty,
      source
    )
    values ('rls_forbidden_item', 'word', 'forbidden', 'forbidden', 'US', 'low', 'manual_reviewed');
    raise exception 'RLS failed: authenticated client inserted practice_items';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.installations (device_install_id_hash, user_id)
    values ('client-direct-installation', '11111111-1111-1111-1111-111111111111');
    raise exception 'RLS failed: authenticated client inserted installations';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.tts_cache (
      cache_key,
      text_hash,
      normalized_text,
      accent,
      speed,
      storage_path
    )
    values ('client-direct-tts', 'hash', 'right', 'US', 'normal', 'tts/right.wav');
    raise exception 'RLS failed: authenticated client inserted tts_cache';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.subscriptions (
      user_id,
      revenuecat_app_user_id,
      entitlement_id,
      product_id,
      status,
      is_active
    )
    values (
      '11111111-1111-1111-1111-111111111111',
      '11111111-1111-1111-1111-111111111111',
      'pro',
      'pm_monthly',
      'active',
      true
    );
    raise exception 'RLS failed: authenticated client inserted subscriptions';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;

set local role service_role;

insert into public.installations (device_install_id_hash, user_id)
values ('service-role-installation', '11111111-1111-1111-1111-111111111111');

insert into public.tts_cache (
  cache_key,
  text_hash,
  normalized_text,
  accent,
  speed,
  storage_path
)
values ('service-role-tts', 'hash', 'right', 'US', 'normal', 'tts/right.wav');

insert into public.subscriptions (
  user_id,
  revenuecat_app_user_id,
  entitlement_id,
  product_id,
  status,
  is_active
)
values (
  '22222222-2222-2222-2222-222222222222',
  '22222222-2222-2222-2222-222222222222',
  'pro',
  'pm_monthly',
  'active',
  true
);

reset role;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('attempts', 'free_attempts')
      and column_name ~ '(audio|recording).*(path|url|file)'
  ) then
    raise exception 'Privacy failed: server-side user audio storage column exists';
  end if;
end;
$$;

rollback;
