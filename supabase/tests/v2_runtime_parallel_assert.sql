\set ON_ERROR_STOP on

do $$
begin
  if (
    select count(*) from public.learning_attempts
    where user_id = 'a9090909-9090-4909-8909-909090909090'
      and client_attempt_id = 'e9090909-9090-4909-8909-909090909090'
  ) <> 1 then
    raise exception 'Parallel replay did not persist exactly one canonical attempt';
  end if;
  if (
    select count(*) from public.learning_attempt_results r
    join public.learning_attempts a on a.id = r.attempt_id
    where a.client_attempt_id = 'e9090909-9090-4909-8909-909090909090'
  ) <> 1 then
    raise exception 'Parallel replay did not persist exactly one canonical result';
  end if;
end;
$$;

delete from auth.users where id = 'a9090909-9090-4909-8909-909090909090';
set role service_role;
delete from public.content_versions where id = 'c9090909-9090-4909-8909-909090909090';
reset role;
