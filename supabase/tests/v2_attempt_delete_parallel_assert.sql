\set ON_ERROR_STOP on
do $$
declare u uuid;
begin
  foreach u in array array[
    '93939393-9393-4939-8939-939393939393'::uuid,
    '95959595-9595-4959-8959-959595959595'::uuid
  ] loop
    if (select current_epoch from public.learning_deletion_epochs where user_id=u)<>1
      or exists(select 1 from public.learning_attempts where user_id=u)
      or exists(select 1 from public.program_day_sessions where user_id=u)
    then raise exception 'attempt/delete race did not converge for %',u; end if;
  end loop;
  if (select count(*) from public.learning_deletion_requests
      where request_id in ('94949494-9494-4949-8949-949494949494','96969696-9696-4969-8969-969696969696'))<>2
  then raise exception 'attempt/delete race did not record both deletion receipts'; end if;
end;
$$;
