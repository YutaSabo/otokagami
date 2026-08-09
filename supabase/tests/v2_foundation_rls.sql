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

insert into public.program_enrollments (
  user_id,
  program_version,
  trial_status,
  trial_started_at,
  current_program_day
)
values
  (
    'a1111111-1111-1111-1111-111111111111',
    'mvp-v2',
    'in_progress',
    now(),
    1
  ),
  (
    'b2222222-2222-2222-2222-222222222222',
    'mvp-v2',
    'in_progress',
    now(),
    1
  );

insert into public.learning_deletion_epochs (user_id, current_epoch)
values
  ('a1111111-1111-1111-1111-111111111111', 0),
  ('b2222222-2222-2222-2222-222222222222', 0);

insert into public.content_versions (
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
values
  ('s6-03-draft', 1, 'en-US', 'ja-JP', 'draft', null, null, null, null),
  ('s6-03-active', 1, 'en-US', 'ja-JP', 'active', now(), now(), now(), repeat('a', 64));

select set_config('app.v2_trusted_command', 'on', true);
update public.learning_deletion_epochs
set current_epoch = 1
where user_id = 'a1111111-1111-1111-1111-111111111111';
select set_config('app.v2_trusted_command', 'off', true);

do $$
begin
  begin
    update public.learning_deletion_epochs
    set current_epoch = 0
    where user_id = 'a1111111-1111-1111-1111-111111111111';
    raise exception 'trusted boundary failed: deletion epoch moved backwards';
  exception
    when raise_exception then
      if sqlerrm not in ('V2_DIRECT_MUTATION_FORBIDDEN', 'V2_DELETION_EPOCH_MUST_INCREMENT', 'Learning deletion epoch must increase') then
        raise;
      end if;
  end;

  begin
    update public.content_versions
    set manifest_metadata = '{"changed":true}'::jsonb
    where stable_release_id = 's6-03-active';
    raise exception 'trusted boundary failed: activated content changed in place';
  exception
    when raise_exception then
      if sqlerrm <> 'Activated content versions are immutable' then
        raise;
      end if;
  end;
end;
$$;

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a1111111-1111-1111-1111-111111111111';

do $$
begin
  if (select count(*) from public.program_enrollments) <> 1 then
    raise exception 'RLS failed: user A should read only own enrollment';
  end if;

  if exists (
    select 1 from public.program_enrollments
    where user_id = 'b2222222-2222-2222-2222-222222222222'
  ) then
    raise exception 'RLS failed: user A can read user B enrollment';
  end if;

  if (select count(*) from public.learning_deletion_epochs) <> 1 then
    raise exception 'RLS failed: user A should read only own deletion epoch';
  end if;

  if (select count(*) from public.content_versions) <> 1
    or not exists (
      select 1 from public.content_versions
      where stable_release_id = 's6-03-active' and status = 'active'
    )
  then
    raise exception 'RLS failed: authenticated client should read active content only';
  end if;
end;
$$;

do $$
begin
  begin
    insert into public.program_enrollments (user_id, program_version)
    values ('a1111111-1111-1111-1111-111111111111', 'client-forbidden');
    raise exception 'RLS failed: authenticated client inserted enrollment';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.program_enrollments
    set completed_program_days = 1
    where user_id = 'a1111111-1111-1111-1111-111111111111';
    raise exception 'RLS failed: authenticated client updated enrollment';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.program_enrollments
    where user_id = 'a1111111-1111-1111-1111-111111111111';
    raise exception 'RLS failed: authenticated client deleted enrollment';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.learning_deletion_epochs (user_id, current_epoch)
    values ('a1111111-1111-1111-1111-111111111111', 5);
    raise exception 'RLS failed: authenticated client inserted deletion epoch';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.learning_deletion_epochs
    set current_epoch = 2
    where user_id = 'a1111111-1111-1111-1111-111111111111';
    raise exception 'RLS failed: authenticated client updated deletion epoch';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.learning_deletion_epochs
    where user_id = 'a1111111-1111-1111-1111-111111111111';
    raise exception 'RLS failed: authenticated client deleted deletion epoch';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.content_versions (
      stable_release_id,
      version,
      assessment_locale,
      coaching_locale
    ) values ('client-forbidden', 1, 'en-US', 'ja-JP');
    raise exception 'RLS failed: authenticated client inserted content version';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.content_versions
    set status = 'retired'
    where stable_release_id = 's6-03-active';
    raise exception 'RLS failed: authenticated client activated or retired content';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.content_versions
    where stable_release_id = 's6-03-active';
    raise exception 'RLS failed: authenticated client deleted content version';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;

do $$
begin
  if (select current_epoch from public.learning_deletion_epochs where user_id = 'a1111111-1111-1111-1111-111111111111') <> 1 then
    raise exception 'trusted boundary failed: accepted deletion epoch was not preserved';
  end if;

  if (select count(*) from public.program_enrollments) <> 2
    or (select count(*) from public.learning_deletion_epochs) <> 2
    or (select count(*) from public.content_versions) <> 2
  then
    raise exception 'trusted boundary failed: protected rows changed during client denial tests';
  end if;
end;
$$;

rollback;
