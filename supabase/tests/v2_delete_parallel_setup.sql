\set ON_ERROR_STOP on

insert into auth.users (
  id,instance_id,aud,role,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at
) values (
  '91919191-9191-4919-8919-919191919191','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','{}','{}',true,now(),now()
) on conflict(id) do nothing;

set role service_role;
insert into public.learning_deletion_epochs(user_id,current_epoch)
values('91919191-9191-4919-8919-919191919191',0)
on conflict(user_id) do nothing;
reset role;
