\set ON_ERROR_STOP on

begin;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
    'public.issue_v2_assessment_ticket(uuid,uuid,text,text,bigint,integer,integer,integer,timestamp with time zone,text)'::regprocedure,
    'public.persist_v2_attempt_with_ticket(uuid,uuid,uuid,text,bigint,uuid,text,timestamp with time zone,date,text,text,text,text,text,text,boolean,boolean,text,text,numeric,text,text,jsonb,jsonb,text)'::regprocedure,
    'public.create_v2_daily_session(uuid,text,date,uuid,text,text,jsonb,text)'::regprocedure,
    'public.refresh_v2_review_slot(uuid,uuid,date,jsonb)'::regprocedure,
    'public.persist_v2_attempt(uuid,uuid,uuid,uuid,text,bigint,text,uuid,timestamp with time zone,date,text,text,text,text,text,boolean,text,text,numeric,text,text,jsonb,jsonb)'::regprocedure,
    'public.complete_v2_program_day(uuid,uuid,uuid,text,timestamp with time zone,date)'::regprocedure
  ] loop
    if has_function_privilege('service_role',signature,'EXECUTE')
      or has_function_privilege('authenticated',signature,'EXECUTE')
      or has_function_privilege('anon',signature,'EXECUTE')
    then raise exception 'Deprecated pre-ticket RPC remains executable: %',signature; end if;
  end loop;

  foreach signature in array array[
    'public.issue_v2_assessment_ticket_v2(uuid,uuid,text,text,bigint,integer,integer,integer,integer,timestamp with time zone,text)'::regprocedure,
    'public.abandon_v2_assessment_ticket(uuid,uuid,text,timestamp with time zone)'::regprocedure,
    'public.create_v2_daily_session_secure(uuid,text,date,uuid,text,text,jsonb,text,text,timestamp with time zone)'::regprocedure,
    'public.refresh_v2_review_slot_secure(uuid,uuid,date,jsonb,text,timestamptz)'::regprocedure,
    'public.persist_v2_attempt_v2(uuid,uuid,uuid,text,bigint,uuid,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,date,text,text,text,text,text,text,boolean,boolean,text,text,numeric,text,text,jsonb,jsonb,text)'::regprocedure,
    'public.complete_v2_review_submission(uuid,uuid,uuid,uuid,bigint,uuid,timestamp with time zone,date)'::regprocedure,
    'public.delete_v2_learning_data_atomic(uuid,uuid,bigint,timestamp with time zone)'::regprocedure,
    'public.export_v2_learning_data_snapshot(uuid,integer,timestamp with time zone)'::regprocedure,
    'public.complete_v2_program_day_secure(uuid,uuid,uuid,text,timestamp with time zone,date,text)'::regprocedure
  ] loop
    if not has_function_privilege('service_role',signature,'EXECUTE')
      or has_function_privilege('authenticated',signature,'EXECUTE')
      or has_function_privilege('anon',signature,'EXECUTE')
    then raise exception 'Hardened RPC privilege boundary failed: %',signature; end if;
  end loop;
end;
$$;

rollback;
