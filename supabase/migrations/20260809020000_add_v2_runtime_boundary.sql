-- S6-05 through S6-07 additive runtime boundary for the Otokagami v2 MVP.
-- No existing row is inserted, updated, deleted, renamed, or backfilled.

alter table public.program_session_items
  add column slot_role text,
  add column selection_reason text,
  add column reference_text text,
  add column reference_text_version text,
  add column expected_focus_representation text,
  add column next_action_key text,
  add constraint program_session_items_slot_role_check check (
    slot_role is null or slot_role in (
      'anchor', 'contrast', 'transfer_word', 'sentence', 'practical_sentence', 'review', 'optional_extension'
    )
  ),
  add constraint program_session_items_selection_reason_check check (
    selection_reason is null or selection_reason in (
      'standard', 'due_review', 'review_substitute_transfer_word',
      'review_substitute_sentence', 'review_substitute_practical_sentence', 'optional_extension'
    )
  ),
  add constraint program_session_items_runtime_content_check check (
    (reference_text is null and reference_text_version is null and expected_focus_representation is null)
    or (
      btrim(reference_text) <> ''
      and btrim(reference_text_version) <> ''
      and btrim(expected_focus_representation) <> ''
    )
  );

comment on column public.program_session_items.slot_role is
  'Immutable server-selected role of this daily-plan slot. Null is retained only for pre-runtime rows in unknown environments.';
comment on column public.program_session_items.selection_reason is
  'Immutable server selection reason. It is never accepted from the Mobile client.';
comment on column public.program_session_items.reference_text is
  'Managed reference text snapshot used by the v2 speech-token boundary; never free input.';

alter table public.program_day_sessions
  add column plan_payload_sha256 text check (plan_payload_sha256 is null or plan_payload_sha256 ~ '^[0-9a-f]{64}$'),
  add column completion_payload_sha256 text check (completion_payload_sha256 is null or completion_payload_sha256 ~ '^[0-9a-f]{64}$'),
  add column review_effective_calendar_date date;

comment on column public.program_day_sessions.review_effective_calendar_date is
  'Calendar Date through which the still-unstarted review slot has been re-evaluated in the session-fixed timezone.';

alter table public.learning_attempts
  add column server_verified boolean not null default false;

comment on column public.learning_attempts.server_verified is
  'True only for a provider result normalized by the trusted v2 API before this row is persisted.';

create or replace function public.guard_program_enrollment_first_attempt()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.first_valid_learning_attempt_id is not null
    and not exists (
      select 1
      from public.learning_attempts a
      where a.id = new.first_valid_learning_attempt_id
        and a.user_id = new.user_id
        and a.technical_valid
        and a.server_verified
    )
  then
    raise exception 'Enrollment first learning attempt must be valid, server-verified, and owned by the enrolled user';
  end if;

  return new;
end;
$$;

create or replace function public.guard_focus_evidence_source()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  attempt_row public.learning_attempts%rowtype;
  cycle_row public.correction_cycles%rowtype;
begin
  if new.evidence_kind = 'immediate_change' then
    select * into cycle_row
    from public.correction_cycles
    where id = new.correction_cycle_id;

    if cycle_row.id is null
      or cycle_row.user_id <> new.user_id
      or cycle_row.focus_group_key <> new.focus_group_key
    then
      raise exception 'Immediate-change evidence must use a correction cycle for the same owner and focus';
    end if;

    select * into attempt_row
    from public.learning_attempts
    where id = cycle_row.before_attempt_id;

    if attempt_row.content_version_id <> new.content_version_id
      or attempt_row.prompt_role <> new.prompt_role
      or not attempt_row.server_verified
    then
      raise exception 'Immediate-change evidence must retain a server-verified correction source content and prompt role';
    end if;
  else
    select * into attempt_row
    from public.learning_attempts
    where id = new.source_attempt_id;

    if attempt_row.id is null
      or attempt_row.user_id <> new.user_id
      or attempt_row.focus_group_key <> new.focus_group_key
      or attempt_row.prompt_role <> new.prompt_role
      or attempt_row.content_version_id <> new.content_version_id
      or not attempt_row.technical_valid
      or not attempt_row.server_verified
      or attempt_row.attempt_role = 'guided_retry'
      or attempt_row.coaching_shown
    then
      raise exception 'Durable evidence must use a valid server-verified unassisted attempt for the same owner, focus, and prompt role';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.guard_v2_session_plan_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_setting('app.v2_review_refresh', true) = 'on' then
    if new.user_id is distinct from old.user_id
      or new.enrollment_id is distinct from old.enrollment_id
      or new.learning_day_sequence is distinct from old.learning_day_sequence
      or new.trial_program_day is distinct from old.trial_program_day
      or new.originating_calendar_date is distinct from old.originating_calendar_date
      or new.timezone is distinct from old.timezone
      or new.content_version_id is distinct from old.content_version_id
      or new.focus_group_key is distinct from old.focus_group_key
      or new.required_item_count is distinct from old.required_item_count
      or new.optional_item_count is distinct from old.optional_item_count
      or new.plan_payload_sha256 is distinct from old.plan_payload_sha256
      or new.review_effective_calendar_date < coalesce(old.review_effective_calendar_date, old.originating_calendar_date)
    then
      raise exception using message = 'V2_REVIEW_REFRESH_SESSION_INVALID', errcode = '23514';
    end if;
    return new;
  end if;
  if new.user_id is distinct from old.user_id
    or new.enrollment_id is distinct from old.enrollment_id
    or new.learning_day_sequence is distinct from old.learning_day_sequence
    or new.trial_program_day is distinct from old.trial_program_day
    or new.originating_calendar_date is distinct from old.originating_calendar_date
    or new.timezone is distinct from old.timezone
    or new.content_version_id is distinct from old.content_version_id
    or new.focus_group_key is distinct from old.focus_group_key
    or new.required_item_count is distinct from old.required_item_count
    or new.optional_item_count is distinct from old.optional_item_count
    or new.plan_payload_sha256 is distinct from old.plan_payload_sha256
    or new.review_effective_calendar_date is distinct from old.review_effective_calendar_date
  then
    raise exception using message = 'V2_SESSION_PLAN_IMMUTABLE', errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.guard_v2_item_plan_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_setting('app.v2_review_refresh', true) = 'on' then
    if old.slot_role <> 'review'
      or old.status <> 'planned'
      or new.user_id is distinct from old.user_id
      or new.session_id is distinct from old.session_id
      or new.position is distinct from old.position
      or new.content_version_id is distinct from old.content_version_id
      or new.slot_role <> 'review'
      or not new.is_required
      or new.status is distinct from old.status
      or new.completion_reason is distinct from old.completion_reason
      or new.selected_before_attempt_id is distinct from old.selected_before_attempt_id
      or new.selected_after_attempt_id is distinct from old.selected_after_attempt_id
      or new.completed_at is distinct from old.completed_at
    then
      raise exception using message = 'V2_REVIEW_REFRESH_ITEM_INVALID', errcode = '23514';
    end if;
    return new;
  end if;
  if new.user_id is distinct from old.user_id
    or new.session_id is distinct from old.session_id
    or new.position is distinct from old.position
    or new.content_version_id is distinct from old.content_version_id
    or new.practice_item_key is distinct from old.practice_item_key
    or new.focus_group_key is distinct from old.focus_group_key
    or new.prompt_role is distinct from old.prompt_role
    or new.slot_role is distinct from old.slot_role
    or new.selection_reason is distinct from old.selection_reason
    or new.is_required is distinct from old.is_required
    or new.review_source_evidence_id is distinct from old.review_source_evidence_id
    or new.review_due_date is distinct from old.review_due_date
    or new.reference_text is distinct from old.reference_text
    or new.reference_text_version is distinct from old.reference_text_version
    or new.expected_focus_representation is distinct from old.expected_focus_representation
    or new.next_action_key is distinct from old.next_action_key
  then
    raise exception using message = 'V2_SESSION_ITEM_PLAN_IMMUTABLE', errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.guard_v2_append_only_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception using message = 'V2_APPEND_ONLY_ROW', errcode = '55000';
end;
$$;

create or replace function public.assert_v2_json_allowlist(
  value jsonb,
  allowed_keys text[],
  field_name text
)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  unexpected text;
begin
  if value is null or jsonb_typeof(value) <> 'object' then
    raise exception using message = field_name || '_MUST_BE_OBJECT', errcode = '22023';
  end if;
  select key into unexpected
  from jsonb_object_keys(value) as keys(key)
  where not (key = any(allowed_keys))
  limit 1;
  if unexpected is not null then
    raise exception using message = field_name || '_KEY_NOT_ALLOWED', errcode = '22023';
  end if;
end;
$$;

create or replace function public.guard_v2_json_boundaries()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'learning_attempts' then
    perform public.assert_v2_json_allowlist(new.capability_metadata, array['targetScore', 'observedCandidate'], 'CAPABILITY_METADATA');
  elsif tg_table_name = 'learning_attempt_results' then
    perform public.assert_v2_json_allowlist(new.capability_flags, array['targetScore', 'observedCandidate'], 'CAPABILITY_FLAGS');
    perform public.assert_v2_json_allowlist(new.normalized_detail, array['recognitionStatus'], 'NORMALIZED_DETAIL');
  elsif tg_table_name = 'learning_reports' then
    perform public.assert_v2_json_allowlist(new.summary, array['status', 'state'], 'REPORT_SUMMARY');
  end if;
  return new;
end;
$$;

create or replace function public.guard_correction_cycle_attempts()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  item_row public.program_session_items%rowtype;
  before_row public.learning_attempts%rowtype;
  after_row public.learning_attempts%rowtype;
begin
  select * into item_row from public.program_session_items where id = new.session_item_id;
  select * into before_row from public.learning_attempts where id = new.before_attempt_id;
  select * into after_row from public.learning_attempts where id = new.after_attempt_id;

  if item_row.id is null
    or item_row.user_id <> new.user_id
    or item_row.focus_group_key <> new.focus_group_key
    or before_row.id is null
    or before_row.user_id <> new.user_id
    or before_row.session_id <> item_row.session_id
    or before_row.session_item_id <> new.session_item_id
    or before_row.focus_group_key <> new.focus_group_key
    or not before_row.technical_valid
    or not before_row.server_verified
    or before_row.attempt_role = 'guided_retry'
    or before_row.coaching_shown
  then
    raise exception using message = 'CORRECTION_BEFORE_ATTEMPT_INVALID', errcode = '23514';
  end if;

  if after_row.id is null
    or after_row.user_id <> new.user_id
    or after_row.session_id <> item_row.session_id
    or after_row.session_item_id <> new.session_item_id
    or after_row.focus_group_key <> new.focus_group_key
    or not after_row.technical_valid
    or not after_row.server_verified
    or after_row.attempt_role <> 'guided_retry'
    or not after_row.coaching_shown
    or after_row.retry_of_attempt_id <> new.before_attempt_id
  then
    raise exception using message = 'CORRECTION_AFTER_ATTEMPT_INVALID', errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.guard_learning_attempt_retry()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  source_row public.learning_attempts%rowtype;
begin
  if new.attempt_role = 'guided_retry' then
    select * into source_row from public.learning_attempts where id = new.retry_of_attempt_id;
    if source_row.id is null
      or source_row.user_id <> new.user_id
      or source_row.session_id <> new.session_id
      or source_row.session_item_id <> new.session_item_id
      or source_row.focus_group_key <> new.focus_group_key
      or not source_row.technical_valid
      or not source_row.server_verified
      or source_row.attempt_role = 'guided_retry'
      or source_row.coaching_shown
    then
      raise exception using message = 'GUIDED_RETRY_SOURCE_INVALID', errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_v2_verified_derivation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  evidence_id uuid;
begin
  if tg_table_name = 'focus_states_v2' then
    evidence_id := new.source_evidence_id;
  elsif tg_table_name = 'review_schedules' then
    evidence_id := new.based_on_evidence_id;
  elsif tg_table_name = 'learning_report_evidence' then
    evidence_id := new.evidence_id;
  else
    return new;
  end if;
  if not exists (
    select 1 from public.focus_evidence e
    where e.id = evidence_id and e.user_id = new.user_id and e.server_verified
  ) then
    raise exception using message = 'UNVERIFIED_EVIDENCE_DERIVATION_REJECTED', errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger program_day_sessions_guard_plan
before update on public.program_day_sessions
for each row execute function public.guard_v2_session_plan_mutation();
create trigger program_session_items_guard_plan
before update on public.program_session_items
for each row execute function public.guard_v2_item_plan_mutation();
create trigger learning_attempts_append_only
before update on public.learning_attempts
for each row execute function public.guard_v2_append_only_update();
create trigger learning_attempt_results_append_only
before update on public.learning_attempt_results
for each row execute function public.guard_v2_append_only_update();
create trigger focus_evidence_append_only
before update on public.focus_evidence
for each row execute function public.guard_v2_append_only_update();
create trigger learning_attempts_json_boundary
before insert on public.learning_attempts
for each row execute function public.guard_v2_json_boundaries();
create trigger learning_attempt_results_json_boundary
before insert on public.learning_attempt_results
for each row execute function public.guard_v2_json_boundaries();
create trigger learning_reports_json_boundary
before insert or update on public.learning_reports
for each row execute function public.guard_v2_json_boundaries();
create trigger focus_states_v2_verified_derivation
before insert or update on public.focus_states_v2
for each row execute function public.guard_v2_verified_derivation();
create trigger review_schedules_verified_derivation
before insert or update on public.review_schedules
for each row execute function public.guard_v2_verified_derivation();
create trigger learning_report_evidence_verified_derivation
before insert or update on public.learning_report_evidence
for each row execute function public.guard_v2_verified_derivation();

create or replace function public.create_v2_daily_session(
  p_user_id uuid,
  p_timezone text,
  p_calendar_date date,
  p_content_version_id uuid,
  p_focus_group_key text,
  p_plan_payload_sha256 text,
  p_items jsonb,
  p_program_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  enrollment_row public.program_enrollments%rowtype;
  session_row public.program_day_sessions%rowtype;
  item jsonb;
  required_count integer;
  optional_count integer;
  next_sequence bigint;
begin
  if p_user_id is null or btrim(p_timezone) = '' or btrim(p_focus_group_key) = ''
    or p_plan_payload_sha256 !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) < 5 or jsonb_array_length(p_items) > 7
  then
    raise exception using message = 'V2_SESSION_INPUT_INVALID', errcode = '22023';
  end if;
  perform timezone(p_timezone, now());
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':v2-session', 0));

  select * into session_row from public.program_day_sessions
  where user_id = p_user_id and status in ('planned', 'in_progress')
  order by created_at limit 1 for update;
  if session_row.id is not null then
    return jsonb_build_object('session_id', session_row.id, 'replayed', true);
  end if;

  if not exists (
    select 1 from public.content_versions
    where id = p_content_version_id and status = 'active'
      and assessment_locale = 'en-US' and coaching_locale = 'ja-JP'
      and linguistic_reviewed_at is not null and azure_validated_at is not null
  ) then
    raise exception using message = 'CONTENT_NOT_READY', errcode = 'P0001';
  end if;

  insert into public.program_enrollments(user_id, program_version)
  values (p_user_id, p_program_version)
  on conflict (user_id) do nothing;
  select * into enrollment_row from public.program_enrollments where user_id = p_user_id for update;

  if enrollment_row.last_completed_calendar_date is not null
    and p_calendar_date <= enrollment_row.last_completed_calendar_date
  then
    raise exception using message = 'NEXT_LEARNING_DAY_NOT_AVAILABLE', errcode = '23514';
  end if;
  if enrollment_row.completed_program_days >= 7
    and not exists (select 1 from public.subscriptions s where s.user_id = p_user_id and s.is_active)
  then
    raise exception using message = 'ACCESS_REQUIRED', errcode = '42501';
  end if;

  select coalesce(max(learning_day_sequence), 0) + 1 into next_sequence
  from public.program_day_sessions where user_id = p_user_id;
  select count(*) filter (where coalesce((value->>'required')::boolean, false)),
         count(*) filter (where not coalesce((value->>'required')::boolean, false))
    into required_count, optional_count
  from jsonb_array_elements(p_items);
  if required_count <> 5 or optional_count not between 0 and 2 then
    raise exception using message = 'V2_PLAN_MUST_HAVE_FIVE_REQUIRED_ITEMS', errcode = '23514';
  end if;

  insert into public.program_day_sessions(
    user_id, enrollment_id, learning_day_sequence, trial_program_day,
    originating_calendar_date, timezone, content_version_id, focus_group_key,
    required_item_count, optional_item_count, plan_payload_sha256, review_effective_calendar_date
  ) values (
    p_user_id, enrollment_row.id, next_sequence,
    case when enrollment_row.completed_program_days < 7 then enrollment_row.completed_program_days + 1 else null end,
    p_calendar_date, p_timezone, p_content_version_id, p_focus_group_key,
    required_count, optional_count, p_plan_payload_sha256, p_calendar_date
  ) returning * into session_row;

  for item in select value from jsonb_array_elements(p_items) loop
    if nullif(btrim(item->>'practiceItemKey'), '') is null
      or nullif(btrim(item->>'referenceText'), '') is null
      or nullif(btrim(item->>'referenceTextVersion'), '') is null
      or nullif(btrim(item->>'expectedFocusRepresentation'), '') is null
      or (
        item->>'slotRole' <> 'review'
        and item->>'focusGroupKey' is distinct from p_focus_group_key
      )
    then
      raise exception using message = 'V2_MANAGED_ITEM_INVALID', errcode = '22023';
    end if;
    insert into public.program_session_items(
      user_id, session_id, position, content_version_id, practice_item_key,
      focus_group_key, prompt_role, slot_role, selection_reason, is_required,
      review_due_date, reference_text, reference_text_version,
      expected_focus_representation, next_action_key
    ) values (
      p_user_id, session_row.id, (item->>'position')::smallint, p_content_version_id,
      item->>'practiceItemKey', item->>'focusGroupKey', item->>'promptRole',
      item->>'slotRole', item->>'selectionReason', (item->>'required')::boolean,
      nullif(item->>'reviewDueDate', '')::date, item->>'referenceText',
      item->>'referenceTextVersion', item->>'expectedFocusRepresentation',
      nullif(item->>'nextActionKey', '')
    );
  end loop;
  return jsonb_build_object('session_id', session_row.id, 'replayed', false);
end;
$$;

create or replace function public.refresh_v2_review_slot(
  p_user_id uuid,
  p_session_id uuid,
  p_calendar_date date,
  p_review_item jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  session_row public.program_day_sessions%rowtype;
  review_row public.program_session_items%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_session_id::text || ':review-refresh', 0));
  select * into session_row from public.program_day_sessions
  where id = p_session_id and user_id = p_user_id for update;
  if session_row.id is null or session_row.status = 'completed' then
    raise exception using message = 'V2_SESSION_NOT_AVAILABLE', errcode = '42501';
  end if;
  if p_calendar_date <= coalesce(session_row.review_effective_calendar_date, session_row.originating_calendar_date) then
    return jsonb_build_object('session_id', session_row.id, 'changed', false, 'replayed', true);
  end if;

  select * into review_row from public.program_session_items
  where session_id = session_row.id and user_id = p_user_id and slot_role = 'review'
  order by position limit 1 for update;
  if review_row.id is null then
    raise exception using message = 'V2_REVIEW_SLOT_NOT_AVAILABLE', errcode = '23514';
  end if;

  perform set_config('app.v2_review_refresh', 'on', true);
  if exists (select 1 from public.learning_attempts where session_item_id = review_row.id)
    or review_row.status <> 'planned'
    or p_review_item is null
  then
    update public.program_day_sessions
      set review_effective_calendar_date = p_calendar_date
      where id = session_row.id;
    perform set_config('app.v2_review_refresh', 'off', true);
    return jsonb_build_object('session_id', session_row.id, 'changed', false, 'replayed', false);
  end if;

  perform public.assert_v2_json_allowlist(
    p_review_item,
    array[
      'practiceItemKey', 'focusGroupKey', 'promptRole', 'selectionReason',
      'reviewSourceEvidenceId', 'reviewDueDate', 'referenceText',
      'referenceTextVersion', 'expectedFocusRepresentation', 'nextActionKey'
    ],
    'REVIEW_ITEM'
  );
  if nullif(btrim(p_review_item->>'practiceItemKey'), '') is null
    or nullif(btrim(p_review_item->>'focusGroupKey'), '') is null
    or p_review_item->>'promptRole' <> 'review'
    or p_review_item->>'selectionReason' <> 'due_review'
    or nullif(btrim(p_review_item->>'referenceText'), '') is null
    or nullif(btrim(p_review_item->>'referenceTextVersion'), '') is null
    or nullif(btrim(p_review_item->>'expectedFocusRepresentation'), '') is null
    or nullif(p_review_item->>'reviewDueDate', '')::date > p_calendar_date
    or not exists (
      select 1 from public.content_versions
      where id = session_row.content_version_id and status = 'active'
        and linguistic_reviewed_at is not null and azure_validated_at is not null
    )
  then
    raise exception using message = 'V2_REVIEW_ITEM_INVALID', errcode = '22023';
  end if;

  update public.program_session_items
    set practice_item_key = p_review_item->>'practiceItemKey',
        focus_group_key = p_review_item->>'focusGroupKey',
        prompt_role = p_review_item->>'promptRole',
        selection_reason = p_review_item->>'selectionReason',
        review_source_evidence_id = nullif(p_review_item->>'reviewSourceEvidenceId', '')::uuid,
        review_due_date = nullif(p_review_item->>'reviewDueDate', '')::date,
        reference_text = p_review_item->>'referenceText',
        reference_text_version = p_review_item->>'referenceTextVersion',
        expected_focus_representation = p_review_item->>'expectedFocusRepresentation',
        next_action_key = nullif(p_review_item->>'nextActionKey', '')
    where id = review_row.id;
  update public.program_day_sessions
    set review_effective_calendar_date = p_calendar_date
    where id = session_row.id;
  perform set_config('app.v2_review_refresh', 'off', true);
  return jsonb_build_object('session_id', session_row.id, 'changed', true, 'replayed', false);
end;
$$;

create or replace function public.persist_v2_attempt(
  p_user_id uuid,
  p_session_id uuid,
  p_session_item_id uuid,
  p_client_attempt_id uuid,
  p_payload_sha256 text,
  p_deletion_epoch bigint,
  p_attempt_role text,
  p_retry_of_attempt_id uuid,
  p_attempted_at timestamptz,
  p_calendar_date date,
  p_timezone text,
  p_provider text,
  p_assessment_locale text,
  p_provider_version text,
  p_normalizer_version text,
  p_technical_valid boolean,
  p_invalid_reason text,
  p_observed_candidate text,
  p_target_score numeric,
  p_result_label text,
  p_next_action_key text,
  p_capability_flags jsonb,
  p_normalized_detail jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  session_row public.program_day_sessions%rowtype;
  item_row public.program_session_items%rowtype;
  existing_row public.learning_attempts%rowtype;
  inserted_row public.learning_attempts%rowtype;
  enrollment_row public.program_enrollments%rowtype;
  next_attempt_sequence integer;
  next_valid_ordinal integer;
  v_current_epoch bigint;
begin
  if p_payload_sha256 !~ '^[0-9a-f]{64}$' or p_deletion_epoch < 0
    or p_assessment_locale <> 'en-US'
    or p_provider <> 'azure'
    or p_attempt_role not in ('cold', 'guided_retry', 'transfer', 'review', 'optional_extension')
  then
    raise exception using message = 'V2_ATTEMPT_INPUT_INVALID', errcode = '22023';
  end if;
  perform public.assert_v2_json_allowlist(p_capability_flags, array['targetScore', 'observedCandidate'], 'CAPABILITY_FLAGS');
  perform public.assert_v2_json_allowlist(p_normalized_detail, array['recognitionStatus'], 'NORMALIZED_DETAIL');
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_client_attempt_id::text, 0));

  select * into existing_row from public.learning_attempts
  where user_id = p_user_id and client_attempt_id = p_client_attempt_id;
  if existing_row.id is not null then
    if existing_row.payload_sha256 <> p_payload_sha256 then
      raise exception using message = 'IDEMPOTENCY_PAYLOAD_CONFLICT', errcode = '23505';
    end if;
    return jsonb_build_object(
      'attempt_id', existing_row.id,
      'technical_valid', existing_row.technical_valid,
      'valid_attempt_ordinal', existing_row.valid_attempt_ordinal,
      'replayed', true
    );
  end if;

  select coalesce((select e.current_epoch from public.learning_deletion_epochs e where e.user_id = p_user_id), 0)
    into v_current_epoch;
  if v_current_epoch <> p_deletion_epoch then
    raise exception using message = 'DELETION_EPOCH_CONFLICT', errcode = '40001';
  end if;

  select * into session_row from public.program_day_sessions
  where id = p_session_id and user_id = p_user_id for update;
  select * into item_row from public.program_session_items
  where id = p_session_item_id and session_id = p_session_id and user_id = p_user_id for update;
  if session_row.id is null or item_row.id is null or session_row.status = 'completed'
    or item_row.content_version_id <> session_row.content_version_id
    or item_row.reference_text is null
  then
    raise exception using message = 'V2_SESSION_ITEM_NOT_AVAILABLE', errcode = '42501';
  end if;
  select * into enrollment_row from public.program_enrollments
  where id = session_row.enrollment_id and user_id = p_user_id for update;
  if enrollment_row.id is null then
    raise exception using message = 'V2_ENROLLMENT_NOT_AVAILABLE', errcode = '42501';
  end if;
  if enrollment_row.completed_program_days >= 7
    and not exists (select 1 from public.subscriptions s where s.user_id = p_user_id and s.is_active)
  then
    raise exception using message = 'ACCESS_REQUIRED', errcode = '42501';
  end if;
  if session_row.timezone <> p_timezone
    or timezone(session_row.timezone, p_attempted_at)::date <> p_calendar_date
  then
    raise exception using message = 'SESSION_TIMEZONE_MISMATCH', errcode = '23514';
  end if;
  if not exists (select 1 from public.content_versions where id = session_row.content_version_id and status = 'active') then
    raise exception using message = 'CONTENT_NOT_READY', errcode = 'P0001';
  end if;

  select coalesce(max(attempt_sequence), 0) + 1 into next_attempt_sequence
  from public.learning_attempts where session_item_id = item_row.id;
  if p_technical_valid then
    select count(*) + 1 into next_valid_ordinal
    from public.learning_attempts where session_item_id = item_row.id and technical_valid;
    if next_valid_ordinal > 3 then
      raise exception using message = 'VALID_ATTEMPT_LIMIT_REACHED', errcode = '23514';
    end if;
  else
    next_valid_ordinal := null;
    if nullif(btrim(p_invalid_reason), '') is null then
      raise exception using message = 'INVALID_REASON_REQUIRED', errcode = '22023';
    end if;
  end if;

  insert into public.learning_attempts(
    user_id, session_id, session_item_id, client_attempt_id, payload_sha256,
    content_version_id, practice_item_key, focus_group_key, prompt_role,
    attempt_role, retry_of_attempt_id, attempt_sequence, valid_attempt_ordinal,
    attempted_at, attempted_calendar_date, timezone, coaching_shown,
    technical_valid, invalid_reason, provider, assessment_locale, provider_version,
    normalizer_version, capability_metadata, server_verified
  ) values (
    p_user_id, session_row.id, item_row.id, p_client_attempt_id, p_payload_sha256,
    item_row.content_version_id, item_row.practice_item_key, item_row.focus_group_key, item_row.prompt_role,
    p_attempt_role, p_retry_of_attempt_id, next_attempt_sequence, next_valid_ordinal,
    p_attempted_at, p_calendar_date, session_row.timezone, p_attempt_role = 'guided_retry',
    p_technical_valid, case when p_technical_valid then null else p_invalid_reason end,
    p_provider, p_assessment_locale, p_provider_version, p_normalizer_version,
    p_capability_flags, true
  ) returning * into inserted_row;

  insert into public.learning_attempt_results(
    attempt_id, user_id, provider, assessment_locale, normalizer_version,
    reference_text_version, expected_focus_representation, observed_candidate,
    target_score, technical_valid, result_label, next_action_key,
    capability_flags, normalized_detail
  ) values (
    inserted_row.id, p_user_id, p_provider, p_assessment_locale, p_normalizer_version,
    item_row.reference_text_version, item_row.expected_focus_representation,
    p_observed_candidate, p_target_score, p_technical_valid, p_result_label,
    p_next_action_key, p_capability_flags, p_normalized_detail
  );

  if p_technical_valid then
    update public.program_day_sessions
      set status = 'in_progress', started_at = coalesce(started_at, p_attempted_at),
          current_position = greatest(current_position, item_row.position)
      where id = session_row.id;
    update public.program_session_items
      set status = 'completed', completion_reason = 'completed', completed_at = p_attempted_at
      where id = item_row.id and status <> 'completed';

    if enrollment_row.first_valid_learning_attempt_id is null then
      update public.program_enrollments
        set first_valid_learning_attempt_id = inserted_row.id,
            trial_status = 'in_progress', trial_started_at = p_attempted_at,
            current_program_day = 1
      where id = enrollment_row.id and trial_status = 'not_started';
    end if;
  end if;

  return jsonb_build_object(
    'attempt_id', inserted_row.id,
    'technical_valid', inserted_row.technical_valid,
    'valid_attempt_ordinal', inserted_row.valid_attempt_ordinal,
    'replayed', false
  );
end;
$$;

create or replace function public.complete_v2_program_day(
  p_user_id uuid,
  p_session_id uuid,
  p_completion_idempotency_key uuid,
  p_completion_payload_sha256 text,
  p_completed_at timestamptz,
  p_calendar_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  session_row public.program_day_sessions%rowtype;
  enrollment_row public.program_enrollments%rowtype;
  completed_required integer;
  next_completed smallint;
begin
  if p_completion_payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using message = 'V2_COMPLETION_INPUT_INVALID', errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_session_id::text || ':complete', 0));
  select * into session_row from public.program_day_sessions
  where id = p_session_id and user_id = p_user_id for update;
  if session_row.id is null then
    raise exception using message = 'V2_SESSION_NOT_FOUND', errcode = '42501';
  end if;
  if session_row.status = 'completed' then
    if session_row.completion_idempotency_key = p_completion_idempotency_key
      and session_row.completion_payload_sha256 = p_completion_payload_sha256
    then
      return jsonb_build_object('session_id', session_row.id, 'replayed', true, 'completed_program_day', session_row.trial_program_day);
    end if;
    raise exception using message = 'IDEMPOTENCY_PAYLOAD_CONFLICT', errcode = '23505';
  end if;
  if timezone(session_row.timezone, p_completed_at)::date <> p_calendar_date then
    raise exception using message = 'SESSION_TIMEZONE_MISMATCH', errcode = '23514';
  end if;

  select * into enrollment_row from public.program_enrollments
  where id = session_row.enrollment_id and user_id = p_user_id for update;
  if enrollment_row.first_valid_learning_attempt_id is null or enrollment_row.trial_status = 'not_started' then
    raise exception using message = 'VALID_ATTEMPT_REQUIRED', errcode = '23514';
  end if;
  if enrollment_row.last_completed_calendar_date is not null
    and p_calendar_date <= enrollment_row.last_completed_calendar_date
  then
    raise exception using message = 'CALENDAR_DATE_ALREADY_COMPLETED', errcode = '23505';
  end if;
  if session_row.required_item_count <> 5 then
    raise exception using message = 'SHORTENING_POLICY_NOT_READY', errcode = '23514';
  end if;
  select count(*) into completed_required
  from public.program_session_items
  where session_id = session_row.id and user_id = p_user_id and is_required and status = 'completed';
  if completed_required <> 5 then
    raise exception using message = 'REQUIRED_ITEMS_INCOMPLETE', errcode = '23514';
  end if;

  update public.program_day_sessions
    set status = 'completed', completed_calendar_date = p_calendar_date,
        completion_idempotency_key = p_completion_idempotency_key,
        completion_payload_sha256 = p_completion_payload_sha256,
        completed_at = p_completed_at, current_position = required_item_count
    where id = session_row.id;

  next_completed := least(enrollment_row.completed_program_days + 1, 7);
  update public.program_enrollments
    set completed_program_days = next_completed,
        current_program_day = greatest(current_program_day, next_completed),
        last_completed_calendar_date = p_calendar_date,
        trial_status = case when next_completed = 7 then 'day_7_completed' else 'in_progress' end,
        day_7_report_status = case when next_completed = 7 then 'pending' else day_7_report_status end
    where id = enrollment_row.id;

  return jsonb_build_object(
    'session_id', session_row.id,
    'replayed', false,
    'completed_program_day', session_row.trial_program_day,
    'learning_day_sequence', session_row.learning_day_sequence,
    'day_7_report_status', case when next_completed = 7 then 'pending' else 'not_started' end
  );
end;
$$;

revoke all on function public.guard_v2_session_plan_mutation() from public, anon, authenticated;
revoke all on function public.guard_program_enrollment_first_attempt() from public, anon, authenticated;
revoke all on function public.guard_focus_evidence_source() from public, anon, authenticated;
revoke all on function public.guard_v2_item_plan_mutation() from public, anon, authenticated;
revoke all on function public.guard_v2_append_only_update() from public, anon, authenticated;
revoke all on function public.assert_v2_json_allowlist(jsonb, text[], text) from public, anon, authenticated;
revoke all on function public.guard_v2_json_boundaries() from public, anon, authenticated;
revoke all on function public.guard_v2_verified_derivation() from public, anon, authenticated;
revoke all on function public.create_v2_daily_session(uuid, text, date, uuid, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.refresh_v2_review_slot(uuid, uuid, date, jsonb) from public, anon, authenticated;
revoke all on function public.persist_v2_attempt(uuid, uuid, uuid, uuid, text, bigint, text, uuid, timestamptz, date, text, text, text, text, text, boolean, text, text, numeric, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.complete_v2_program_day(uuid, uuid, uuid, text, timestamptz, date) from public, anon, authenticated;

grant execute on function public.create_v2_daily_session(uuid, text, date, uuid, text, text, jsonb, text) to service_role;
grant execute on function public.refresh_v2_review_slot(uuid, uuid, date, jsonb) to service_role;
grant execute on function public.persist_v2_attempt(uuid, uuid, uuid, uuid, text, bigint, text, uuid, timestamptz, date, text, text, text, text, text, boolean, text, text, numeric, text, text, jsonb, jsonb) to service_role;
grant execute on function public.complete_v2_program_day(uuid, uuid, uuid, text, timestamptz, date) to service_role;

comment on function public.create_v2_daily_session(uuid, text, date, uuid, text, text, jsonb, text) is
  'Service-role-only transactional v2 managed-session creation. Client planning input is never accepted directly.';
comment on function public.refresh_v2_review_slot(uuid, uuid, date, jsonb) is
  'Service-role-only rollover refresh for the single unstarted review slot; started or completed items are never replaced.';
comment on function public.persist_v2_attempt(uuid, uuid, uuid, uuid, text, bigint, text, uuid, timestamptz, date, text, text, text, text, text, boolean, text, text, numeric, text, text, jsonb, jsonb) is
  'Service-role-only idempotent attempt and normalized-result persistence. Provider raw JSON and audio are not accepted.';
comment on function public.complete_v2_program_day(uuid, uuid, uuid, text, timestamptz, date) is
  'Service-role-only idempotent Program Day completion. It rechecks server-owned item state and currently permits only the five-item path.';
