-- S6-08.1 / Stage 7.1 forward-only hardening.
-- No existing row is modified by migration application. DML exists only inside
-- service-role-only transactional commands.

alter table public.assessment_tickets
  add column ticket_request_id uuid;

create unique index assessment_tickets_request_id_unique
  on public.assessment_tickets(user_id, ticket_request_id)
  where ticket_request_id is not null;

comment on column public.assessment_tickets.ticket_request_id is
  'Client-generated idempotency key for issue/recover/cancel. It is not a nonce and contains no secret.';

alter table public.learning_attempts
  add column recording_started_at timestamptz,
  add column provider_result_received_at timestamptz,
  add constraint learning_attempts_recording_chronology_check check (
    (recording_started_at is null and provider_result_received_at is null)
    or (
      recording_started_at is not null
      and provider_captured_at is not null
      and provider_result_received_at is not null
      and submitted_at is not null
      and recording_started_at <= provider_captured_at
      and provider_captured_at <= provider_result_received_at
      and provider_result_received_at <= submitted_at
    )
  );

comment on column public.learning_attempts.recording_started_at is
  'Device recording start instant bound into the canonical payload hash; not inferred from provider completion.';
comment on column public.learning_attempts.provider_result_received_at is
  'Instant the direct-to-Azure result was received. Raw provider payload and audio are never stored.';

create or replace function public.issue_v2_assessment_ticket_v3(
  p_user_id uuid,
  p_ticket_request_id uuid,
  p_session_item_id uuid,
  p_attempt_purpose text,
  p_nonce_sha256 text,
  p_deletion_epoch bigint,
  p_capture_ttl_seconds integer,
  p_submission_window_seconds integer,
  p_rate_window_seconds integer,
  p_rate_limit_max integer,
  p_issued_at timestamptz,
  p_entitlement_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare existing_row public.assessment_tickets%rowtype; result jsonb; ticket_id uuid;
  item_row public.program_session_items%rowtype; session_row public.program_day_sessions%rowtype;
begin
  if p_ticket_request_id is null then
    raise exception using message='V2_TICKET_REQUEST_ID_REQUIRED',errcode='22023';
  end if;
  perform public.lock_v2_user_mutation(p_user_id);
  select * into existing_row from public.assessment_tickets
    where user_id=p_user_id and ticket_request_id=p_ticket_request_id for update;
  if existing_row.id is not null then
    if existing_row.session_item_id<>p_session_item_id
      or existing_row.attempt_purpose<>p_attempt_purpose
      or existing_row.nonce_sha256<>p_nonce_sha256
      or existing_row.deletion_epoch<>p_deletion_epoch
    then raise exception using message='IDEMPOTENCY_PAYLOAD_CONFLICT',errcode='23505'; end if;
    return jsonb_build_object(
      'ticket_id',existing_row.id,'ticket_request_id',existing_row.ticket_request_id,
      'capture_expires_at',existing_row.capture_expires_at,
      'submission_expires_at',existing_row.submission_expires_at,
      'status',existing_row.status,'replayed',true
    );
  end if;
  select * into item_row from public.program_session_items
    where id=p_session_item_id and user_id=p_user_id;
  select * into session_row from public.program_day_sessions
    where id=item_row.session_id and user_id=p_user_id;
  if session_row.validation_only then
    if session_row.validation_installation_sha256 is null or not exists (
      select 1 from public.v2_validation_content_access a
      where a.user_id=p_user_id and a.content_version_id=session_row.content_version_id
        and a.installation_sha256=session_row.validation_installation_sha256
        and a.revoked_at is null and (a.expires_at is null or a.expires_at>p_issued_at)
    ) then raise exception using message='VALIDATION_TESTER_NOT_ALLOWED',errcode='42501'; end if;
    perform set_config('app.v2_validation_access','on',true);
  end if;
  result:=public.issue_v2_assessment_ticket_v2(
    p_user_id,p_session_item_id,p_attempt_purpose,p_nonce_sha256,p_deletion_epoch,
    p_capture_ttl_seconds,p_submission_window_seconds,p_rate_window_seconds,
    p_rate_limit_max,p_issued_at,p_entitlement_id
  );
  ticket_id:=(result->>'ticket_id')::uuid;
  perform set_config('app.v2_trusted_command','on',true);
  update public.assessment_tickets set ticket_request_id=p_ticket_request_id where id=ticket_id;
  perform set_config('app.v2_trusted_command','off',true);
  return result||jsonb_build_object('ticket_request_id',p_ticket_request_id,'status','issued','replayed',false);
end;
$$;

create or replace function public.recover_v2_assessment_ticket(
  p_user_id uuid,p_ticket_request_id uuid,p_nonce_sha256 text,p_server_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare ticket_row public.assessment_tickets%rowtype; v_current_epoch bigint;
begin
  perform public.lock_v2_user_mutation(p_user_id);
  select * into ticket_row from public.assessment_tickets
    where user_id=p_user_id and ticket_request_id=p_ticket_request_id for update;
  select e.current_epoch into v_current_epoch from public.learning_deletion_epochs e where e.user_id=p_user_id for update;
  if ticket_row.id is null or ticket_row.nonce_sha256<>p_nonce_sha256
    or ticket_row.deletion_epoch<>v_current_epoch
  then raise exception using message='ASSESSMENT_TICKET_INVALID',errcode='42501'; end if;
  if ticket_row.status='issued' and p_server_now>ticket_row.submission_expires_at then
    perform set_config('app.v2_trusted_command','on',true);
    update public.assessment_tickets set status='expired' where id=ticket_row.id;
    perform set_config('app.v2_trusted_command','off',true);
    ticket_row.status:='expired';
  end if;
  return jsonb_build_object(
    'ticket_id',ticket_row.id,'ticket_request_id',ticket_row.ticket_request_id,
    'session_id',ticket_row.session_id,'session_item_id',ticket_row.session_item_id,
    'content_version_id',ticket_row.content_version_id,'deletion_epoch',ticket_row.deletion_epoch,
    'capture_expires_at',ticket_row.capture_expires_at,
    'submission_expires_at',ticket_row.submission_expires_at,
    'status',ticket_row.status,'consumed_attempt_id',ticket_row.consumed_attempt_id
  );
end;
$$;

-- Keep attempts immutable except for the one trusted, null-to-value chronology
-- attachment performed immediately after the atomic legacy v2 insert. The
-- deletion-only FK-cycle exception remains unchanged.
create or replace function public.guard_v2_append_only_update()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_table_name='learning_attempts'
    and current_setting('app.v2_learning_delete',true)='on'
    and new.assessment_ticket_id is null
    and (to_jsonb(new)-'assessment_ticket_id')=(to_jsonb(old)-'assessment_ticket_id')
  then return new; end if;
  if tg_table_name='learning_attempts'
    and current_setting('app.v2_trusted_command',true)='on'
    and old.recording_started_at is null and old.provider_result_received_at is null
    and new.recording_started_at is not null and new.provider_result_received_at is not null
    and (to_jsonb(new)-'recording_started_at'-'provider_result_received_at')
      =(to_jsonb(old)-'recording_started_at'-'provider_result_received_at')
  then return new; end if;
  raise exception using message='V2_APPEND_ONLY_ROW',errcode='55000';
end;
$$;

create or replace function public.cancel_v2_assessment_ticket(
  p_user_id uuid,p_ticket_request_id uuid,p_nonce_sha256 text,p_server_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare ticket_row public.assessment_tickets%rowtype;
begin
  perform public.recover_v2_assessment_ticket(p_user_id,p_ticket_request_id,p_nonce_sha256,p_server_now);
  select * into ticket_row from public.assessment_tickets
    where user_id=p_user_id and ticket_request_id=p_ticket_request_id for update;
  if ticket_row.status='consumed' then
    raise exception using message='ASSESSMENT_TICKET_ALREADY_CONSUMED',errcode='23514';
  end if;
  if ticket_row.status='issued' then
    perform set_config('app.v2_trusted_command','on',true);
    update public.assessment_tickets set status='expired' where id=ticket_row.id;
    perform set_config('app.v2_trusted_command','off',true);
  end if;
  return jsonb_build_object(
    'ticket_id',ticket_row.id,'ticket_request_id',ticket_row.ticket_request_id,
    'status','expired','cancelled',true
  );
end;
$$;

create or replace function public.persist_v2_attempt_v3(
  p_user_id uuid,p_session_item_id uuid,p_client_attempt_id uuid,p_payload_sha256 text,
  p_deletion_epoch bigint,p_assessment_ticket_id uuid,p_ticket_request_id uuid,
  p_ticket_nonce_sha256 text,p_captured_at timestamptz,p_recording_started_at timestamptz,
  p_provider_result_received_at timestamptz,p_server_now timestamptz,p_attempted_at timestamptz,
  p_calendar_date date,p_timezone text,p_provider text,p_assessment_locale text,
  p_provider_version text,p_normalizer_version text,p_normalization_status text,
  p_provider_attested boolean,p_technical_valid boolean,p_invalid_reason text,
  p_observed_candidate text,p_target_score numeric,p_result_label text,p_next_action_key text,
  p_capability_flags jsonb,p_normalized_detail jsonb,p_entitlement_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare ticket_row public.assessment_tickets%rowtype; result jsonb; attempt_id uuid;
  v_current_epoch bigint; session_row public.program_day_sessions%rowtype;
begin
  if p_recording_started_at is null or p_captured_at is null or p_provider_result_received_at is null
    or p_recording_started_at>p_captured_at
    or p_captured_at>p_provider_result_received_at
    or p_provider_result_received_at>p_server_now
  then raise exception using message='V2_ATTEMPT_CHRONOLOGY_INVALID',errcode='22023'; end if;
  perform public.lock_v2_user_mutation(p_user_id);
  select current_epoch into v_current_epoch from public.learning_deletion_epochs
    where user_id=p_user_id for update;
  if v_current_epoch is null or v_current_epoch<>p_deletion_epoch then
    raise exception using message='DELETION_EPOCH_CONFLICT',errcode='40001'; end if;
  select * into ticket_row from public.assessment_tickets
    where id=p_assessment_ticket_id and user_id=p_user_id and ticket_request_id=p_ticket_request_id
      and session_item_id=p_session_item_id for update;
  if ticket_row.id is null or ticket_row.nonce_sha256<>p_ticket_nonce_sha256
  then raise exception using message='ASSESSMENT_TICKET_BINDING_MISMATCH',errcode='42501'; end if;
  select * into session_row from public.program_day_sessions
    where id=ticket_row.session_id and user_id=p_user_id;
  if session_row.validation_only then perform set_config('app.v2_validation_access','on',true); end if;
  result:=public.persist_v2_attempt_v2(
    p_user_id,p_session_item_id,p_client_attempt_id,p_payload_sha256,p_deletion_epoch,
    p_assessment_ticket_id,p_ticket_nonce_sha256,p_captured_at,p_server_now,p_attempted_at,
    p_calendar_date,p_timezone,p_provider,p_assessment_locale,p_provider_version,p_normalizer_version,
    p_normalization_status,p_provider_attested,p_technical_valid,p_invalid_reason,p_observed_candidate,
    p_target_score,p_result_label,p_next_action_key,p_capability_flags,p_normalized_detail,p_entitlement_id
  );
  attempt_id:=(result->>'attempt_id')::uuid;
  perform set_config('app.v2_trusted_command','on',true);
  update public.learning_attempts set recording_started_at=p_recording_started_at,
    provider_result_received_at=p_provider_result_received_at where id=attempt_id
      and recording_started_at is null and provider_result_received_at is null;
  perform set_config('app.v2_trusted_command','off',true);
  return result||jsonb_build_object('ticket_request_id',p_ticket_request_id);
end;
$$;

create or replace function public.complete_v2_review_submission_v2(
  p_user_id uuid,p_review_schedule_id uuid,p_session_item_id uuid,p_attempt_id uuid,
  p_deletion_epoch bigint,p_completion_idempotency_key uuid,p_completed_at timestamptz,
  p_calendar_date date
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare schedule_row public.review_schedules%rowtype; due_date date; result jsonb;
begin
  perform public.lock_v2_user_mutation(p_user_id);
  select * into schedule_row from public.review_schedules
    where id=p_review_schedule_id and user_id=p_user_id for update;
  if schedule_row.id is null then raise exception using message='V2_REVIEW_COMPLETION_INVALID',errcode='23514'; end if;
  due_date:=schedule_row.based_on_calendar_date + case schedule_row.interval_kind
    when 'day_1' then 1 when 'day_3' then 3 when 'day_7' then 7 when 'day_14' then 14 end;
  if due_date is null or schedule_row.review_due_date<>due_date then
    raise exception using message='V2_REVIEW_DUE_DATE_INVALID',errcode='23514';
  end if;
  result:=public.complete_v2_review_submission(
    p_user_id,p_review_schedule_id,p_session_item_id,p_attempt_id,p_deletion_epoch,
    p_completion_idempotency_key,p_completed_at,p_calendar_date
  );
  perform set_config('app.v2_trusted_command','on',true);
  update public.review_schedules set status='completed',
    completion_evidence_id=based_on_evidence_id,updated_at=p_completed_at
    where id=p_review_schedule_id and status in ('scheduled','due','overdue');
  perform set_config('app.v2_trusted_command','off',true);
  return result||jsonb_build_object('schedule_status','completed','review_due_date',due_date);
end;
$$;

create or replace function public.delete_v2_learning_data_atomic_v2(
  p_user_id uuid,p_deletion_request_id uuid,p_expected_deletion_epoch bigint,p_server_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare result jsonb; canonical_epoch bigint; request_epoch bigint;
begin
  result:=public.delete_v2_learning_data_atomic(
    p_user_id,p_deletion_request_id,p_expected_deletion_epoch,p_server_now
  );
  select current_epoch into canonical_epoch from public.learning_deletion_epochs where user_id=p_user_id;
  request_epoch:=(result->>'resulting_epoch')::bigint;
  return (result-'deletion_epoch')||jsonb_build_object(
    'deletion_epoch',canonical_epoch,
    'canonical_deletion_epoch',canonical_epoch,
    'request_resulting_epoch',request_epoch,
    'superseded',request_epoch<canonical_epoch
  );
end;
$$;

create or replace function public.guard_v2_lifecycle_append_only()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if current_setting('app.v2_learning_delete',true)='on' and tg_op='DELETE' then return old; end if;
  raise exception using message='V2_APPEND_ONLY_ROW',errcode='55000';
end;
$$;

create trigger review_completion_receipts_append_only
before update or delete on public.review_completion_receipts
for each row execute function public.guard_v2_lifecycle_append_only();
create trigger learning_deletion_requests_append_only
before update or delete on public.learning_deletion_requests
for each row execute function public.guard_v2_lifecycle_append_only();

revoke update,delete on public.review_completion_receipts from service_role;
revoke update,delete on public.learning_deletion_requests from service_role;

revoke all on function public.issue_v2_assessment_ticket_v3(uuid,uuid,uuid,text,text,bigint,integer,integer,integer,integer,timestamptz,text) from public,anon,authenticated;
revoke all on function public.recover_v2_assessment_ticket(uuid,uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.cancel_v2_assessment_ticket(uuid,uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.persist_v2_attempt_v3(uuid,uuid,uuid,text,bigint,uuid,uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,date,text,text,text,text,text,text,boolean,boolean,text,text,numeric,text,text,jsonb,jsonb,text) from public,anon,authenticated;
revoke all on function public.complete_v2_review_submission_v2(uuid,uuid,uuid,uuid,bigint,uuid,timestamptz,date) from public,anon,authenticated;
revoke all on function public.delete_v2_learning_data_atomic_v2(uuid,uuid,bigint,timestamptz) from public,anon,authenticated;

grant execute on function public.issue_v2_assessment_ticket_v3(uuid,uuid,uuid,text,text,bigint,integer,integer,integer,integer,timestamptz,text) to service_role;
grant execute on function public.recover_v2_assessment_ticket(uuid,uuid,text,timestamptz) to service_role;
grant execute on function public.cancel_v2_assessment_ticket(uuid,uuid,text,timestamptz) to service_role;
grant execute on function public.persist_v2_attempt_v3(uuid,uuid,uuid,text,bigint,uuid,uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,date,text,text,text,text,text,text,boolean,boolean,text,text,numeric,text,text,jsonb,jsonb,text) to service_role;
grant execute on function public.complete_v2_review_submission_v2(uuid,uuid,uuid,uuid,bigint,uuid,timestamptz,date) to service_role;
grant execute on function public.delete_v2_learning_data_atomic_v2(uuid,uuid,bigint,timestamptz) to service_role;

comment on function public.issue_v2_assessment_ticket_v3(uuid,uuid,uuid,text,text,bigint,integer,integer,integer,integer,timestamptz,text) is
  'Service-only idempotent ticket issue/recovery boundary. Raw nonce and Azure token are never returned or persisted.';
comment on function public.persist_v2_attempt_v3(uuid,uuid,uuid,text,bigint,uuid,uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,date,text,text,text,text,text,text,boolean,boolean,text,text,numeric,text,text,jsonb,jsonb,text) is
  'Service-only attempt persistence with request binding and recording/provider/submission chronology.';

-- Development validation content is a separate release channel. Existing
-- releases retain their production meaning through the constant defaults.
alter table public.content_versions
  add column release_channel text not null default 'production',
  add column validation_only boolean not null default false,
  add constraint content_versions_release_channel_check check (
    (release_channel = 'production' and not validation_only)
    or (
      release_channel = 'development_validation'
      and validation_only
      and status = 'draft'
      and linguistic_reviewed_at is null
      and azure_validated_at is null
      and activated_at is null
    )
  );

comment on column public.content_versions.release_channel is
  'production is the public content lifecycle. development_validation is isolated Preview/Development Build evidence and is never public active content.';
comment on column public.content_versions.validation_only is
  'True only for development_validation releases; excluded from formal content counts, trial, durable evidence, and reports.';

alter table public.program_day_sessions
  add column validation_only boolean not null default false,
  add column validation_installation_sha256 text,
  add constraint program_day_sessions_validation_trial_check check (
    (not validation_only and validation_installation_sha256 is null)
    or (validation_only and trial_program_day is null and validation_installation_sha256 ~ '^[0-9a-f]{64}$')
  );

comment on column public.program_day_sessions.validation_only is
  'Marks an isolated device-validation session. Such a session cannot consume a trial day or derive durable evidence/formal reports.';
comment on column public.program_day_sessions.validation_installation_sha256 is
  'One-way installation digest bound to a validation-only session; never a raw device identifier.';

create or replace function public.v2_subscription_access(
  p_user_id uuid,p_entitlement_id text,p_server_now timestamptz
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select current_setting('app.v2_validation_access',true)='on' or (
    p_entitlement_id is not null and exists (
      select 1 from public.subscriptions s where s.user_id=p_user_id
        and s.revenuecat_app_user_id=p_user_id::text and s.entitlement_id=p_entitlement_id
        and s.status='active' and s.is_active and s.current_period_ends_at is not null
        and s.current_period_ends_at>p_server_now
    )
  );
$$;

create table public.v2_validation_content_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  content_version_id uuid not null references public.content_versions(id) on delete cascade,
  installation_sha256 text not null check (installation_sha256 ~ '^[0-9a-f]{64}$'),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  primary key (user_id, content_version_id, installation_sha256),
  constraint v2_validation_content_access_lifecycle_check check (
    (expires_at is null or expires_at > granted_at)
    and (revoked_at is null or revoked_at >= granted_at)
  )
);

comment on table public.v2_validation_content_access is
  'Service-only exact tester/content/installation allowlist. The installation value is a one-way SHA-256 digest, never a raw device identifier.';

create index v2_validation_content_access_lookup_idx
  on public.v2_validation_content_access(user_id, content_version_id, installation_sha256)
  where revoked_at is null;

alter table public.v2_validation_content_access enable row level security;
revoke all on public.v2_validation_content_access from public, anon, authenticated;
grant select, insert, update, delete on public.v2_validation_content_access to service_role;

create or replace function public.guard_v2_validation_access_content()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if not exists (
    select 1 from public.content_versions c
    where c.id = new.content_version_id
      and c.release_channel = 'development_validation'
      and c.validation_only
      and c.status = 'draft'
      and c.linguistic_reviewed_at is null
      and c.azure_validated_at is null
      and c.activated_at is null
  ) then
    raise exception using message='V2_VALIDATION_CONTENT_NOT_ISOLATED',errcode='23514';
  end if;
  return new;
end;
$$;

create trigger v2_validation_content_access_content_guard
before insert or update on public.v2_validation_content_access
for each row execute function public.guard_v2_validation_access_content();

create or replace function public.guard_v2_validation_session_isolation()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare content_row public.content_versions%rowtype;
begin
  if tg_op='UPDATE' and (
    new.validation_only is distinct from old.validation_only
    or new.validation_installation_sha256 is distinct from old.validation_installation_sha256
  ) then raise exception using message='V2_VALIDATION_SESSION_BINDING_IMMUTABLE',errcode='23514'; end if;
  select * into content_row from public.content_versions where id = new.content_version_id;
  if content_row.id is null then
    raise exception using message='CONTENT_NOT_READY',errcode='P0001';
  end if;
  if new.validation_only then
    if new.trial_program_day is not null
      or content_row.release_channel <> 'development_validation'
      or not content_row.validation_only
      or content_row.status <> 'draft'
      or content_row.linguistic_reviewed_at is not null
      or content_row.azure_validated_at is not null
      or content_row.activated_at is not null
    then raise exception using message='V2_VALIDATION_SESSION_NOT_ISOLATED',errcode='23514'; end if;
    if tg_op = 'UPDATE' and old.status <> 'completed' and new.status = 'completed'
      and current_setting('app.v2_validation_completion',true) is distinct from 'on'
    then raise exception using message='V2_VALIDATION_COMPLETION_REQUIRES_ISOLATED_COMMAND',errcode='42501'; end if;
  elsif content_row.release_channel <> 'production' or content_row.validation_only then
    raise exception using message='V2_PRODUCTION_SESSION_CONTENT_INVALID',errcode='23514';
  end if;
  return new;
end;
$$;

create trigger program_day_sessions_validation_isolation
before insert or update on public.program_day_sessions
for each row execute function public.guard_v2_validation_session_isolation();

-- A technically-valid validation attempt may be persisted for device evidence,
-- but it must never become the first trial attempt or consume a trial grant.
create or replace function public.guard_v2_validation_trial_exclusion()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if new.first_valid_learning_attempt_id is distinct from old.first_valid_learning_attempt_id
    and new.first_valid_learning_attempt_id is not null
    and exists (
      select 1
      from public.learning_attempts a
      join public.program_day_sessions s on s.id=a.session_id and s.user_id=a.user_id
      where a.id=new.first_valid_learning_attempt_id and a.user_id=new.user_id and s.validation_only
    )
  then
    new.trial_grant_consumed := old.trial_grant_consumed;
    new.trial_granted_at := old.trial_granted_at;
    new.first_valid_learning_attempt_id := old.first_valid_learning_attempt_id;
    new.trial_status := old.trial_status;
    new.trial_started_at := old.trial_started_at;
    new.current_program_day := old.current_program_day;
    new.completed_program_days := old.completed_program_days;
    new.last_completed_calendar_date := old.last_completed_calendar_date;
    new.day_7_report_status := old.day_7_report_status;
  end if;
  return new;
end;
$$;

create trigger a_program_enrollments_validation_trial_exclusion
before update on public.program_enrollments
for each row execute function public.guard_v2_validation_trial_exclusion();

create or replace function public.guard_v2_validation_durable_derivation()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare validation_source boolean := false;
begin
  if tg_table_name = 'focus_evidence' then
    validation_source := exists (
      select 1 from public.learning_attempts a
      join public.program_day_sessions s on s.id=a.session_id and s.user_id=a.user_id
      where a.id=new.source_attempt_id and a.user_id=new.user_id and s.validation_only
    ) or exists (
      select 1 from public.correction_cycles c
      join public.learning_attempts a on a.id=c.after_attempt_id and a.user_id=c.user_id
      join public.program_day_sessions s on s.id=a.session_id and s.user_id=a.user_id
      where c.id=new.correction_cycle_id and c.user_id=new.user_id and s.validation_only
    );
  elsif tg_table_name = 'learning_reports' then
    validation_source := exists (
      select 1 from public.content_versions c
      where c.id=new.generated_content_version_id and c.validation_only
    );
  end if;
  if validation_source then
    raise exception using message='V2_VALIDATION_DURABLE_DERIVATION_FORBIDDEN',errcode='42501';
  end if;
  return new;
end;
$$;

create trigger focus_evidence_validation_isolation
before insert or update on public.focus_evidence
for each row execute function public.guard_v2_validation_durable_derivation();
create trigger learning_reports_validation_isolation
before insert or update on public.learning_reports
for each row execute function public.guard_v2_validation_durable_derivation();

create or replace function public.create_v2_validation_daily_session_secure(
  p_user_id uuid,p_timezone text,p_calendar_date date,p_content_version_id uuid,
  p_focus_group_key text,p_plan_payload_sha256 text,p_items jsonb,p_program_version text,
  p_entitlement_id text,p_server_now timestamptz,p_installation_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $$
declare content_row public.content_versions%rowtype; enrollment_row public.program_enrollments%rowtype;
  session_row public.program_day_sessions%rowtype; item jsonb; required_count integer;
  optional_count integer; next_sequence bigint;
begin
  -- Validation never consumes entitlement or trial state. Touch the supplied
  -- server metadata only to make that intentional non-authoritative boundary explicit.
  perform nullif(p_entitlement_id,'');
  if p_user_id is null or nullif(btrim(p_timezone),'') is null
    or nullif(btrim(p_focus_group_key),'') is null
    or p_plan_payload_sha256 !~ '^[0-9a-f]{64}$'
    or p_installation_sha256 !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_items)<>'array'
    or jsonb_array_length(p_items)<5 or jsonb_array_length(p_items)>7
    or timezone(p_timezone,p_server_now)::date<>p_calendar_date
  then raise exception using message='V2_VALIDATION_SESSION_INPUT_INVALID',errcode='22023'; end if;

  perform public.lock_v2_user_mutation(p_user_id);
  select * into content_row from public.content_versions where id=p_content_version_id for share;
  if content_row.id is null
    or content_row.release_channel<>'development_validation'
    or not content_row.validation_only
    or content_row.status<>'draft'
    or content_row.linguistic_reviewed_at is not null
    or content_row.azure_validated_at is not null
    or content_row.activated_at is not null
    or content_row.assessment_locale<>'en-US'
    or content_row.coaching_locale<>'ja-JP'
    or p_program_version<>content_row.stable_release_id||':'||content_row.version::text
  then raise exception using message='VALIDATION_CONTENT_NOT_READY',errcode='P0001'; end if;
  if not exists (
    select 1 from public.v2_validation_content_access a
    where a.user_id=p_user_id and a.content_version_id=p_content_version_id
      and a.installation_sha256=p_installation_sha256 and a.revoked_at is null
      and (a.expires_at is null or a.expires_at>p_server_now)
  ) then raise exception using message='VALIDATION_TESTER_NOT_ALLOWED',errcode='42501'; end if;

  select * into session_row from public.program_day_sessions
    where user_id=p_user_id and status in ('planned','in_progress')
    order by created_at limit 1 for update;
  if session_row.id is not null then
    if session_row.validation_only and session_row.content_version_id=p_content_version_id
      and session_row.plan_payload_sha256=p_plan_payload_sha256
    then return jsonb_build_object('session_id',session_row.id,'replayed',true,'validation_only',true); end if;
    raise exception using message='V2_SESSION_NOT_AVAILABLE',errcode='23514';
  end if;

  select count(*) filter(where coalesce((value->>'required')::boolean,false)),
    count(*) filter(where not coalesce((value->>'required')::boolean,false))
    into required_count,optional_count from jsonb_array_elements(p_items);
  if required_count<>5 or optional_count not between 0 and 2 then
    raise exception using message='V2_PLAN_MUST_HAVE_FIVE_REQUIRED_ITEMS',errcode='23514'; end if;

  insert into public.program_enrollments(user_id,program_version)
    values(p_user_id,p_program_version) on conflict(user_id) do nothing;
  select * into enrollment_row from public.program_enrollments where user_id=p_user_id for update;
  select coalesce(max(learning_day_sequence),0)+1 into next_sequence
    from public.program_day_sessions where user_id=p_user_id;

  insert into public.program_day_sessions(
    user_id,enrollment_id,learning_day_sequence,trial_program_day,originating_calendar_date,
    timezone,content_version_id,focus_group_key,required_item_count,optional_item_count,
    plan_payload_sha256,review_effective_calendar_date,validation_only,validation_installation_sha256
  ) values (
    p_user_id,enrollment_row.id,next_sequence,null,p_calendar_date,p_timezone,p_content_version_id,
    p_focus_group_key,required_count,optional_count,p_plan_payload_sha256,p_calendar_date,true,p_installation_sha256
  ) returning * into session_row;

  for item in select value from jsonb_array_elements(p_items) loop
    if nullif(btrim(item->>'practiceItemKey'),'') is null
      or nullif(btrim(item->>'referenceText'),'') is null
      or nullif(btrim(item->>'referenceTextVersion'),'') is null
      or nullif(btrim(item->>'expectedFocusRepresentation'),'') is null
      or jsonb_typeof(item->'targetLocator')<>'object'
      or item->>'focusGroupKey' is distinct from p_focus_group_key
      or item->>'slotRole'='review'
      or nullif(item->>'reviewScheduleId','') is not null
      or nullif(item->>'reviewSourceEvidenceId','') is not null
    then raise exception using message='V2_VALIDATION_MANAGED_ITEM_INVALID',errcode='22023'; end if;
    insert into public.program_session_items(
      user_id,session_id,position,content_version_id,practice_item_key,focus_group_key,
      prompt_role,slot_role,selection_reason,is_required,reference_text,reference_text_version,
      expected_focus_representation,next_action_key,target_locator,advice_version
    ) values (
      p_user_id,session_row.id,(item->>'position')::smallint,p_content_version_id,
      item->>'practiceItemKey',item->>'focusGroupKey',item->>'promptRole',item->>'slotRole',
      item->>'selectionReason',(item->>'required')::boolean,item->>'referenceText',
      item->>'referenceTextVersion',item->>'expectedFocusRepresentation',
      nullif(item->>'nextActionKey',''),item->'targetLocator',nullif(item->>'adviceVersion','')::integer
    );
  end loop;
  insert into public.learning_deletion_epochs(user_id,current_epoch) values(p_user_id,0)
    on conflict(user_id) do nothing;
  return jsonb_build_object('session_id',session_row.id,'replayed',false,'validation_only',true);
end;
$$;

create or replace function public.complete_v2_validation_session_secure(
  p_user_id uuid,p_session_id uuid,p_completion_idempotency_key uuid,
  p_completion_payload_sha256 text,p_completed_at timestamptz,p_calendar_date date
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare session_row public.program_day_sessions%rowtype; completed_required integer;
begin
  if p_completion_idempotency_key is null
    or p_completion_payload_sha256 !~ '^[0-9a-f]{64}$'
  then raise exception using message='V2_COMPLETION_INPUT_INVALID',errcode='22023'; end if;
  perform public.lock_v2_user_mutation(p_user_id);
  select * into session_row from public.program_day_sessions
    where id=p_session_id and user_id=p_user_id for update;
  if session_row.id is null or not session_row.validation_only then
    raise exception using message='V2_VALIDATION_SESSION_NOT_FOUND',errcode='42501';
  end if;
  if session_row.status='completed' then
    if session_row.completion_idempotency_key=p_completion_idempotency_key
      and session_row.completion_payload_sha256=p_completion_payload_sha256
    then return jsonb_build_object('session_id',session_row.id,'replayed',true,
      'validation_only',true,'learning_day_sequence',session_row.learning_day_sequence);
    end if;
    raise exception using message='IDEMPOTENCY_PAYLOAD_CONFLICT',errcode='23505';
  end if;
  if timezone(session_row.timezone,p_completed_at)::date<>p_calendar_date then
    raise exception using message='SESSION_TIMEZONE_MISMATCH',errcode='23514'; end if;
  if session_row.required_item_count<>5 or session_row.trial_program_day is not null then
    raise exception using message='V2_VALIDATION_SESSION_NOT_ISOLATED',errcode='23514'; end if;
  select count(*) into completed_required from public.program_session_items i
    where i.session_id=session_row.id and i.user_id=p_user_id and i.is_required and i.status='completed'
      and exists (
        select 1 from public.learning_attempts a
        where a.session_item_id=i.id and a.user_id=p_user_id and a.technical_valid
          and a.normalization_status='server_normalized'
      );
  if completed_required<>5 then
    raise exception using message='REQUIRED_ITEMS_INCOMPLETE',errcode='23514'; end if;
  perform set_config('app.v2_trusted_command','on',true);
  perform set_config('app.v2_validation_completion','on',true);
  update public.program_day_sessions set status='completed',completed_calendar_date=p_calendar_date,
    completion_idempotency_key=p_completion_idempotency_key,
    completion_payload_sha256=p_completion_payload_sha256,completed_at=p_completed_at,
    current_position=required_item_count where id=session_row.id;
  perform set_config('app.v2_validation_completion','off',true);
  perform set_config('app.v2_trusted_command','off',true);
  return jsonb_build_object('session_id',session_row.id,'replayed',false,
    'validation_only',true,'learning_day_sequence',session_row.learning_day_sequence,
    'policy_status','validation_only');
end;
$$;

revoke all on function public.guard_v2_validation_access_content() from public,anon,authenticated;
revoke all on function public.guard_v2_validation_session_isolation() from public,anon,authenticated;
revoke all on function public.guard_v2_validation_trial_exclusion() from public,anon,authenticated;
revoke all on function public.guard_v2_validation_durable_derivation() from public,anon,authenticated;
revoke all on function public.create_v2_validation_daily_session_secure(uuid,text,date,uuid,text,text,jsonb,text,text,timestamptz,text) from public,anon,authenticated;
revoke all on function public.complete_v2_validation_session_secure(uuid,uuid,uuid,text,timestamptz,date) from public,anon,authenticated;
grant execute on function public.guard_v2_validation_access_content() to service_role;
grant execute on function public.guard_v2_validation_session_isolation() to service_role;
grant execute on function public.guard_v2_validation_trial_exclusion() to service_role;
grant execute on function public.guard_v2_validation_durable_derivation() to service_role;
grant execute on function public.create_v2_validation_daily_session_secure(uuid,text,date,uuid,text,text,jsonb,text,text,timestamptz,text) to service_role;
grant execute on function public.complete_v2_validation_session_secure(uuid,uuid,uuid,text,timestamptz,date) to service_role;

comment on function public.create_v2_validation_daily_session_secure(uuid,text,date,uuid,text,text,jsonb,text,text,timestamptz,text) is
  'Service-only exact tester/installation device-validation session command. It cannot use production content, trial Program Days, due reviews, durable evidence, or formal reports.';
comment on function public.complete_v2_validation_session_secure(uuid,uuid,uuid,text,timestamptz,date) is
  'Service-only validation completion receipt. It marks only the isolated session and never mutates enrollment, trial, durable evidence, review, or formal reports.';
