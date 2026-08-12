\set ON_ERROR_STOP on

insert into auth.users(id,instance_id,aud,role,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
values
 ('93939393-9393-4939-8939-939393939393','00000000-0000-0000-0000-000000000000','authenticated','authenticated','{}','{}',true,now(),now()),
 ('95959595-9595-4959-8959-959595959595','00000000-0000-0000-0000-000000000000','authenticated','authenticated','{}','{}',true,now(),now())
on conflict(id) do nothing;

set role service_role;
insert into public.content_versions(
  id,stable_release_id,version,assessment_locale,coaching_locale,status,
  linguistic_reviewed_at,azure_validated_at,activated_at,manifest_sha256
) values (
  '97979797-9797-4979-8979-979797979797','attempt-delete-race',1,'en-US','ja-JP','active',
  now(),now(),now(),repeat('9',64)
) on conflict(id) do nothing;

select public.create_v2_daily_session_secure(
  u,'UTC',current_date,'97979797-9797-4979-8979-979797979797','race-focus',repeat('7',64),
  '[
    {"position":1,"slotRole":"anchor","promptRole":"anchor","practiceItemKey":"race-1","focusGroupKey":"race-focus","selectionReason":"standard","required":true,"referenceText":"test","referenceTextVersion":"v1","expectedFocusRepresentation":"t","targetLocator":{"wordIndex":0,"phonemeIndex":0}},
    {"position":2,"slotRole":"contrast","promptRole":"contrast","practiceItemKey":"race-2","focusGroupKey":"race-focus","selectionReason":"standard","required":true,"referenceText":"test","referenceTextVersion":"v1","expectedFocusRepresentation":"t","targetLocator":{"wordIndex":0,"phonemeIndex":0}},
    {"position":3,"slotRole":"transfer_word","promptRole":"transfer_word","practiceItemKey":"race-3","focusGroupKey":"race-focus","selectionReason":"standard","required":true,"referenceText":"test","referenceTextVersion":"v1","expectedFocusRepresentation":"t","targetLocator":{"wordIndex":0,"phonemeIndex":0}},
    {"position":4,"slotRole":"sentence","promptRole":"sentence","practiceItemKey":"race-4","focusGroupKey":"race-focus","selectionReason":"standard","required":true,"referenceText":"Test now.","referenceTextVersion":"v1","expectedFocusRepresentation":"t","targetLocator":{"wordIndex":0,"phonemeIndex":0}},
    {"position":5,"slotRole":"practical_sentence","promptRole":"practical_sentence","practiceItemKey":"race-5","focusGroupKey":"race-focus","selectionReason":"standard","required":true,"referenceText":"Test it.","referenceTextVersion":"v1","expectedFocusRepresentation":"t","targetLocator":{"wordIndex":0,"phonemeIndex":0}}
  ]'::jsonb,'attempt-delete-race:1',null,now()
)
from unnest(array[
  '93939393-9393-4939-8939-939393939393'::uuid,
  '95959595-9595-4959-8959-959595959595'::uuid
]) as users(u);

select public.issue_v2_assessment_ticket_v4(
  u,r,(select id from public.program_session_items where user_id=u and position=1),
  'initial',n,0,300,600,60,3,now(),null,null
)
from (values
  ('93939393-9393-4939-8939-939393939393'::uuid,'91919191-9191-4919-8919-919191919191'::uuid,repeat('a',64)),
  ('95959595-9595-4959-8959-959595959595'::uuid,'92929292-9292-4929-8929-929292929292'::uuid,repeat('b',64))
) as requests(u,r,n);
reset role;
