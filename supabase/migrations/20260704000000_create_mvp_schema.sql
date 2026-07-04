create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  anon_public_id text not null unique,
  native_language text not null default 'ja' check (native_language in ('ja')),
  target_accent text not null default 'US' check (target_accent in ('US', 'UK')),
  free_trial_started_at timestamptz not null default now(),
  timezone text not null,
  reminder_enabled boolean not null default false,
  reminder_time_local text check (reminder_time_local is null or reminder_time_local ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  playback_speed_default text not null default 'normal' check (playback_speed_default in ('normal', 'slow')),
  free_text_consent_version text,
  free_text_consented_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.installations (
  id uuid primary key default gen_random_uuid(),
  device_install_id_hash text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (last_seen_at >= first_seen_at)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  revenuecat_app_user_id text not null,
  entitlement_id text not null,
  product_id text not null,
  status text not null check (status in ('active', 'expired', 'billing_issue', 'canceled', 'unknown')),
  is_active boolean not null default false,
  current_period_started_at timestamptz,
  current_period_ends_at timestamptz,
  latest_event_at timestamptz,
  raw_event jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (revenuecat_app_user_id = user_id::text)
);

create table public.phonemes (
  phoneme_id text primary key,
  ipa text not null,
  category text not null check (category in ('consonant', 'monophthong', 'diphthong')),
  example_word text not null,
  ja_difficulty text not null check (ja_difficulty in ('high', 'medium', 'low')),
  sort_order integer not null unique,
  is_active boolean not null default true
);

create table public.phoneme_clusters (
  cluster_id text primary key,
  example_word text not null,
  ja_difficulty text not null check (ja_difficulty in ('high', 'medium', 'low')),
  sort_order integer not null unique,
  is_active boolean not null default true
);

create table public.practice_items (
  practice_item_id text primary key,
  item_type text not null check (item_type in ('word', 'sentence')),
  text text not null,
  normalized_text text not null,
  expected_ipa text,
  accent text not null default 'US' check (accent in ('US', 'UK')),
  ja_difficulty text not null check (ja_difficulty in ('high', 'medium', 'low')),
  source text not null check (source in ('seed_ai_generated', 'manual_reviewed')),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.practice_item_targets (
  id uuid primary key default gen_random_uuid(),
  practice_item_id text not null references public.practice_items(practice_item_id) on delete cascade,
  target_type text not null check (target_type in ('phoneme', 'cluster')),
  target_id text not null,
  position_hint jsonb,
  unique (practice_item_id, target_type, target_id)
);

create or replace function public.validate_practice_item_target()
returns trigger
language plpgsql
as $$
begin
  if new.target_type = 'phoneme' and not exists (
    select 1 from public.phonemes where phoneme_id = new.target_id
  ) then
    raise exception 'Unknown phoneme target_id: %', new.target_id;
  end if;

  if new.target_type = 'cluster' and not exists (
    select 1 from public.phoneme_clusters where cluster_id = new.target_id
  ) then
    raise exception 'Unknown cluster target_id: %', new.target_id;
  end if;

  return new;
end;
$$;

create trigger validate_practice_item_target_before_write
before insert or update on public.practice_item_targets
for each row execute function public.validate_practice_item_target();

create table public.daily_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_date date not null,
  timezone text not null,
  status text not null default 'created' check (status in ('created', 'in_progress', 'completed')),
  completed_count integer not null default 0 check (completed_count between 0 and 7),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, session_date)
);

create table public.daily_session_items (
  id uuid primary key default gen_random_uuid(),
  daily_session_id uuid not null references public.daily_sessions(id) on delete cascade,
  position integer not null check (position between 1 and 7),
  slot_type text not null check (slot_type in ('weak', 'new', 'review')),
  practice_item_id text not null references public.practice_items(practice_item_id),
  target_phoneme_ids text[] not null default '{}',
  selection_reason jsonb,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'skipped')),
  best_attempt_id uuid,
  completed_at timestamptz,
  unique (daily_session_id, position)
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  daily_session_id uuid references public.daily_sessions(id) on delete set null,
  daily_session_item_id uuid references public.daily_session_items(id) on delete set null,
  practice_item_id text not null references public.practice_items(practice_item_id),
  practice_mode text not null check (practice_mode in ('daily', 'weak_drill', 'phoneme_select')),
  attempt_no integer not null check (attempt_no > 0),
  practiced_at timestamptz not null,
  practiced_date date not null,
  timezone text not null,
  target_phoneme_ids text[] not null default '{}',
  overall_score numeric not null check (overall_score between 0 and 100),
  target_score_avg numeric not null check (target_score_avg between 0 and 100),
  is_correct boolean not null,
  is_perfect boolean not null,
  is_best boolean not null default false,
  azure_raw_json jsonb not null,
  app_version text,
  device_info jsonb,
  created_at timestamptz not null default now()
);

alter table public.daily_session_items
  add constraint daily_session_items_best_attempt_id_fkey
  foreign key (best_attempt_id) references public.attempts(id) on delete set null;

create table public.attempt_phoneme_results (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  index integer not null check (index >= 0),
  word_index integer check (word_index is null or word_index >= 0),
  expected_phoneme_id text not null references public.phonemes(phoneme_id),
  expected_ipa text not null,
  observed_phoneme_id text references public.phonemes(phoneme_id),
  observed_ipa text,
  score numeric not null check (score between 0 and 100),
  color text not null check (color in ('green', 'yellow', 'red')),
  is_target boolean not null default false,
  confusion_pair_id text,
  unique (attempt_id, index)
);

create table public.phoneme_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  phoneme_id text not null references public.phonemes(phoneme_id),
  mastery_ewma numeric check (mastery_ewma is null or mastery_ewma between 0 and 100),
  practice_count integer not null default 0 check (practice_count >= 0),
  last_practiced_date date,
  next_review_date date,
  review_stage integer not null default 0 check (review_stage between 0 and 3),
  updated_at timestamptz not null default now(),
  primary key (user_id, phoneme_id)
);

create table public.phoneme_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null,
  phoneme_id text not null references public.phonemes(phoneme_id),
  mastery_ewma numeric not null check (mastery_ewma between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, snapshot_date, phoneme_id)
);

create table public.user_badges (
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_id text not null,
  awarded_at timestamptz not null default now(),
  metadata jsonb,
  primary key (user_id, badge_id)
);

create table public.user_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bookmark_type text not null check (bookmark_type in ('phoneme', 'practice_item', 'free_text')),
  phoneme_id text references public.phonemes(phoneme_id),
  practice_item_id text references public.practice_items(practice_item_id),
  free_text text,
  created_at timestamptz not null default now(),
  check (
    (bookmark_type = 'phoneme' and phoneme_id is not null and practice_item_id is null and free_text is null)
    or (bookmark_type = 'practice_item' and practice_item_id is not null and phoneme_id is null and free_text is null)
    or (bookmark_type = 'free_text' and free_text is not null and phoneme_id is null and practice_item_id is null)
  )
);

create table public.free_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null,
  attempted_date date not null,
  timezone text not null,
  input_text text not null,
  normalized_text text not null,
  ipa_result jsonb,
  oov_words text[] not null default '{}',
  conversion_confidence numeric check (conversion_confidence is null or conversion_confidence between 0 and 1),
  phoneme_scores jsonb not null,
  word_scores jsonb,
  overall_score numeric check (overall_score is null or overall_score between 0 and 100),
  azure_raw_json jsonb not null,
  native_language text not null default 'ja' check (native_language in ('ja')),
  target_accent text not null default 'US' check (target_accent in ('US', 'UK')),
  pii_flag boolean not null default false,
  consent_version text not null,
  app_version text,
  device_info jsonb
);

create table public.advice_pages (
  advice_id text primary key,
  confusion_pair_id text,
  generic_advice_id text,
  native_language text not null default 'ja' check (native_language in ('ja')),
  target_accent text not null default 'US' check (target_accent in ('US', 'UK')),
  title text not null,
  short_tip text not null,
  comparison_text text,
  coach_example_text text,
  asset_id text,
  is_template boolean not null default true,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (confusion_pair_id is not null and generic_advice_id is null)
    or (confusion_pair_id is null and generic_advice_id is not null)
  )
);

create table public.advice_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  attempt_id uuid references public.attempts(id) on delete set null,
  free_attempt_id uuid references public.free_attempts(id) on delete set null,
  advice_id text not null references public.advice_pages(advice_id),
  rating text not null check (rating in ('up', 'down')),
  created_at timestamptz not null default now(),
  check (((attempt_id is not null)::integer + (free_attempt_id is not null)::integer) = 1)
);

create table public.tts_cache (
  cache_key text primary key,
  text_hash text not null,
  normalized_text text not null,
  accent text not null default 'US' check (accent in ('US', 'UK')),
  speed text not null check (speed in ('normal', 'slow')),
  storage_path text not null,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create table public.ai_advice_cache (
  cache_key text primary key,
  native_language text not null default 'ja' check (native_language in ('ja')),
  target_accent text not null default 'US' check (target_accent in ('US', 'UK')),
  confusion_pair_id text,
  generic_advice_id text,
  prompt_version text not null,
  output_text text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  check (
    (confusion_pair_id is not null and generic_advice_id is null)
    or (confusion_pair_id is null and generic_advice_id is not null)
  )
);

create table public.error_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  source text not null check (source in ('azure', 'piper', 'openai', 'revenuecat', 'supabase', 'api', 'mobile', 'unknown')),
  operation text not null,
  message text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger installations_set_updated_at
before update on public.installations
for each row execute function public.set_updated_at();

create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

create trigger practice_items_set_updated_at
before update on public.practice_items
for each row execute function public.set_updated_at();

create trigger phoneme_state_set_updated_at
before update on public.phoneme_state
for each row execute function public.set_updated_at();

create trigger phoneme_snapshots_set_updated_at
before update on public.phoneme_snapshots
for each row execute function public.set_updated_at();

create trigger advice_pages_set_updated_at
before update on public.advice_pages
for each row execute function public.set_updated_at();

create index installations_device_install_id_hash_idx on public.installations(device_install_id_hash);
create index installations_user_id_idx on public.installations(user_id);
create index subscriptions_user_id_idx on public.subscriptions(user_id);
create index practice_item_targets_practice_item_id_idx on public.practice_item_targets(practice_item_id);
create index daily_sessions_user_id_session_date_idx on public.daily_sessions(user_id, session_date);
create index daily_session_items_daily_session_id_idx on public.daily_session_items(daily_session_id);
create index attempts_user_id_practiced_date_idx on public.attempts(user_id, practiced_date);
create index attempts_user_id_practice_item_id_idx on public.attempts(user_id, practice_item_id);
create index attempts_user_id_is_best_idx on public.attempts(user_id, is_best);
create index attempt_phoneme_results_attempt_id_idx on public.attempt_phoneme_results(attempt_id);
create index attempt_phoneme_results_expected_phoneme_id_idx on public.attempt_phoneme_results(expected_phoneme_id);
create index phoneme_state_user_id_mastery_ewma_idx on public.phoneme_state(user_id, mastery_ewma);
create index phoneme_state_user_id_next_review_date_idx on public.phoneme_state(user_id, next_review_date);
create index phoneme_snapshots_user_id_snapshot_date_idx on public.phoneme_snapshots(user_id, snapshot_date);
create index free_attempts_user_id_attempted_date_idx on public.free_attempts(user_id, attempted_date);
create index user_badges_user_id_badge_id_idx on public.user_badges(user_id, badge_id);

alter table public.profiles enable row level security;
alter table public.installations enable row level security;
alter table public.subscriptions enable row level security;
alter table public.phonemes enable row level security;
alter table public.phoneme_clusters enable row level security;
alter table public.practice_items enable row level security;
alter table public.practice_item_targets enable row level security;
alter table public.daily_sessions enable row level security;
alter table public.daily_session_items enable row level security;
alter table public.attempts enable row level security;
alter table public.attempt_phoneme_results enable row level security;
alter table public.phoneme_state enable row level security;
alter table public.phoneme_snapshots enable row level security;
alter table public.user_badges enable row level security;
alter table public.user_bookmarks enable row level security;
alter table public.free_attempts enable row level security;
alter table public.advice_pages enable row level security;
alter table public.advice_feedback enable row level security;
alter table public.tts_cache enable row level security;
alter table public.ai_advice_cache enable row level security;
alter table public.error_logs enable row level security;

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant select on public.phonemes, public.phoneme_clusters, public.practice_items, public.practice_item_targets, public.advice_pages to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select on public.subscriptions to authenticated;
grant select, insert, update, delete on public.daily_sessions to authenticated;
grant select, insert, update, delete on public.daily_session_items to authenticated;
grant select, insert, update, delete on public.attempts to authenticated;
grant select, insert, update, delete on public.attempt_phoneme_results to authenticated;
grant select, insert, update, delete on public.phoneme_state to authenticated;
grant select, insert, update, delete on public.phoneme_snapshots to authenticated;
grant select, insert, update, delete on public.user_badges to authenticated;
grant select, insert, update, delete on public.user_bookmarks to authenticated;
grant select, insert, update, delete on public.free_attempts to authenticated;
grant select, insert, update, delete on public.advice_feedback to authenticated;

create policy profiles_select_own on public.profiles
for select to authenticated
using (user_id = auth.uid());

create policy profiles_insert_own on public.profiles
for insert to authenticated
with check (user_id = auth.uid());

create policy profiles_update_own on public.profiles
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy profiles_delete_own on public.profiles
for delete to authenticated
using (user_id = auth.uid());

create policy subscriptions_select_own on public.subscriptions
for select to authenticated
using (user_id = auth.uid());

create policy phonemes_select_authenticated on public.phonemes
for select to authenticated
using (true);

create policy phoneme_clusters_select_authenticated on public.phoneme_clusters
for select to authenticated
using (true);

create policy practice_items_select_authenticated on public.practice_items
for select to authenticated
using (true);

create policy practice_item_targets_select_authenticated on public.practice_item_targets
for select to authenticated
using (true);

create policy advice_pages_select_authenticated on public.advice_pages
for select to authenticated
using (true);

create policy daily_sessions_select_own on public.daily_sessions
for select to authenticated
using (user_id = auth.uid());

create policy daily_sessions_insert_own on public.daily_sessions
for insert to authenticated
with check (user_id = auth.uid());

create policy daily_sessions_update_own on public.daily_sessions
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy daily_sessions_delete_own on public.daily_sessions
for delete to authenticated
using (user_id = auth.uid());

create policy daily_session_items_select_own_parent on public.daily_session_items
for select to authenticated
using (
  exists (
    select 1 from public.daily_sessions
    where daily_sessions.id = daily_session_items.daily_session_id
      and daily_sessions.user_id = auth.uid()
  )
);

create policy daily_session_items_insert_own_parent on public.daily_session_items
for insert to authenticated
with check (
  exists (
    select 1 from public.daily_sessions
    where daily_sessions.id = daily_session_items.daily_session_id
      and daily_sessions.user_id = auth.uid()
  )
);

create policy daily_session_items_update_own_parent on public.daily_session_items
for update to authenticated
using (
  exists (
    select 1 from public.daily_sessions
    where daily_sessions.id = daily_session_items.daily_session_id
      and daily_sessions.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.daily_sessions
    where daily_sessions.id = daily_session_items.daily_session_id
      and daily_sessions.user_id = auth.uid()
  )
);

create policy daily_session_items_delete_own_parent on public.daily_session_items
for delete to authenticated
using (
  exists (
    select 1 from public.daily_sessions
    where daily_sessions.id = daily_session_items.daily_session_id
      and daily_sessions.user_id = auth.uid()
  )
);

create policy attempts_select_own on public.attempts
for select to authenticated
using (user_id = auth.uid());

create policy attempts_insert_own on public.attempts
for insert to authenticated
with check (user_id = auth.uid());

create policy attempts_update_own on public.attempts
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy attempts_delete_own on public.attempts
for delete to authenticated
using (user_id = auth.uid());

create policy attempt_phoneme_results_select_own_parent on public.attempt_phoneme_results
for select to authenticated
using (
  exists (
    select 1 from public.attempts
    where attempts.id = attempt_phoneme_results.attempt_id
      and attempts.user_id = auth.uid()
  )
);

create policy attempt_phoneme_results_insert_own_parent on public.attempt_phoneme_results
for insert to authenticated
with check (
  exists (
    select 1 from public.attempts
    where attempts.id = attempt_phoneme_results.attempt_id
      and attempts.user_id = auth.uid()
  )
);

create policy attempt_phoneme_results_update_own_parent on public.attempt_phoneme_results
for update to authenticated
using (
  exists (
    select 1 from public.attempts
    where attempts.id = attempt_phoneme_results.attempt_id
      and attempts.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.attempts
    where attempts.id = attempt_phoneme_results.attempt_id
      and attempts.user_id = auth.uid()
  )
);

create policy attempt_phoneme_results_delete_own_parent on public.attempt_phoneme_results
for delete to authenticated
using (
  exists (
    select 1 from public.attempts
    where attempts.id = attempt_phoneme_results.attempt_id
      and attempts.user_id = auth.uid()
  )
);

create policy phoneme_state_select_own on public.phoneme_state
for select to authenticated
using (user_id = auth.uid());

create policy phoneme_state_insert_own on public.phoneme_state
for insert to authenticated
with check (user_id = auth.uid());

create policy phoneme_state_update_own on public.phoneme_state
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy phoneme_state_delete_own on public.phoneme_state
for delete to authenticated
using (user_id = auth.uid());

create policy phoneme_snapshots_select_own on public.phoneme_snapshots
for select to authenticated
using (user_id = auth.uid());

create policy phoneme_snapshots_insert_own on public.phoneme_snapshots
for insert to authenticated
with check (user_id = auth.uid());

create policy phoneme_snapshots_update_own on public.phoneme_snapshots
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy phoneme_snapshots_delete_own on public.phoneme_snapshots
for delete to authenticated
using (user_id = auth.uid());

create policy user_badges_select_own on public.user_badges
for select to authenticated
using (user_id = auth.uid());

create policy user_badges_insert_own on public.user_badges
for insert to authenticated
with check (user_id = auth.uid());

create policy user_badges_update_own on public.user_badges
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy user_badges_delete_own on public.user_badges
for delete to authenticated
using (user_id = auth.uid());

create policy user_bookmarks_select_own on public.user_bookmarks
for select to authenticated
using (user_id = auth.uid());

create policy user_bookmarks_insert_own on public.user_bookmarks
for insert to authenticated
with check (user_id = auth.uid());

create policy user_bookmarks_update_own on public.user_bookmarks
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy user_bookmarks_delete_own on public.user_bookmarks
for delete to authenticated
using (user_id = auth.uid());

create policy free_attempts_select_own on public.free_attempts
for select to authenticated
using (user_id = auth.uid());

create policy free_attempts_insert_own on public.free_attempts
for insert to authenticated
with check (user_id = auth.uid());

create policy free_attempts_update_own on public.free_attempts
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy free_attempts_delete_own on public.free_attempts
for delete to authenticated
using (user_id = auth.uid());

create policy advice_feedback_select_own on public.advice_feedback
for select to authenticated
using (user_id = auth.uid());

create policy advice_feedback_insert_own on public.advice_feedback
for insert to authenticated
with check (user_id = auth.uid());

create policy advice_feedback_update_own on public.advice_feedback
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy advice_feedback_delete_own on public.advice_feedback
for delete to authenticated
using (user_id = auth.uid());
