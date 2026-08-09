-- S6-03 additive foundation for the new MVP.
-- No existing row is inserted, updated, deleted, or backfilled by this migration.

create table public.program_enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  program_version text not null,
  trial_status text not null default 'not_started'
    check (trial_status in ('not_started', 'in_progress', 'day_7_completed', 'exhausted')),
  trial_started_at timestamptz,
  current_program_day smallint not null default 0
    check (current_program_day between 0 and 7),
  completed_program_days smallint not null default 0
    check (completed_program_days between 0 and 7),
  last_completed_calendar_date date,
  day_7_report_status text not null default 'not_started'
    check (day_7_report_status in ('not_started', 'pending', 'ready')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint program_enrollments_day_order_check
    check (
      completed_program_days <= current_program_day
      and current_program_day <= completed_program_days + 1
    ),
  constraint program_enrollments_completion_date_check
    check (
      (completed_program_days = 0 and last_completed_calendar_date is null)
      or (completed_program_days > 0 and last_completed_calendar_date is not null)
    ),
  constraint program_enrollments_trial_state_check
    check (
      (
        trial_status = 'not_started'
        and trial_started_at is null
        and current_program_day = 0
        and completed_program_days = 0
        and day_7_report_status = 'not_started'
      )
      or (
        trial_status = 'in_progress'
        and trial_started_at is not null
        and current_program_day between 1 and 7
        and completed_program_days between 0 and 6
        and day_7_report_status = 'not_started'
      )
      or (
        trial_status = 'day_7_completed'
        and trial_started_at is not null
        and current_program_day = 7
        and completed_program_days = 7
        and day_7_report_status in ('pending', 'ready')
      )
      or (
        trial_status = 'exhausted'
        and trial_started_at is not null
        and current_program_day = 7
        and completed_program_days = 7
        and day_7_report_status = 'ready'
      )
    )
);

comment on table public.program_enrollments is
  'Server-controlled v2 enrollment and 7 active learning day history; independent from learning-data deletion.';
comment on column public.program_enrollments.program_version is
  'Stable program definition identifier chosen by the trusted server.';

create table public.content_versions (
  id uuid primary key default gen_random_uuid(),
  stable_release_id text not null,
  version integer not null check (version > 0),
  assessment_locale text not null,
  coaching_locale text not null,
  status text not null default 'draft'
    check (status in ('draft', 'linguistic_reviewed', 'azure_validated', 'active', 'retired')),
  linguistic_reviewed_at timestamptz,
  azure_validated_at timestamptz,
  activated_at timestamptz,
  manifest_sha256 text
    check (manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(manifest_metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stable_release_id, version),
  constraint content_versions_review_state_check
    check (
      status = 'draft'
      or (
        status = 'linguistic_reviewed'
        and linguistic_reviewed_at is not null
      )
      or (
        status = 'azure_validated'
        and linguistic_reviewed_at is not null
        and azure_validated_at is not null
      )
      or (
        status in ('active', 'retired')
        and linguistic_reviewed_at is not null
        and azure_validated_at is not null
        and activated_at is not null
        and manifest_sha256 is not null
      )
    )
);

comment on table public.content_versions is
  'Trusted content release boundary. Authenticated clients can read active versions but cannot mutate lifecycle state.';
comment on column public.content_versions.stable_release_id is
  'Stable release identity; pair with version instead of mutating an activated release in place.';

create table public.learning_deletion_epochs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_epoch bigint not null default 0 check (current_epoch >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.learning_deletion_epochs is
  'Server-controlled monotonic epoch used to reject delayed writes created before a learning-data deletion.';

create index program_enrollments_trial_status_idx
  on public.program_enrollments(trial_status);
create index content_versions_status_locales_idx
  on public.content_versions(status, assessment_locale, coaching_locale);

create or replace function public.guard_content_version_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('active', 'retired') and (
    new.stable_release_id is distinct from old.stable_release_id
    or new.version is distinct from old.version
    or new.assessment_locale is distinct from old.assessment_locale
    or new.coaching_locale is distinct from old.coaching_locale
    or new.linguistic_reviewed_at is distinct from old.linguistic_reviewed_at
    or new.azure_validated_at is distinct from old.azure_validated_at
    or new.activated_at is distinct from old.activated_at
    or new.manifest_sha256 is distinct from old.manifest_sha256
    or new.manifest_metadata is distinct from old.manifest_metadata
  ) then
    raise exception 'Activated content versions are immutable';
  end if;

  if old.status = 'active' and new.status not in ('active', 'retired') then
    raise exception 'Active content versions can only remain active or become retired';
  end if;

  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'Retired content versions cannot be reactivated';
  end if;

  return new;
end;
$$;

create or replace function public.guard_learning_deletion_epoch_update()
returns trigger
language plpgsql
as $$
begin
  if new.current_epoch <= old.current_epoch then
    raise exception 'Learning deletion epoch must increase';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_content_version_mutation() from public, anon, authenticated;
revoke all on function public.guard_learning_deletion_epoch_update() from public, anon, authenticated;
grant execute on function public.guard_content_version_mutation() to service_role;
grant execute on function public.guard_learning_deletion_epoch_update() to service_role;

create trigger content_versions_guard_mutation
before update on public.content_versions
for each row execute function public.guard_content_version_mutation();

create trigger content_versions_set_updated_at
before update on public.content_versions
for each row execute function public.set_updated_at();

create trigger program_enrollments_set_updated_at
before update on public.program_enrollments
for each row execute function public.set_updated_at();

create trigger learning_deletion_epochs_guard_update
before update on public.learning_deletion_epochs
for each row execute function public.guard_learning_deletion_epoch_update();

create trigger learning_deletion_epochs_set_updated_at
before update on public.learning_deletion_epochs
for each row execute function public.set_updated_at();

alter table public.program_enrollments enable row level security;
alter table public.content_versions enable row level security;
alter table public.learning_deletion_epochs enable row level security;

revoke all on public.program_enrollments from anon, authenticated;
revoke all on public.content_versions from anon, authenticated;
revoke all on public.learning_deletion_epochs from anon, authenticated;

grant select on public.program_enrollments to authenticated;
grant select on public.content_versions to authenticated;
grant select on public.learning_deletion_epochs to authenticated;

grant all on public.program_enrollments to service_role;
grant all on public.content_versions to service_role;
grant all on public.learning_deletion_epochs to service_role;

create policy program_enrollments_select_own
on public.program_enrollments
for select to authenticated
using (user_id = auth.uid());

create policy content_versions_select_active
on public.content_versions
for select to authenticated
using (status = 'active');

create policy learning_deletion_epochs_select_own
on public.learning_deletion_epochs
for select to authenticated
using (user_id = auth.uid());
