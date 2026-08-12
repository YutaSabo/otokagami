\set ON_ERROR_STOP on

begin;

do $$
begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='assessment_tickets' and column_name='ticket_request_id')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='learning_attempts' and column_name='recording_started_at')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='learning_attempts' and column_name='provider_result_received_at')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='content_versions' and column_name='release_channel')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='content_versions' and column_name='validation_only')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='program_day_sessions' and column_name='validation_only')
  then raise exception 'S6-08.1 ticket/attempt columns missing'; end if;

  if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='v2_validation_content_access')
    or not (select relrowsecurity from pg_class where oid='public.v2_validation_content_access'::regclass)
  then raise exception 'S6-08.1 validation access isolation missing'; end if;

  if has_function_privilege('authenticated','public.issue_v2_assessment_ticket_v3(uuid,uuid,uuid,text,text,bigint,integer,integer,integer,integer,timestamp with time zone,text)','EXECUTE')
    or has_function_privilege('anon','public.recover_v2_assessment_ticket(uuid,uuid,text,timestamp with time zone)','EXECUTE')
    or has_function_privilege('authenticated','public.cancel_v2_assessment_ticket(uuid,uuid,text,timestamp with time zone)','EXECUTE')
    or has_function_privilege('anon','public.delete_v2_learning_data_atomic_v2(uuid,uuid,bigint,timestamp with time zone)','EXECUTE')
    or has_function_privilege('authenticated','public.create_v2_validation_daily_session_secure(uuid,text,date,uuid,text,text,jsonb,text,text,timestamp with time zone,text)','EXECUTE')
    or has_function_privilege('anon','public.create_v2_validation_daily_session_secure(uuid,text,date,uuid,text,text,jsonb,text,text,timestamp with time zone,text)','EXECUTE')
  then raise exception 'S6-08.1 protected RPC leaked to a client role'; end if;

  if has_table_privilege('anon','public.v2_validation_content_access','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.v2_validation_content_access','SELECT,INSERT,UPDATE,DELETE')
    or not has_table_privilege('service_role','public.v2_validation_content_access','SELECT,INSERT,UPDATE,DELETE')
  then raise exception 'S6-08.1 validation access grants are unsafe'; end if;

  if has_table_privilege('service_role','public.review_completion_receipts','UPDATE')
    or has_table_privilege('service_role','public.review_completion_receipts','DELETE')
    or has_table_privilege('service_role','public.learning_deletion_requests','UPDATE')
    or has_table_privilege('service_role','public.learning_deletion_requests','DELETE')
  then raise exception 'S6-08.1 append-only ledger grants are unsafe'; end if;
end;
$$;

rollback;
