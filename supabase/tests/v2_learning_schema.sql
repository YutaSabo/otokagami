\set ON_ERROR_STOP on

do $$
declare
  new_table_name text;
  row_count bigint;
  new_tables constant text[] := array[
    'program_day_sessions',
    'program_session_items',
    'learning_attempts',
    'learning_attempt_results',
    'correction_cycles',
    'focus_evidence',
    'focus_states_v2',
    'review_schedules',
    'learning_reports',
    'learning_report_evidence',
    'learning_report_correction_cycles'
  ];
begin
  if (
    select count(*)
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
  ) <> 39 then
    raise exception 'S6-08.1 schema failed: expected 38 existing plus validation access ledger';
  end if;

  foreach new_table_name in array new_tables loop
    if to_regclass(format('public.%I', new_table_name)) is null then
      raise exception 'S6-04 schema failed: missing table %', new_table_name;
    end if;

    if not (
      select relrowsecurity
      from pg_class
      where oid = format('public.%I', new_table_name)::regclass
    ) then
      raise exception 'S6-04 RLS failed: RLS disabled on %', new_table_name;
    end if;

    if has_table_privilege('anon', format('public.%I', new_table_name), 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'S6-04 grants failed: anon has privileges on %', new_table_name;
    end if;

    if not has_table_privilege('authenticated', format('public.%I', new_table_name), 'SELECT') then
      raise exception 'S6-04 grants failed: authenticated SELECT missing on %', new_table_name;
    end if;

    if has_table_privilege('authenticated', format('public.%I', new_table_name), 'INSERT,UPDATE,DELETE') then
      raise exception 'S6-04 grants failed: authenticated mutation privilege exists on %', new_table_name;
    end if;

    if not has_table_privilege('service_role', format('public.%I', new_table_name), 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'S6-04 grants failed: service role privileges missing on %', new_table_name;
    end if;

    execute format('select count(*) from public.%I', new_table_name) into row_count;
    if row_count <> 0 then
      raise exception 'S6-04 migration inserted rows into new table %', new_table_name;
    end if;
  end loop;

  if (select count(*) from pg_policies where schemaname = 'public') <> 65 then
    raise exception 'S6-08 RLS failed: expected 64 existing plus one review receipt policy';
  end if;

  if (select count(*) from public.program_enrollments) <> 0
    or (select count(*) from public.content_versions) <> 0
    or (select count(*) from public.learning_deletion_epochs) <> 0
  then
    raise exception 'S6-04 migration changed S6-03 foundation row counts';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'program_enrollments'
      and column_name = 'first_valid_learning_attempt_id'
      and is_nullable = 'YES'
  ) then
    raise exception 'S6-04 schema failed: first valid learning attempt link is missing';
  end if;

  if col_description('public.program_enrollments'::regclass, (
    select ordinal_position
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'program_enrollments'
      and column_name = 'current_program_day'
  )) not like 'Trial-only active learning day cursor%'
  then
    raise exception 'S6-04 schema failed: trial-only Program Day comment is missing';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = any(new_tables)
      and column_name in (
        'audio',
        'audio_data',
        'audio_base64',
        'audio_uri',
        'device_uri',
        'azure_raw_json',
        'raw_azure_json',
        'access_token',
        'subscription_key'
      )
  ) then
    raise exception 'S6-04 privacy failed: prohibited audio, URI, raw Azure, or secret column exists';
  end if;

  if (
    select count(*)
    from pg_trigger
    where not tgisinternal
      and tgname in (
        'correction_cycles_guard_attempts',
        'learning_attempts_guard_retry',
        'program_enrollments_guard_first_attempt',
        'focus_evidence_guard_source',
        'program_day_sessions_set_updated_at',
        'program_session_items_set_updated_at',
        'correction_cycles_set_updated_at',
        'focus_states_v2_set_updated_at',
        'review_schedules_set_updated_at'
      )
  ) <> 9 then
    raise exception 'S6-04 schema failed: expected learning guard/update triggers';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'program_day_sessions_one_active_per_user'
  ) or not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'program_day_sessions_one_completed_calendar_date'
  ) or not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'learning_attempts_valid_ordinal_unique'
  ) then
    raise exception 'S6-04 schema failed: required partial unique index is missing';
  end if;

  if has_function_privilege('authenticated', 'public.guard_correction_cycle_attempts()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.guard_learning_attempt_retry()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.guard_program_enrollment_first_attempt()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.guard_focus_evidence_source()', 'EXECUTE')
    or has_function_privilege('anon', 'public.guard_correction_cycle_attempts()', 'EXECUTE')
    or has_function_privilege('anon', 'public.guard_learning_attempt_retry()', 'EXECUTE')
    or has_function_privilege('anon', 'public.guard_program_enrollment_first_attempt()', 'EXECUTE')
    or has_function_privilege('anon', 'public.guard_focus_evidence_source()', 'EXECUTE')
  then
    raise exception 'S6-04 trusted boundary failed: client role can execute guard functions';
  end if;
end;
$$;
