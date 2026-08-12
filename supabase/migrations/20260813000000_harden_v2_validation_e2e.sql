-- S6-08.2 / Stage 7.1 forward-only device-validation hardening.
-- Applied migrations remain immutable. This migration contains no data backfill,
-- seed, truncate, or user-data deletion. Validation remains service-only and
-- cannot consume trial state or create durable learning evidence.

alter table public.assessment_tickets
  add column cancelled_at timestamptz,
  add column cancellation_reason text,
  add constraint assessment_tickets_cancellation_shape_check check (
    (cancelled_at is null and cancellation_reason is null)
    or (
      cancelled_at is not null
      and cancellation_reason in ('client_cancelled','token_issue_failed','capture_abandoned')
      and status = 'expired'
    )
  );

alter table public.program_session_items
  add column coach_text text,
  add column reference_audio_standard_url text,
  add column reference_audio_slow_url text,
  add column reference_audio_version text,
  add column reference_audio_manifest_sha256 text,
  add constraint program_session_items_coach_text_check check (
    coach_text is null
    or (
      char_length(coach_text) between 1 and 280
      and coach_text !~ '[[:cntrl:]]'
      and coach_text !~* '(https?://|bearer[[:space:]]|authorization[[:space:]]*:|token[[:space:]]*[=:])'
    )
  ),
  add constraint program_session_items_reference_audio_shape_check check (
    (
      reference_audio_standard_url is null
      and reference_audio_slow_url is null
      and reference_audio_version is null
      and reference_audio_manifest_sha256 is null
    )
    or (
      char_length(reference_audio_standard_url) between 1 and 500
      and char_length(reference_audio_slow_url) between 1 and 500
      and char_length(reference_audio_version) between 1 and 120
      and reference_audio_manifest_sha256 ~ '^[0-9a-f]{64}$'
      and reference_audio_standard_url !~ '[[:cntrl:]]'
      and reference_audio_slow_url !~ '[[:cntrl:]]'
      and reference_audio_standard_url !~* '(bearer[[:space:]]|authorization[[:space:]]*:|token[[:space:]]*[=:])'
      and reference_audio_slow_url !~* '(bearer[[:space:]]|authorization[[:space:]]*:|token[[:space:]]*[=:])'
      and (
        reference_audio_standard_url like '/validation-audio/%'
        or reference_audio_standard_url like 'https://%'
      )
      and (
        reference_audio_slow_url like '/validation-audio/%'
        or reference_audio_slow_url like 'https://%'
      )
    )
  );

comment on column public.program_session_items.coach_text is
  'Immutable, server-owned static coaching copy. It must not contain a URI, token, raw provider message, or runtime-generated advice.';
comment on column public.program_session_items.reference_audio_standard_url is
  'Immutable managed reference-audio locator. It never refers to user audio and is snapshotted with a manifest hash.';

alter table public.review_schedules
  add column completion_receipt_id uuid;

alter table public.review_schedules
  drop constraint review_schedules_completion_check,
  add constraint review_schedules_completion_check check (
    (status = 'completed' and completion_receipt_id is not null)
    or (status <> 'completed' and completion_receipt_id is null and completion_evidence_id is null)
  );

alter table public.review_schedules
  add constraint review_schedules_completion_receipt_owner_fkey
  foreign key (completion_receipt_id, user_id)
  references public.review_completion_receipts(id, user_id)
  on delete set null (completion_receipt_id);

comment on column public.review_schedules.completion_receipt_id is
  'Trusted review completion fact. It is distinct from the source evidence that scheduled the review.';

-- A review slot can contain either a bound due review or one explicit managed
-- substitute. A substitute keeps slot_role=review for plan topology while its
-- actual prompt_role and selection_reason remain non-review and it carries no
-- review schedule snapshot.
alter table public.program_session_items
  drop constraint program_session_items_review_snapshot_shape_check,
  add constraint program_session_items_review_snapshot_shape_check check (
    (
      slot_role = 'review'
      and (
        (
          prompt_role = 'review'
          and review_schedule_id is not null
          and review_source_evidence_id is not null
          and review_due_date is not null
          and review_interval_kind is not null
        )
        or (
          prompt_role in ('transfer_word','sentence','practical_sentence')
          and selection_reason in (
            'review_substitute_transfer_word',
            'review_substitute_sentence',
            'review_substitute_practical_sentence'
          )
          and review_schedule_id is null
          and review_source_evidence_id is null
          and review_due_date is null
          and review_interval_kind is null
        )
      )
    )
    or (
      slot_role <> 'review'
      and review_schedule_id is null
      and review_source_evidence_id is null
      and review_due_date is null
      and review_interval_kind is null
    )
  );

create or replace function public.assert_v2_validation_installation(
  p_user_id uuid,
  p_session_id uuid,
  p_installation_sha256 text,
  p_server_now timestamptz
)
returns public.program_day_sessions
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare session_row public.program_day_sessions%rowtype;
begin
  if p_installation_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using message='VALIDATION_INSTALLATION_REQUIRED',errcode='42501';
  end if;
  select * into session_row from public.program_day_sessions
    where id=p_session_id and user_id=p_user_id for share;
  if session_row.id is null or not session_row.validation_only
    or session_row.validation_installation_sha256<>p_installation_sha256
    or not exists (
      select 1 from public.v2_validation_content_access a
      where a.user_id=p_user_id
        and a.content_version_id=session_row.content_version_id
        and a.installation_sha256=p_installation_sha256
        and a.revoked_at is null
        and (a.expires_at is null or a.expires_at>p_server_now)
    )
  then raise exception using message='VALIDATION_TESTER_NOT_ALLOWED',errcode='42501'; end if;
  return session_row;
end;
$$;

create or replace function public.issue_v2_assessment_ticket_v4(
  p_user_id uuid,
  p_ticket_request_id uuid,
  p_session_item_id uuid,
  p_attempt_purpose text,
  p_nonce_sha256 text,
  p_deletion_epoch bigint,
  p_capture_ttl_seconds integer,
  p_submission_window_seconds integer,
  p_rate_window_seconds integer,
  p_rate_limit_max integer,
  p_issued_at timestamptz,
  p_entitlement_id text,
  p_validation_installation_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare item_row public.program_session_items%rowtype;
  session_row public.program_day_sessions%rowtype;
  result jsonb;
begin
  perform public.lock_v2_user_mutation(p_user_id);
  if coalesce((select current_epoch from public.learning_deletion_epochs
      where user_id=p_user_id),0)<>p_deletion_epoch then
    raise exception using message='DELETION_EPOCH_CONFLICT',errcode='40001';
  end if;
  select * into item_row from public.program_session_items
    where id=p_session_item_id and user_id=p_user_id;
  select * into session_row from public.program_day_sessions
    where id=item_row.session_id and user_id=p_user_id;
  if session_row.id is null then
    raise exception using message='SESSION_ITEM_NOT_AVAILABLE',errcode='23514';
  end if;
  if session_row.validation_only then
    perform public.assert_v2_validation_installation(
      p_user_id,session_row.id,p_validation_installation_sha256,p_issued_at
    );
  elsif p_validation_installation_sha256 is not null then
    raise exception using message='VALIDATION_BINDING_UNEXPECTED',errcode='23514';
  end if;

  result:=public.issue_v2_assessment_ticket_v3(
    p_user_id,p_ticket_request_id,p_session_item_id,p_attempt_purpose,p_nonce_sha256,
    p_deletion_epoch,p_capture_ttl_seconds,p_submission_window_seconds,
    p_rate_window_seconds,p_rate_limit_max,p_issued_at,p_entitlement_id
  );
  if result->>'status'<>'issued' then
    raise exception using message='ASSESSMENT_TICKET_INVALID',errcode='23514';
  end if;
  return result;
end;
$$;

create or replace function public.recover_v2_assessment_ticket_v2(
  p_user_id uuid,p_ticket_request_id uuid,p_nonce_sha256 text,
  p_server_now timestamptz,p_validation_installation_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare result jsonb; ticket_row public.assessment_tickets%rowtype;
begin
  perform public.lock_v2_user_mutation(p_user_id);
  result:=public.recover_v2_assessment_ticket(
    p_user_id,p_ticket_request_id,p_nonce_sha256,p_server_now
  );
  select * into ticket_row from public.assessment_tickets
    where user_id=p_user_id and ticket_request_id=p_ticket_request_id;
  if exists (
    select 1 from public.program_day_sessions s
    where s.id=ticket_row.session_id and s.user_id=p_user_id and s.validation_only
  ) then
    perform public.assert_v2_validation_installation(
      p_user_id,ticket_row.session_id,p_validation_installation_sha256,p_server_now
    );
  elsif p_validation_installation_sha256 is not null then
    raise exception using message='VALIDATION_BINDING_UNEXPECTED',errcode='23514';
  end if;
  return result||jsonb_build_object(
    'cancelled',ticket_row.cancelled_at is not null,
    'cancellation_reason',ticket_row.cancellation_reason
  );
end;
$$;

create or replace function public.cancel_v2_assessment_ticket_v2(
  p_user_id uuid,p_ticket_request_id uuid,p_nonce_sha256 text,
  p_server_now timestamptz,p_validation_installation_sha256 text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare result jsonb; ticket_row public.assessment_tickets%rowtype;
begin
  perform public.lock_v2_user_mutation(p_user_id);
  if p_reason not in ('client_cancelled','token_issue_failed','capture_abandoned') then
    raise exception using message='ASSESSMENT_TICKET_CANCEL_REASON_INVALID',errcode='22023';
  end if;
  result:=public.recover_v2_assessment_ticket_v2(
    p_user_id,p_ticket_request_id,p_nonce_sha256,p_server_now,
    p_validation_installation_sha256
  );
  select * into ticket_row from public.assessment_tickets
    where user_id=p_user_id and ticket_request_id=p_ticket_request_id for update;
  if ticket_row.status='consumed' then
    raise exception using message='ASSESSMENT_TICKET_ALREADY_CONSUMED',errcode='23514';
  end if;
  perform set_config('app.v2_trusted_command','on',true);
  update public.assessment_tickets set status='expired',
    cancelled_at=coalesce(cancelled_at,p_server_now),
    cancellation_reason=coalesce(cancellation_reason,p_reason)
    where id=ticket_row.id;
  perform set_config('app.v2_trusted_command','off',true);
  return result||jsonb_build_object(
    'status','cancelled','cancelled',true,'cancellation_reason',p_reason
  );
end;
$$;

create or replace function public.persist_v2_attempt_v4(
  p_user_id uuid,p_session_item_id uuid,p_client_attempt_id uuid,p_payload_sha256 text,
  p_deletion_epoch bigint,p_assessment_ticket_id uuid,p_ticket_request_id uuid,
  p_ticket_nonce_sha256 text,p_captured_at timestamptz,p_recording_started_at timestamptz,
  p_provider_result_received_at timestamptz,p_server_now timestamptz,p_attempted_at timestamptz,
  p_calendar_date date,p_timezone text,p_provider text,p_assessment_locale text,
  p_provider_version text,p_normalizer_version text,p_normalization_status text,
  p_provider_attested boolean,p_technical_valid boolean,p_invalid_reason text,
  p_observed_candidate text,p_target_score numeric,p_result_label text,p_next_action_key text,
  p_capability_flags jsonb,p_normalized_detail jsonb,p_entitlement_id text,
  p_validation_installation_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare item_row public.program_session_items%rowtype;
  session_row public.program_day_sessions%rowtype;
  ticket_row public.assessment_tickets%rowtype;
begin
  perform public.lock_v2_user_mutation(p_user_id);
  if coalesce((select current_epoch from public.learning_deletion_epochs
      where user_id=p_user_id),0)<>p_deletion_epoch then
    raise exception using message='DELETION_EPOCH_CONFLICT',errcode='40001';
  end if;
  select * into item_row from public.program_session_items
    where id=p_session_item_id and user_id=p_user_id;
  select * into session_row from public.program_day_sessions
    where id=item_row.session_id and user_id=p_user_id;
  if session_row.id is null then
    raise exception using message='SESSION_ITEM_NOT_AVAILABLE',errcode='23514';
  end if;
  if session_row.validation_only then
    perform public.assert_v2_validation_installation(
      p_user_id,session_row.id,p_validation_installation_sha256,p_server_now
    );
  elsif p_validation_installation_sha256 is not null then
    raise exception using message='VALIDATION_BINDING_UNEXPECTED',errcode='23514';
  end if;
  select * into ticket_row from public.assessment_tickets
    where id=p_assessment_ticket_id and user_id=p_user_id
      and ticket_request_id=p_ticket_request_id for update;
  if ticket_row.id is null or ticket_row.session_item_id<>p_session_item_id
    or ticket_row.nonce_sha256<>p_ticket_nonce_sha256
  then raise exception using message='ASSESSMENT_TICKET_BINDING_MISMATCH',errcode='42501'; end if;
  if p_recording_started_at<ticket_row.issued_at
    or p_recording_started_at>ticket_row.capture_expires_at
  then raise exception using message='ASSESSMENT_CAPTURE_EXPIRED',errcode='23514'; end if;
  if p_server_now>ticket_row.submission_expires_at then
    raise exception using message='ASSESSMENT_SUBMISSION_EXPIRED',errcode='23514'; end if;
  return public.persist_v2_attempt_v3(
    p_user_id,p_session_item_id,p_client_attempt_id,p_payload_sha256,p_deletion_epoch,
    p_assessment_ticket_id,p_ticket_request_id,p_ticket_nonce_sha256,p_captured_at,
    p_recording_started_at,p_provider_result_received_at,p_server_now,p_attempted_at,
    p_calendar_date,p_timezone,p_provider,p_assessment_locale,p_provider_version,
    p_normalizer_version,p_normalization_status,p_provider_attested,p_technical_valid,
    p_invalid_reason,p_observed_candidate,p_target_score,p_result_label,p_next_action_key,
    p_capability_flags,p_normalized_detail,p_entitlement_id
  );
end;
$$;

create or replace function public.complete_v2_review_submission_v3(
  p_user_id uuid,p_review_schedule_id uuid,p_session_item_id uuid,p_attempt_id uuid,
  p_deletion_epoch bigint,p_completion_idempotency_key uuid,p_completed_at timestamptz,
  p_calendar_date date
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare schedule_row public.review_schedules%rowtype;
  receipt_row public.review_completion_receipts%rowtype;
  due_date date; result jsonb;
begin
  perform public.lock_v2_user_mutation(p_user_id);
  select * into schedule_row from public.review_schedules
    where id=p_review_schedule_id and user_id=p_user_id for update;
  if schedule_row.id is null then
    raise exception using message='V2_REVIEW_COMPLETION_INVALID',errcode='23514';
  end if;
  due_date:=schedule_row.based_on_calendar_date + case schedule_row.interval_kind
    when 'day_1' then 1 when 'day_3' then 3 when 'day_7' then 7 when 'day_14' then 14 end;
  if due_date is null or schedule_row.review_due_date<>due_date
    or p_calendar_date<due_date
    or schedule_row.status in ('completed','superseded')
  then
    if schedule_row.status='completed' then
      select * into receipt_row from public.review_completion_receipts
        where user_id=p_user_id and review_schedule_id=p_review_schedule_id;
      if receipt_row.completion_idempotency_key=p_completion_idempotency_key then
        return jsonb_build_object(
          'receipt_id',receipt_row.id,'review_schedule_id',schedule_row.id,
          'completed_calendar_date',receipt_row.completed_calendar_date,
          'schedule_status','completed','replayed',true,'policy_status','needs_policy'
        );
      end if;
    end if;
    raise exception using message='V2_REVIEW_DUE_DATE_INVALID',errcode='23514';
  end if;
  result:=public.complete_v2_review_submission(
    p_user_id,p_review_schedule_id,p_session_item_id,p_attempt_id,p_deletion_epoch,
    p_completion_idempotency_key,p_completed_at,p_calendar_date
  );
  select * into receipt_row from public.review_completion_receipts
    where user_id=p_user_id and review_schedule_id=p_review_schedule_id;
  perform set_config('app.v2_trusted_command','on',true);
  update public.review_schedules set status='completed',
    completion_receipt_id=receipt_row.id,
    completion_evidence_id=null,
    updated_at=p_completed_at
    where id=p_review_schedule_id and status in ('scheduled','due','overdue');
  perform set_config('app.v2_trusted_command','off',true);
  return result||jsonb_build_object(
    'receipt_id',receipt_row.id,'schedule_status','completed',
    'review_due_date',due_date,'policy_status','needs_policy'
  );
end;
$$;

create or replace function public.create_v2_validation_daily_session_secure_v2(
  p_user_id uuid,p_timezone text,p_calendar_date date,p_content_version_id uuid,
  p_focus_group_key text,p_plan_payload_sha256 text,p_items jsonb,p_program_version text,
  p_entitlement_id text,p_server_now timestamptz,p_installation_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $$
declare item jsonb; session_id uuid;
begin
  if p_entitlement_id is not null then
    raise exception using message='V2_VALIDATION_ENTITLEMENT_NOT_ALLOWED',errcode='23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) value
    where value->>'slotRole'='review'
      and not (
        value->>'promptRole' in ('transfer_word','sentence','practical_sentence')
        and value->>'selectionReason' in (
          'review_substitute_transfer_word','review_substitute_sentence',
          'review_substitute_practical_sentence'
        )
        and nullif(value->>'reviewScheduleId','') is null
        and nullif(value->>'reviewSourceEvidenceId','') is null
        and nullif(value->>'reviewDueDate','') is null
        and nullif(value->>'reviewIntervalKind','') is null
      )
  ) then
    raise exception using message='V2_VALIDATION_REVIEW_SUBSTITUTE_INVALID',errcode='23514';
  end if;

  -- The immutable v1 command cannot accept a substitute. Insert through the
  -- same isolated transaction here, preserving its exact ownership and trial
  -- exclusions while accepting only the explicit substitute shape above.
  perform public.lock_v2_user_mutation(p_user_id);
  if not exists (
    select 1 from public.content_versions c
    join public.v2_validation_content_access a on a.content_version_id=c.id
    where c.id=p_content_version_id and c.release_channel='development_validation'
      and c.validation_only and c.status='draft' and c.linguistic_reviewed_at is null
      and c.azure_validated_at is null and c.activated_at is null
      and a.user_id=p_user_id and a.installation_sha256=p_installation_sha256
      and a.revoked_at is null and (a.expires_at is null or a.expires_at>p_server_now)
  ) then raise exception using message='VALIDATION_TESTER_NOT_ALLOWED',errcode='42501'; end if;
  if jsonb_array_length(p_items)<>7
    or (select count(*) from jsonb_array_elements(p_items) value where (value->>'required')::boolean)<>5
    or (select count(*) from jsonb_array_elements(p_items) value where not (value->>'required')::boolean)<>2
  then raise exception using message='V2_PLAN_MUST_HAVE_FIVE_REQUIRED_AND_TWO_OPTIONAL',errcode='23514'; end if;

  select s.id into session_id from public.program_day_sessions s
    where s.user_id=p_user_id and s.status in ('planned','in_progress') for update;
  if session_id is not null then
    if exists (
      select 1 from public.program_day_sessions s where s.id=session_id
        and s.validation_only and s.content_version_id=p_content_version_id
        and s.plan_payload_sha256=p_plan_payload_sha256
        and s.validation_installation_sha256=p_installation_sha256
    ) then return jsonb_build_object('session_id',session_id,'replayed',true,'validation_only',true); end if;
    raise exception using message='V2_SESSION_NOT_AVAILABLE',errcode='23514';
  end if;

  insert into public.program_enrollments(user_id,program_version)
    values(p_user_id,p_program_version) on conflict(user_id) do nothing;
  insert into public.learning_deletion_epochs(user_id,current_epoch)
    values(p_user_id,0) on conflict(user_id) do nothing;

  insert into public.program_day_sessions(
    user_id,enrollment_id,learning_day_sequence,trial_program_day,originating_calendar_date,
    timezone,content_version_id,focus_group_key,required_item_count,optional_item_count,
    plan_payload_sha256,review_effective_calendar_date,validation_only,validation_installation_sha256
  ) select p_user_id,e.id,
      coalesce((select max(s.learning_day_sequence) from public.program_day_sessions s where s.user_id=p_user_id),0)+1,
      null,p_calendar_date,p_timezone,p_content_version_id,p_focus_group_key,5,2,
      p_plan_payload_sha256,p_calendar_date,true,p_installation_sha256
    from public.program_enrollments e where e.user_id=p_user_id
    returning id into session_id;

  for item in select value from jsonb_array_elements(p_items) loop
    if nullif(btrim(item->>'practiceItemKey'),'') is null
      or nullif(btrim(item->>'referenceText'),'') is null
      or nullif(btrim(item->>'referenceTextVersion'),'') is null
      or nullif(btrim(item->>'expectedFocusRepresentation'),'') is null
      or item->>'focusGroupKey' is distinct from p_focus_group_key
      or jsonb_typeof(item->'targetLocator')<>'object'
    then raise exception using message='V2_VALIDATION_MANAGED_ITEM_INVALID',errcode='22023'; end if;
    insert into public.program_session_items(
      user_id,session_id,position,content_version_id,practice_item_key,focus_group_key,
      prompt_role,slot_role,selection_reason,is_required,reference_text,reference_text_version,
      expected_focus_representation,next_action_key,target_locator,advice_version,coach_text,
      reference_audio_standard_url,reference_audio_slow_url,reference_audio_version,
      reference_audio_manifest_sha256
    ) values (
      p_user_id,session_id,(item->>'position')::smallint,p_content_version_id,
      item->>'practiceItemKey',item->>'focusGroupKey',item->>'promptRole',item->>'slotRole',
      item->>'selectionReason',(item->>'required')::boolean,item->>'referenceText',
      item->>'referenceTextVersion',item->>'expectedFocusRepresentation',
      nullif(item->>'nextActionKey',''),item->'targetLocator',nullif(item->>'adviceVersion','')::integer,
      nullif(item->>'coachText',''),nullif(item->>'referenceAudioStandardUrl',''),
      nullif(item->>'referenceAudioSlowUrl',''),nullif(item->>'referenceAudioVersion',''),
      nullif(item->>'referenceAudioManifestSha256','')
    );
  end loop;
  return jsonb_build_object('session_id',session_id,'replayed',false,'validation_only',true);
end;
$$;

create or replace function public.complete_v2_validation_session_secure_v2(
  p_user_id uuid,p_session_id uuid,p_completion_idempotency_key uuid,
  p_completion_payload_sha256 text,p_completed_at timestamptz,p_calendar_date date,
  p_installation_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  perform public.lock_v2_user_mutation(p_user_id);
  perform public.assert_v2_validation_installation(
    p_user_id,p_session_id,p_installation_sha256,p_completed_at
  );
  return public.complete_v2_validation_session_secure(
    p_user_id,p_session_id,p_completion_idempotency_key,
    p_completion_payload_sha256,p_completed_at,p_calendar_date
  );
end;
$$;

revoke all on function public.assert_v2_validation_installation(uuid,uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.issue_v2_assessment_ticket_v4(uuid,uuid,uuid,text,text,bigint,integer,integer,integer,integer,timestamptz,text,text) from public,anon,authenticated;
revoke all on function public.recover_v2_assessment_ticket_v2(uuid,uuid,text,timestamptz,text) from public,anon,authenticated;
revoke all on function public.cancel_v2_assessment_ticket_v2(uuid,uuid,text,timestamptz,text,text) from public,anon,authenticated;
revoke all on function public.persist_v2_attempt_v4(uuid,uuid,uuid,text,bigint,uuid,uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,date,text,text,text,text,text,text,boolean,boolean,text,text,numeric,text,text,jsonb,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.complete_v2_review_submission_v3(uuid,uuid,uuid,uuid,bigint,uuid,timestamptz,date) from public,anon,authenticated;
revoke all on function public.create_v2_validation_daily_session_secure_v2(uuid,text,date,uuid,text,text,jsonb,text,text,timestamptz,text) from public,anon,authenticated;
revoke all on function public.complete_v2_validation_session_secure_v2(uuid,uuid,uuid,text,timestamptz,date,text) from public,anon,authenticated;

grant execute on function public.assert_v2_validation_installation(uuid,uuid,text,timestamptz) to service_role;
grant execute on function public.issue_v2_assessment_ticket_v4(uuid,uuid,uuid,text,text,bigint,integer,integer,integer,integer,timestamptz,text,text) to service_role;
grant execute on function public.recover_v2_assessment_ticket_v2(uuid,uuid,text,timestamptz,text) to service_role;
grant execute on function public.cancel_v2_assessment_ticket_v2(uuid,uuid,text,timestamptz,text,text) to service_role;
grant execute on function public.persist_v2_attempt_v4(uuid,uuid,uuid,text,bigint,uuid,uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,date,text,text,text,text,text,text,boolean,boolean,text,text,numeric,text,text,jsonb,jsonb,text,text) to service_role;
grant execute on function public.complete_v2_review_submission_v3(uuid,uuid,uuid,uuid,bigint,uuid,timestamptz,date) to service_role;
grant execute on function public.create_v2_validation_daily_session_secure_v2(uuid,text,date,uuid,text,text,jsonb,text,text,timestamptz,text) to service_role;
grant execute on function public.complete_v2_validation_session_secure_v2(uuid,uuid,uuid,text,timestamptz,date,text) to service_role;

comment on function public.create_v2_validation_daily_session_secure_v2(uuid,text,date,uuid,text,text,jsonb,text,text,timestamptz,text) is
  'Service-only validation session command: exactly five required and two optional managed items, explicit review substitute, immutable audio/coach snapshots, no trial or durable evidence.';
comment on function public.complete_v2_review_submission_v3(uuid,uuid,uuid,uuid,bigint,uuid,timestamptz,date) is
  'Completes a due review using an immutable receipt for the actual valid review attempt. The basis evidence remains only the schedule origin and is never reused as completion evidence.';
