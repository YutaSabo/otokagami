\set ON_ERROR_STOP on

do $$
begin
  if (select current_epoch from public.learning_deletion_epochs
      where user_id='91919191-9191-4919-8919-919191919191')<>1
    or (select count(*) from public.learning_deletion_requests
      where request_id='92929292-9292-4929-8929-929292929292')<>1
  then raise exception 'parallel delete replay did not converge on one epoch and one ledger row'; end if;
end;
$$;
