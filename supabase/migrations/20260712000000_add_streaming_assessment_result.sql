alter table public.attempts
  add column if not exists normalized_result jsonb not null default '{}'::jsonb,
  add column if not exists performance_metrics jsonb;

alter table public.free_attempts
  add column if not exists normalized_result jsonb not null default '{}'::jsonb,
  add column if not exists performance_metrics jsonb;

alter table public.profiles
  alter column native_language set default 'und',
  drop constraint if exists profiles_native_language_check,
  add constraint profiles_native_language_check check (native_language ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$' or native_language = 'und');

alter table public.free_attempts
  alter column native_language set default 'und',
  drop constraint if exists free_attempts_native_language_check,
  add constraint free_attempts_native_language_check check (native_language ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$' or native_language = 'und');

comment on column public.attempts.normalized_result is 'Provider-neutral pronunciation result; unavailable values remain null.';
comment on column public.attempts.performance_metrics is 'Non-sensitive client/server assessment timings only.';
comment on column public.free_attempts.normalized_result is 'Provider-neutral pronunciation result; unavailable values remain null.';
comment on column public.free_attempts.performance_metrics is 'Non-sensitive client/server assessment timings only.';
