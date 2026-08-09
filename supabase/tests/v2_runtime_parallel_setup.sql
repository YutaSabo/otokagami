\set ON_ERROR_STOP on

insert into auth.users (instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'a9090909-9090-4909-8909-909090909090', 'authenticated', 'authenticated', '{}', '{}', true, now(), now())
on conflict (id) do nothing;

set role service_role;
insert into public.content_versions(
  id, stable_release_id, version, assessment_locale, coaching_locale, status,
  linguistic_reviewed_at, azure_validated_at, activated_at, manifest_sha256
) values (
  'c9090909-9090-4909-8909-909090909090', 's6-07-parallel', 1, 'en-US', 'ja-JP', 'active',
  now(), now(), now(), repeat('9', 64)
) on conflict (id) do nothing;

select public.create_v2_daily_session(
  'a9090909-9090-4909-8909-909090909090', 'UTC', current_date,
  'c9090909-9090-4909-8909-909090909090', 'parallel-focus', repeat('9', 64),
  '[
    {"position":1,"slotRole":"anchor","promptRole":"anchor","practiceItemKey":"parallel-1","focusGroupKey":"parallel-focus","selectionReason":"standard","required":true,"referenceText":"think","referenceTextVersion":"v1","expectedFocusRepresentation":"θ"},
    {"position":2,"slotRole":"contrast","promptRole":"contrast","practiceItemKey":"parallel-2","focusGroupKey":"parallel-focus","selectionReason":"standard","required":true,"referenceText":"sink","referenceTextVersion":"v1","expectedFocusRepresentation":"θ"},
    {"position":3,"slotRole":"transfer_word","promptRole":"transfer_word","practiceItemKey":"parallel-3","focusGroupKey":"parallel-focus","selectionReason":"standard","required":true,"referenceText":"thought","referenceTextVersion":"v1","expectedFocusRepresentation":"θ"},
    {"position":4,"slotRole":"sentence","promptRole":"sentence","practiceItemKey":"parallel-4","focusGroupKey":"parallel-focus","selectionReason":"standard","required":true,"referenceText":"Think now","referenceTextVersion":"v1","expectedFocusRepresentation":"θ"},
    {"position":5,"slotRole":"review","promptRole":"transfer_word","practiceItemKey":"parallel-5","focusGroupKey":"parallel-focus","selectionReason":"review_substitute_transfer_word","required":true,"referenceText":"thick","referenceTextVersion":"v1","expectedFocusRepresentation":"θ"}
  ]'::jsonb,
  'otokagami-v2-mvp'
);
reset role;
