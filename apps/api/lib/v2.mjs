import {
  AZURE_V2_PROVIDER_PAYLOAD_MAX_BYTES,
  assertIanaTimeZone,
  assertUuid,
  calendarDateFromInstant,
  canonicalPayloadSha256,
  createDailyPlan,
  normalizeAzureFocusResult,
  resumeProgramDayPlan
} from "@pronunciation-mirror/core/v2";
import { randomUUID } from "node:crypto";

import { getApiEnv } from "./env.mjs";
import { ApiError, getBearerToken, ok, readJson, readJsonLimited } from "./http.mjs";

const V2_MODES = new Set(["off", "read_only", "learning"]);
const READ_ROUTES = new Set(["bootstrap", "access-status", "progress", "reports"]);
const V2_API_CONTRACT_VERSION = "2026-08-s6-07";
const ATTEMPT_REQUEST_ENVELOPE_BYTES = 2_048;
export const V2_ATTEMPT_REQUEST_MAX_BYTES = AZURE_V2_PROVIDER_PAYLOAD_MAX_BYTES + ATTEMPT_REQUEST_ENVELOPE_BYTES;

export function getV2Mode(env = process.env) {
  const value = env.OTOKAGAMI_V2_MODE ?? "off";
  return V2_MODES.has(value) ? value : "off";
}

export function assertV2Mode(mode, operation) {
  if (mode === "off") throw new ApiError("V2_DISABLED", "新しい学習機能は準備中です。", 503, false);
  if (operation === "write" && mode !== "learning") {
    throw new ApiError("V2_READ_ONLY", "新しい学習機能は読み取り専用です。", 403, false);
  }
}

export function createV2Repository(config, fetchImpl = fetch) {
  const restBase = `${config.supabaseUrl.replace(/\/$/, "")}/rest/v1`;
  const authBase = `${config.supabaseUrl.replace(/\/$/, "")}/auth/v1`;

  async function request(path, options = {}) {
    const response = await fetchImpl(`${restBase}${path}`, {
      ...options,
      headers: {
        apikey: config.supabaseServiceRoleKey,
        authorization: `Bearer ${config.supabaseServiceRoleKey}`,
        "content-type": "application/json",
        ...(options.headers ?? {})
      }
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw mapDatabaseError(body?.message, body?.code);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  return {
    async authenticate(accessToken) {
      const response = await fetchImpl(`${authBase}/user`, {
        headers: { apikey: config.supabaseAnonKey, authorization: `Bearer ${accessToken}` }
      });
      if (!response.ok) throw new ApiError("UNAUTHORIZED", "認証が必要です。", 401, false);
      const user = await response.json();
      if (typeof user?.id !== "string") throw new ApiError("UNAUTHORIZED", "認証が必要です。", 401, false);
      return { id: user.id };
    },
    async getEnrollment(userId) {
      const rows = await request(`/program_enrollments?user_id=eq.${encode(userId)}&select=*&limit=1`);
      return rows[0] ?? null;
    },
    async getDeletionEpoch(userId) {
      const rows = await request(`/learning_deletion_epochs?user_id=eq.${encode(userId)}&select=current_epoch&limit=1`);
      return rows[0]?.current_epoch ?? null;
    },
    async getSubscriptionAccess(userId, entitlementId, now) {
      const rows = await request(
        `/subscriptions?user_id=eq.${encode(userId)}&entitlement_id=eq.${encode(entitlementId)}&select=user_id,revenuecat_app_user_id,entitlement_id,status,is_active,current_period_ends_at&order=updated_at.desc&limit=1`
      );
      const row = rows[0];
      return Boolean(row && row.user_id === userId && row.revenuecat_app_user_id === userId &&
        row.entitlement_id === entitlementId && row.status === "active" && row.is_active === true &&
        typeof row.current_period_ends_at === "string" && Date.parse(row.current_period_ends_at) > now.getTime());
    },
    async getActiveContentVersion() {
      const rows = await request(
        "/content_versions?status=eq.active&assessment_locale=eq.en-US&coaching_locale=eq.ja-JP&select=*&order=activated_at.desc&limit=1"
      );
      return rows[0] ?? null;
    },
    async getActiveSession(userId) {
      const rows = await request(
        `/program_day_sessions?user_id=eq.${encode(userId)}&status=in.(planned,in_progress)&select=*&order=created_at.asc&limit=1`
      );
      if (!rows[0]) return null;
      return { ...rows[0], items: await this.listSessionItems(userId, rows[0].id) };
    },
    async getLatestCompletedSession(userId) {
      const rows = await request(
        `/program_day_sessions?user_id=eq.${encode(userId)}&status=eq.completed&select=id,learning_day_sequence,completed_calendar_date,timezone&order=learning_day_sequence.desc&limit=1`
      );
      return rows[0] ?? null;
    },
    async listSessionItems(userId, sessionId) {
      return request(
        `/program_session_items?user_id=eq.${encode(userId)}&session_id=eq.${encode(sessionId)}&select=*&order=position.asc`
      );
    },
    async getSessionItem(userId, itemId) {
      const rows = await request(`/program_session_items?user_id=eq.${encode(userId)}&id=eq.${encode(itemId)}&select=*&limit=1`);
      if (!rows[0]) return null;
      const sessions = await request(
        `/program_day_sessions?user_id=eq.${encode(userId)}&id=eq.${encode(rows[0].session_id)}&select=*&limit=1`
      );
      return sessions[0] ? { ...rows[0], session: sessions[0] } : null;
    },
    async createDailySession(command) {
      return request("/rpc/create_v2_daily_session_secure", {
        method: "POST",
        body: JSON.stringify(command)
      });
    },
    async refreshReviewSlot(command) {
      return request("/rpc/refresh_v2_review_slot_secure", { method: "POST", body: JSON.stringify(command) });
    },
    async persistAttempt(command) {
      return request("/rpc/persist_v2_attempt_with_ticket", { method: "POST", body: JSON.stringify(command) });
    },
    async issueAssessmentTicket(command) {
      return request("/rpc/issue_v2_assessment_ticket", { method: "POST", body: JSON.stringify(command) });
    },
    async completeSession(command) {
      return request("/rpc/complete_v2_program_day_secure", { method: "POST", body: JSON.stringify(command) });
    },
    async getProgress(userId) {
      const [enrollment, sessions, focusStates, reviews] = await Promise.all([
        this.getEnrollment(userId),
        request(`/program_day_sessions?user_id=eq.${encode(userId)}&select=id,learning_day_sequence,trial_program_day,status,originating_calendar_date,completed_calendar_date,focus_group_key&order=learning_day_sequence.asc`),
        request(`/focus_states_v2?user_id=eq.${encode(userId)}&select=*&order=focus_group_key.asc`),
        request(`/review_schedules?user_id=eq.${encode(userId)}&select=*&order=review_due_date.asc`)
      ]);
      return { enrollment, sessions, focus_states: focusStates, reviews };
    },
    async getReports(userId) {
      return request(`/learning_reports?user_id=eq.${encode(userId)}&select=*&order=created_at.desc`);
    }
  };
}

export function createEmptyV2ContentRepository() {
  return {
    async listFocusCandidates() { return []; },
    async listContentCandidates() { return []; },
    async listReviewSchedules() { return []; }
  };
}

export async function createV2Context({ request, env = process.env, fetchImpl = fetch, repository }) {
  const mode = getV2Mode(env);
  assertV2Mode(mode, "read");
  const config = getApiEnv(env);
  const repo = repository ?? createV2Repository(config, fetchImpl);
  const user = await repo.authenticate(getBearerToken(request));
  return { mode, config, repository: repo, user };
}

export async function getV2Access(repository, userId, config, now = new Date()) {
  const [enrollment, subscribed] = await Promise.all([
    repository.getEnrollment(userId),
    config.v2RevenueCatEntitlementId
      ? repository.getSubscriptionAccess(userId, config.v2RevenueCatEntitlementId, now)
      : Promise.resolve(false)
  ]);
  const completed = enrollment?.completed_program_days ?? 0;
  return {
    subscribed,
    trial_status: enrollment?.trial_status ?? "not_started",
    completed_active_learning_days: completed,
    can_start_learning: subscribed || completed < 7,
    requires_paywall: !subscribed && completed >= 7
  };
}

export async function v2Bootstrap(options) {
  const context = await createV2Context(options);
  const deletionEpoch = await context.repository.getDeletionEpoch(context.user.id);
  const contentVersion = await context.repository.getActiveContentVersion();
  return {
    mode: context.mode,
    minimumSupportedVersion: null,
    contractVersion: V2_API_CONTRACT_VERSION,
    normalizerVersion: "azure-en-us-focus-v2",
    contentVersion: contentVersion?.id ?? null,
    capabilities: { providerAttestation: false, appAttest: false, durableEvidence: false, shortening: false },
    deletionEpoch,
    access: await getV2Access(context.repository, context.user.id, context.config),
    enrollment: await context.repository.getEnrollment(context.user.id)
  };
}

export async function v2AccessStatus(options) {
  const context = await createV2Context(options);
  return getV2Access(context.repository, context.user.id, context.config);
}

export async function v2DailySession({
  request,
  env = process.env,
  fetchImpl = fetch,
  repository,
  contentRepository = createEmptyV2ContentRepository(),
  now = new Date()
}) {
  const context = await createV2Context({ request, env, fetchImpl, repository });
  const existing = await context.repository.getActiveSession(context.user.id);
  if (existing) {
    const calendarDate = calendarDateFromInstant(now, existing.timezone);
    const effectiveDate = existing.review_effective_calendar_date ?? existing.originating_calendar_date;
    if (calendarDate !== effectiveDate) {
      if (context.mode !== "learning") {
        return { session: sanitizeSession(existing), resumed: true, refresh_pending: true };
      }
      const contentVersion = await context.repository.getActiveContentVersion();
      if (contentVersion?.id === existing.content_version_id) {
        const [content, reviews] = await Promise.all([
          contentRepository.listContentCandidates({ contentVersion }),
          contentRepository.listReviewSchedules({ userId: context.user.id })
        ]);
        const resumedPlan = resumeProgramDayPlan({
          plan: sessionToDailyPlan(existing, effectiveDate),
          calendarDate,
          startedItemPositions: (existing.items ?? []).filter((item) => item.status !== "planned").map((item) => item.position),
          content,
          reviewSchedules: reviews
        });
        const oldReview = (existing.items ?? []).find((item) => item.slot_role === "review");
        const newReview = resumedPlan.requiredItems.find((item) => item.slotRole === "review");
        const source = newReview === undefined ? undefined : content.find(
          (candidate) => candidate.contentVersionId === existing.content_version_id && candidate.practiceItemKey === newReview.practiceItemKey
        );
        const selected = resumedPlan.selectedReview;
        const changed = oldReview !== undefined && newReview !== undefined && source !== undefined &&
          (oldReview.practice_item_key !== newReview.practiceItemKey || oldReview.focus_group_key !== newReview.focusGroupKey);
        if (changed && (!source.referenceText || !source.referenceTextVersion || !source.expectedFocusRepresentation)) {
          throw new ApiError("CONTENT_NOT_READY", "学習コンテンツは準備中です。", 503, false);
        }
        await context.repository.refreshReviewSlot({
          p_user_id: context.user.id,
          p_session_id: existing.id,
          p_entitlement_id: context.config.v2RevenueCatEntitlementId,
          p_server_now: now.toISOString(),
          p_calendar_date: calendarDate,
          p_review_item: changed ? {
            practiceItemKey: newReview.practiceItemKey,
            focusGroupKey: newReview.focusGroupKey,
            promptRole: newReview.promptRole,
            selectionReason: newReview.selectionReason,
            reviewScheduleId: selected?.id ?? null,
            reviewSourceEvidenceId: selected?.basedOnEvidenceId ?? null,
            reviewDueDate: selected?.dueDate ?? null,
            referenceText: source.referenceText,
            referenceTextVersion: source.referenceTextVersion,
            expectedFocusRepresentation: source.expectedFocusRepresentation,
            targetLocator: source.targetLocator,
            nextActionKey: source.nextActionKey ?? null,
            adviceVersion: source.adviceVersion ?? null
          } : null
        });
        const refreshed = await context.repository.getActiveSession(context.user.id);
        if (refreshed) return { session: sanitizeSession(refreshed), resumed: true };
      }
    }
    return { session: sanitizeSession(existing), resumed: true };
  }
  assertV2Mode(context.mode, "write");
  const access = await getV2Access(context.repository, context.user.id, context.config, now);
  if (!access.can_start_learning) throw new ApiError("ACCESS_REQUIRED", "学習を続けるには購読が必要です。", 402, false);
  const body = await readJson(request);
  assertAllowedKeys(body, ["timezone"]);
  const timezone = typeof body?.timezone === "string" ? body.timezone : "";
  try { assertIanaTimeZone(timezone); } catch { throw new ApiError("INVALID_TIMEZONE", "タイムゾーンが不正です。", 400, false); }
  const contentVersion = await context.repository.getActiveContentVersion();
  if (!contentVersion) throw new ApiError("CONTENT_NOT_READY", "学習コンテンツは準備中です。", 503, false);
  const [focusCandidates, content, reviews] = await Promise.all([
    contentRepository.listFocusCandidates({ userId: context.user.id, contentVersion }),
    contentRepository.listContentCandidates({ contentVersion }),
    contentRepository.listReviewSchedules({ userId: context.user.id })
  ]);
  const previousSession = await context.repository.getLatestCompletedSession(context.user.id);
  if (previousSession) {
    const previousCalendarNow = calendarDateFromInstant(now, previousSession.timezone);
    if (previousCalendarNow <= previousSession.completed_calendar_date) {
      throw new ApiError("CALENDAR_DATE_NOT_ADVANCED", "次の学習日はまだ開始できません。", 409, false);
    }
  }
  const enrollment = await context.repository.getEnrollment(context.user.id);
  const planResult = createDailyPlan({
    learningDaySequence: (previousSession?.learning_day_sequence ?? 0) + 1,
    trialProgramDay: (enrollment?.completed_program_days ?? 0) < 7
      ? /** @type {1|2|3|4|5|6|7} */ ((enrollment?.completed_program_days ?? 0) + 1)
      : undefined,
    contentVersionId: contentVersion.id,
    calendarDate: calendarDateFromInstant(now, timezone),
    focusCandidates,
    content,
    reviewSchedules: reviews
  });
  if (planResult.status !== "ok") throw new ApiError("CONTENT_NOT_READY", "学習コンテンツは準備中です。", 503, false);
  const allItems = [...planResult.plan.requiredItems, ...planResult.plan.optionalItems];
  const planned = allItems.map((item) => {
    const source = content.find((candidate) => candidate.practiceItemKey === item.practiceItemKey);
    if (!source?.referenceText || !source.referenceTextVersion || !source.expectedFocusRepresentation || !source.targetLocator) {
      throw new ApiError("CONTENT_NOT_READY", "学習コンテンツは準備中です。", 503, false);
    }
    return {
      position: item.position,
      slotRole: item.slotRole,
      promptRole: item.promptRole,
      practiceItemKey: item.practiceItemKey,
      focusGroupKey: item.focusGroupKey,
      selectionReason: item.selectionReason,
      required: item.required,
      reviewDueDate: planResult.plan.selectedReview !== undefined &&
        planResult.plan.selectedReview.id === item.reviewScheduleId
        ? planResult.plan.selectedReview.dueDate
        : null,
      referenceText: source.referenceText,
      referenceTextVersion: source.referenceTextVersion,
      expectedFocusRepresentation: source.expectedFocusRepresentation,
      targetLocator: source.targetLocator,
      nextActionKey: source.nextActionKey ?? null,
      adviceVersion: source.adviceVersion ?? null
    };
  });
  const result = await context.repository.createDailySession({
    p_user_id: context.user.id,
    p_timezone: timezone,
    p_calendar_date: planResult.plan.originatingCalendarDate,
    p_content_version_id: contentVersion.id,
    p_focus_group_key: planResult.plan.focusGroupKey,
    p_plan_payload_sha256: canonicalPayloadSha256(planned),
    p_items: planned,
    p_program_version: `${contentVersion.stable_release_id}:${contentVersion.version}`,
    p_entitlement_id: context.config.v2RevenueCatEntitlementId,
    p_server_now: now.toISOString()
  });
  const created = await context.repository.getActiveSession(context.user.id);
  if (!created) throw new ApiError("SESSION_CREATE_FAILED", "学習の開始に失敗しました。", 502, true);
  return { session: sanitizeSession(created), resumed: Boolean(result?.replayed) };
}

export async function v2SpeechToken({ request, env = process.env, fetchImpl = fetch, repository, now = new Date() }) {
  const context = await createV2Context({ request, env, fetchImpl, repository });
  assertV2Mode(context.mode, "write");
  const access = await getV2Access(context.repository, context.user.id, context.config, now);
  if (!access.can_start_learning) throw new ApiError("ACCESS_REQUIRED", "学習を続けるには購読が必要です。", 402, false);
  const body = await readJson(request);
  assertAllowedKeys(body, ["session_item_id", "attempt_purpose"]);
  assertUuidOrBadRequest(body?.session_item_id, "session_item_id");
  const purpose = body.attempt_purpose ?? "initial";
  if (!new Set(["initial", "guided_retry"]).has(purpose)) throw new ApiError("BAD_REQUEST", "attempt_purposeが不正です。", 400, false);
  const item = await context.repository.getSessionItem(context.user.id, body.session_item_id);
  if (!item || !["planned", "in_progress"].includes(item.session.status) || !item.reference_text || !item.target_locator) {
    throw new ApiError("SESSION_ITEM_NOT_AVAILABLE", "この課題は利用できません。", 404, false);
  }
  if (!context.config.v2AssessmentTicketTtlSeconds || !context.config.v2TicketRateLimitWindowSeconds || !context.config.v2TicketRateLimitMax) {
    throw new ApiError("SERVER_ENV_MISSING", "v2 assessment ticket設定が未設定です。", 500, false);
  }
  if (!context.config.azureSpeechKey || !context.config.azureSpeechRegion) {
    throw new ApiError("AZURE_SPEECH_CONFIG_MISSING", "Azure Speech設定が未設定です。", 500, false);
  }
  let token;
  if (context.config.azureAssessmentMode === "mock") {
    token = "mock-speech-token";
  } else {
    let response;
    try {
      response = await fetchImpl(`https://${context.config.azureSpeechRegion}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": "0",
          "Ocp-Apim-Subscription-Key": context.config.azureSpeechKey
        },
        body: ""
      });
    } catch {
      throw new ApiError("AZURE_TOKEN_UNAVAILABLE", "発音判定の準備に失敗しました。", 502, true);
    }
    if (!response.ok) throw new ApiError("AZURE_TOKEN_UNAVAILABLE", "発音判定の準備に失敗しました。", 502, true);
    token = (await response.text()).trim();
    if (!token) throw new ApiError("AZURE_TOKEN_UNAVAILABLE", "発音判定の準備に失敗しました。", 502, true);
  }
  const nonce = randomUUID();
  const deletionEpoch = await context.repository.getDeletionEpoch(context.user.id);
  if (!Number.isSafeInteger(deletionEpoch) || deletionEpoch < 0) {
    throw new ApiError("DELETION_EPOCH_REQUIRED", "学習データ境界を確認できません。", 409, false);
  }
  const ticket = await context.repository.issueAssessmentTicket({
    p_user_id: context.user.id,
    p_session_item_id: item.id,
    p_attempt_purpose: purpose,
    p_nonce_sha256: canonicalPayloadSha256(nonce),
    p_deletion_epoch: deletionEpoch,
    p_ttl_seconds: context.config.v2AssessmentTicketTtlSeconds,
    p_rate_window_seconds: context.config.v2TicketRateLimitWindowSeconds,
    p_rate_limit_max: context.config.v2TicketRateLimitMax,
    p_issued_at: now.toISOString(),
    p_entitlement_id: context.config.v2RevenueCatEntitlementId
  });
  return {
    token,
    region: context.config.azureSpeechRegion,
    locale: "en-US",
    reference_text: item.reference_text,
    session_item_id: item.id,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    assessment_ticket: { id: ticket.ticket_id, nonce, expires_at: ticket.expires_at, deletion_epoch: deletionEpoch }
  };
}

export async function v2PersistAttempt({ request, env = process.env, fetchImpl = fetch, repository, now = new Date() }) {
  const context = await createV2Context({ request, env, fetchImpl, repository });
  assertV2Mode(context.mode, "write");
  const access = await getV2Access(context.repository, context.user.id, context.config, now);
  if (!access.can_start_learning) throw new ApiError("ACCESS_REQUIRED", "学習を続けるには購読が必要です。", 402, false);
  const body = await readJsonLimited(request, V2_ATTEMPT_REQUEST_MAX_BYTES);
  assertAllowedKeys(body, ["session_item_id", "client_attempt_id", "assessment_ticket_id", "assessment_ticket_nonce", "deletion_epoch", "provider_result"]);
  assertUuidOrBadRequest(body?.session_item_id, "session_item_id");
  assertUuidOrBadRequest(body?.client_attempt_id, "client_attempt_id");
  if (body?.assessment_ticket_id == null || body?.assessment_ticket_nonce == null) {
    throw new ApiError("ASSESSMENT_TICKET_REQUIRED", "判定チケットが必要です。", 400, false);
  }
  assertUuidOrBadRequest(body.assessment_ticket_id, "assessment_ticket_id");
  assertUuidOrBadRequest(body.assessment_ticket_nonce, "assessment_ticket_nonce");
  if (!Number.isSafeInteger(body?.deletion_epoch) || body.deletion_epoch < 0) throw new ApiError("BAD_REQUEST", "deletion_epochが不正です。", 400, false);
  const currentEpoch = await context.repository.getDeletionEpoch(context.user.id);
  if (!Number.isSafeInteger(currentEpoch) || currentEpoch !== body.deletion_epoch) {
    throw new ApiError("DELETION_EPOCH_CONFLICT", "学習データ境界が更新されています。", 409, false);
  }
  const item = await context.repository.getSessionItem(context.user.id, body.session_item_id);
  if (!item) throw new ApiError("SESSION_ITEM_NOT_AVAILABLE", "この課題は利用できません。", 404, false);
  let normalized;
  try {
    normalized = normalizeAzureFocusResult({
      providerPayload: body.provider_result,
      referenceText: item.reference_text,
      contentVersionId: item.content_version_id,
      practiceItemKey: item.practice_item_key,
      targetLocator: item.target_locator,
      expectedFocusRepresentation: item.expected_focus_representation,
      referenceTextVersion: item.reference_text_version,
      nextActionKey: item.next_action_key ?? undefined,
      assessmentLocale: "en-US",
      payloadByteLimit: AZURE_V2_PROVIDER_PAYLOAD_MAX_BYTES
    });
  } catch (error) {
    if (error instanceof RangeError && /exceeds the measured fixture limit/.test(error.message)) {
      throw new ApiError("PROVIDER_PAYLOAD_TOO_LARGE", "判定結果が大きすぎます。", 413, false);
    }
    if (error instanceof TypeError || error instanceof RangeError) {
      throw new ApiError("BAD_REQUEST", "判定結果の形式が不正です。", 400, false);
    }
    throw error;
  }
  const canonical = {
    sessionItemId: item.id,
    clientAttemptId: body.client_attempt_id,
    assessmentTicketId: body.assessment_ticket_id,
    deletionEpoch: body.deletion_epoch,
    normalized
  };
  const attemptedAt = now.toISOString();
  const result = await context.repository.persistAttempt({
    p_user_id: context.user.id,
    p_session_item_id: item.id,
    p_client_attempt_id: body.client_attempt_id,
    p_payload_sha256: canonicalPayloadSha256(canonical),
    p_deletion_epoch: body.deletion_epoch,
    p_assessment_ticket_id: body.assessment_ticket_id,
    p_ticket_nonce_sha256: canonicalPayloadSha256(body.assessment_ticket_nonce),
    p_attempted_at: attemptedAt,
    p_calendar_date: calendarDateFromInstant(attemptedAt, item.session.timezone),
    p_timezone: item.session.timezone,
    p_provider: normalized.provider,
    p_assessment_locale: normalized.assessmentLocale,
    p_provider_version: null,
    p_normalizer_version: normalized.normalizerVersion,
    p_normalization_status: normalized.normalizationStatus,
    p_provider_attested: normalized.providerAttested,
    p_technical_valid: normalized.technicalValid,
    p_invalid_reason: normalized.invalidReason,
    p_observed_candidate: normalized.observedCandidate,
    p_target_score: normalized.targetScore,
    p_result_label: normalized.resultLabel,
    p_next_action_key: normalized.nextActionKey,
    p_capability_flags: normalized.capabilityFlags,
    p_normalized_detail: normalized.normalizedDetail,
    p_entitlement_id: context.config.v2RevenueCatEntitlementId
  });
  return { ...result, result: normalized };
}

export async function v2CompleteSession({ request, env = process.env, fetchImpl = fetch, repository, now = new Date() }) {
  const context = await createV2Context({ request, env, fetchImpl, repository });
  assertV2Mode(context.mode, "write");
  const body = await readJson(request);
  assertAllowedKeys(body, ["session_id", "completion_idempotency_key"]);
  assertUuidOrBadRequest(body?.session_id, "session_id");
  assertUuidOrBadRequest(body?.completion_idempotency_key, "completion_idempotency_key");
  const session = await context.repository.getActiveSession(context.user.id);
  if (!session || session.id !== body.session_id) throw new ApiError("SESSION_NOT_AVAILABLE", "学習セッションが見つかりません。", 404, false);
  const completedAt = now.toISOString();
  const calendarDate = calendarDateFromInstant(completedAt, session.timezone);
  const payloadHash = canonicalPayloadSha256({ sessionId: session.id, completionIdempotencyKey: body.completion_idempotency_key });
  return context.repository.completeSession({
    p_user_id: context.user.id,
    p_session_id: session.id,
    p_completion_idempotency_key: body.completion_idempotency_key,
    p_completion_payload_sha256: payloadHash,
    p_completed_at: completedAt,
    p_calendar_date: calendarDate,
    p_entitlement_id: context.config.v2RevenueCatEntitlementId
  });
}

export async function v2Progress(options) {
  const context = await createV2Context(options);
  return context.repository.getProgress(context.user.id);
}

export async function v2Reports(options) {
  const context = await createV2Context(options);
  const enrollment = await context.repository.getEnrollment(context.user.id);
  return { day_7_report_status: enrollment?.day_7_report_status ?? "not_started", reports: await context.repository.getReports(context.user.id) };
}

export async function handleV2(kind, options) {
  const operation = READ_ROUTES.has(kind) ? kind : kind;
  let data;
  switch (operation) {
    case "bootstrap": data = await v2Bootstrap(options); break;
    case "access-status": data = await v2AccessStatus(options); break;
    case "daily-session": data = await v2DailySession(options); break;
    case "speech-token": data = await v2SpeechToken(options); break;
    case "attempts": data = await v2PersistAttempt(options); break;
    case "session-completion": data = await v2CompleteSession(options); break;
    case "progress": data = await v2Progress(options); break;
    case "reports": data = await v2Reports(options); break;
    default: throw new ApiError("NOT_FOUND", "APIが見つかりません。", 404, false);
  }
  return ok(data, { headers: { "Cache-Control": "no-store, private", Pragma: "no-cache" } });
}

function sanitizeSession(session) {
  return {
    id: session.id,
    learning_day_sequence: session.learning_day_sequence,
    trial_program_day: session.trial_program_day,
    originating_calendar_date: session.originating_calendar_date,
    timezone: session.timezone,
    focus_group_key: session.focus_group_key,
    status: session.status,
    current_position: session.current_position,
    items: (session.items ?? []).map((item) => ({
      id: item.id,
      position: item.position,
      slot_role: item.slot_role,
      prompt_role: item.prompt_role,
      practice_item_key: item.practice_item_key,
      focus_group_key: item.focus_group_key,
      required: item.is_required,
      status: item.status,
      reference_text: item.reference_text,
      expected_focus_representation: item.expected_focus_representation,
      target_locator: item.target_locator,
      next_action_key: item.next_action_key
    }))
  };
}

function sessionToDailyPlan(session, effectiveCalendarDate) {
  const plannedItems = (session.items ?? []).map((item) => ({
    position: item.position,
    slotRole: item.slot_role,
    promptRole: item.prompt_role,
    contentVersionId: item.content_version_id,
    practiceItemKey: item.practice_item_key,
    focusGroupKey: item.focus_group_key,
    required: item.is_required,
    reviewScheduleId: item.review_source_evidence_id ?? undefined,
    selectionReason: item.selection_reason
  }));
  return {
    learningDaySequence: session.learning_day_sequence,
    trialProgramDay: session.trial_program_day ?? undefined,
    contentVersionId: session.content_version_id,
    originatingCalendarDate: session.originating_calendar_date,
    effectiveCalendarDate,
    focusGroupKey: session.focus_group_key,
    requiredCount: 5,
    requiredItems: plannedItems.filter((item) => item.required),
    optionalItems: plannedItems.filter((item) => !item.required)
  };
}

function mapDatabaseError(message, code) {
  const known = {
    CONTENT_NOT_READY: ["CONTENT_NOT_READY", 503, false],
    ACCESS_REQUIRED: ["ACCESS_REQUIRED", 402, false],
    IDEMPOTENCY_PAYLOAD_CONFLICT: ["IDEMPOTENCY_CONFLICT", 409, false],
    DELETION_EPOCH_CONFLICT: ["DELETION_EPOCH_CONFLICT", 409, false],
    VALID_ATTEMPT_LIMIT_REACHED: ["VALID_ATTEMPT_LIMIT_REACHED", 409, false],
    REQUIRED_ITEMS_INCOMPLETE: ["REQUIRED_ITEMS_INCOMPLETE", 409, false],
    SHORTENING_POLICY_NOT_READY: ["SHORTENING_POLICY_NOT_READY", 409, false],
    CALENDAR_DATE_ALREADY_COMPLETED: ["CALENDAR_DATE_ALREADY_COMPLETED", 409, false],
    ASSESSMENT_TICKET_INVALID: ["ASSESSMENT_TICKET_INVALID", 409, false],
    ASSESSMENT_TICKET_BINDING_MISMATCH: ["ASSESSMENT_TICKET_INVALID", 409, false],
    UNCONSUMED_TICKET_EXISTS: ["ASSESSMENT_TICKET_ALREADY_ISSUED", 409, false],
    TICKET_RATE_LIMITED: ["TICKET_RATE_LIMITED", 429, true],
    OPTIONAL_EXTENSION_NOT_AVAILABLE: ["OPTIONAL_EXTENSION_NOT_AVAILABLE", 409, false],
    NEXT_LEARNING_DAY_NOT_AVAILABLE: ["NEXT_LEARNING_DAY_NOT_AVAILABLE", 409, false],
    DELETION_EPOCH_REQUIRED: ["DELETION_EPOCH_REQUIRED", 409, false]
  };
  const mapped = known[message];
  if (mapped) return new ApiError(mapped[0], "学習状態を更新できませんでした。", mapped[1], mapped[2]);
  return new ApiError("DATABASE_OPERATION_FAILED", "学習状態を更新できませんでした。", code === "42501" ? 403 : 502, true);
}

function assertAllowedKeys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError("BAD_REQUEST", "リクエスト本文が不正です。", 400, false);
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unexpected) throw new ApiError("BAD_REQUEST", "許可されていない入力です。", 400, false);
}

function assertUuidOrBadRequest(value, field) {
  try { assertUuid(value, field); } catch { throw new ApiError("BAD_REQUEST", `${field}が不正です。`, 400, false); }
}

function encode(value) {
  return encodeURIComponent(value).replaceAll(".", "%2E");
}
