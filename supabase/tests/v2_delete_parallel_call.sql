\set ON_ERROR_STOP on
set role service_role;
select public.delete_v2_learning_data_atomic(
  '91919191-9191-4919-8919-919191919191',
  '92929292-9292-4929-8929-929292929292',0,'2026-08-10T02:00:00Z'
);
reset role;
