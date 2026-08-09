-- S6-04 additive learning schema for the Otokagami v2 MVP.
-- This migration does not insert, update, delete, rename, or backfill existing rows.

comment on column public.program_enrollments.current_program_day is
  'Trial-only active learning day cursor. Values remain Day 0 through Day 7 and do not count subscription learning days.';
comment on column public.program_enrollments.completed_program_days is
  'Trial-only completed active learning day count. Values remain 0 through 7; ongoing learning uses program_day_sessions.learning_day_sequence.';

alter table public.program_enrollments
  add constraint program_enrollments_id_user_unique unique (id, user_id);

create table public.program_day_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  enrollment_id uuid not null,
  learning_day_sequence bigint not null check (learning_day_sequence > 0),
  trial_program_day smallint check (trial_program_day between 1 and 7),
  originating_calendar_date date not null,
  completed_calendar_date date,
  timezone text not null check (btrim(timezone) <> ''),
  content_version_id uuid not null references public.content_versions(id),
  focus_group_key text not null check (btrim(focus_group_key) <> ''),
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'completed')),
  required_item_count smallint not null
    check (required_item_count between 1 and 5),
  optional_item_count smallint not null default 0
    check (optional_item_count between 0 and 2),
  current_position smallint not null default 0,
  completion_idempotency_key uuid,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (id, user_id, content_version_id),
  unique (user_id, learning_day_sequence),
  constraint program_day_sessions_enrollment_owner_fkey
    foreign key (enrollment_id, user_id)
    references public.program_enrollments(id, user_id),
  constraint program_day_sessions_position_check
    check (current_position between 0 and required_item_count + optional_item_count),
  constraint program_day_sessions_lifecycle_check
    check (
      (
        status = 'planned'
        and started_at is null
        and completed_at is null
        and completed_calendar_date is null
        and completion_idempotency_key is null
      )
      or (
        status = 'in_progress'
        and started_at is not null
        and completed_at is null
        and completed_calendar_date is null
        and completion_idempotency_key is null
      )
      or (
        status = 'completed'
        and started_at is not null
        and completed_at is not null
        and completed_calendar_date is not null
        and completion_idempotency_key is not null
        and current_position >= required_item_count
      )
    )
);

comment on table public.program_day_sessions is
  'Server-controlled v2 learning-day sessions. learning_day_sequence is an unbounded internal sequence shared by trial and subscribed learning.';
comment on column public.program_day_sessions.trial_program_day is
  'Nullable trial-only Program Day 1 through 7. Enrollment synchronization is implemented by a later trusted command.';
comment on column public.program_day_sessions.optional_item_count is
  'Optional extension count; never contributes to required completion.';

create unique index program_day_sessions_trial_day_unique
  on public.program_day_sessions(user_id, trial_program_day)
  where trial_program_day is not null;
create unique index program_day_sessions_one_active_per_user
  on public.program_day_sessions(user_id)
  where status in ('planned', 'in_progress');
create unique index program_day_sessions_one_completed_calendar_date
  on public.program_day_sessions(user_id, completed_calendar_date)
  where status = 'completed';
create unique index program_day_sessions_completion_key_unique
  on public.program_day_sessions(user_id, completion_idempotency_key)
  where completion_idempotency_key is not null;
create index program_day_sessions_user_status_idx
  on public.program_day_sessions(user_id, status);

create table public.program_session_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  position smallint not null check (position between 1 and 7),
  content_version_id uuid not null references public.content_versions(id),
  practice_item_key text not null check (btrim(practice_item_key) <> ''),
  focus_group_key text not null check (btrim(focus_group_key) <> ''),
  prompt_role text not null check (
    prompt_role in (
      'anchor',
      'contrast',
      'transfer_word',
      'sentence',
      'practical_sentence',
      'review',
      'optional_extension'
    )
  ),
  is_required boolean not null,
  review_source_evidence_id uuid,
  review_due_date date,
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'completed')),
  completion_reason text check (
    completion_reason is null
    or completion_reason in (
      'completed',
      'shortened',
      'substituted',
      'skipped_after_technical_failures'
    )
  ),
  selected_before_attempt_id uuid,
  selected_after_attempt_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, user_id),
  unique (id, user_id, session_id),
  unique (
    id,
    user_id,
    session_id,
    content_version_id,
    practice_item_key,
    focus_group_key,
    prompt_role
  ),
  unique (session_id, position),
  constraint program_session_items_session_owner_fkey
    foreign key (session_id, user_id, content_version_id)
    references public.program_day_sessions(id, user_id, content_version_id)
    on delete cascade,
  constraint program_session_items_required_role_check
    check ((prompt_role = 'optional_extension') = (not is_required)),
  constraint program_session_items_review_source_shape_check
    check (
      (prompt_role = 'review' and review_due_date is not null)
      or (prompt_role <> 'review' and review_source_evidence_id is null and review_due_date is null)
    ),
  constraint program_session_items_completion_check
    check (
      (status = 'completed' and completion_reason is not null and completed_at is not null)
      or (status <> 'completed' and completion_reason is null and completed_at is null)
    )
);

comment on table public.program_session_items is
  'Versioned v2 managed prompts. Stable keys intentionally do not reference legacy practice_items or daily_session_items.';

create index program_session_items_user_session_idx
  on public.program_session_items(user_id, session_id);
create index program_session_items_review_due_idx
  on public.program_session_items(user_id, review_due_date)
  where review_due_date is not null;

create table public.learning_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  session_item_id uuid not null,
  client_attempt_id uuid not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  content_version_id uuid not null references public.content_versions(id),
  practice_item_key text not null check (btrim(practice_item_key) <> ''),
  focus_group_key text not null check (btrim(focus_group_key) <> ''),
  prompt_role text not null check (
    prompt_role in (
      'anchor',
      'contrast',
      'transfer_word',
      'sentence',
      'practical_sentence',
      'review',
      'optional_extension'
    )
  ),
  attempt_role text not null check (
    attempt_role in ('cold', 'guided_retry', 'transfer', 'review', 'optional_extension')
  ),
  retry_of_attempt_id uuid,
  attempt_sequence integer not null check (attempt_sequence > 0),
  valid_attempt_ordinal smallint check (valid_attempt_ordinal between 1 and 3),
  attempted_at timestamptz not null,
  attempted_calendar_date date not null,
  timezone text not null check (btrim(timezone) <> ''),
  coaching_shown boolean not null default false,
  technical_valid boolean not null,
  invalid_reason text,
  provider text not null check (btrim(provider) <> ''),
  assessment_locale text not null check (btrim(assessment_locale) <> ''),
  provider_version text,
  normalizer_version text not null check (btrim(normalizer_version) <> ''),
  capability_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(capability_metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (id, user_id, session_item_id),
  unique (id, user_id, technical_valid),
  unique (user_id, client_attempt_id),
  unique (session_item_id, attempt_sequence),
  constraint learning_attempts_session_owner_fkey
    foreign key (session_id, user_id)
    references public.program_day_sessions(id, user_id)
    on delete cascade,
  constraint learning_attempts_item_owner_fkey
    foreign key (
      session_item_id,
      user_id,
      session_id,
      content_version_id,
      practice_item_key,
      focus_group_key,
      prompt_role
    )
    references public.program_session_items(
      id,
      user_id,
      session_id,
      content_version_id,
      practice_item_key,
      focus_group_key,
      prompt_role
    )
    on delete cascade,
  constraint learning_attempts_retry_owner_item_fkey
    foreign key (retry_of_attempt_id, user_id, session_item_id)
    references public.learning_attempts(id, user_id, session_item_id),
  constraint learning_attempts_retry_shape_check
    check (
      (attempt_role = 'guided_retry' and retry_of_attempt_id is not null and coaching_shown)
      or (attempt_role <> 'guided_retry' and retry_of_attempt_id is null)
    ),
  constraint learning_attempts_validity_check
    check (
      (
        technical_valid
        and valid_attempt_ordinal is not null
        and invalid_reason is null
      )
      or (
        not technical_valid
        and valid_attempt_ordinal is null
        and invalid_reason is not null
        and btrim(invalid_reason) <> ''
      )
    )
);

comment on table public.learning_attempts is
  'Trusted normalized attempt envelope. Never stores audio, base64 audio, device file URIs, Azure tokens, or raw Azure JSON.';
comment on column public.learning_attempts.payload_sha256 is
  'Digest used with client_attempt_id to detect idempotency payload conflicts; the source payload is not stored here.';
comment on column public.learning_attempts.capability_metadata is
  'Secret-free capability flags only; raw provider payloads and speech content are prohibited.';

create unique index learning_attempts_valid_ordinal_unique
  on public.learning_attempts(session_item_id, valid_attempt_ordinal)
  where valid_attempt_ordinal is not null;
create index learning_attempts_user_date_idx
  on public.learning_attempts(user_id, attempted_calendar_date);
create index learning_attempts_item_role_idx
  on public.learning_attempts(session_item_id, attempt_role);

create table public.learning_attempt_results (
  attempt_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (btrim(provider) <> ''),
  assessment_locale text not null check (btrim(assessment_locale) <> ''),
  normalizer_version text not null check (btrim(normalizer_version) <> ''),
  reference_text_version text not null check (btrim(reference_text_version) <> ''),
  expected_focus_representation text not null check (btrim(expected_focus_representation) <> ''),
  observed_candidate text,
  target_score numeric check (target_score between 0 and 100),
  technical_valid boolean not null,
  result_label text not null check (btrim(result_label) <> ''),
  next_action_key text,
  capability_flags jsonb not null default '{}'::jsonb
    check (jsonb_typeof(capability_flags) = 'object'),
  normalized_detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(normalized_detail) = 'object'),
  created_at timestamptz not null default now(),
  unique (attempt_id, user_id),
  constraint learning_attempt_results_attempt_owner_validity_fkey
    foreign key (attempt_id, user_id, technical_valid)
    references public.learning_attempts(id, user_id, technical_valid)
    on delete cascade
);

comment on table public.learning_attempt_results is
  'One normalized result per attempt. Azure raw JSON, audio, tokens, secrets, and device URIs are prohibited.';
comment on column public.learning_attempt_results.normalized_detail is
  'Allowlisted normalized detail only; never a raw Azure or other provider response.';

create table public.correction_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_item_id uuid not null,
  focus_group_key text not null check (btrim(focus_group_key) <> ''),
  before_attempt_id uuid not null,
  advice_stable_key text not null check (btrim(advice_stable_key) <> ''),
  advice_version integer not null check (advice_version > 0),
  coaching_locale text not null check (btrim(coaching_locale) <> ''),
  after_attempt_id uuid not null,
  candidate_change_type text,
  immediate_change_status text not null default 'pending'
    check (immediate_change_status in ('pending', 'improved', 'not_improved', 'inconclusive')),
  before_audio_retained_on_device boolean not null default false,
  after_audio_retained_on_device boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (id, user_id, session_item_id),
  unique (id, user_id, focus_group_key),
  unique (after_attempt_id),
  constraint correction_cycles_item_owner_fkey
    foreign key (session_item_id, user_id)
    references public.program_session_items(id, user_id)
    on delete cascade,
  constraint correction_cycles_before_owner_item_fkey
    foreign key (before_attempt_id, user_id, session_item_id)
    references public.learning_attempts(id, user_id, session_item_id)
    on delete cascade,
  constraint correction_cycles_after_owner_item_fkey
    foreign key (after_attempt_id, user_id, session_item_id)
    references public.learning_attempts(id, user_id, session_item_id)
    on delete cascade,
  constraint correction_cycles_distinct_attempts_check
    check (before_attempt_id <> after_attempt_id)
);

comment on table public.correction_cycles is
  'Representative unassisted-before and guided-after correction pair. Local audio availability is metadata only; no URI or audio is stored.';

create index correction_cycles_user_item_idx
  on public.correction_cycles(user_id, session_item_id);

create table public.focus_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  focus_group_key text not null check (btrim(focus_group_key) <> ''),
  evidence_kind text not null check (
    evidence_kind in ('discovered', 'immediate_change', 'held', 'transferred', 'stable', 'maintenance')
  ),
  source_attempt_id uuid,
  correction_cycle_id uuid,
  evidence_calendar_date date not null,
  prompt_role text not null check (
    prompt_role in (
      'anchor',
      'contrast',
      'transfer_word',
      'sentence',
      'practical_sentence',
      'review',
      'optional_extension'
    )
  ),
  prompt_context text not null check (btrim(prompt_context) <> ''),
  assisted boolean not null,
  content_version_id uuid not null references public.content_versions(id),
  server_verified boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (id, user_id, focus_group_key),
  unique (id, user_id, focus_group_key, evidence_kind, content_version_id),
  unique (id, user_id, focus_group_key, evidence_calendar_date),
  unique (user_id, evidence_calendar_date, focus_group_key, prompt_role, evidence_kind),
  constraint focus_evidence_source_attempt_owner_fkey
    foreign key (source_attempt_id, user_id)
    references public.learning_attempts(id, user_id)
    on delete cascade,
  constraint focus_evidence_cycle_owner_focus_fkey
    foreign key (correction_cycle_id, user_id, focus_group_key)
    references public.correction_cycles(id, user_id, focus_group_key)
    on delete cascade,
  constraint focus_evidence_source_shape_check
    check (
      (
        evidence_kind = 'immediate_change'
        and source_attempt_id is null
        and correction_cycle_id is not null
        and assisted
      )
      or (
        evidence_kind <> 'immediate_change'
        and source_attempt_id is not null
        and correction_cycle_id is null
        and not assisted
      )
    )
);

comment on table public.focus_evidence is
  'Server-verified v2 learning evidence. Guided retries can support only immediate_change via a correction cycle, never durable evidence.';

create index focus_evidence_user_focus_date_idx
  on public.focus_evidence(user_id, focus_group_key, evidence_calendar_date);

alter table public.program_session_items
  add constraint program_session_items_review_evidence_owner_focus_fkey
  foreign key (review_source_evidence_id, user_id, focus_group_key)
  references public.focus_evidence(id, user_id, focus_group_key)
  on delete set null (review_source_evidence_id);

alter table public.program_session_items
  add constraint program_session_items_before_attempt_owner_item_fkey
  foreign key (selected_before_attempt_id, user_id, id)
  references public.learning_attempts(id, user_id, session_item_id)
  on delete set null (selected_before_attempt_id);

alter table public.program_session_items
  add constraint program_session_items_after_attempt_owner_item_fkey
  foreign key (selected_after_attempt_id, user_id, id)
  references public.learning_attempts(id, user_id, session_item_id)
  on delete set null (selected_after_attempt_id);

create table public.focus_states_v2 (
  user_id uuid not null references auth.users(id) on delete cascade,
  focus_group_key text not null check (btrim(focus_group_key) <> ''),
  current_state text not null check (
    current_state in ('discovered', 'immediate_change', 'held', 'transferred', 'stable', 'maintenance')
  ),
  last_unassisted_success_date date,
  next_prompt_role text check (
    next_prompt_role is null
    or next_prompt_role in (
      'anchor',
      'contrast',
      'transfer_word',
      'sentence',
      'practical_sentence',
      'review',
      'optional_extension'
    )
  ),
  next_review_due_date date,
  source_evidence_id uuid not null,
  content_version_id uuid not null references public.content_versions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, focus_group_key),
  constraint focus_states_v2_source_evidence_owner_focus_fkey
    foreign key (
      source_evidence_id,
      user_id,
      focus_group_key,
      current_state,
      content_version_id
    )
    references public.focus_evidence(
      id,
      user_id,
      focus_group_key,
      evidence_kind,
      content_version_id
    )
    on delete restrict
);

comment on table public.focus_states_v2 is
  'Materialized trusted v2 focus state. It does not reference legacy EWMA, legacy best attempts, or client-computed mastery.';

create index focus_states_v2_review_due_idx
  on public.focus_states_v2(user_id, next_review_due_date)
  where next_review_due_date is not null;

create table public.review_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  focus_group_key text not null check (btrim(focus_group_key) <> ''),
  interval_kind text not null check (interval_kind in ('day_1', 'day_3', 'day_7', 'day_14')),
  based_on_evidence_id uuid not null,
  based_on_calendar_date date not null,
  review_due_date date not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'due', 'overdue', 'completed', 'superseded')),
  completion_evidence_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (based_on_evidence_id, interval_kind),
  constraint review_schedules_basis_owner_focus_fkey
    foreign key (based_on_evidence_id, user_id, focus_group_key, based_on_calendar_date)
    references public.focus_evidence(id, user_id, focus_group_key, evidence_calendar_date)
    on delete cascade,
  constraint review_schedules_completion_owner_focus_fkey
    foreign key (completion_evidence_id, user_id, focus_group_key)
    references public.focus_evidence(id, user_id, focus_group_key)
    on delete set null (completion_evidence_id),
  constraint review_schedules_due_date_check
    check (review_due_date >= based_on_calendar_date),
  constraint review_schedules_completion_check
    check (
      (status = 'completed' and completion_evidence_id is not null)
      or (status <> 'completed' and completion_evidence_id is null)
    )
);

comment on table public.review_schedules is
  'Calendar-date review schedule. Overdue is neither failed nor automatically completed; planner integration is deferred.';

create index review_schedules_user_due_status_idx
  on public.review_schedules(user_id, review_due_date, status);

create table public.learning_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_type text not null check (report_type in ('daily', 'day_7', 'weekly')),
  idempotency_key uuid not null,
  trial_program_day_start smallint check (trial_program_day_start between 1 and 7),
  trial_program_day_end smallint check (trial_program_day_end between 1 and 7),
  learning_day_sequence_start bigint check (learning_day_sequence_start > 0),
  learning_day_sequence_end bigint check (learning_day_sequence_end > 0),
  calendar_date_start date not null,
  calendar_date_end date not null,
  generated_content_version_id uuid not null references public.content_versions(id),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  next_review_due_date date,
  next_focus_group_key text,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, idempotency_key),
  constraint learning_reports_trial_range_check
    check (
      (trial_program_day_start is null and trial_program_day_end is null)
      or (
        trial_program_day_start is not null
        and trial_program_day_end is not null
        and trial_program_day_start <= trial_program_day_end
      )
    ),
  constraint learning_reports_sequence_range_check
    check (
      (learning_day_sequence_start is null and learning_day_sequence_end is null)
      or (
        learning_day_sequence_start is not null
        and learning_day_sequence_end is not null
        and learning_day_sequence_start <= learning_day_sequence_end
      )
    ),
  constraint learning_reports_calendar_range_check
    check (calendar_date_start <= calendar_date_end)
);

comment on table public.learning_reports is
  'Read-own report metadata retained after subscription expiry. Summary must not contain audio, device URIs, tokens, secrets, or raw provider payloads.';

create index learning_reports_user_created_idx
  on public.learning_reports(user_id, created_at desc);

-- These two minimal association tables make report evidence reproducible without
-- embedding mutable identifier arrays in report JSON.
create table public.learning_report_evidence (
  report_id uuid not null,
  evidence_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (report_id, evidence_id),
  constraint learning_report_evidence_report_owner_fkey
    foreign key (report_id, user_id)
    references public.learning_reports(id, user_id)
    on delete cascade,
  constraint learning_report_evidence_evidence_owner_fkey
    foreign key (evidence_id, user_id)
    references public.focus_evidence(id, user_id)
    on delete cascade
);

create table public.learning_report_correction_cycles (
  report_id uuid not null,
  correction_cycle_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (report_id, correction_cycle_id),
  constraint learning_report_cycles_report_owner_fkey
    foreign key (report_id, user_id)
    references public.learning_reports(id, user_id)
    on delete cascade,
  constraint learning_report_cycles_cycle_owner_fkey
    foreign key (correction_cycle_id, user_id)
    references public.correction_cycles(id, user_id)
    on delete cascade
);

alter table public.program_enrollments
  add column first_valid_learning_attempt_id uuid;

alter table public.program_enrollments
  add constraint program_enrollments_first_attempt_owner_fkey
  foreign key (first_valid_learning_attempt_id, user_id)
  references public.learning_attempts(id, user_id)
  on delete set null (first_valid_learning_attempt_id);

comment on column public.program_enrollments.first_valid_learning_attempt_id is
  'First trusted valid v2 attempt that starts the one-time trial. Deleting learning data clears this link but preserves enrollment and trial counters so trial is not re-granted.';

create or replace function public.guard_correction_cycle_attempts()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  before_row public.learning_attempts%rowtype;
  after_row public.learning_attempts%rowtype;
begin
  select * into before_row
  from public.learning_attempts
  where id = new.before_attempt_id;

  select * into after_row
  from public.learning_attempts
  where id = new.after_attempt_id;

  if before_row.id is null
    or before_row.user_id <> new.user_id
    or before_row.session_item_id <> new.session_item_id
    or before_row.focus_group_key <> new.focus_group_key
    or not before_row.technical_valid
    or before_row.attempt_role = 'guided_retry'
    or before_row.coaching_shown
  then
    raise exception 'Correction before attempt must be a valid unassisted attempt for the same owner and item';
  end if;

  if after_row.id is null
    or after_row.user_id <> new.user_id
    or after_row.session_item_id <> new.session_item_id
    or after_row.focus_group_key <> new.focus_group_key
    or not after_row.technical_valid
    or after_row.attempt_role <> 'guided_retry'
    or not after_row.coaching_shown
    or after_row.retry_of_attempt_id <> new.before_attempt_id
  then
    raise exception 'Correction after attempt must be a valid guided retry of the before attempt';
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
    select * into source_row
    from public.learning_attempts
    where id = new.retry_of_attempt_id;

    if source_row.id is null
      or source_row.user_id <> new.user_id
      or source_row.session_item_id <> new.session_item_id
      or not source_row.technical_valid
      or source_row.attempt_role = 'guided_retry'
      or source_row.coaching_shown
    then
      raise exception 'Guided retry must reference a valid unassisted attempt for the same owner and item';
    end if;
  end if;

  return new;
end;
$$;

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
    )
  then
    raise exception 'Enrollment first learning attempt must be valid and owned by the enrolled user';
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
    then
      raise exception 'Immediate-change evidence must retain the correction source content and prompt role';
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
      or attempt_row.attempt_role = 'guided_retry'
      or attempt_row.coaching_shown
    then
      raise exception 'Durable evidence must use a valid unassisted attempt for the same owner, focus, and prompt role';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_correction_cycle_attempts() from public, anon, authenticated;
revoke all on function public.guard_learning_attempt_retry() from public, anon, authenticated;
revoke all on function public.guard_program_enrollment_first_attempt() from public, anon, authenticated;
revoke all on function public.guard_focus_evidence_source() from public, anon, authenticated;
grant execute on function public.guard_correction_cycle_attempts() to service_role;
grant execute on function public.guard_learning_attempt_retry() to service_role;
grant execute on function public.guard_program_enrollment_first_attempt() to service_role;
grant execute on function public.guard_focus_evidence_source() to service_role;

create trigger learning_attempts_guard_retry
before insert or update on public.learning_attempts
for each row execute function public.guard_learning_attempt_retry();

create trigger program_enrollments_guard_first_attempt
before insert or update of first_valid_learning_attempt_id on public.program_enrollments
for each row execute function public.guard_program_enrollment_first_attempt();

create trigger correction_cycles_guard_attempts
before insert or update on public.correction_cycles
for each row execute function public.guard_correction_cycle_attempts();

create trigger focus_evidence_guard_source
before insert or update on public.focus_evidence
for each row execute function public.guard_focus_evidence_source();

create trigger program_day_sessions_set_updated_at
before update on public.program_day_sessions
for each row execute function public.set_updated_at();
create trigger program_session_items_set_updated_at
before update on public.program_session_items
for each row execute function public.set_updated_at();
create trigger correction_cycles_set_updated_at
before update on public.correction_cycles
for each row execute function public.set_updated_at();
create trigger focus_states_v2_set_updated_at
before update on public.focus_states_v2
for each row execute function public.set_updated_at();
create trigger review_schedules_set_updated_at
before update on public.review_schedules
for each row execute function public.set_updated_at();

alter table public.program_day_sessions enable row level security;
alter table public.program_session_items enable row level security;
alter table public.learning_attempts enable row level security;
alter table public.learning_attempt_results enable row level security;
alter table public.correction_cycles enable row level security;
alter table public.focus_evidence enable row level security;
alter table public.focus_states_v2 enable row level security;
alter table public.review_schedules enable row level security;
alter table public.learning_reports enable row level security;
alter table public.learning_report_evidence enable row level security;
alter table public.learning_report_correction_cycles enable row level security;

revoke all on public.program_day_sessions from anon, authenticated;
revoke all on public.program_session_items from anon, authenticated;
revoke all on public.learning_attempts from anon, authenticated;
revoke all on public.learning_attempt_results from anon, authenticated;
revoke all on public.correction_cycles from anon, authenticated;
revoke all on public.focus_evidence from anon, authenticated;
revoke all on public.focus_states_v2 from anon, authenticated;
revoke all on public.review_schedules from anon, authenticated;
revoke all on public.learning_reports from anon, authenticated;
revoke all on public.learning_report_evidence from anon, authenticated;
revoke all on public.learning_report_correction_cycles from anon, authenticated;

grant select on public.program_day_sessions to authenticated;
grant select on public.program_session_items to authenticated;
grant select on public.learning_attempts to authenticated;
grant select on public.learning_attempt_results to authenticated;
grant select on public.correction_cycles to authenticated;
grant select on public.focus_evidence to authenticated;
grant select on public.focus_states_v2 to authenticated;
grant select on public.review_schedules to authenticated;
grant select on public.learning_reports to authenticated;
grant select on public.learning_report_evidence to authenticated;
grant select on public.learning_report_correction_cycles to authenticated;

grant all on public.program_day_sessions to service_role;
grant all on public.program_session_items to service_role;
grant all on public.learning_attempts to service_role;
grant all on public.learning_attempt_results to service_role;
grant all on public.correction_cycles to service_role;
grant all on public.focus_evidence to service_role;
grant all on public.focus_states_v2 to service_role;
grant all on public.review_schedules to service_role;
grant all on public.learning_reports to service_role;
grant all on public.learning_report_evidence to service_role;
grant all on public.learning_report_correction_cycles to service_role;

create policy v2_program_day_sessions_select_own
on public.program_day_sessions for select to authenticated
using (user_id = auth.uid());
create policy v2_program_session_items_select_own
on public.program_session_items for select to authenticated
using (user_id = auth.uid());
create policy v2_learning_attempts_select_own
on public.learning_attempts for select to authenticated
using (user_id = auth.uid());
create policy v2_learning_attempt_results_select_own
on public.learning_attempt_results for select to authenticated
using (user_id = auth.uid());
create policy v2_correction_cycles_select_own
on public.correction_cycles for select to authenticated
using (user_id = auth.uid());
create policy v2_focus_evidence_select_own
on public.focus_evidence for select to authenticated
using (user_id = auth.uid());
create policy v2_focus_states_select_own
on public.focus_states_v2 for select to authenticated
using (user_id = auth.uid());
create policy v2_review_schedules_select_own
on public.review_schedules for select to authenticated
using (user_id = auth.uid());
create policy v2_learning_reports_select_own
on public.learning_reports for select to authenticated
using (user_id = auth.uid());
create policy v2_learning_report_evidence_select_own
on public.learning_report_evidence for select to authenticated
using (user_id = auth.uid());
create policy v2_learning_report_cycles_select_own
on public.learning_report_correction_cycles for select to authenticated
using (user_id = auth.uid());
