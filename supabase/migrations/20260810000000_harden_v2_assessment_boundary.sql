-- S6-07 forward-only hardening for the client-carried Azure assessment boundary.
-- Existing v1 objects and rows are not backfilled, renamed, dropped, or deleted.

alter table public.program_session_items
  add column target_locator jsonb,
  add column advice_version integer,
  add constraint program_session_items_target_locator_check check (
    target_locator is null or (
      jsonb_typeof(target_locator) = 'object'
      and target_locator ? 'wordIndex'
      and target_locator ? 'phonemeIndex'
      and (target_locator - 'wordIndex' - 'phonemeIndex') = '{}'::jsonb
      and (target_locator->>'wordIndex') ~ '^[0-9]+$'
      and (target_locator->>'phonemeIndex') ~ '^[0-9]+$'
    )
  ),
  add constraint program_session_items_advice_version_check
    check (advice_version is null or advice_version > 0);

comment on column public.program_session_items.target_locator is
  'Immutable zero-based wordIndex and phonemeIndex bound to the managed reference snapshot.';

alter table public.program_session_items
  add constraint program_session_items_ticket_binding_unique
  unique (id, user_id, session_id, content_version_id, practice_item_key, focus_group_key);

alter table public.learning_attempts
  add column normalization_status text not null default 'rejected'
    check (normalization_status in ('server_normalized', 'rejected')),
  add column provider_attested boolean not null default false,
  add column assessment_ticket_id uuid;

comment on column public.learning_attempts.server_verified is
  'Deprecated legacy runtime flag. It does not prove provider authenticity and new v2 decisions must not read it.';
comment on column public.learning_attempts.normalization_status is
  'server_normalized means strict trusted-API validation of client-carried provider JSON; it is not provider attestation.';
comment on column public.learning_attempts.provider_attested is
  'Reserved for a future cryptographic provider-attestation boundary. Client-carried Azure results remain false.';

alter table public.learning_attempt_results
  add column normalization_status text not null default 'rejected'
    check (normalization_status in ('server_normalized', 'rejected')),
  add column provider_attested boolean not null default false;

alter table public.focus_evidence
  add column normalization_status text not null default 'rejected'
    check (normalization_status in ('server_normalized', 'rejected'));
comment on column public.focus_evidence.server_verified is
  'Deprecated legacy evidence flag. New derivations require normalization_status=server_normalized.';

alter table public.program_enrollments
  add column trial_granted_at timestamptz,
  add column trial_grant_consumed boolean not null default false;

comment on column public.program_enrollments.trial_grant_consumed is
  'Monotonic trial-grant history. Learning-data deletion may clear attempt pointers but must not regrant the trial.';

create table public.assessment_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  session_item_id uuid not null,
  content_version_id uuid not null references public.content_versions(id),
  practice_item_key text not null check (btrim(practice_item_key) <> ''),
  focus_group_key text not null check (btrim(focus_group_key) <> ''),
  reference_text_sha256 text not null check (reference_text_sha256 ~ '^[0-9a-f]{64}$'),
  reference_text_version text not null check (btrim(reference_text_version) <> ''),
  target_locator jsonb not null,
  assessment_locale text not null check (assessment_locale = 'en-US'),
  attempt_purpose text not null check (attempt_purpose in ('initial', 'guided_retry')),
  derived_attempt_role text not null check (
    derived_attempt_role in ('cold', 'guided_retry', 'transfer', 'review', 'optional_extension')
  ),
  retry_of_attempt_id uuid,
  advice_stable_key text,
  advice_version integer,
  deletion_epoch bigint not null check (deletion_epoch >= 0),
  nonce_sha256 text not null check (nonce_sha256 ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > issued_at),
  consumed_at timestamptz,
  consumed_attempt_id uuid,
  status text not null default 'issued' check (status in ('issued', 'consumed', 'expired')),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (id, user_id, session_item_id),
  constraint assessment_tickets_session_owner_fkey foreign key (session_id, user_id)
    references public.program_day_sessions(id, user_id) on delete cascade,
  constraint assessment_tickets_item_owner_fkey foreign key (
    session_item_id, user_id, session_id, content_version_id, practice_item_key, focus_group_key
  ) references public.program_session_items(
    id, user_id, session_id, content_version_id, practice_item_key, focus_group_key
  ) on delete cascade,
  constraint assessment_tickets_retry_owner_item_fkey foreign key (retry_of_attempt_id, user_id, session_item_id)
    references public.learning_attempts(id, user_id, session_item_id),
  constraint assessment_tickets_lifecycle_check check (
    (status = 'issued' and consumed_at is null and consumed_attempt_id is null)
    or (status = 'consumed' and consumed_at is not null and consumed_attempt_id is not null)
    or (status = 'expired' and consumed_at is null and consumed_attempt_id is null)
  ),
  constraint assessment_tickets_purpose_check check (
    (attempt_purpose = 'initial' and derived_attempt_role <> 'guided_retry' and retry_of_attempt_id is null)
    or (attempt_purpose = 'guided_retry' and derived_attempt_role = 'guided_retry' and retry_of_attempt_id is not null
      and advice_stable_key is not null and advice_version is not null)
  ),
  constraint assessment_tickets_attached_attempt_fkey foreign key (consumed_attempt_id, user_id, session_item_id)
    references public.learning_attempts(id, user_id, session_item_id)
);

create unique index assessment_tickets_one_unconsumed_item
  on public.assessment_tickets(user_id, session_item_id) where status = 'issued';
create index assessment_tickets_rate_idx on public.assessment_tickets(user_id, session_id, session_item_id, issued_at);

alter table public.learning_attempts
  add constraint learning_attempts_assessment_ticket_fkey
  foreign key (assessment_ticket_id, user_id, session_item_id)
  references public.assessment_tickets(id, user_id, session_item_id);

alter table public.assessment_tickets enable row level security;
revoke all on public.assessment_tickets from public, anon, authenticated;
grant select, insert, update on public.assessment_tickets to service_role;

create or replace function public.v2_subscription_access(
  p_user_id uuid, p_entitlement_id text, p_server_now timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_entitlement_id is not null and exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user_id
      and s.revenuecat_app_user_id = p_user_id::text
      and s.entitlement_id = p_entitlement_id
      and s.status = 'active'
      and s.is_active
      and s.current_period_ends_at is not null
      and s.current_period_ends_at > p_server_now
  );
$$;

create or replace function public.guard_v2_sensitive_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_setting('app.v2_trusted_command', true) is distinct from 'on' then
    raise exception using message = 'V2_DIRECT_MUTATION_FORBIDDEN', errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.guard_program_enrollment_monotonic()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare old_report_rank integer; new_report_rank integer;
  old_trial_rank integer; new_trial_rank integer;
begin
  if current_setting('app.v2_trusted_command', true) is distinct from 'on' then
    raise exception using message = 'V2_DIRECT_MUTATION_FORBIDDEN', errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  old_report_rank := case old.day_7_report_status when 'not_started' then 0 when 'pending' then 1 when 'ready' then 2 else -1 end;
  new_report_rank := case new.day_7_report_status when 'not_started' then 0 when 'pending' then 1 when 'ready' then 2 else -1 end;
  old_trial_rank := case old.trial_status when 'not_started' then 0 when 'in_progress' then 1 when 'day_7_completed' then 2 when 'exhausted' then 3 else -1 end;
  new_trial_rank := case new.trial_status when 'not_started' then 0 when 'in_progress' then 1 when 'day_7_completed' then 2 when 'exhausted' then 3 else -1 end;
  if (old.trial_grant_consumed and not new.trial_grant_consumed)
    or (old.trial_granted_at is not null and new.trial_granted_at is null)
    or new.completed_program_days < old.completed_program_days
    or new.current_program_day < old.current_program_day
    or new_report_rank < old_report_rank
    or new_trial_rank < old_trial_rank
  then raise exception using message = 'V2_ENROLLMENT_STATE_REGRESSION', errcode = '23514'; end if;
  return new;
end;
$$;

create or replace function public.guard_learning_deletion_epoch_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using message = 'V2_DELETION_EPOCH_DELETE_FORBIDDEN', errcode = '42501';
  end if;
  if current_setting('app.v2_trusted_command', true) is distinct from 'on' then
    raise exception using message = 'V2_DIRECT_MUTATION_FORBIDDEN', errcode = '42501';
  end if;
  if new.user_id <> old.user_id or new.current_epoch <> old.current_epoch + 1 then
    raise exception using message = 'V2_DELETION_EPOCH_MUST_INCREMENT', errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger assessment_tickets_trusted_mutation
before update or delete on public.assessment_tickets
for each row execute function public.guard_v2_sensitive_mutation();
create trigger program_enrollments_trusted_mutation
before update or delete on public.program_enrollments
for each row execute function public.guard_program_enrollment_monotonic();
create trigger program_day_sessions_trusted_mutation
before update or delete on public.program_day_sessions
for each row execute function public.guard_v2_sensitive_mutation();
create trigger program_session_items_trusted_mutation
before update or delete on public.program_session_items
for each row execute function public.guard_v2_sensitive_mutation();
create trigger learning_attempts_trusted_delete
before delete on public.learning_attempts
for each row execute function public.guard_v2_sensitive_mutation();
create trigger learning_attempt_results_trusted_delete
before delete on public.learning_attempt_results
for each row execute function public.guard_v2_sensitive_mutation();
create trigger correction_cycles_trusted_mutation
before update or delete on public.correction_cycles
for each row execute function public.guard_v2_sensitive_mutation();
create trigger focus_evidence_trusted_delete
before delete on public.focus_evidence
for each row execute function public.guard_v2_sensitive_mutation();
create trigger focus_states_v2_trusted_mutation
before update or delete on public.focus_states_v2
for each row execute function public.guard_v2_sensitive_mutation();
create trigger review_schedules_trusted_mutation
before update or delete on public.review_schedules
for each row execute function public.guard_v2_sensitive_mutation();
create trigger learning_reports_trusted_mutation
before update or delete on public.learning_reports
for each row execute function public.guard_v2_sensitive_mutation();
create trigger learning_report_evidence_trusted_mutation
before update or delete on public.learning_report_evidence
for each row execute function public.guard_v2_sensitive_mutation();
create trigger learning_report_correction_cycles_trusted_mutation
before update or delete on public.learning_report_correction_cycles
for each row execute function public.guard_v2_sensitive_mutation();
create trigger learning_deletion_epochs_monotonic
before update or delete on public.learning_deletion_epochs
for each row execute function public.guard_learning_deletion_epoch_mutation();

create or replace function public.guard_learning_attempt_retry()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare source_row public.learning_attempts%rowtype;
begin
  if new.attempt_role = 'guided_retry' then
    select * into source_row from public.learning_attempts where id = new.retry_of_attempt_id;
    if source_row.id is null or source_row.user_id <> new.user_id
      or source_row.session_id <> new.session_id or source_row.session_item_id <> new.session_item_id
      or source_row.focus_group_key <> new.focus_group_key or source_row.content_version_id <> new.content_version_id
      or not source_row.technical_valid or source_row.normalization_status <> 'server_normalized'
      or source_row.attempt_role = 'guided_retry' or source_row.coaching_shown
      or source_row.attempted_at >= new.attempted_at
    then raise exception using message = 'V2_GUIDED_SOURCE_INVALID', errcode = '23514'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_program_enrollment_first_attempt()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.first_valid_learning_attempt_id is not null and not exists (
    select 1 from public.learning_attempts a where a.id=new.first_valid_learning_attempt_id
      and a.user_id=new.user_id and a.technical_valid and a.normalization_status='server_normalized'
  ) then raise exception 'Enrollment first learning attempt must be valid, server-normalized, and owned by the enrolled user'; end if;
  return new;
end;
$$;

create or replace function public.guard_focus_evidence_source()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare attempt_row public.learning_attempts%rowtype; cycle_row public.correction_cycles%rowtype;
begin
  if new.normalization_status <> 'server_normalized' then
    raise exception using message='UNNORMALIZED_EVIDENCE_REJECTED',errcode='23514'; end if;
  if new.evidence_kind='immediate_change' then
    select * into cycle_row from public.correction_cycles where id=new.correction_cycle_id;
    select * into attempt_row from public.learning_attempts where id=cycle_row.before_attempt_id;
    if cycle_row.id is null or cycle_row.user_id<>new.user_id or cycle_row.focus_group_key<>new.focus_group_key
      or attempt_row.content_version_id<>new.content_version_id or attempt_row.prompt_role<>new.prompt_role
      or attempt_row.normalization_status<>'server_normalized'
    then raise exception using message='V2_IMMEDIATE_EVIDENCE_INVALID',errcode='23514'; end if;
  else
    select * into attempt_row from public.learning_attempts where id=new.source_attempt_id;
    if attempt_row.id is null or attempt_row.user_id<>new.user_id or attempt_row.focus_group_key<>new.focus_group_key
      or attempt_row.prompt_role<>new.prompt_role or attempt_row.content_version_id<>new.content_version_id
      or not attempt_row.technical_valid or attempt_row.normalization_status<>'server_normalized'
      or attempt_row.attempt_role='guided_retry' or attempt_row.coaching_shown
    then raise exception using message='V2_DURABLE_EVIDENCE_INVALID',errcode='23514'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_v2_verified_derivation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare evidence_id uuid;
begin
  if tg_table_name='focus_states_v2' then evidence_id:=new.source_evidence_id;
  elsif tg_table_name='review_schedules' then evidence_id:=new.based_on_evidence_id;
  elsif tg_table_name='learning_report_evidence' then evidence_id:=new.evidence_id;
  else return new; end if;
  if not exists (select 1 from public.focus_evidence e where e.id=evidence_id and e.user_id=new.user_id
    and e.normalization_status='server_normalized')
  then raise exception using message='UNNORMALIZED_EVIDENCE_DERIVATION_REJECTED',errcode='23514'; end if;
  return new;
end;
$$;

create or replace function public.guard_correction_cycle_attempts()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare before_row public.learning_attempts%rowtype; after_row public.learning_attempts%rowtype;
begin
  select * into before_row from public.learning_attempts where id = new.before_attempt_id;
  select * into after_row from public.learning_attempts where id = new.after_attempt_id;
  if before_row.id is null or after_row.id is null
    or before_row.user_id <> new.user_id or after_row.user_id <> new.user_id
    or before_row.session_id <> after_row.session_id
    or before_row.session_item_id <> new.session_item_id or after_row.session_item_id <> new.session_item_id
    or before_row.focus_group_key <> new.focus_group_key or after_row.focus_group_key <> new.focus_group_key
    or before_row.content_version_id <> after_row.content_version_id
    or not before_row.technical_valid or before_row.normalization_status <> 'server_normalized'
    or before_row.attempt_role = 'guided_retry' or before_row.coaching_shown
    or after_row.attempt_role <> 'guided_retry' or after_row.retry_of_attempt_id <> before_row.id
    or after_row.normalization_status <> 'server_normalized' or after_row.attempted_at <= before_row.attempted_at
  then raise exception using message = 'V2_CORRECTION_CYCLE_INVALID', errcode = '23514'; end if;
  new.immediate_change_status := 'inconclusive';
  return new;
end;
$$;

create or replace function public.issue_v2_assessment_ticket(
  p_user_id uuid, p_session_item_id uuid, p_attempt_purpose text, p_nonce_sha256 text,
  p_deletion_epoch bigint, p_ttl_seconds integer, p_rate_window_seconds integer,
  p_rate_limit_max integer, p_issued_at timestamptz, p_entitlement_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions, pg_temp
as $$
declare item_row public.program_session_items%rowtype; session_row public.program_day_sessions%rowtype;
  enrollment_row public.program_enrollments%rowtype; source_row public.learning_attempts%rowtype;
  ticket_row public.assessment_tickets%rowtype; v_current_epoch bigint; derived_role text;
begin
  if p_attempt_purpose not in ('initial','guided_retry') or p_nonce_sha256 !~ '^[0-9a-f]{64}$'
    or p_ttl_seconds <= 0 or p_rate_window_seconds <= 0 or p_rate_limit_max <= 0
  then raise exception using message = 'V2_TICKET_INPUT_INVALID', errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_session_item_id::text || ':ticket', 0));
  select e.current_epoch into v_current_epoch from public.learning_deletion_epochs e where e.user_id = p_user_id for update;
  if v_current_epoch is null or v_current_epoch <> p_deletion_epoch then
    raise exception using message = 'DELETION_EPOCH_CONFLICT', errcode = '40001';
  end if;
  select * into item_row from public.program_session_items where id = p_session_item_id and user_id = p_user_id for update;
  select * into session_row from public.program_day_sessions where id = item_row.session_id and user_id = p_user_id for update;
  select * into enrollment_row from public.program_enrollments where id = session_row.enrollment_id and user_id = p_user_id;
  if item_row.id is null or session_row.id is null or session_row.status = 'completed'
    or item_row.reference_text is null or item_row.target_locator is null
  then raise exception using message = 'V2_SESSION_ITEM_NOT_AVAILABLE', errcode = '42501'; end if;
  if enrollment_row.completed_program_days >= 7 and not public.v2_subscription_access(p_user_id,p_entitlement_id,p_issued_at) then
    raise exception using message = 'ACCESS_REQUIRED', errcode = '42501';
  end if;
  if item_row.prompt_role = 'optional_extension' and exists (
    select 1 from public.program_session_items i where i.session_id = session_row.id and i.is_required and i.status <> 'completed'
  ) then raise exception using message = 'OPTIONAL_EXTENSION_NOT_AVAILABLE', errcode = '23514'; end if;
  perform set_config('app.v2_trusted_command','on',true);
  update public.assessment_tickets set status = 'expired'
    where user_id = p_user_id and session_item_id = p_session_item_id and status = 'issued' and expires_at <= p_issued_at;
  if exists (select 1 from public.assessment_tickets where user_id=p_user_id and session_item_id=p_session_item_id and status='issued') then
    raise exception using message = 'UNCONSUMED_TICKET_EXISTS', errcode = '23505';
  end if;
  if (select count(*) from public.assessment_tickets where user_id=p_user_id and session_id=session_row.id
      and session_item_id=p_session_item_id and issued_at > p_issued_at - make_interval(secs => p_rate_window_seconds)) >= p_rate_limit_max
  then raise exception using message = 'TICKET_RATE_LIMITED', errcode = '23514'; end if;
  if p_attempt_purpose = 'guided_retry' then
    select * into source_row from public.learning_attempts
      where user_id=p_user_id and session_item_id=p_session_item_id and technical_valid
        and normalization_status='server_normalized' and attempt_role <> 'guided_retry' and not coaching_shown
      order by attempt_sequence desc limit 1;
    if source_row.id is null or item_row.next_action_key is null or item_row.advice_version is null then
      raise exception using message = 'GUIDED_RETRY_NOT_AVAILABLE', errcode = '23514';
    end if;
    derived_role := 'guided_retry';
  else
    derived_role := case
      when item_row.prompt_role = 'review' then 'review'
      when item_row.prompt_role = 'optional_extension' then 'optional_extension'
      when item_row.prompt_role in ('transfer_word','sentence','practical_sentence') then 'transfer'
      else 'cold' end;
  end if;
  insert into public.assessment_tickets(
    user_id,session_id,session_item_id,content_version_id,practice_item_key,focus_group_key,
    reference_text_sha256,reference_text_version,target_locator,assessment_locale,attempt_purpose,
    derived_attempt_role,retry_of_attempt_id,advice_stable_key,advice_version,deletion_epoch,
    nonce_sha256,issued_at,expires_at
  ) values (
    p_user_id,session_row.id,item_row.id,item_row.content_version_id,item_row.practice_item_key,item_row.focus_group_key,
    encode(extensions.digest(lower(regexp_replace(btrim(item_row.reference_text),'\s+',' ','g')),'sha256'),'hex'),
    item_row.reference_text_version,item_row.target_locator,'en-US',p_attempt_purpose,derived_role,
    source_row.id,item_row.next_action_key,item_row.advice_version,p_deletion_epoch,p_nonce_sha256,p_issued_at,
    p_issued_at + make_interval(secs => p_ttl_seconds)
  ) returning * into ticket_row;
  perform set_config('app.v2_trusted_command','off',true);
  return jsonb_build_object('ticket_id',ticket_row.id,'expires_at',ticket_row.expires_at);
end;
$$;

create or replace function public.create_v2_daily_session_secure(
  p_user_id uuid, p_timezone text, p_calendar_date date, p_content_version_id uuid,
  p_focus_group_key text, p_plan_payload_sha256 text, p_items jsonb, p_program_version text,
  p_entitlement_id text, p_server_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare previous_row public.program_day_sessions%rowtype; content_row public.content_versions%rowtype;
  result jsonb; item jsonb;
begin
  if timezone(p_timezone,p_server_now)::date <> p_calendar_date then
    raise exception using message='V2_CALENDAR_DATE_INVALID',errcode='23514';
  end if;
  select * into previous_row from public.program_day_sessions
    where user_id=p_user_id and status='completed' order by learning_day_sequence desc limit 1;
  if previous_row.id is not null and timezone(previous_row.timezone,p_server_now)::date <= previous_row.completed_calendar_date then
    raise exception using message='NEXT_LEARNING_DAY_NOT_AVAILABLE',errcode='23514';
  end if;
  select * into content_row from public.content_versions where id=p_content_version_id;
  if content_row.id is null or content_row.status <> 'active'
    or content_row.linguistic_reviewed_at is null or content_row.azure_validated_at is null
    or p_program_version <> content_row.stable_release_id || ':' || content_row.version::text
  then raise exception using message='CONTENT_NOT_READY',errcode='P0001'; end if;
  if coalesce((select completed_program_days from public.program_enrollments where user_id=p_user_id),0) >= 7
    and not public.v2_subscription_access(p_user_id,p_entitlement_id,p_server_now)
  then raise exception using message='ACCESS_REQUIRED',errcode='42501'; end if;
  perform set_config('app.v2_trusted_command','on',true);
  result := public.create_v2_daily_session(
    p_user_id,p_timezone,p_calendar_date,p_content_version_id,p_focus_group_key,
    p_plan_payload_sha256,p_items,p_program_version
  );
  insert into public.learning_deletion_epochs(user_id,current_epoch) values(p_user_id,0)
    on conflict(user_id) do nothing;
  if not coalesce((result->>'replayed')::boolean,false) then
    perform set_config('app.v2_secure_create','on',true);
    for item in select value from jsonb_array_elements(p_items) loop
      if jsonb_typeof(item->'targetLocator') <> 'object' then
        raise exception using message='V2_TARGET_LOCATOR_REQUIRED',errcode='22023';
      end if;
      update public.program_session_items set
        target_locator=item->'targetLocator',
        advice_version=nullif(item->>'adviceVersion','')::integer
      where session_id=(result->>'session_id')::uuid and position=(item->>'position')::smallint;
    end loop;
    perform set_config('app.v2_secure_create','off',true);
  end if;
  perform set_config('app.v2_trusted_command','off',true);
  return result;
end;
$$;

create or replace function public.guard_v2_item_security_fields()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if (new.target_locator is distinct from old.target_locator or new.advice_version is distinct from old.advice_version)
    and current_setting('app.v2_secure_create',true) is distinct from 'on'
  then raise exception using message='V2_ITEM_SNAPSHOT_IMMUTABLE',errcode='23514'; end if;
  return new;
end;
$$;
create trigger program_session_items_security_fields_immutable
before update on public.program_session_items for each row execute function public.guard_v2_item_security_fields();

create or replace function public.refresh_v2_review_slot_secure(
  p_user_id uuid,p_session_id uuid,p_calendar_date date,p_review_item jsonb,p_entitlement_id text,
  p_server_now timestamptz
)
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare evidence_row public.focus_evidence%rowtype; schedule_row public.review_schedules%rowtype;
  source_attempt public.learning_attempts%rowtype; session_row public.program_day_sessions%rowtype;
  enrollment_row public.program_enrollments%rowtype; result jsonb; legacy_review_item jsonb;
begin
  select * into session_row from public.program_day_sessions
    where id=p_session_id and user_id=p_user_id;
  select * into enrollment_row from public.program_enrollments
    where id=session_row.enrollment_id and user_id=p_user_id;
  if session_row.id is null or enrollment_row.id is null then
    raise exception using message='V2_SESSION_NOT_AVAILABLE',errcode='42501';
  end if;
  if enrollment_row.completed_program_days >= 7
    and not public.v2_subscription_access(p_user_id,p_entitlement_id,p_server_now)
  then raise exception using message='ACCESS_REQUIRED',errcode='42501'; end if;
  if p_review_item is not null then
    select * into evidence_row from public.focus_evidence
      where id=nullif(p_review_item->>'reviewSourceEvidenceId','')::uuid and user_id=p_user_id;
    select * into schedule_row from public.review_schedules
      where id=nullif(p_review_item->>'reviewScheduleId','')::uuid and user_id=p_user_id;
    select * into source_attempt from public.learning_attempts
      where id=evidence_row.source_attempt_id and user_id=p_user_id;
    if evidence_row.id is null or evidence_row.focus_group_key <> p_review_item->>'focusGroupKey'
      or evidence_row.assisted or evidence_row.normalization_status <> 'server_normalized'
      or source_attempt.id is null or not source_attempt.technical_valid
      or source_attempt.normalization_status <> 'server_normalized'
      or source_attempt.attempt_role = 'guided_retry' or source_attempt.coaching_shown
      or schedule_row.id is null or schedule_row.based_on_evidence_id <> evidence_row.id
      or schedule_row.focus_group_key <> evidence_row.focus_group_key
      or schedule_row.review_due_date <> nullif(p_review_item->>'reviewDueDate','')::date
      or schedule_row.status not in ('scheduled','due','overdue')
      or schedule_row.completion_evidence_id is not null
      or nullif(p_review_item->>'practiceItemKey','') is null
      or nullif(p_review_item->>'referenceTextVersion','') is null
      or jsonb_typeof(p_review_item->'targetLocator') <> 'object'
    then raise exception using message='V2_REVIEW_EVIDENCE_INVALID',errcode='23514'; end if;
  end if;
  legacy_review_item := case when p_review_item is null then null
    else p_review_item - 'reviewScheduleId' - 'targetLocator' - 'adviceVersion' end;
  perform set_config('app.v2_trusted_command','on',true);
  result := public.refresh_v2_review_slot(p_user_id,p_session_id,p_calendar_date,legacy_review_item);
  if p_review_item is not null and coalesce((result->>'changed')::boolean,false) then
    perform set_config('app.v2_secure_create','on',true);
    update public.program_session_items set target_locator=p_review_item->'targetLocator'
      where session_id=p_session_id and slot_role='review';
    perform set_config('app.v2_secure_create','off',true);
  end if;
  perform set_config('app.v2_trusted_command','off',true);
  return result;
end;
$$;

create or replace function public.persist_v2_attempt_with_ticket(
  p_user_id uuid,p_session_item_id uuid,p_client_attempt_id uuid,p_payload_sha256 text,
  p_deletion_epoch bigint,p_assessment_ticket_id uuid,p_ticket_nonce_sha256 text,
  p_attempted_at timestamptz,p_calendar_date date,p_timezone text,p_provider text,
  p_assessment_locale text,p_provider_version text,p_normalizer_version text,
  p_normalization_status text,p_provider_attested boolean,p_technical_valid boolean,
  p_invalid_reason text,p_observed_candidate text,p_target_score numeric,p_result_label text,
  p_next_action_key text,p_capability_flags jsonb,p_normalized_detail jsonb,p_entitlement_id text
)
returns jsonb
language plpgsql security definer set search_path=public,auth,pg_temp
as $$
declare ticket_row public.assessment_tickets%rowtype; item_row public.program_session_items%rowtype;
  session_row public.program_day_sessions%rowtype; enrollment_row public.program_enrollments%rowtype;
  existing_row public.learning_attempts%rowtype; inserted_row public.learning_attempts%rowtype;
  v_current_epoch bigint; next_sequence integer; next_valid smallint;
begin
  if p_payload_sha256 !~ '^[0-9a-f]{64}$' or p_ticket_nonce_sha256 !~ '^[0-9a-f]{64}$'
    or p_provider <> 'azure' or p_assessment_locale <> 'en-US'
    or p_normalization_status not in ('server_normalized','rejected') or p_provider_attested
    or (p_technical_valid and p_normalization_status <> 'server_normalized')
    or (not p_technical_valid and p_normalization_status <> 'rejected')
  then raise exception using message='V2_ATTEMPT_INPUT_INVALID',errcode='22023'; end if;
  perform public.assert_v2_json_allowlist(p_capability_flags,array['targetScore','observedCandidate'],'CAPABILITY_FLAGS');
  perform public.assert_v2_json_allowlist(p_normalized_detail,array['recognitionStatus'],'NORMALIZED_DETAIL');
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_client_attempt_id::text,0));
  select e.current_epoch into v_current_epoch from public.learning_deletion_epochs e where e.user_id=p_user_id for update;
  if v_current_epoch is null or v_current_epoch <> p_deletion_epoch then
    raise exception using message='DELETION_EPOCH_CONFLICT',errcode='40001';
  end if;
  select * into existing_row from public.learning_attempts where user_id=p_user_id and client_attempt_id=p_client_attempt_id;
  if existing_row.id is not null then
    if existing_row.payload_sha256 <> p_payload_sha256 or existing_row.assessment_ticket_id <> p_assessment_ticket_id then
      raise exception using message='IDEMPOTENCY_PAYLOAD_CONFLICT',errcode='23505'; end if;
    return jsonb_build_object('attempt_id',existing_row.id,'technical_valid',existing_row.technical_valid,
      'valid_attempt_ordinal',existing_row.valid_attempt_ordinal,'attempt_role',existing_row.attempt_role,'replayed',true);
  end if;
  select * into ticket_row from public.assessment_tickets
    where id=p_assessment_ticket_id and user_id=p_user_id and session_item_id=p_session_item_id for update;
  if ticket_row.id is null or ticket_row.status <> 'issued' or ticket_row.expires_at <= p_attempted_at
    or ticket_row.nonce_sha256 <> p_ticket_nonce_sha256 or ticket_row.deletion_epoch <> p_deletion_epoch
  then raise exception using message='ASSESSMENT_TICKET_INVALID',errcode='42501'; end if;
  select * into item_row from public.program_session_items where id=ticket_row.session_item_id and user_id=p_user_id for update;
  select * into session_row from public.program_day_sessions where id=ticket_row.session_id and user_id=p_user_id for update;
  select * into enrollment_row from public.program_enrollments where id=session_row.enrollment_id and user_id=p_user_id for update;
  if item_row.id is null or session_row.id is null or session_row.status='completed'
    or item_row.content_version_id <> ticket_row.content_version_id
    or item_row.practice_item_key <> ticket_row.practice_item_key
    or item_row.focus_group_key <> ticket_row.focus_group_key
    or item_row.target_locator <> ticket_row.target_locator
    or encode(extensions.digest(lower(regexp_replace(btrim(item_row.reference_text),'\s+',' ','g')),'sha256'),'hex') <> ticket_row.reference_text_sha256
  then raise exception using message='ASSESSMENT_TICKET_BINDING_MISMATCH',errcode='42501'; end if;
  if enrollment_row.completed_program_days >= 7 and not public.v2_subscription_access(p_user_id,p_entitlement_id,p_attempted_at) then
    raise exception using message='ACCESS_REQUIRED',errcode='42501'; end if;
  if session_row.timezone <> p_timezone or timezone(session_row.timezone,p_attempted_at)::date <> p_calendar_date then
    raise exception using message='SESSION_TIMEZONE_MISMATCH',errcode='23514'; end if;
  select coalesce(max(attempt_sequence),0)+1 into next_sequence from public.learning_attempts where session_item_id=item_row.id;
  if p_technical_valid then
    select count(*)+1 into next_valid from public.learning_attempts where session_item_id=item_row.id and technical_valid;
    if next_valid > 3 then raise exception using message='VALID_ATTEMPT_LIMIT_REACHED',errcode='23514'; end if;
  else
    next_valid:=null;
    if nullif(btrim(p_invalid_reason),'') is null then raise exception using message='INVALID_REASON_REQUIRED',errcode='22023'; end if;
  end if;
  insert into public.learning_attempts(
    user_id,session_id,session_item_id,client_attempt_id,payload_sha256,content_version_id,
    practice_item_key,focus_group_key,prompt_role,attempt_role,retry_of_attempt_id,attempt_sequence,
    valid_attempt_ordinal,attempted_at,attempted_calendar_date,timezone,coaching_shown,
    technical_valid,invalid_reason,provider,assessment_locale,provider_version,normalizer_version,
    capability_metadata,server_verified,normalization_status,provider_attested,assessment_ticket_id
  ) values (
    p_user_id,session_row.id,item_row.id,p_client_attempt_id,p_payload_sha256,item_row.content_version_id,
    item_row.practice_item_key,item_row.focus_group_key,item_row.prompt_role,ticket_row.derived_attempt_role,
    ticket_row.retry_of_attempt_id,next_sequence,next_valid,p_attempted_at,p_calendar_date,session_row.timezone,
    ticket_row.derived_attempt_role='guided_retry',p_technical_valid,case when p_technical_valid then null else p_invalid_reason end,
    p_provider,p_assessment_locale,p_provider_version,p_normalizer_version,p_capability_flags,false,
    p_normalization_status,false,ticket_row.id
  ) returning * into inserted_row;
  insert into public.learning_attempt_results(
    attempt_id,user_id,provider,assessment_locale,normalizer_version,reference_text_version,
    expected_focus_representation,observed_candidate,target_score,technical_valid,result_label,
    next_action_key,capability_flags,normalized_detail,normalization_status,provider_attested
  ) values (
    inserted_row.id,p_user_id,p_provider,p_assessment_locale,p_normalizer_version,item_row.reference_text_version,
    item_row.expected_focus_representation,p_observed_candidate,p_target_score,p_technical_valid,p_result_label,
    p_next_action_key,p_capability_flags,p_normalized_detail,p_normalization_status,false
  );
  if ticket_row.derived_attempt_role='guided_retry' and p_technical_valid then
    insert into public.correction_cycles(
      user_id,session_item_id,focus_group_key,before_attempt_id,advice_stable_key,advice_version,
      coaching_locale,after_attempt_id,immediate_change_status
    ) values (
      p_user_id,item_row.id,item_row.focus_group_key,ticket_row.retry_of_attempt_id,
      ticket_row.advice_stable_key,ticket_row.advice_version,'ja-JP',inserted_row.id,'inconclusive'
    );
  end if;
  perform set_config('app.v2_trusted_command','on',true);
  update public.assessment_tickets set status='consumed',consumed_at=p_attempted_at,consumed_attempt_id=inserted_row.id
    where id=ticket_row.id;
  if p_technical_valid then
    update public.program_day_sessions set status='in_progress',started_at=coalesce(started_at,p_attempted_at),
      current_position=greatest(current_position,item_row.position) where id=session_row.id;
    update public.program_session_items set status='completed',completion_reason='completed',completed_at=p_attempted_at
      where id=item_row.id and status<>'completed';
    if not enrollment_row.trial_grant_consumed then
      update public.program_enrollments set trial_grant_consumed=true,trial_granted_at=p_attempted_at,
        first_valid_learning_attempt_id=inserted_row.id,trial_status='in_progress',trial_started_at=p_attempted_at,current_program_day=1
        where id=enrollment_row.id;
    elsif enrollment_row.first_valid_learning_attempt_id is null then
      update public.program_enrollments set first_valid_learning_attempt_id=inserted_row.id where id=enrollment_row.id;
    end if;
  end if;
  perform set_config('app.v2_trusted_command','off',true);
  return jsonb_build_object('attempt_id',inserted_row.id,'technical_valid',inserted_row.technical_valid,
    'valid_attempt_ordinal',inserted_row.valid_attempt_ordinal,'attempt_role',inserted_row.attempt_role,'replayed',false,
    'policy_status','needs_policy');
end;
$$;

create or replace function public.complete_v2_program_day_secure(
  p_user_id uuid,p_session_id uuid,p_completion_idempotency_key uuid,
  p_completion_payload_sha256 text,p_completed_at timestamptz,p_calendar_date date,
  p_entitlement_id text
)
returns jsonb
language plpgsql security definer set search_path=public,auth,pg_temp
as $$
declare session_row public.program_day_sessions%rowtype; enrollment_row public.program_enrollments%rowtype;
  completed_required integer; next_completed smallint; report_status text;
begin
  if p_completion_payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using message='V2_COMPLETION_INPUT_INVALID',errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_session_id::text||':complete',0));
  select * into session_row from public.program_day_sessions where id=p_session_id and user_id=p_user_id for update;
  if session_row.id is null then raise exception using message='V2_SESSION_NOT_FOUND',errcode='42501'; end if;
  if session_row.status='completed' then
    if session_row.completion_idempotency_key=p_completion_idempotency_key
      and session_row.completion_payload_sha256=p_completion_payload_sha256
    then return jsonb_build_object('session_id',session_row.id,'replayed',true,
      'completed_program_day',session_row.trial_program_day,'learning_day_sequence',session_row.learning_day_sequence);
    end if;
    raise exception using message='IDEMPOTENCY_PAYLOAD_CONFLICT',errcode='23505';
  end if;
  if timezone(session_row.timezone,p_completed_at)::date <> p_calendar_date then
    raise exception using message='SESSION_TIMEZONE_MISMATCH',errcode='23514'; end if;
  select * into enrollment_row from public.program_enrollments
    where id=session_row.enrollment_id and user_id=p_user_id for update;
  if not enrollment_row.trial_grant_consumed or enrollment_row.trial_started_at is null then
    raise exception using message='VALID_ATTEMPT_REQUIRED',errcode='23514'; end if;
  if enrollment_row.completed_program_days >= 7 and not public.v2_subscription_access(p_user_id,p_entitlement_id,p_completed_at) then
    raise exception using message='ACCESS_REQUIRED',errcode='42501'; end if;
  if enrollment_row.last_completed_calendar_date is not null and p_calendar_date <= enrollment_row.last_completed_calendar_date then
    raise exception using message='CALENDAR_DATE_ALREADY_COMPLETED',errcode='23505'; end if;
  if session_row.required_item_count <> 5 then
    raise exception using message='SHORTENING_POLICY_NOT_READY',errcode='23514'; end if;
  select count(*) into completed_required from public.program_session_items i
    where i.session_id=session_row.id and i.user_id=p_user_id and i.is_required and i.status='completed'
      and exists (
        select 1 from public.learning_attempts a where a.session_item_id=i.id and a.user_id=p_user_id
          and a.technical_valid and a.normalization_status='server_normalized'
      );
  if completed_required <> 5 then raise exception using message='REQUIRED_ITEMS_INCOMPLETE',errcode='23514'; end if;
  perform set_config('app.v2_trusted_command','on',true);
  update public.program_day_sessions set status='completed',completed_calendar_date=p_calendar_date,
    completion_idempotency_key=p_completion_idempotency_key,completion_payload_sha256=p_completion_payload_sha256,
    completed_at=p_completed_at,current_position=required_item_count where id=session_row.id;
  next_completed:=least(enrollment_row.completed_program_days+1,7);
  report_status:=case
    when enrollment_row.day_7_report_status='ready' then 'ready'
    when next_completed=7 then 'pending'
    else enrollment_row.day_7_report_status end;
  update public.program_enrollments set completed_program_days=next_completed,
    current_program_day=greatest(current_program_day,next_completed),last_completed_calendar_date=p_calendar_date,
    trial_status=case when next_completed=7 then 'day_7_completed' else 'in_progress' end,
    day_7_report_status=report_status where id=enrollment_row.id;
  perform set_config('app.v2_trusted_command','off',true);
  return jsonb_build_object('session_id',session_row.id,'replayed',false,
    'completed_program_day',session_row.trial_program_day,'learning_day_sequence',session_row.learning_day_sequence,
    'day_7_report_status',report_status,'policy_status','needs_policy');
end;
$$;

-- The already-applied service RPCs remain as historical objects but are no longer
-- executable by the runtime service role after the hardened replacements exist.
revoke execute on function public.create_v2_daily_session(uuid,text,date,uuid,text,text,jsonb,text) from service_role;
revoke execute on function public.refresh_v2_review_slot(uuid,uuid,date,jsonb) from service_role;
revoke execute on function public.persist_v2_attempt(uuid,uuid,uuid,uuid,text,bigint,text,uuid,timestamptz,date,text,text,text,text,text,boolean,text,text,numeric,text,text,jsonb,jsonb) from service_role;
revoke execute on function public.complete_v2_program_day(uuid,uuid,uuid,text,timestamptz,date) from service_role;

revoke all on function public.v2_subscription_access(uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.guard_v2_sensitive_mutation() from public,anon,authenticated;
revoke all on function public.guard_program_enrollment_monotonic() from public,anon,authenticated;
revoke all on function public.guard_learning_deletion_epoch_mutation() from public,anon,authenticated;
revoke all on function public.guard_v2_item_security_fields() from public,anon,authenticated;
revoke all on function public.issue_v2_assessment_ticket(uuid,uuid,text,text,bigint,integer,integer,integer,timestamptz,text) from public,anon,authenticated;
revoke all on function public.create_v2_daily_session_secure(uuid,text,date,uuid,text,text,jsonb,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.refresh_v2_review_slot_secure(uuid,uuid,date,jsonb,text,timestamptz) from public,anon,authenticated;
revoke all on function public.persist_v2_attempt_with_ticket(uuid,uuid,uuid,text,bigint,uuid,text,timestamptz,date,text,text,text,text,text,text,boolean,boolean,text,text,numeric,text,text,jsonb,jsonb,text) from public,anon,authenticated;
revoke all on function public.complete_v2_program_day_secure(uuid,uuid,uuid,text,timestamptz,date,text) from public,anon,authenticated;

grant execute on function public.v2_subscription_access(uuid,text,timestamptz) to service_role;
grant execute on function public.issue_v2_assessment_ticket(uuid,uuid,text,text,bigint,integer,integer,integer,timestamptz,text) to service_role;
grant execute on function public.create_v2_daily_session_secure(uuid,text,date,uuid,text,text,jsonb,text,text,timestamptz) to service_role;
grant execute on function public.refresh_v2_review_slot_secure(uuid,uuid,date,jsonb,text,timestamptz) to service_role;
grant execute on function public.persist_v2_attempt_with_ticket(uuid,uuid,uuid,text,bigint,uuid,text,timestamptz,date,text,text,text,text,text,text,boolean,boolean,text,text,numeric,text,text,jsonb,jsonb,text) to service_role;
grant execute on function public.complete_v2_program_day_secure(uuid,uuid,uuid,text,timestamptz,date,text) to service_role;

comment on function public.issue_v2_assessment_ticket(uuid,uuid,text,text,bigint,integer,integer,integer,timestamptz,text) is
  'Service-only one-time ticket bound to an owned managed item. Stores no Azure token, secret, audio, or device URI.';
comment on function public.persist_v2_attempt_with_ticket(uuid,uuid,uuid,text,bigint,uuid,text,timestamptz,date,text,text,text,text,text,text,boolean,boolean,text,text,numeric,text,text,jsonb,jsonb,text) is
  'Consumes one assessment ticket and stores only strict server-normalized fields. Provider attestation remains false.';
