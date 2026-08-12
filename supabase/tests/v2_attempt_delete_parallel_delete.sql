\set ON_ERROR_STOP on
set role service_role;
select public.delete_v2_learning_data_atomic_v2(
  '93939393-9393-4939-8939-939393939393','94949494-9494-4949-8949-949494949494',0,now()
);
reset role;
