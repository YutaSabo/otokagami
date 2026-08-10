-- S6-07.1 / S6-08 forward-only hardening for assessment replay, review receipts,
-- deletion epochs, atomic learning-data deletion, and redacted snapshot export.
-- Existing rows are not changed by applying this migration. DML below exists only
-- inside service-role-only transactional functions.

alter table public.assessment_tickets
  add column capture_expires_at timestamptz,
  add column submission_expires_at timestamptz,
  add constraint assessment_tickets_capture_submission_check check (
    (capture_expires_at is null and submission_expires_at is null)
    or (
      capture_expires_at is not null
      and submission_expires_at is not null
      and capture_expires_at > issued_at
      and submission_expires_at >= capture_expires_at
      and expires_at = submission_expires_at
    )
  );

comment on column public.assessment_tickets.capture_expires_at is
  'Last instant at which Azure capture may start. This is distinct from the later submission replay deadline.';
comment on column public.assessment_tickets.submission_expires_at is
  'Last instant at which an already captured strict projection may be submitted or replayed.';

alter table public.learning_attempts
  add column provider_captured_at timestamptz,
  add column submitted_at timestamptz,
  add constraint learning_attempts_capture_submission_check check (
    (provider_captured_at is null and submitted_at is null)
    or (
      provider_captured_at is not null
      and submitted_at is not null
      and submitted_at >= provider_captured_at
    )
  );

alter table public.correction_cycles
  add column content_version_id uuid references public.content_versions(id);

comment on column public.correction_cycles.content_version_id is
  'Content snapshot shared by the before and guided-after attempts. New trusted writes require this value.';

alter table public.program_session_items
  add column review_schedule_id uuid,
  add column review_interval_kind text check (
    review_interval_kind is null or review_interval_kind in ('day_1','day_3','day_7','day_14')
  );

alter table public.review_schedules
  add constraint review_schedules_snapshot_binding_unique
  unique (id, user_id, focus_group_key, based_on_evidence_id, review_due_date, interval_kind);

alter table public.program_session_items
  add constraint program_session_items_review_schedule_snapshot_fkey
  foreign key (
    review_schedule_id,
    user_id,
    focus_group_key,
    review_source_evidence_id,
    review_due_date,
    review_interval_kind
  ) references public.review_schedules(
    id,
    user_id,
    focus_group_key,
    based_on_evidence_id,
    review_due_date,
    interval_kind
  ),
  add constraint program_session_items_review_snapshot_shape_check check (
    (
      slot_role = 'review'
      and (
        (
          review_schedule_id is not null
          and review_source_evidence_id is not null
          and review_due_date is not null
          and review_interval_kind is not null
        )
        or (
          review_schedule_id is null
          and review_source_evidence_id is null
          and review_due_date is not null
          and review_interval_kind is null
        )
      )
    )
    or (
      slot_role <> 'review'
      and review_schedule_id is null
      and review_source_evidence_id is null
      and review_due_date is null
      and review_interval_kind is null
    )
  );

comment on column public.program_session_items.review_schedule_id is
  'Immutable review schedule snapshot binding. It prevents a submitted review from being attached to another schedule.';

create table public.review_completion_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  review_schedule_id uuid not null,
  session_item_id uuid not null,
  attempt_id uuid not null,
  deletion_epoch bigint not null check (deletion_epoch >= 0),
  completion_idempotency_key uuid not null,
  completed_calendar_date date not null,
  completed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, review_schedule_id),
  unique (user_id, completion_idempotency_key),
  constraint review_completion_receipts_schedule_owner_fkey
    foreign key (review_schedule_id, user_id)
    references public.review_schedules(id, user_id) on delete cascade,
  constraint review_completion_receipts_item_owner_fkey
    foreign key (session_item_id, user_id)
    references public.program_session_items(id, user_id) on delete cascade,
  constraint review_completion_receipts_attempt_owner_item_fkey
    foreign key (attempt_id, user_id, session_item_id)
    references public.learning_attempts(id, user_id, session_item_id) on delete cascade
);

comment on table public.review_completion_receipts is
  'Trusted receipt for a valid unassisted review submission. It does not promote focus state while product policy is unset.';

create table public.learning_deletion_requests (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expected_epoch bigint not null check (expected_epoch >= 0),
  resulting_epoch bigint not null check (resulting_epoch = expected_epoch + 1),
  deleted_counts jsonb not null check (jsonb_typeof(deleted_counts) = 'object'),
  requested_at timestamptz not null,
  completed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (request_id, user_id)
);

comment on table public.learning_deletion_requests is
  'Idempotency and audit ledger for atomic learning-data deletion. It retains no content, token, nonce, provider payload, or local URI.';

alter table public.review_completion_receipts enable row level security;
alter table public.learning_deletion_requests enable row level security;
revoke all on public.review_completion_receipts from public, anon, authenticated;
revoke all on public.learning_deletion_requests from public, anon, authenticated;
grant select on public.review_completion_receipts to authenticated;
grant select, insert, update, delete on public.review_completion_receipts to service_role;
grant select, insert, update on public.learning_deletion_requests to service_role;

create policy v2_review_completion_receipts_select_own
on public.review_completion_receipts for select to authenticated
using (user_id = auth.uid());

create or replace function public.lock_v2_user_mutation(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null then
    raise exception using message = 'V2_USER_REQUIRED', errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('otokagami:v2:user:' || p_user_id::text, 0));
end;
$$;

create or replace function public.guard_v2_review_snapshot_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.review_schedule_id is distinct from old.review_schedule_id
    or new.review_interval_kind is distinct from old.review_interval_kind
  then
    if current_setting('app.v2_secure_create', true) is distinct from 'on'
      and current_setting('app.v2_review_refresh', true) is distinct from 'on'
    then
      raise exception using message = 'V2_REVIEW_SNAPSHOT_IMMUTABLE', errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger program_session_items_review_snapshot_immutable
before update on public.program_session_items
for each row execute function public.guard_v2_review_snapshot_mutation();

create or replace function public.guard_v2_append_only_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'learning_attempts'
    and current_setting('app.v2_learning_delete', true) = 'on'
    and new.assessment_ticket_id is null
    and (to_jsonb(new) - 'assessment_ticket_id') = (to_jsonb(old) - 'assessment_ticket_id')
  then
    return new;
  end if;
  raise exception using message = 'V2_APPEND_ONLY_ROW', errcode = '55000';
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
    or before_row.content_version_id <> new.content_version_id
    or not before_row.technical_valid or not after_row.technical_valid
    or before_row.normalization_status <> 'server_normalized'
    or after_row.normalization_status <> 'server_normalized'
    or before_row.provider_attested or after_row.provider_attested
    or before_row.attempt_role = 'guided_retry' or before_row.coaching_shown
    or after_row.attempt_role <> 'guided_retry' or not after_row.coaching_shown
    or after_row.retry_of_attempt_id <> before_row.id
    or after_row.attempted_at <= before_row.attempted_at
  then
    raise exception using message = 'V2_CORRECTION_CYCLE_INVALID', errcode = '23514';
  end if;
  new.immediate_change_status := 'inconclusive';
  return new;
end;
$$;

create or replace function public.guard_legacy_learning_write_after_v2_deletion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_user_id uuid;
begin
  if current_setting('app.v2_learning_delete', true) = 'on' then return new; end if;
  v_user_id := nullif(to_jsonb(new)->>'user_id','')::uuid;
  if v_user_id is null and tg_table_name = 'daily_session_items' then
    select d.user_id into v_user_id from public.daily_sessions d
    where d.id = nullif(to_jsonb(new)->>'daily_session_id','')::uuid;
  elsif v_user_id is null and tg_table_name = 'attempt_phoneme_results' then
    select a.user_id into v_user_id from public.attempts a
    where a.id = nullif(to_jsonb(new)->>'attempt_id','')::uuid;
  end if;
  if v_user_id is null then
    raise exception using message = 'LEGACY_LEARNING_OWNER_REQUIRED', errcode = '23514';
  end if;
  perform public.lock_v2_user_mutation(v_user_id);
  if coalesce((select current_epoch from public.learning_deletion_epochs where user_id = v_user_id),0) > 0 then
    raise exception using message = 'LEGACY_LEARNING_WRITE_AFTER_DELETION_FORBIDDEN', errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger daily_sessions_v2_deletion_barrier before insert or update on public.daily_sessions
for each row execute function public.guard_legacy_learning_write_after_v2_deletion();
create trigger daily_session_items_v2_deletion_barrier before insert or update on public.daily_session_items
for each row execute function public.guard_legacy_learning_write_after_v2_deletion();
create trigger attempts_v2_deletion_barrier before insert or update on public.attempts
for each row execute function public.guard_legacy_learning_write_after_v2_deletion();
create trigger attempt_phoneme_results_v2_deletion_barrier before insert or update on public.attempt_phoneme_results
for each row execute function public.guard_legacy_learning_write_after_v2_deletion();
create trigger phoneme_state_v2_deletion_barrier before insert or update on public.phoneme_state
for each row execute function public.guard_legacy_learning_write_after_v2_deletion();
create trigger phoneme_snapshots_v2_deletion_barrier before insert or update on public.phoneme_snapshots
for each row execute function public.guard_legacy_learning_write_after_v2_deletion();
create trigger user_badges_v2_deletion_barrier before insert or update on public.user_badges
for each row execute function public.guard_legacy_learning_write_after_v2_deletion();
create trigger user_bookmarks_v2_deletion_barrier before insert or update on public.user_bookmarks
for each row execute function public.guard_legacy_learning_write_after_v2_deletion();
create trigger free_attempts_v2_deletion_barrier before insert or update on public.free_attempts
for each row execute function public.guard_legacy_learning_write_after_v2_deletion();
create trigger advice_feedback_v2_deletion_barrier before insert or update on public.advice_feedback
for each row execute function public.guard_legacy_learning_write_after_v2_deletion();

create or replace function public.issue_v2_assessment_ticket_v2(
  p_user_id uuid,
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
set search_path = public, auth, extensions, pg_temp
as $$
declare item_row public.program_session_items%rowtype; session_row public.program_day_sessions%rowtype;
  enrollment_row public.program_enrollments%rowtype; source_row public.learning_attempts%rowtype;
  ticket_row public.assessment_tickets%rowtype; v_current_epoch bigint; derived_role text;
  valid_count integer;
begin
  if p_attempt_purpose not in ('initial','guided_retry')
    or p_nonce_sha256 !~ '^[0-9a-f]{64}$'
    or p_capture_ttl_seconds <= 0
    or p_submission_window_seconds < p_capture_ttl_seconds
    or p_rate_window_seconds <= 0
    or p_rate_limit_max <= 0
  then raise exception using message='V2_TICKET_INPUT_INVALID',errcode='22023'; end if;

  perform public.lock_v2_user_mutation(p_user_id);
  select e.current_epoch into v_current_epoch from public.learning_deletion_epochs e
    where e.user_id=p_user_id for update;
  if v_current_epoch is null or v_current_epoch <> p_deletion_epoch then
    raise exception using message='DELETION_EPOCH_CONFLICT',errcode='40001';
  end if;

  select * into item_row from public.program_session_items
    where id=p_session_item_id and user_id=p_user_id for update;
  select * into session_row from public.program_day_sessions
    where id=item_row.session_id and user_id=p_user_id for update;
  select * into enrollment_row from public.program_enrollments
    where id=session_row.enrollment_id and user_id=p_user_id;
  if item_row.id is null or session_row.id is null or session_row.status='completed'
    or item_row.reference_text is null or item_row.target_locator is null
  then raise exception using message='V2_SESSION_ITEM_NOT_AVAILABLE',errcode='42501'; end if;
  if enrollment_row.completed_program_days >= 7
    and not public.v2_subscription_access(p_user_id,p_entitlement_id,p_issued_at)
  then raise exception using message='ACCESS_REQUIRED',errcode='42501'; end if;
  if item_row.prompt_role='optional_extension' and exists (
    select 1 from public.program_session_items i
    where i.session_id=session_row.id and i.is_required and i.status<>'completed'
  ) then raise exception using message='OPTIONAL_EXTENSION_NOT_AVAILABLE',errcode='23514'; end if;

  select count(*) into valid_count from public.learning_attempts
    where user_id=p_user_id and session_item_id=p_session_item_id and technical_valid;
  if valid_count >= 3 then
    raise exception using message='VALID_ATTEMPT_LIMIT_REACHED',errcode='23514';
  end if;

  perform set_config('app.v2_trusted_command','on',true);
  update public.assessment_tickets set status='expired'
    where user_id=p_user_id and session_item_id=p_session_item_id and status='issued'
      and coalesce(submission_expires_at,expires_at) <= p_issued_at;
  if exists (
    select 1 from public.assessment_tickets
    where user_id=p_user_id and session_item_id=p_session_item_id and status='issued'
  ) then raise exception using message='UNCONSUMED_TICKET_EXISTS',errcode='23505'; end if;
  if (
    select count(*) from public.assessment_tickets
    where user_id=p_user_id and session_id=session_row.id and session_item_id=p_session_item_id
      and issued_at > p_issued_at - make_interval(secs=>p_rate_window_seconds)
  ) >= p_rate_limit_max then
    raise exception using message='TICKET_RATE_LIMITED',errcode='23514';
  end if;

  if p_attempt_purpose='guided_retry' then
    select * into source_row from public.learning_attempts
      where user_id=p_user_id and session_item_id=p_session_item_id and technical_valid
        and normalization_status='server_normalized' and not provider_attested
        and attempt_role<>'guided_retry' and not coaching_shown
      order by attempt_sequence desc limit 1;
    if source_row.id is null or item_row.next_action_key is null or item_row.advice_version is null then
      raise exception using message='GUIDED_RETRY_NOT_AVAILABLE',errcode='23514';
    end if;
    derived_role:='guided_retry';
  else
    derived_role:=case
      when item_row.prompt_role='review' then 'review'
      when item_row.prompt_role='optional_extension' then 'optional_extension'
      when item_row.prompt_role in ('transfer_word','sentence','practical_sentence') then 'transfer'
      else 'cold' end;
  end if;

  insert into public.assessment_tickets(
    user_id,session_id,session_item_id,content_version_id,practice_item_key,focus_group_key,
    reference_text_sha256,reference_text_version,target_locator,assessment_locale,attempt_purpose,
    derived_attempt_role,retry_of_attempt_id,advice_stable_key,advice_version,deletion_epoch,
    nonce_sha256,issued_at,expires_at,capture_expires_at,submission_expires_at
  ) values (
    p_user_id,session_row.id,item_row.id,item_row.content_version_id,item_row.practice_item_key,item_row.focus_group_key,
    encode(extensions.digest(lower(regexp_replace(btrim(item_row.reference_text),'\s+',' ','g')),'sha256'),'hex'),
    item_row.reference_text_version,item_row.target_locator,'en-US',p_attempt_purpose,derived_role,
    source_row.id,item_row.next_action_key,item_row.advice_version,p_deletion_epoch,p_nonce_sha256,p_issued_at,
    p_issued_at+make_interval(secs=>p_submission_window_seconds),
    p_issued_at+make_interval(secs=>p_capture_ttl_seconds),
    p_issued_at+make_interval(secs=>p_submission_window_seconds)
  ) returning * into ticket_row;
  perform set_config('app.v2_trusted_command','off',true);
  return jsonb_build_object(
    'ticket_id',ticket_row.id,
    'capture_expires_at',ticket_row.capture_expires_at,
    'submission_expires_at',ticket_row.submission_expires_at
  );
end;
$$;

create or replace function public.abandon_v2_assessment_ticket(
  p_user_id uuid,
  p_ticket_id uuid,
  p_nonce_sha256 text,
  p_server_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare ticket_row public.assessment_tickets%rowtype; v_current_epoch bigint;
begin
  if p_nonce_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using message='V2_TICKET_INPUT_INVALID',errcode='22023';
  end if;
  perform public.lock_v2_user_mutation(p_user_id);
  select * into ticket_row from public.assessment_tickets
    where id=p_ticket_id and user_id=p_user_id for update;
  select current_epoch into v_current_epoch from public.learning_deletion_epochs
    where user_id=p_user_id for update;
  if ticket_row.id is null or ticket_row.nonce_sha256<>p_nonce_sha256
    or v_current_epoch is null or ticket_row.deletion_epoch<>v_current_epoch
  then raise exception using message='ASSESSMENT_TICKET_INVALID',errcode='42501'; end if;
  if ticket_row.status='consumed' then
    raise exception using message='ASSESSMENT_TICKET_ALREADY_CONSUMED',errcode='23514'; end if;
  if ticket_row.status='issued' then
    perform set_config('app.v2_trusted_command','on',true);
    update public.assessment_tickets set status='expired'
      where id=ticket_row.id;
    perform set_config('app.v2_trusted_command','off',true);
  end if;
  return jsonb_build_object('ticket_id',ticket_row.id,'abandoned',true,'abandoned_at',p_server_now);
end;
$$;

create or replace function public.persist_v2_attempt_v2(
  p_user_id uuid,p_session_item_id uuid,p_client_attempt_id uuid,p_payload_sha256 text,
  p_deletion_epoch bigint,p_assessment_ticket_id uuid,p_ticket_nonce_sha256 text,
  p_captured_at timestamptz,p_server_now timestamptz,p_attempted_at timestamptz,
  p_calendar_date date,p_timezone text,
  p_provider text,p_assessment_locale text,p_provider_version text,p_normalizer_version text,
  p_normalization_status text,p_provider_attested boolean,p_technical_valid boolean,
  p_invalid_reason text,p_observed_candidate text,p_target_score numeric,p_result_label text,
  p_next_action_key text,p_capability_flags jsonb,p_normalized_detail jsonb,p_entitlement_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $$
declare ticket_row public.assessment_tickets%rowtype; item_row public.program_session_items%rowtype;
  session_row public.program_day_sessions%rowtype; enrollment_row public.program_enrollments%rowtype;
  existing_row public.learning_attempts%rowtype; inserted_row public.learning_attempts%rowtype;
  v_current_epoch bigint; next_sequence integer; next_valid smallint; cycle_id uuid;
begin
  if p_payload_sha256 !~ '^[0-9a-f]{64}$' or p_ticket_nonce_sha256 !~ '^[0-9a-f]{64}$'
    or p_provider<>'azure' or p_assessment_locale<>'en-US'
    or p_normalization_status not in ('server_normalized','rejected') or p_provider_attested
    or p_server_now<p_captured_at
    or (p_technical_valid and p_normalization_status<>'server_normalized')
    or (not p_technical_valid and p_normalization_status<>'rejected')
  then raise exception using message='V2_ATTEMPT_INPUT_INVALID',errcode='22023'; end if;
  perform public.assert_v2_json_allowlist(p_capability_flags,array['targetScore','observedCandidate'],'CAPABILITY_FLAGS');
  perform public.assert_v2_json_allowlist(p_normalized_detail,array['recognitionStatus'],'NORMALIZED_DETAIL');

  perform public.lock_v2_user_mutation(p_user_id);
  select current_epoch into v_current_epoch from public.learning_deletion_epochs
    where user_id=p_user_id for update;
  if v_current_epoch is null or v_current_epoch<>p_deletion_epoch then
    raise exception using message='DELETION_EPOCH_CONFLICT',errcode='40001';
  end if;

  -- Ticket owner/binding/nonce/epoch/deadlines are checked before an idempotent
  -- result may be returned. A stolen client_attempt_id is therefore insufficient.
  select * into ticket_row from public.assessment_tickets
    where id=p_assessment_ticket_id and user_id=p_user_id and session_item_id=p_session_item_id for update;
  if ticket_row.id is null
    or ticket_row.nonce_sha256<>p_ticket_nonce_sha256
    or ticket_row.deletion_epoch<>p_deletion_epoch
    or ticket_row.capture_expires_at is null
    or ticket_row.submission_expires_at is null
    or p_captured_at<ticket_row.issued_at
    or p_captured_at>ticket_row.capture_expires_at
    or p_server_now>ticket_row.submission_expires_at
  then raise exception using message='ASSESSMENT_TICKET_INVALID',errcode='42501'; end if;

  select * into existing_row from public.learning_attempts
    where user_id=p_user_id and client_attempt_id=p_client_attempt_id;
  if existing_row.id is not null then
    if existing_row.payload_sha256<>p_payload_sha256
      or existing_row.assessment_ticket_id<>p_assessment_ticket_id
      or ticket_row.status<>'consumed'
      or ticket_row.consumed_attempt_id<>existing_row.id
    then raise exception using message='IDEMPOTENCY_PAYLOAD_CONFLICT',errcode='23505'; end if;
    select id into cycle_id from public.correction_cycles
      where user_id=p_user_id and after_attempt_id=existing_row.id;
    return jsonb_build_object('attempt_id',existing_row.id,'technical_valid',existing_row.technical_valid,
      'valid_attempt_ordinal',existing_row.valid_attempt_ordinal,'attempt_role',existing_row.attempt_role,
      'correction_cycle_id',cycle_id,'replayed',true);
  end if;
  if ticket_row.status<>'issued' then
    raise exception using message='ASSESSMENT_TICKET_INVALID',errcode='42501'; end if;

  select * into item_row from public.program_session_items
    where id=ticket_row.session_item_id and user_id=p_user_id for update;
  select * into session_row from public.program_day_sessions
    where id=ticket_row.session_id and user_id=p_user_id for update;
  select * into enrollment_row from public.program_enrollments
    where id=session_row.enrollment_id and user_id=p_user_id for update;
  if item_row.id is null or session_row.id is null or session_row.status='completed'
    or item_row.content_version_id<>ticket_row.content_version_id
    or item_row.practice_item_key<>ticket_row.practice_item_key
    or item_row.focus_group_key<>ticket_row.focus_group_key
    or item_row.target_locator<>ticket_row.target_locator
    or encode(extensions.digest(lower(regexp_replace(btrim(item_row.reference_text),'\s+',' ','g')),'sha256'),'hex')
      <>ticket_row.reference_text_sha256
  then raise exception using message='ASSESSMENT_TICKET_BINDING_MISMATCH',errcode='42501'; end if;
  if enrollment_row.completed_program_days>=7
    and not public.v2_subscription_access(p_user_id,p_entitlement_id,p_server_now)
  then raise exception using message='ACCESS_REQUIRED',errcode='42501'; end if;
  if session_row.timezone<>p_timezone
    or timezone(session_row.timezone,p_attempted_at)::date<>p_calendar_date
  then raise exception using message='SESSION_TIMEZONE_MISMATCH',errcode='23514'; end if;

  select coalesce(max(attempt_sequence),0)+1 into next_sequence
    from public.learning_attempts where session_item_id=item_row.id;
  if p_technical_valid then
    select count(*)+1 into next_valid from public.learning_attempts
      where session_item_id=item_row.id and technical_valid;
    if next_valid>3 then raise exception using message='VALID_ATTEMPT_LIMIT_REACHED',errcode='23514'; end if;
  else
    next_valid:=null;
    if nullif(btrim(p_invalid_reason),'') is null then
      raise exception using message='INVALID_REASON_REQUIRED',errcode='22023'; end if;
  end if;

  insert into public.learning_attempts(
    user_id,session_id,session_item_id,client_attempt_id,payload_sha256,content_version_id,
    practice_item_key,focus_group_key,prompt_role,attempt_role,retry_of_attempt_id,attempt_sequence,
    valid_attempt_ordinal,attempted_at,attempted_calendar_date,timezone,coaching_shown,
    technical_valid,invalid_reason,provider,assessment_locale,provider_version,normalizer_version,
    capability_metadata,server_verified,normalization_status,provider_attested,assessment_ticket_id,
    provider_captured_at,submitted_at
  ) values (
    p_user_id,session_row.id,item_row.id,p_client_attempt_id,p_payload_sha256,item_row.content_version_id,
    item_row.practice_item_key,item_row.focus_group_key,item_row.prompt_role,ticket_row.derived_attempt_role,
    ticket_row.retry_of_attempt_id,next_sequence,next_valid,p_attempted_at,p_calendar_date,session_row.timezone,
    ticket_row.derived_attempt_role='guided_retry',p_technical_valid,
    case when p_technical_valid then null else p_invalid_reason end,p_provider,p_assessment_locale,
    p_provider_version,p_normalizer_version,p_capability_flags,false,p_normalization_status,false,ticket_row.id,
    p_captured_at,p_server_now
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
      user_id,session_item_id,focus_group_key,content_version_id,before_attempt_id,
      advice_stable_key,advice_version,coaching_locale,after_attempt_id,immediate_change_status
    ) values (
      p_user_id,item_row.id,item_row.focus_group_key,item_row.content_version_id,ticket_row.retry_of_attempt_id,
      ticket_row.advice_stable_key,ticket_row.advice_version,'ja-JP',inserted_row.id,'inconclusive'
    ) returning id into cycle_id;
  end if;

  perform set_config('app.v2_trusted_command','on',true);
  update public.assessment_tickets set status='consumed',consumed_at=p_server_now,
    consumed_attempt_id=inserted_row.id where id=ticket_row.id;
  if p_technical_valid then
    update public.program_day_sessions set status='in_progress',
      started_at=coalesce(started_at,p_attempted_at),current_position=greatest(current_position,item_row.position)
      where id=session_row.id;
    update public.program_session_items set status='completed',completion_reason='completed',completed_at=p_server_now
      where id=item_row.id and status<>'completed';
    if not enrollment_row.trial_grant_consumed then
      update public.program_enrollments set trial_grant_consumed=true,trial_granted_at=p_server_now,
        first_valid_learning_attempt_id=inserted_row.id,trial_status='in_progress',
        trial_started_at=p_server_now,current_program_day=1 where id=enrollment_row.id;
    elsif enrollment_row.first_valid_learning_attempt_id is null then
      update public.program_enrollments set first_valid_learning_attempt_id=inserted_row.id
        where id=enrollment_row.id;
    end if;
  end if;
  perform set_config('app.v2_trusted_command','off',true);
  return jsonb_build_object('attempt_id',inserted_row.id,'technical_valid',inserted_row.technical_valid,
    'valid_attempt_ordinal',inserted_row.valid_attempt_ordinal,'attempt_role',inserted_row.attempt_role,
    'correction_cycle_id',cycle_id,'replayed',false,'policy_status','needs_policy');
end;
$$;

create or replace function public.complete_v2_review_submission(
  p_user_id uuid,
  p_review_schedule_id uuid,
  p_session_item_id uuid,
  p_attempt_id uuid,
  p_deletion_epoch bigint,
  p_completion_idempotency_key uuid,
  p_completed_at timestamptz,
  p_calendar_date date
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare epoch_row public.learning_deletion_epochs%rowtype; schedule_row public.review_schedules%rowtype;
  item_row public.program_session_items%rowtype; attempt_row public.learning_attempts%rowtype;
  receipt_row public.review_completion_receipts%rowtype;
begin
  perform public.lock_v2_user_mutation(p_user_id);
  select * into epoch_row from public.learning_deletion_epochs where user_id=p_user_id for update;
  if epoch_row.user_id is null or epoch_row.current_epoch<>p_deletion_epoch then
    raise exception using message='DELETION_EPOCH_CONFLICT',errcode='40001'; end if;

  select * into receipt_row from public.review_completion_receipts
    where user_id=p_user_id and completion_idempotency_key=p_completion_idempotency_key;
  if receipt_row.id is not null then
    if receipt_row.review_schedule_id<>p_review_schedule_id
      or receipt_row.session_item_id<>p_session_item_id
      or receipt_row.attempt_id<>p_attempt_id
      or receipt_row.deletion_epoch<>p_deletion_epoch
    then raise exception using message='IDEMPOTENCY_PAYLOAD_CONFLICT',errcode='23505'; end if;
    return jsonb_build_object('receipt_id',receipt_row.id,'review_schedule_id',receipt_row.review_schedule_id,
      'completed_calendar_date',receipt_row.completed_calendar_date,'replayed',true,'policy_status','needs_policy');
  end if;

  select * into schedule_row from public.review_schedules
    where id=p_review_schedule_id and user_id=p_user_id for update;
  select * into item_row from public.program_session_items
    where id=p_session_item_id and user_id=p_user_id for update;
  select * into attempt_row from public.learning_attempts
    where id=p_attempt_id and user_id=p_user_id and session_item_id=p_session_item_id;
  if schedule_row.id is null or item_row.id is null or attempt_row.id is null
    or schedule_row.status not in ('scheduled','due','overdue')
    or schedule_row.completion_evidence_id is not null
    or item_row.slot_role<>'review' or item_row.prompt_role<>'review'
    or item_row.review_schedule_id<>schedule_row.id
    or item_row.review_source_evidence_id<>schedule_row.based_on_evidence_id
    or item_row.review_interval_kind<>schedule_row.interval_kind
    or item_row.review_due_date<>schedule_row.review_due_date
    or item_row.focus_group_key<>schedule_row.focus_group_key
    or attempt_row.session_item_id<>item_row.id
    or attempt_row.session_id<>item_row.session_id
    or attempt_row.content_version_id<>item_row.content_version_id
    or attempt_row.practice_item_key<>item_row.practice_item_key
    or attempt_row.focus_group_key<>item_row.focus_group_key
    or attempt_row.prompt_role<>'review' or attempt_row.attempt_role<>'review'
    or not attempt_row.technical_valid or attempt_row.normalization_status<>'server_normalized'
    or attempt_row.provider_attested or attempt_row.coaching_shown or attempt_row.retry_of_attempt_id is not null
    or p_calendar_date<schedule_row.review_due_date
    or timezone(attempt_row.timezone,p_completed_at)::date<>p_calendar_date
  then raise exception using message='V2_REVIEW_COMPLETION_INVALID',errcode='23514'; end if;

  insert into public.review_completion_receipts(
    user_id,review_schedule_id,session_item_id,attempt_id,deletion_epoch,
    completion_idempotency_key,completed_calendar_date,completed_at
  ) values (
    p_user_id,p_review_schedule_id,p_session_item_id,p_attempt_id,p_deletion_epoch,
    p_completion_idempotency_key,p_calendar_date,p_completed_at
  ) returning * into receipt_row;
  return jsonb_build_object('receipt_id',receipt_row.id,'review_schedule_id',receipt_row.review_schedule_id,
    'completed_calendar_date',receipt_row.completed_calendar_date,'replayed',false,'policy_status','needs_policy');
end;
$$;

create or replace function public.create_v2_daily_session_secure(
  p_user_id uuid,p_timezone text,p_calendar_date date,p_content_version_id uuid,
  p_focus_group_key text,p_plan_payload_sha256 text,p_items jsonb,p_program_version text,
  p_entitlement_id text,p_server_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $$
declare previous_row public.program_day_sessions%rowtype; content_row public.content_versions%rowtype;
  schedule_row public.review_schedules%rowtype; result jsonb; item jsonb;
begin
  perform public.lock_v2_user_mutation(p_user_id);
  if timezone(p_timezone,p_server_now)::date<>p_calendar_date then
    raise exception using message='V2_CALENDAR_DATE_INVALID',errcode='23514'; end if;
  select * into previous_row from public.program_day_sessions
    where user_id=p_user_id and status='completed' order by learning_day_sequence desc limit 1;
  if previous_row.id is not null
    and timezone(previous_row.timezone,p_server_now)::date<=previous_row.completed_calendar_date
  then raise exception using message='NEXT_LEARNING_DAY_NOT_AVAILABLE',errcode='23514'; end if;
  select * into content_row from public.content_versions where id=p_content_version_id;
  if content_row.id is null or content_row.status<>'active'
    or content_row.linguistic_reviewed_at is null or content_row.azure_validated_at is null
    or p_program_version<>content_row.stable_release_id||':'||content_row.version::text
  then raise exception using message='CONTENT_NOT_READY',errcode='P0001'; end if;
  if coalesce((select completed_program_days from public.program_enrollments where user_id=p_user_id),0)>=7
    and not public.v2_subscription_access(p_user_id,p_entitlement_id,p_server_now)
  then raise exception using message='ACCESS_REQUIRED',errcode='42501'; end if;

  perform set_config('app.v2_trusted_command','on',true);
  result:=public.create_v2_daily_session(
    p_user_id,p_timezone,p_calendar_date,p_content_version_id,p_focus_group_key,
    p_plan_payload_sha256,p_items,p_program_version
  );
  insert into public.learning_deletion_epochs(user_id,current_epoch) values(p_user_id,0)
    on conflict(user_id) do nothing;
  if not coalesce((result->>'replayed')::boolean,false) then
    perform set_config('app.v2_secure_create','on',true);
    for item in select value from jsonb_array_elements(p_items) loop
      if jsonb_typeof(item->'targetLocator')<>'object' then
        raise exception using message='V2_TARGET_LOCATOR_REQUIRED',errcode='22023'; end if;
      if item->>'slotRole'='review' then
        select * into schedule_row from public.review_schedules
          where id=nullif(item->>'reviewScheduleId','')::uuid
            and user_id=p_user_id
            and focus_group_key=item->>'focusGroupKey'
            and based_on_evidence_id=nullif(item->>'reviewSourceEvidenceId','')::uuid
            and review_due_date=nullif(item->>'reviewDueDate','')::date
            and interval_kind=item->>'reviewIntervalKind'
            and status in ('scheduled','due','overdue');
        if schedule_row.id is null then
          raise exception using message='V2_REVIEW_SNAPSHOT_INVALID',errcode='23514'; end if;
        perform set_config('app.v2_review_refresh','on',true);
      end if;
      update public.program_session_items set
        target_locator=item->'targetLocator',advice_version=nullif(item->>'adviceVersion','')::integer,
        review_schedule_id=case when item->>'slotRole'='review' then schedule_row.id else null end,
        review_source_evidence_id=case when item->>'slotRole'='review' then schedule_row.based_on_evidence_id else null end,
        review_interval_kind=case when item->>'slotRole'='review' then schedule_row.interval_kind else null end
      where session_id=(result->>'session_id')::uuid and position=(item->>'position')::smallint;
      if item->>'slotRole'='review' then
        perform set_config('app.v2_review_refresh','off',true);
      end if;
    end loop;
    perform set_config('app.v2_secure_create','off',true);
  end if;
  perform set_config('app.v2_trusted_command','off',true);
  return result;
end;
$$;

create or replace function public.refresh_v2_review_slot_secure(
  p_user_id uuid,p_session_id uuid,p_calendar_date date,p_review_item jsonb,
  p_entitlement_id text,p_server_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $$
declare evidence_row public.focus_evidence%rowtype; schedule_row public.review_schedules%rowtype;
  source_attempt public.learning_attempts%rowtype; session_row public.program_day_sessions%rowtype;
  enrollment_row public.program_enrollments%rowtype; review_row public.program_session_items%rowtype;
begin
  perform public.lock_v2_user_mutation(p_user_id);
  select * into session_row from public.program_day_sessions
    where id=p_session_id and user_id=p_user_id;
  select * into enrollment_row from public.program_enrollments
    where id=session_row.enrollment_id and user_id=p_user_id;
  if session_row.id is null or enrollment_row.id is null then
    raise exception using message='V2_SESSION_NOT_AVAILABLE',errcode='42501'; end if;
  if enrollment_row.completed_program_days>=7
    and not public.v2_subscription_access(p_user_id,p_entitlement_id,p_server_now)
  then raise exception using message='ACCESS_REQUIRED',errcode='42501'; end if;
  if p_calendar_date<=coalesce(session_row.review_effective_calendar_date,session_row.originating_calendar_date) then
    return jsonb_build_object('session_id',session_row.id,'changed',false,'replayed',true);
  end if;
  select * into review_row from public.program_session_items
    where session_id=session_row.id and user_id=p_user_id and slot_role='review'
    order by position limit 1 for update;
  if review_row.id is null then
    raise exception using message='V2_REVIEW_SLOT_NOT_AVAILABLE',errcode='23514'; end if;
  if exists(select 1 from public.learning_attempts where session_item_id=review_row.id)
    or review_row.status<>'planned' or p_review_item is null
  then
    perform set_config('app.v2_trusted_command','on',true);
    perform set_config('app.v2_review_refresh','on',true);
    update public.program_day_sessions set review_effective_calendar_date=p_calendar_date
      where id=session_row.id;
    perform set_config('app.v2_review_refresh','off',true);
    perform set_config('app.v2_trusted_command','off',true);
    return jsonb_build_object('session_id',session_row.id,'changed',false,'replayed',false);
  end if;
  if p_review_item is not null then
    select * into evidence_row from public.focus_evidence
      where id=nullif(p_review_item->>'reviewSourceEvidenceId','')::uuid and user_id=p_user_id;
    select * into schedule_row from public.review_schedules
      where id=nullif(p_review_item->>'reviewScheduleId','')::uuid and user_id=p_user_id;
    select * into source_attempt from public.learning_attempts
      where id=evidence_row.source_attempt_id and user_id=p_user_id;
    if evidence_row.id is null or evidence_row.focus_group_key<>p_review_item->>'focusGroupKey'
      or evidence_row.assisted or evidence_row.normalization_status<>'server_normalized'
      or source_attempt.id is null or not source_attempt.technical_valid
      or source_attempt.normalization_status<>'server_normalized'
      or source_attempt.attempt_role='guided_retry' or source_attempt.coaching_shown
      or schedule_row.id is null or schedule_row.based_on_evidence_id<>evidence_row.id
      or schedule_row.focus_group_key<>evidence_row.focus_group_key
      or schedule_row.review_due_date<>nullif(p_review_item->>'reviewDueDate','')::date
      or schedule_row.interval_kind<>p_review_item->>'reviewIntervalKind'
      or schedule_row.status not in ('scheduled','due','overdue')
      or schedule_row.completion_evidence_id is not null
      or nullif(p_review_item->>'practiceItemKey','') is null
      or nullif(p_review_item->>'referenceTextVersion','') is null
      or jsonb_typeof(p_review_item->'targetLocator')<>'object'
    then raise exception using message='V2_REVIEW_EVIDENCE_INVALID',errcode='23514'; end if;
  end if;
  perform set_config('app.v2_trusted_command','on',true);
  perform set_config('app.v2_secure_create','on',true);
  perform set_config('app.v2_review_refresh','on',true);
  update public.program_session_items set
    practice_item_key=p_review_item->>'practiceItemKey',
    focus_group_key=p_review_item->>'focusGroupKey',prompt_role='review',
    selection_reason='due_review',review_source_evidence_id=schedule_row.based_on_evidence_id,
    review_due_date=schedule_row.review_due_date,reference_text=p_review_item->>'referenceText',
    reference_text_version=p_review_item->>'referenceTextVersion',
    expected_focus_representation=p_review_item->>'expectedFocusRepresentation',
    next_action_key=nullif(p_review_item->>'nextActionKey',''),
    target_locator=p_review_item->'targetLocator',
    advice_version=nullif(p_review_item->>'adviceVersion','')::integer,
    review_schedule_id=schedule_row.id,review_interval_kind=schedule_row.interval_kind
    where id=review_row.id;
  update public.program_day_sessions set review_effective_calendar_date=p_calendar_date
    where id=session_row.id;
  perform set_config('app.v2_review_refresh','off',true);
  perform set_config('app.v2_secure_create','off',true);
  perform set_config('app.v2_trusted_command','off',true);
  return jsonb_build_object('session_id',session_row.id,'changed',true,'replayed',false);
end;
$$;

create or replace function public.complete_v2_program_day_secure(
  p_user_id uuid,p_session_id uuid,p_completion_idempotency_key uuid,
  p_completion_payload_sha256 text,p_completed_at timestamptz,p_calendar_date date,
  p_entitlement_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $$
declare session_row public.program_day_sessions%rowtype; enrollment_row public.program_enrollments%rowtype;
  completed_required integer; next_completed smallint; report_status text;
begin
  if p_completion_payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using message='V2_COMPLETION_INPUT_INVALID',errcode='22023'; end if;
  perform public.lock_v2_user_mutation(p_user_id);
  select * into session_row from public.program_day_sessions
    where id=p_session_id and user_id=p_user_id for update;
  if session_row.id is null then raise exception using message='V2_SESSION_NOT_FOUND',errcode='42501'; end if;
  if session_row.status='completed' then
    if session_row.completion_idempotency_key=p_completion_idempotency_key
      and session_row.completion_payload_sha256=p_completion_payload_sha256
    then return jsonb_build_object('session_id',session_row.id,'replayed',true,
      'completed_program_day',session_row.trial_program_day,
      'learning_day_sequence',session_row.learning_day_sequence); end if;
    raise exception using message='IDEMPOTENCY_PAYLOAD_CONFLICT',errcode='23505';
  end if;
  if timezone(session_row.timezone,p_completed_at)::date<>p_calendar_date then
    raise exception using message='SESSION_TIMEZONE_MISMATCH',errcode='23514'; end if;
  select * into enrollment_row from public.program_enrollments
    where id=session_row.enrollment_id and user_id=p_user_id for update;
  if not enrollment_row.trial_grant_consumed or enrollment_row.trial_started_at is null then
    raise exception using message='VALID_ATTEMPT_REQUIRED',errcode='23514'; end if;
  if enrollment_row.completed_program_days>=7
    and not public.v2_subscription_access(p_user_id,p_entitlement_id,p_completed_at)
  then raise exception using message='ACCESS_REQUIRED',errcode='42501'; end if;
  if enrollment_row.last_completed_calendar_date is not null
    and p_calendar_date<=enrollment_row.last_completed_calendar_date
  then raise exception using message='CALENDAR_DATE_ALREADY_COMPLETED',errcode='23505'; end if;
  if session_row.required_item_count<>5 then
    raise exception using message='SHORTENING_POLICY_NOT_READY',errcode='23514'; end if;
  select count(*) into completed_required from public.program_session_items i
    where i.session_id=session_row.id and i.user_id=p_user_id and i.is_required and i.status='completed'
      and exists (
        select 1 from public.learning_attempts a
        where a.session_item_id=i.id and a.user_id=p_user_id and a.technical_valid
          and a.normalization_status='server_normalized'
      );
  if completed_required<>5 then raise exception using message='REQUIRED_ITEMS_INCOMPLETE',errcode='23514'; end if;
  perform set_config('app.v2_trusted_command','on',true);
  update public.program_day_sessions set status='completed',completed_calendar_date=p_calendar_date,
    completion_idempotency_key=p_completion_idempotency_key,
    completion_payload_sha256=p_completion_payload_sha256,completed_at=p_completed_at,
    current_position=required_item_count where id=session_row.id;
  next_completed:=least(enrollment_row.completed_program_days+1,7);
  report_status:=case when enrollment_row.day_7_report_status='ready' then 'ready'
    when next_completed=7 then 'pending' else enrollment_row.day_7_report_status end;
  update public.program_enrollments set completed_program_days=next_completed,
    current_program_day=greatest(current_program_day,next_completed),
    last_completed_calendar_date=p_calendar_date,
    trial_status=case when next_completed=7 then 'day_7_completed' else 'in_progress' end,
    day_7_report_status=report_status where id=enrollment_row.id;
  perform set_config('app.v2_trusted_command','off',true);
  return jsonb_build_object('session_id',session_row.id,'replayed',false,
    'completed_program_day',session_row.trial_program_day,
    'learning_day_sequence',session_row.learning_day_sequence,
    'day_7_report_status',report_status,'policy_status','needs_policy');
end;
$$;

create or replace function public.delete_v2_learning_data_atomic(
  p_user_id uuid,
  p_deletion_request_id uuid,
  p_expected_deletion_epoch bigint,
  p_server_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare request_row public.learning_deletion_requests%rowtype; epoch_row public.learning_deletion_epochs%rowtype;
  counts jsonb; new_epoch bigint;
begin
  if p_deletion_request_id is null or p_expected_deletion_epoch<0 then
    raise exception using message='V2_DELETE_INPUT_INVALID',errcode='22023'; end if;
  perform public.lock_v2_user_mutation(p_user_id);
  select * into request_row from public.learning_deletion_requests
    where request_id=p_deletion_request_id for update;
  if request_row.request_id is not null then
    if request_row.user_id<>p_user_id or request_row.expected_epoch<>p_expected_deletion_epoch then
      raise exception using message='IDEMPOTENCY_PAYLOAD_CONFLICT',errcode='23505'; end if;
    return jsonb_build_object('deletion_request_id',request_row.request_id,
      'deletion_epoch',request_row.resulting_epoch,'resulting_epoch',request_row.resulting_epoch,
      'deleted_counts',request_row.deleted_counts,'replayed',true,
      'local_recordings_action_required',true);
  end if;

  insert into public.learning_deletion_epochs(user_id,current_epoch) values(p_user_id,0)
    on conflict(user_id) do nothing;
  select * into epoch_row from public.learning_deletion_epochs where user_id=p_user_id for update;
  if epoch_row.current_epoch<>p_expected_deletion_epoch then
    raise exception using message='DELETION_EPOCH_CONFLICT',errcode='40001'; end if;
  new_epoch:=epoch_row.current_epoch+1;

  counts:=jsonb_build_object(
    'v2_sessions',(select count(*) from public.program_day_sessions where user_id=p_user_id),
    'v2_items',(select count(*) from public.program_session_items where user_id=p_user_id),
    'v2_attempts',(select count(*) from public.learning_attempts where user_id=p_user_id),
    'v2_results',(select count(*) from public.learning_attempt_results where user_id=p_user_id),
    'v2_cycles',(select count(*) from public.correction_cycles where user_id=p_user_id),
    'v2_evidence',(select count(*) from public.focus_evidence where user_id=p_user_id),
    'v2_focus_states',(select count(*) from public.focus_states_v2 where user_id=p_user_id),
    'v2_reviews',(select count(*) from public.review_schedules where user_id=p_user_id),
    'v2_review_receipts',(select count(*) from public.review_completion_receipts where user_id=p_user_id),
    'v2_reports',(select count(*) from public.learning_reports where user_id=p_user_id),
    'v2_tickets',(select count(*) from public.assessment_tickets where user_id=p_user_id),
    'legacy_sessions',(select count(*) from public.daily_sessions where user_id=p_user_id),
    'legacy_attempts',(select count(*) from public.attempts where user_id=p_user_id),
    'legacy_states',(select count(*) from public.phoneme_state where user_id=p_user_id),
    'legacy_snapshots',(select count(*) from public.phoneme_snapshots where user_id=p_user_id),
    'legacy_badges',(select count(*) from public.user_badges where user_id=p_user_id),
    'legacy_bookmarks',(select count(*) from public.user_bookmarks where user_id=p_user_id),
    'legacy_free_attempts',(select count(*) from public.free_attempts where user_id=p_user_id),
    'legacy_advice_feedback',(select count(*) from public.advice_feedback where user_id=p_user_id)
  );

  perform set_config('app.v2_trusted_command','on',true);
  perform set_config('app.v2_learning_delete','on',true);
  update public.learning_deletion_epochs set current_epoch=new_epoch where user_id=p_user_id;

  -- Break the intentional ticket/attempt FK cycle only inside this trusted delete.
  update public.learning_attempts set assessment_ticket_id=null
    where user_id=p_user_id and assessment_ticket_id is not null;
  update public.assessment_tickets set status='expired',consumed_at=null,consumed_attempt_id=null
    where user_id=p_user_id and status<>'expired';
  delete from public.assessment_tickets where user_id=p_user_id;

  delete from public.learning_report_evidence where user_id=p_user_id;
  delete from public.learning_report_correction_cycles where user_id=p_user_id;
  delete from public.learning_reports where user_id=p_user_id;
  delete from public.focus_states_v2 where user_id=p_user_id;
  delete from public.review_completion_receipts where user_id=p_user_id;
  -- Session items own the immutable review-schedule snapshot FK. Remove the
  -- session graph first; evidence cascades may then remove schedules safely.
  delete from public.program_day_sessions where user_id=p_user_id;
  -- Defensive cleanup for any historically orphaned user-owned rows.
  delete from public.review_schedules where user_id=p_user_id;
  delete from public.focus_evidence where user_id=p_user_id;
  delete from public.correction_cycles where user_id=p_user_id;
  delete from public.learning_attempt_results where user_id=p_user_id;
  delete from public.learning_attempts where user_id=p_user_id;
  delete from public.program_session_items where user_id=p_user_id;

  delete from public.advice_feedback where user_id=p_user_id;
  delete from public.daily_session_items where daily_session_id in (
    select id from public.daily_sessions where user_id=p_user_id
  );
  delete from public.attempts where user_id=p_user_id;
  delete from public.daily_sessions where user_id=p_user_id;
  delete from public.phoneme_state where user_id=p_user_id;
  delete from public.phoneme_snapshots where user_id=p_user_id;
  delete from public.user_badges where user_id=p_user_id;
  delete from public.user_bookmarks where user_id=p_user_id;
  delete from public.free_attempts where user_id=p_user_id;

  insert into public.learning_deletion_requests(
    request_id,user_id,expected_epoch,resulting_epoch,deleted_counts,requested_at,completed_at
  ) values (
    p_deletion_request_id,p_user_id,p_expected_deletion_epoch,new_epoch,counts,p_server_now,p_server_now
  ) returning * into request_row;
  perform set_config('app.v2_learning_delete','off',true);
  perform set_config('app.v2_trusted_command','off',true);
  return jsonb_build_object('deletion_request_id',request_row.request_id,
    'deletion_epoch',request_row.resulting_epoch,'resulting_epoch',request_row.resulting_epoch,
    'deleted_counts',request_row.deleted_counts,'replayed',false,
    'local_recordings_action_required',true);
end;
$$;

create or replace function public.export_v2_learning_data_snapshot(
  p_user_id uuid,
  p_max_bytes integer,
  p_server_now timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare result jsonb; result_bytes bigint;
begin
  if p_user_id is null or p_max_bytes<=0 then
    raise exception using message='V2_EXPORT_INPUT_INVALID',errcode='22023'; end if;
  if not exists(select 1 from auth.users where id=p_user_id) then
    raise exception using message='V2_EXPORT_USER_NOT_FOUND',errcode='42501'; end if;

  result:=jsonb_build_object(
    'schema_version','otokagami-learning-export-v2',
    'exported_at',p_server_now,
    'profile',coalesce((select jsonb_build_object(
      'native_language',p.native_language,'target_accent',p.target_accent,
      'timezone',p.timezone,'reminder_enabled',p.reminder_enabled,
      'reminder_time_local',p.reminder_time_local,'playback_speed_default',p.playback_speed_default
    ) from public.profiles p where p.user_id=p_user_id),'null'::jsonb),
    'access_metadata',jsonb_build_object(
      'legacy_trial_started_at',(select p.free_trial_started_at from public.profiles p where p.user_id=p_user_id),
      'program_enrollment',coalesce((select jsonb_build_object(
        'program_version',e.program_version,'trial_status',e.trial_status,
        'trial_started_at',e.trial_started_at,'current_program_day',e.current_program_day,
        'completed_program_days',e.completed_program_days,
        'last_completed_calendar_date',e.last_completed_calendar_date,
        'day_7_report_status',e.day_7_report_status,'trial_granted_at',e.trial_granted_at,
        'trial_grant_consumed',e.trial_grant_consumed
      ) from public.program_enrollments e where e.user_id=p_user_id),'null'::jsonb),
      'subscriptions',coalesce((select jsonb_agg(jsonb_build_object(
        'entitlement_id',s.entitlement_id,'product_id',s.product_id,'status',s.status,
        'is_active',s.is_active,'current_period_started_at',s.current_period_started_at,
        'current_period_ends_at',s.current_period_ends_at
      ) order by s.created_at) from public.subscriptions s where s.user_id=p_user_id),'[]'::jsonb)
    ),
    'v2',jsonb_build_object(
      'sessions',coalesce((select jsonb_agg(jsonb_build_object(
        'id',s.id,'learning_day_sequence',s.learning_day_sequence,'trial_program_day',s.trial_program_day,
        'originating_calendar_date',s.originating_calendar_date,'completed_calendar_date',s.completed_calendar_date,
        'timezone',s.timezone,'content_version_id',s.content_version_id,'focus_group_key',s.focus_group_key,
        'status',s.status,'required_item_count',s.required_item_count,'optional_item_count',s.optional_item_count,
        'current_position',s.current_position,'started_at',s.started_at,'completed_at',s.completed_at
      ) order by s.learning_day_sequence) from public.program_day_sessions s where s.user_id=p_user_id),'[]'::jsonb),
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'id',i.id,'session_id',i.session_id,'position',i.position,'content_version_id',i.content_version_id,
        'practice_item_key',i.practice_item_key,'focus_group_key',i.focus_group_key,
        'prompt_role',i.prompt_role,'slot_role',i.slot_role,'selection_reason',i.selection_reason,
        'is_required',i.is_required,'review_schedule_id',i.review_schedule_id,
        'review_due_date',i.review_due_date,'review_interval_kind',i.review_interval_kind,
        'status',i.status,'completion_reason',i.completion_reason,'completed_at',i.completed_at
      ) order by i.session_id,i.position) from public.program_session_items i where i.user_id=p_user_id),'[]'::jsonb),
      'attempts',coalesce((select jsonb_agg(jsonb_build_object(
        'id',a.id,'session_id',a.session_id,'session_item_id',a.session_item_id,
        'content_version_id',a.content_version_id,'practice_item_key',a.practice_item_key,
        'focus_group_key',a.focus_group_key,'prompt_role',a.prompt_role,'attempt_role',a.attempt_role,
        'retry_of_attempt_id',a.retry_of_attempt_id,'attempt_sequence',a.attempt_sequence,
        'valid_attempt_ordinal',a.valid_attempt_ordinal,'attempted_at',a.attempted_at,
        'attempted_calendar_date',a.attempted_calendar_date,'timezone',a.timezone,
        'coaching_shown',a.coaching_shown,'technical_valid',a.technical_valid,
        'invalid_reason',a.invalid_reason,'provider',a.provider,'assessment_locale',a.assessment_locale,
        'provider_version',a.provider_version,'normalizer_version',a.normalizer_version,
        'normalization_status',a.normalization_status,'provider_attested',a.provider_attested
      ) order by a.attempted_at,a.attempt_sequence) from public.learning_attempts a where a.user_id=p_user_id),'[]'::jsonb),
      'results',coalesce((select jsonb_agg(jsonb_build_object(
        'attempt_id',r.attempt_id,'provider',r.provider,'assessment_locale',r.assessment_locale,
        'normalizer_version',r.normalizer_version,'reference_text_version',r.reference_text_version,
        'expected_focus_representation',r.expected_focus_representation,'observed_candidate',r.observed_candidate,
        'target_score',r.target_score,'technical_valid',r.technical_valid,'result_label',r.result_label,
        'next_action_key',r.next_action_key,'capability_flags',r.capability_flags,
        'normalized_detail',r.normalized_detail,'normalization_status',r.normalization_status,
        'provider_attested',r.provider_attested,'created_at',r.created_at
      ) order by r.created_at) from public.learning_attempt_results r where r.user_id=p_user_id),'[]'::jsonb),
      'correction_cycles',coalesce((select jsonb_agg(jsonb_build_object(
        'id',c.id,'session_item_id',c.session_item_id,'focus_group_key',c.focus_group_key,
        'content_version_id',c.content_version_id,'before_attempt_id',c.before_attempt_id,
        'advice_stable_key',c.advice_stable_key,'advice_version',c.advice_version,
        'coaching_locale',c.coaching_locale,'after_attempt_id',c.after_attempt_id,
        'candidate_change_type',c.candidate_change_type,'immediate_change_status',c.immediate_change_status,
        'created_at',c.created_at
      ) order by c.created_at) from public.correction_cycles c where c.user_id=p_user_id),'[]'::jsonb),
      'focus_evidence',coalesce((select jsonb_agg(jsonb_build_object(
        'id',e.id,'focus_group_key',e.focus_group_key,'evidence_kind',e.evidence_kind,
        'source_attempt_id',e.source_attempt_id,'correction_cycle_id',e.correction_cycle_id,
        'evidence_calendar_date',e.evidence_calendar_date,'prompt_role',e.prompt_role,
        'prompt_context',e.prompt_context,'assisted',e.assisted,'content_version_id',e.content_version_id,
        'normalization_status',e.normalization_status,'created_at',e.created_at
      ) order by e.evidence_calendar_date,e.created_at) from public.focus_evidence e where e.user_id=p_user_id),'[]'::jsonb),
      'focus_states',coalesce((select jsonb_agg(jsonb_build_object(
        'focus_group_key',f.focus_group_key,'current_state',f.current_state,
        'last_unassisted_success_date',f.last_unassisted_success_date,'next_prompt_role',f.next_prompt_role,
        'next_review_due_date',f.next_review_due_date,'source_evidence_id',f.source_evidence_id,
        'content_version_id',f.content_version_id,'updated_at',f.updated_at
      ) order by f.focus_group_key) from public.focus_states_v2 f where f.user_id=p_user_id),'[]'::jsonb),
      'reviews',coalesce((select jsonb_agg(jsonb_build_object(
        'id',r.id,'focus_group_key',r.focus_group_key,'interval_kind',r.interval_kind,
        'based_on_evidence_id',r.based_on_evidence_id,'based_on_calendar_date',r.based_on_calendar_date,
        'review_due_date',r.review_due_date,'status',r.status,'completion_evidence_id',r.completion_evidence_id,
        'created_at',r.created_at,'updated_at',r.updated_at
      ) order by r.review_due_date) from public.review_schedules r where r.user_id=p_user_id),'[]'::jsonb),
      'review_completion_receipts',coalesce((select jsonb_agg(jsonb_build_object(
        'id',r.id,'review_schedule_id',r.review_schedule_id,'session_item_id',r.session_item_id,
        'attempt_id',r.attempt_id,'completed_calendar_date',r.completed_calendar_date,
        'completed_at',r.completed_at
      ) order by r.completed_at) from public.review_completion_receipts r where r.user_id=p_user_id),'[]'::jsonb),
      'reports',coalesce((select jsonb_agg(jsonb_build_object(
        'id',r.id,'report_type',r.report_type,'trial_program_day_start',r.trial_program_day_start,
        'trial_program_day_end',r.trial_program_day_end,'learning_day_sequence_start',r.learning_day_sequence_start,
        'learning_day_sequence_end',r.learning_day_sequence_end,'calendar_date_start',r.calendar_date_start,
        'calendar_date_end',r.calendar_date_end,'generated_content_version_id',r.generated_content_version_id,
        'summary',r.summary,'next_review_due_date',r.next_review_due_date,
        'next_focus_group_key',r.next_focus_group_key,'created_at',r.created_at
      ) order by r.created_at) from public.learning_reports r where r.user_id=p_user_id),'[]'::jsonb)
    ),
    'legacy',jsonb_build_object(
      'classification','legacy_v1',
      'daily_sessions',coalesce((select jsonb_agg(jsonb_build_object(
        'id',s.id,'session_date',s.session_date,'timezone',s.timezone,'status',s.status,
        'completed_count',s.completed_count,'created_at',s.created_at,'completed_at',s.completed_at
      ) order by s.session_date) from public.daily_sessions s where s.user_id=p_user_id),'[]'::jsonb),
      'daily_session_items',coalesce((select jsonb_agg(jsonb_build_object(
        'id',i.id,'daily_session_id',i.daily_session_id,'position',i.position,'slot_type',i.slot_type,
        'practice_item_id',i.practice_item_id,'target_phoneme_ids',i.target_phoneme_ids,
        'status',i.status,'completed_at',i.completed_at
      ) order by i.daily_session_id,i.position) from public.daily_session_items i
        join public.daily_sessions s on s.id=i.daily_session_id where s.user_id=p_user_id),'[]'::jsonb),
      'attempts',coalesce((select jsonb_agg(jsonb_build_object(
        'id',a.id,'daily_session_id',a.daily_session_id,'daily_session_item_id',a.daily_session_item_id,
        'practice_item_id',a.practice_item_id,'practice_mode',a.practice_mode,'attempt_no',a.attempt_no,
        'practiced_at',a.practiced_at,'practiced_date',a.practiced_date,'timezone',a.timezone,
        'target_phoneme_ids',a.target_phoneme_ids,'overall_score',a.overall_score,
        'target_score_avg',a.target_score_avg,'is_correct',a.is_correct,'is_perfect',a.is_perfect,
        'is_best',a.is_best,'app_version',a.app_version,'created_at',a.created_at
      ) order by a.practiced_at) from public.attempts a where a.user_id=p_user_id),'[]'::jsonb),
      'attempt_phoneme_results',coalesce((select jsonb_agg(jsonb_build_object(
        'id',r.id,'attempt_id',r.attempt_id,'index',r.index,'word_index',r.word_index,
        'expected_phoneme_id',r.expected_phoneme_id,'expected_ipa',r.expected_ipa,
        'observed_phoneme_id',r.observed_phoneme_id,'observed_ipa',r.observed_ipa,
        'score',r.score,'color',r.color,'is_target',r.is_target,'confusion_pair_id',r.confusion_pair_id
      ) order by r.attempt_id,r.index) from public.attempt_phoneme_results r
        join public.attempts a on a.id=r.attempt_id where a.user_id=p_user_id),'[]'::jsonb),
      'phoneme_state',coalesce((select jsonb_agg(jsonb_build_object(
        'phoneme_id',s.phoneme_id,'mastery_ewma',s.mastery_ewma,'practice_count',s.practice_count,
        'last_practiced_date',s.last_practiced_date,'next_review_date',s.next_review_date,
        'review_stage',s.review_stage,'updated_at',s.updated_at
      ) order by s.phoneme_id) from public.phoneme_state s where s.user_id=p_user_id),'[]'::jsonb),
      'phoneme_snapshots',coalesce((select jsonb_agg(jsonb_build_object(
        'snapshot_date',s.snapshot_date,'phoneme_id',s.phoneme_id,'mastery_ewma',s.mastery_ewma,
        'created_at',s.created_at,'updated_at',s.updated_at
      ) order by s.snapshot_date,s.phoneme_id) from public.phoneme_snapshots s where s.user_id=p_user_id),'[]'::jsonb),
      'badges',coalesce((select jsonb_agg(jsonb_build_object(
        'badge_id',b.badge_id,'awarded_at',b.awarded_at,'metadata',b.metadata
      ) order by b.awarded_at) from public.user_badges b where b.user_id=p_user_id),'[]'::jsonb),
      'bookmarks',coalesce((select jsonb_agg(jsonb_build_object(
        'id',b.id,'bookmark_type',b.bookmark_type,'phoneme_id',b.phoneme_id,
        'practice_item_id',b.practice_item_id,'free_text',b.free_text,'created_at',b.created_at
      ) order by b.created_at) from public.user_bookmarks b where b.user_id=p_user_id),'[]'::jsonb),
      'free_attempts',coalesce((select jsonb_agg(jsonb_build_object(
        'id',f.id,'attempted_at',f.attempted_at,'attempted_date',f.attempted_date,'timezone',f.timezone,
        'input_text',f.input_text,'normalized_text',f.normalized_text,'ipa_result',f.ipa_result,
        'oov_words',f.oov_words,'conversion_confidence',f.conversion_confidence,
        'phoneme_scores',f.phoneme_scores,'overall_score',f.overall_score,
        'native_language',f.native_language,'target_accent',f.target_accent,
        'consent_version',f.consent_version,'app_version',f.app_version
      ) order by f.attempted_at) from public.free_attempts f where f.user_id=p_user_id),'[]'::jsonb),
      'advice_feedback',coalesce((select jsonb_agg(jsonb_build_object(
        'id',f.id,'attempt_id',f.attempt_id,'free_attempt_id',f.free_attempt_id,
        'advice_id',f.advice_id,'rating',f.rating,'created_at',f.created_at
      ) order by f.created_at) from public.advice_feedback f where f.user_id=p_user_id),'[]'::jsonb)
    )
  );
  result_bytes:=octet_length(convert_to(result::text,'UTF8'));
  if result_bytes>p_max_bytes then
    raise exception using message='EXPORT_SIZE_LIMIT_EXCEEDED',errcode='54000'; end if;
  return result||jsonb_build_object('export_bytes',result_bytes);
end;
$$;

-- The previous assessment ticket/persistence functions remain historical objects,
-- but the runtime service role can use only the deadline- and replay-hardened v2 forms.
revoke execute on function public.issue_v2_assessment_ticket(
  uuid,uuid,text,text,bigint,integer,integer,integer,timestamptz,text
) from service_role;
revoke execute on function public.persist_v2_attempt_with_ticket(
  uuid,uuid,uuid,text,bigint,uuid,text,timestamptz,date,text,text,text,text,text,text,
  boolean,boolean,text,text,numeric,text,text,jsonb,jsonb,text
) from service_role;

revoke all on function public.lock_v2_user_mutation(uuid) from public,anon,authenticated;
revoke all on function public.guard_v2_review_snapshot_mutation() from public,anon,authenticated;
revoke all on function public.guard_legacy_learning_write_after_v2_deletion() from public,anon,authenticated;
revoke all on function public.issue_v2_assessment_ticket_v2(
  uuid,uuid,text,text,bigint,integer,integer,integer,integer,timestamptz,text
) from public,anon,authenticated;
revoke all on function public.abandon_v2_assessment_ticket(uuid,uuid,text,timestamptz)
  from public,anon,authenticated;
revoke all on function public.persist_v2_attempt_v2(
  uuid,uuid,uuid,text,bigint,uuid,text,timestamptz,timestamptz,timestamptz,date,text,
  text,text,text,text,text,boolean,boolean,text,text,numeric,text,text,jsonb,jsonb,text
) from public,anon,authenticated;
revoke all on function public.complete_v2_review_submission(
  uuid,uuid,uuid,uuid,bigint,uuid,timestamptz,date
) from public,anon,authenticated;
revoke all on function public.delete_v2_learning_data_atomic(uuid,uuid,bigint,timestamptz)
  from public,anon,authenticated;
revoke all on function public.export_v2_learning_data_snapshot(uuid,integer,timestamptz)
  from public,anon,authenticated;

grant execute on function public.lock_v2_user_mutation(uuid) to service_role;
grant execute on function public.issue_v2_assessment_ticket_v2(
  uuid,uuid,text,text,bigint,integer,integer,integer,integer,timestamptz,text
) to service_role;
grant execute on function public.abandon_v2_assessment_ticket(uuid,uuid,text,timestamptz)
  to service_role;
grant execute on function public.persist_v2_attempt_v2(
  uuid,uuid,uuid,text,bigint,uuid,text,timestamptz,timestamptz,timestamptz,date,text,
  text,text,text,text,text,boolean,boolean,text,text,numeric,text,text,jsonb,jsonb,text
) to service_role;
grant execute on function public.complete_v2_review_submission(
  uuid,uuid,uuid,uuid,bigint,uuid,timestamptz,date
) to service_role;
grant execute on function public.delete_v2_learning_data_atomic(uuid,uuid,bigint,timestamptz)
  to service_role;
grant execute on function public.export_v2_learning_data_snapshot(uuid,integer,timestamptz)
  to service_role;

comment on function public.persist_v2_attempt_v2(
  uuid,uuid,uuid,text,bigint,uuid,text,timestamptz,timestamptz,timestamptz,date,text,
  text,text,text,text,text,boolean,boolean,text,text,numeric,text,text,jsonb,jsonb,text
) is 'Service-only atomic attempt persistence. Replay verifies epoch, ticket binding, nonce digest, and payload hash before returning a canonical result.';
comment on function public.delete_v2_learning_data_atomic(uuid,uuid,bigint,timestamptz) is
  'Service-only idempotent deletion. Preserves auth identity, profile/installations, subscriptions, trial ledger, epoch ledger, and shared content.';
comment on function public.export_v2_learning_data_snapshot(uuid,integer,timestamptz) is
  'Service-only allowlisted snapshot export. Excludes tickets, nonce/hash values, raw provider payload, audio, URI, credentials, and service internals.';
