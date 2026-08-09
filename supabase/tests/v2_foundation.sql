\set ON_ERROR_STOP on

do $$
declare
  legacy_table text;
begin
  foreach legacy_table in array array['phonemes', 'phoneme_clusters', 'practice_items'] loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = legacy_table
        and column_name = 'ja_difficulty'
        and is_nullable = 'NO'
        and column_default = '''medium''::text'
    ) then
      raise exception 'v1 compatibility failed: %.ja_difficulty/default missing', legacy_table;
    end if;

    if col_description(format('public.%I', legacy_table)::regclass, (
      select ordinal_position
      from information_schema.columns
      where table_schema = 'public'
        and table_name = legacy_table
        and column_name = 'ja_difficulty'
    )) not like 'Legacy v1 metadata retained%'
    then
      raise exception 'v1 compatibility failed: %.ja_difficulty comment missing', legacy_table;
    end if;
  end loop;

  if (
    select count(*)
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
  ) <> 24 then
    raise exception 'S6-03 schema failed: expected 24 public base tables';
  end if;

  if exists (
    select 1
    from (values
      ('program_enrollments'),
      ('content_versions'),
      ('learning_deletion_epochs')
    ) as required(table_name)
    left join pg_class c on c.relname = required.table_name
    left join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.oid is null or not c.relrowsecurity
  ) then
    raise exception 'S6-03 schema failed: RLS is not enabled on every v2 foundation table';
  end if;

  if (select count(*) from public.program_enrollments) <> 0
    or (select count(*) from public.content_versions) <> 0
    or (select count(*) from public.learning_deletion_epochs) <> 0
  then
    raise exception 'S6-03 schema failed: v2 foundation tables must start empty';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public') <> 53 then
    raise exception 'S6-03 schema failed: expected 50 existing policies plus 3 new policies';
  end if;

  if has_table_privilege('anon', 'public.program_enrollments', 'SELECT')
    or has_table_privilege('anon', 'public.content_versions', 'SELECT')
    or has_table_privilege('anon', 'public.learning_deletion_epochs', 'SELECT')
  then
    raise exception 'S6-03 grants failed: anon can read v2 foundation tables';
  end if;

  if not has_table_privilege('authenticated', 'public.program_enrollments', 'SELECT')
    or not has_table_privilege('authenticated', 'public.content_versions', 'SELECT')
    or not has_table_privilege('authenticated', 'public.learning_deletion_epochs', 'SELECT')
  then
    raise exception 'S6-03 grants failed: authenticated read grants missing';
  end if;

  if has_table_privilege('authenticated', 'public.program_enrollments', 'INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated', 'public.content_versions', 'INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated', 'public.learning_deletion_epochs', 'INSERT,UPDATE,DELETE')
  then
    raise exception 'S6-03 grants failed: authenticated can mutate protected v2 state';
  end if;

  if not has_table_privilege('service_role', 'public.program_enrollments', 'INSERT,UPDATE,DELETE')
    or not has_table_privilege('service_role', 'public.content_versions', 'INSERT,UPDATE,DELETE')
    or not has_table_privilege('service_role', 'public.learning_deletion_epochs', 'INSERT,UPDATE,DELETE')
  then
    raise exception 'S6-03 grants failed: trusted service write grants missing';
  end if;

  if (select count(*) from pg_trigger where not tgisinternal and tgname in (
    'program_enrollments_set_updated_at',
    'content_versions_guard_mutation',
    'content_versions_set_updated_at',
    'learning_deletion_epochs_guard_update',
    'learning_deletion_epochs_set_updated_at'
  )) <> 5 then
    raise exception 'S6-03 schema failed: expected five v2 protection/update triggers';
  end if;
end;
$$;
