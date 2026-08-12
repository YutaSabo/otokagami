\set ON_ERROR_STOP on
begin;
set role service_role;
select public.lock_v2_user_mutation('95959595-9595-4959-8959-959595959595');
select pg_sleep(0.35);
select public.delete_v2_learning_data_atomic_v2(
  '95959595-9595-4959-8959-959595959595','96969696-9696-4969-8969-969696969696',0,now()
);
commit;
