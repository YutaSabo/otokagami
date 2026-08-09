\set ON_ERROR_STOP on

do $$
declare
  function_signature regprocedure;
begin
  if (select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') <> 35 then
    raise exception 'S6-05/07 runtime migration must not add or remove public tables';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> 64 then
    raise exception 'S6-05/07 runtime migration changed existing RLS policies';
  end if;

  if exists (
    select 1 from (values
      ('program_session_items', 'slot_role'),
      ('program_session_items', 'selection_reason'),
      ('program_session_items', 'reference_text'),
      ('program_session_items', 'reference_text_version'),
      ('program_session_items', 'expected_focus_representation'),
      ('program_day_sessions', 'plan_payload_sha256'),
      ('program_day_sessions', 'completion_payload_sha256'),
      ('program_day_sessions', 'review_effective_calendar_date'),
      ('learning_attempts', 'server_verified')
    ) as required(table_name, column_name)
    left join information_schema.columns c
      on c.table_schema = 'public' and c.table_name = required.table_name and c.column_name = required.column_name
    where c.column_name is null
  ) then
    raise exception 'S6-05/07 runtime migration is missing a required column';
  end if;

  foreach function_signature in array array[
    'public.create_v2_daily_session(uuid,text,date,uuid,text,text,jsonb,text)'::regprocedure,
    'public.refresh_v2_review_slot(uuid,uuid,date,jsonb)'::regprocedure,
    'public.persist_v2_attempt(uuid,uuid,uuid,uuid,text,bigint,text,uuid,timestamp with time zone,date,text,text,text,text,text,boolean,text,text,numeric,text,text,jsonb,jsonb)'::regprocedure,
    'public.complete_v2_program_day(uuid,uuid,uuid,text,timestamp with time zone,date)'::regprocedure
  ] loop
    if has_function_privilege('anon', function_signature, 'EXECUTE')
      or has_function_privilege('authenticated', function_signature, 'EXECUTE')
      or not has_function_privilege('service_role', function_signature, 'EXECUTE')
    then
      raise exception 'Protected RPC privilege boundary failed for %', function_signature;
    end if;
  end loop;

  if not exists (select 1 from pg_trigger where tgrelid = 'public.learning_attempts'::regclass and tgname = 'learning_attempts_append_only')
    or not exists (select 1 from pg_trigger where tgrelid = 'public.learning_attempt_results'::regclass and tgname = 'learning_attempt_results_append_only')
    or not exists (select 1 from pg_trigger where tgrelid = 'public.focus_evidence'::regclass and tgname = 'focus_evidence_append_only')
  then
    raise exception 'Append-only guard trigger missing';
  end if;

  if (select count(*) from public.program_day_sessions) <> 0
    or (select count(*) from public.learning_attempts) <> 0
    or (select count(*) from public.learning_attempt_results) <> 0
  then
    raise exception 'Runtime migration inserted v2 rows';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('program_day_sessions', 'program_session_items', 'learning_attempts', 'learning_attempt_results', 'focus_evidence', 'learning_reports')
      and column_name in (
        'audio', 'audio_data', 'audio_base64', 'audio_uri', 'file_uri', 'device_uri',
        'azure_raw_json', 'provider_payload', 'access_token', 'authorization', 'secret'
      )
  ) then
    raise exception 'A prohibited audio, URI, raw provider, token, or secret column exists in v2 runtime tables';
  end if;
end;
$$;
