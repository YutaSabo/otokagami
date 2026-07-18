import { ApiError } from "./http.mjs";

const PROFILE_SELECT =
  "user_id,anon_public_id,native_language,target_accent,free_trial_started_at,timezone,free_text_consent_version,free_text_consented_at";
const INSTALLATION_SELECT = "id,device_install_id_hash,user_id,first_seen_at,last_seen_at";
const SUBSCRIPTION_SELECT =
  "id,user_id,revenuecat_app_user_id,entitlement_id,product_id,status,is_active,current_period_started_at,current_period_ends_at,latest_event_at,raw_event";
const PHONEME_SELECT = "phoneme_id,ipa,category,example_word,ja_difficulty,sort_order,is_active";
const PHONEME_STATE_SELECT =
  "user_id,phoneme_id,mastery_ewma,practice_count,last_practiced_date,next_review_date,review_stage";
const PRACTICE_ITEM_SELECT =
  "practice_item_id,item_type,text,normalized_text,expected_ipa,accent,ja_difficulty,source,is_active";
const PRACTICE_ITEM_TARGET_SELECT = "practice_item_id,target_type,target_id";
const DAILY_SESSION_SELECT = "id,user_id,session_date,timezone,status,completed_count,created_at,completed_at";
const DAILY_SESSION_ITEM_SELECT =
  "id,daily_session_id,position,slot_type,practice_item_id,target_phoneme_ids,selection_reason,status,best_attempt_id,completed_at";
const ATTEMPT_SELECT =
  "id,user_id,daily_session_id,daily_session_item_id,practice_item_id,practice_mode,attempt_no,practiced_at,practiced_date,timezone,target_phoneme_ids,overall_score,target_score_avg,is_correct,is_perfect,is_best,azure_raw_json,app_version,device_info,created_at";
const ATTEMPT_PHONEME_RESULT_SELECT =
  "id,attempt_id,index,word_index,expected_phoneme_id,expected_ipa,observed_phoneme_id,observed_ipa,score,color,is_target,confusion_pair_id";
const PHONEME_SNAPSHOT_SELECT = "user_id,snapshot_date,phoneme_id,mastery_ewma,created_at,updated_at";
const USER_BADGE_SELECT = "user_id,badge_id,awarded_at,metadata";
const USER_BOOKMARK_SELECT = "id,user_id,bookmark_type,phoneme_id,practice_item_id,free_text,created_at";
const FREE_ATTEMPT_SELECT =
  "id,user_id,attempted_at,attempted_date,timezone,input_text,normalized_text,ipa_result,oov_words,conversion_confidence,phoneme_scores,word_scores,overall_score,azure_raw_json,native_language,target_accent,pii_flag,consent_version,app_version,device_info";
const ADVICE_FEEDBACK_SELECT = "id,user_id,attempt_id,free_attempt_id,advice_id,rating,created_at";
const TTS_CACHE_SELECT =
  "cache_key,text_hash,normalized_text,accent,speed,storage_path,duration_ms,created_at,last_used_at";
const ADVICE_PAGE_SELECT =
  "advice_id,confusion_pair_id,generic_advice_id,native_language,target_accent,title,short_tip,comparison_text,coach_example_text,asset_id,is_template,is_active";
const AI_ADVICE_CACHE_SELECT =
  "cache_key,native_language,target_accent,confusion_pair_id,generic_advice_id,prompt_version,output_text,created_at,last_used_at";

function encodeQueryValue(value) {
  return encodeURIComponent(value).replaceAll(".", "%2E");
}

export function createSupabaseRestClient(config, fetchImpl = fetch) {
  const restBaseUrl = `${config.supabaseUrl.replace(/\/$/, "")}/rest/v1`;
  const authBaseUrl = `${config.supabaseUrl.replace(/\/$/, "")}/auth/v1`;

  async function request(path, options = {}) {
    const response = await fetchImpl(`${restBaseUrl}${path}`, {
      ...options,
      headers: {
        apikey: config.supabaseServiceRoleKey,
        authorization: `Bearer ${config.supabaseServiceRoleKey}`,
        "content-type": "application/json",
        ...(options.headers ?? {})
      }
    });

    if (!response.ok) {
      // Retain only operational metadata for server-side diagnostics. Never retain a
      // response body, query values, access token, or user-provided content.
      const payload = await response.json().catch(() => null);
      const databaseCode = typeof payload?.code === "string" ? payload.code : null;
      const databaseCategory = databaseCode?.startsWith("23")
        ? "constraint"
        : databaseCode?.startsWith("42")
          ? "schema"
          : response.status === 401 || response.status === 403
            ? "authorization"
            : "request";
      throw new ApiError("SUPABASE_REQUEST_FAILED", "データベース処理に失敗しました。", 502, true, {
        status: response.status,
        operation: `${options.method ?? "GET"} ${path.split("?")[0]}`,
        database_code: databaseCode,
        database_category: databaseCategory
      });
    }

    if (response.status === 204) return null;
    return response.json();
  }

  async function getAuthenticatedUser(accessToken) {
    const response = await fetchImpl(`${authBaseUrl}/user`, {
      headers: {
        apikey: config.supabaseAnonKey,
        authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new ApiError("UNAUTHORIZED", "認証が必要です。", 401, false);
    }

    const user = await response.json();
    if (!user?.id) {
      throw new ApiError("UNAUTHORIZED", "認証が必要です。", 401, false);
    }

    return user;
  }

  async function getProfile(userId) {
    const rows = await request(`/profiles?user_id=eq.${encodeQueryValue(userId)}&select=${PROFILE_SELECT}&limit=1`);
    return rows[0] ?? null;
  }

  async function createProfile(profile) {
    const rows = await request("/profiles", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(profile)
    });
    return rows[0];
  }

  async function updateProfile(userId, patch) {
    const rows = await request(`/profiles?user_id=eq.${encodeQueryValue(userId)}&select=${PROFILE_SELECT}`, {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(patch)
    });
    return rows[0] ?? null;
  }

  async function getInstallationByHash(deviceInstallIdHash) {
    const rows = await request(
      `/installations?device_install_id_hash=eq.${encodeQueryValue(deviceInstallIdHash)}&select=${INSTALLATION_SELECT}&limit=1`
    );
    return rows[0] ?? null;
  }

  async function createInstallation(installation) {
    const rows = await request("/installations", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(installation)
    });
    return rows[0];
  }

  async function touchInstallation(id, seenAt) {
    const rows = await request(`/installations?id=eq.${encodeQueryValue(id)}&select=${INSTALLATION_SELECT}`, {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ last_seen_at: seenAt })
    });
    return rows[0];
  }

  async function listActiveSubscriptions(userId) {
    return request(
      `/subscriptions?user_id=eq.${encodeQueryValue(userId)}&is_active=eq.true&select=${SUBSCRIPTION_SELECT}&order=latest_event_at.desc.nullslast`
    );
  }

  async function listActivePhonemes() {
    return request(`/phonemes?is_active=eq.true&select=${PHONEME_SELECT}&order=sort_order.asc`);
  }

  async function listPhonemeStates(userId) {
    return request(
      `/phoneme_state?user_id=eq.${encodeQueryValue(userId)}&select=${PHONEME_STATE_SELECT}&order=phoneme_id.asc`
    );
  }

  async function listActivePracticeItems() {
    return request(
      `/practice_items?is_active=eq.true&accent=eq.US&select=${PRACTICE_ITEM_SELECT}&order=practice_item_id.asc`
    );
  }

  async function listPracticeItemTargets(practiceItemIds) {
    if (practiceItemIds.length === 0) return [];
    return request(
      `/practice_item_targets?practice_item_id=in.(${practiceItemIds
        .map(encodeQueryValue)
        .join(",")})&target_type=eq.phoneme&select=${PRACTICE_ITEM_TARGET_SELECT}`
    );
  }

  async function getPracticeItem(practiceItemId) {
    const rows = await request(
      `/practice_items?practice_item_id=eq.${encodeQueryValue(
        practiceItemId
      )}&is_active=eq.true&select=${PRACTICE_ITEM_SELECT}&limit=1`
    );
    return rows[0] ?? null;
  }

  async function getDailySession(userId, sessionDate) {
    const rows = await request(
      `/daily_sessions?user_id=eq.${encodeQueryValue(userId)}&session_date=eq.${encodeQueryValue(
        sessionDate
      )}&select=${DAILY_SESSION_SELECT}&limit=1`
    );
    return rows[0] ?? null;
  }

  async function listDailySessions(userId) {
    return request(
      `/daily_sessions?user_id=eq.${encodeQueryValue(userId)}&select=${DAILY_SESSION_SELECT}&order=session_date.asc`
    );
  }

  async function createDailySession(session) {
    const rows = await request("/daily_sessions", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(session)
    });
    return rows[0];
  }

  async function listDailySessionItems(dailySessionId) {
    return request(
      `/daily_session_items?daily_session_id=eq.${encodeQueryValue(
        dailySessionId
      )}&select=${DAILY_SESSION_ITEM_SELECT}&order=position.asc`
    );
  }

  async function listDailySessionItemsForSessions(dailySessionIds) {
    if (dailySessionIds.length === 0) return [];
    return request(
      `/daily_session_items?daily_session_id=in.(${dailySessionIds
        .map(encodeQueryValue)
        .join(",")})&select=${DAILY_SESSION_ITEM_SELECT}&order=position.asc`
    );
  }

  async function getDailySessionById(dailySessionId) {
    const rows = await request(
      `/daily_sessions?id=eq.${encodeQueryValue(dailySessionId)}&select=${DAILY_SESSION_SELECT}&limit=1`
    );
    return rows[0] ?? null;
  }

  async function updateDailySession(id, patch) {
    const rows = await request(`/daily_sessions?id=eq.${encodeQueryValue(id)}&select=${DAILY_SESSION_SELECT}`, {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(patch)
    });
    return rows[0] ?? null;
  }

  async function getDailySessionItem(dailySessionItemId) {
    const rows = await request(
      `/daily_session_items?id=eq.${encodeQueryValue(dailySessionItemId)}&select=${DAILY_SESSION_ITEM_SELECT}&limit=1`
    );
    return rows[0] ?? null;
  }

  async function updateDailySessionItem(id, patch) {
    const rows = await request(`/daily_session_items?id=eq.${encodeQueryValue(id)}&select=${DAILY_SESSION_ITEM_SELECT}`, {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(patch)
    });
    return rows[0] ?? null;
  }

  async function createDailySessionItems(items) {
    if (items.length === 0) return [];
    return request("/daily_session_items", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(items)
    });
  }

  async function getTtsCache(cacheKey) {
    const rows = await request(
      `/tts_cache?cache_key=eq.${encodeQueryValue(cacheKey)}&select=${TTS_CACHE_SELECT}&limit=1`
    );
    return rows[0] ?? null;
  }

  async function createTtsCache(cache) {
    const rows = await request("/tts_cache", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(cache)
    });
    return rows[0];
  }

  async function touchTtsCache(cacheKey, lastUsedAt) {
    const rows = await request(`/tts_cache?cache_key=eq.${encodeQueryValue(cacheKey)}&select=${TTS_CACHE_SELECT}`, {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ last_used_at: lastUsedAt })
    });
    return rows[0] ?? null;
  }

  async function getAdvicePage(adviceId) {
    const rows = await request(
      `/advice_pages?advice_id=eq.${encodeQueryValue(adviceId)}&is_active=eq.true&select=${ADVICE_PAGE_SELECT}&limit=1`
    );
    return rows[0] ?? null;
  }

  async function getAiAdviceCache(cacheKey) {
    const rows = await request(
      `/ai_advice_cache?cache_key=eq.${encodeQueryValue(cacheKey)}&select=${AI_ADVICE_CACHE_SELECT}&limit=1`
    );
    return rows[0] ?? null;
  }

  async function createAiAdviceCache(cache) {
    const rows = await request("/ai_advice_cache", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(cache)
    });
    return rows[0];
  }

  async function touchAiAdviceCache(cacheKey, lastUsedAt) {
    const rows = await request(
      `/ai_advice_cache?cache_key=eq.${encodeQueryValue(cacheKey)}&select=${AI_ADVICE_CACHE_SELECT}`,
      {
        method: "PATCH",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({ last_used_at: lastUsedAt })
      }
    );
    return rows[0] ?? null;
  }

  async function createAttempt(attempt) {
    const rows = await request("/attempts", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(attempt)
    });
    return rows[0];
  }

  async function createAttemptPhonemeResults(results) {
    if (results.length === 0) return [];
    return request("/attempt_phoneme_results", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(results)
    });
  }

  async function listAttemptPhonemeResults(attemptId) {
    return request(
      `/attempt_phoneme_results?attempt_id=eq.${encodeQueryValue(
        attemptId
      )}&select=${ATTEMPT_PHONEME_RESULT_SELECT}&order=index.asc`
    );
  }

  async function listAttemptsByDailySessionItem(userId, dailySessionItemId) {
    return request(
      `/attempts?user_id=eq.${encodeQueryValue(userId)}&daily_session_item_id=eq.${encodeQueryValue(
        dailySessionItemId
      )}&select=${ATTEMPT_SELECT}&order=attempt_no.asc`
    );
  }

  async function listAttemptsByPracticeItem(userId, practiceItemId, practiceMode) {
    return request(
      `/attempts?user_id=eq.${encodeQueryValue(userId)}&practice_item_id=eq.${encodeQueryValue(
        practiceItemId
      )}&practice_mode=eq.${encodeQueryValue(practiceMode)}&select=${ATTEMPT_SELECT}&order=attempt_no.asc`
    );
  }

  async function updateAttemptsIsBest(attemptIds, isBest) {
    if (attemptIds.length === 0) return [];
    return request(`/attempts?id=in.(${attemptIds.map(encodeQueryValue).join(",")})&select=${ATTEMPT_SELECT}`, {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ is_best: isBest })
    });
  }

  async function listBestAttempts(userId) {
    return request(
      `/attempts?user_id=eq.${encodeQueryValue(userId)}&is_best=eq.true&select=${ATTEMPT_SELECT}&order=practiced_date.asc`
    );
  }

  async function getAttempt(userId, attemptId) {
    const rows = await request(
      `/attempts?user_id=eq.${encodeQueryValue(userId)}&id=eq.${encodeQueryValue(attemptId)}&select=${ATTEMPT_SELECT}&limit=1`
    );
    return rows[0] ?? null;
  }

  async function listAttempts(userId) {
    return request(
      `/attempts?user_id=eq.${encodeQueryValue(userId)}&select=${ATTEMPT_SELECT}&order=practiced_date.asc`
    );
  }

  async function getPhonemeState(userId, phonemeId) {
    const rows = await request(
      `/phoneme_state?user_id=eq.${encodeQueryValue(userId)}&phoneme_id=eq.${encodeQueryValue(
        phonemeId
      )}&select=${PHONEME_STATE_SELECT}&limit=1`
    );
    return rows[0] ?? null;
  }

  async function createPhonemeState(state) {
    const rows = await request("/phoneme_state", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(state)
    });
    return rows[0];
  }

  async function updatePhonemeState(userId, phonemeId, patch) {
    const rows = await request(
      `/phoneme_state?user_id=eq.${encodeQueryValue(userId)}&phoneme_id=eq.${encodeQueryValue(
        phonemeId
      )}&select=${PHONEME_STATE_SELECT}`,
      {
        method: "PATCH",
        headers: { prefer: "return=representation" },
        body: JSON.stringify(patch)
      }
    );
    return rows[0] ?? null;
  }

  async function getPhonemeSnapshot(userId, snapshotDate, phonemeId) {
    const rows = await request(
      `/phoneme_snapshots?user_id=eq.${encodeQueryValue(userId)}&snapshot_date=eq.${encodeQueryValue(
        snapshotDate
      )}&phoneme_id=eq.${encodeQueryValue(phonemeId)}&select=${PHONEME_SNAPSHOT_SELECT}&limit=1`
    );
    return rows[0] ?? null;
  }

  async function createPhonemeSnapshot(snapshot) {
    const rows = await request("/phoneme_snapshots", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(snapshot)
    });
    return rows[0];
  }

  async function updatePhonemeSnapshot(userId, snapshotDate, phonemeId, patch) {
    const rows = await request(
      `/phoneme_snapshots?user_id=eq.${encodeQueryValue(userId)}&snapshot_date=eq.${encodeQueryValue(
        snapshotDate
      )}&phoneme_id=eq.${encodeQueryValue(phonemeId)}&select=${PHONEME_SNAPSHOT_SELECT}`,
      {
        method: "PATCH",
        headers: { prefer: "return=representation" },
        body: JSON.stringify(patch)
      }
    );
    return rows[0] ?? null;
  }

  async function listUserBadges(userId) {
    return request(`/user_badges?user_id=eq.${encodeQueryValue(userId)}&select=${USER_BADGE_SELECT}`);
  }

  async function listPhonemeSnapshots(userId) {
    return request(
      `/phoneme_snapshots?user_id=eq.${encodeQueryValue(userId)}&select=${PHONEME_SNAPSHOT_SELECT}&order=snapshot_date.asc`
    );
  }

  async function createUserBadge(badge) {
    const rows = await request("/user_badges", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(badge)
    });
    return rows[0];
  }

  async function listUserBookmarks(userId) {
    return request(`/user_bookmarks?user_id=eq.${encodeQueryValue(userId)}&select=${USER_BOOKMARK_SELECT}`);
  }

  async function createFreeAttempt(freeAttempt) {
    const rows = await request("/free_attempts", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(freeAttempt)
    });
    return rows[0];
  }

  async function getFreeAttempt(userId, freeAttemptId) {
    const rows = await request(
      `/free_attempts?user_id=eq.${encodeQueryValue(userId)}&id=eq.${encodeQueryValue(
        freeAttemptId
      )}&select=${FREE_ATTEMPT_SELECT}&limit=1`
    );
    return rows[0] ?? null;
  }

  async function listFreeAttempts(userId) {
    return request(
      `/free_attempts?user_id=eq.${encodeQueryValue(userId)}&select=${FREE_ATTEMPT_SELECT}&order=attempted_date.asc`
    );
  }

  async function listFreeAttemptsByDate(userId, attemptedDate) {
    return request(
      `/free_attempts?user_id=eq.${encodeQueryValue(userId)}&attempted_date=eq.${encodeQueryValue(
        attemptedDate
      )}&select=${FREE_ATTEMPT_SELECT}`
    );
  }

  async function createAdviceFeedback(feedback) {
    const rows = await request("/advice_feedback", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(feedback)
    });
    return rows[0];
  }

  async function listAdviceFeedback(userId) {
    return request(`/advice_feedback?user_id=eq.${encodeQueryValue(userId)}&select=${ADVICE_FEEDBACK_SELECT}`);
  }

  async function deleteRowsByUserId(table, userId) {
    return request(`/${table}?user_id=eq.${encodeQueryValue(userId)}`, {
      method: "DELETE",
      headers: { prefer: "return=minimal" }
    });
  }

  async function deleteAttemptPhonemeResultsForUser(userId) {
    const attempts = await listAttempts(userId);
    const attemptIds = attempts.map((attempt) => attempt.id);
    if (attemptIds.length === 0) return null;
    return request(`/attempt_phoneme_results?attempt_id=in.(${attemptIds.map(encodeQueryValue).join(",")})`, {
      method: "DELETE",
      headers: { prefer: "return=minimal" }
    });
  }

  async function deleteDailySessionItemsForUser(userId) {
    const sessions = await request(
      `/daily_sessions?user_id=eq.${encodeQueryValue(userId)}&select=${DAILY_SESSION_SELECT}`
    );
    const sessionIds = sessions.map((session) => session.id);
    if (sessionIds.length === 0) return null;
    return request(`/daily_session_items?daily_session_id=in.(${sessionIds.map(encodeQueryValue).join(",")})`, {
      method: "DELETE",
      headers: { prefer: "return=minimal" }
    });
  }

  async function createErrorLog(errorLog) {
    const rows = await request("/error_logs", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(errorLog)
    });
    return rows[0] ?? null;
  }

  async function listActiveAdvicePages() {
    return request(`/advice_pages?is_active=eq.true&select=${ADVICE_PAGE_SELECT}`);
  }

  async function findSubscription(userId, entitlementId, productId) {
    const rows = await request(
      `/subscriptions?user_id=eq.${encodeQueryValue(userId)}&entitlement_id=eq.${encodeQueryValue(
        entitlementId
      )}&product_id=eq.${encodeQueryValue(productId)}&select=${SUBSCRIPTION_SELECT}&limit=1`
    );
    return rows[0] ?? null;
  }

  async function insertSubscription(subscription) {
    const rows = await request("/subscriptions", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(subscription)
    });
    return rows[0];
  }

  async function updateSubscription(id, patch) {
    const rows = await request(`/subscriptions?id=eq.${encodeQueryValue(id)}&select=${SUBSCRIPTION_SELECT}`, {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(patch)
    });
    return rows[0];
  }

  return {
    getAuthenticatedUser,
    getProfile,
    createProfile,
    updateProfile,
    getInstallationByHash,
    createInstallation,
    touchInstallation,
    listActiveSubscriptions,
    listActivePhonemes,
    listPhonemeStates,
    listActivePracticeItems,
    listPracticeItemTargets,
    getPracticeItem,
    getDailySession,
    listDailySessions,
    createDailySession,
    listDailySessionItems,
    listDailySessionItemsForSessions,
    createDailySessionItems,
    getDailySessionById,
    updateDailySession,
    getDailySessionItem,
    updateDailySessionItem,
    getTtsCache,
    createTtsCache,
    touchTtsCache,
    getAdvicePage,
    getAiAdviceCache,
    createAiAdviceCache,
    touchAiAdviceCache,
    createAttempt,
    createAttemptPhonemeResults,
    listAttemptPhonemeResults,
    listAttemptsByDailySessionItem,
    listAttemptsByPracticeItem,
    updateAttemptsIsBest,
    listBestAttempts,
    getAttempt,
    listAttempts,
    getPhonemeState,
    createPhonemeState,
    updatePhonemeState,
    getPhonemeSnapshot,
    createPhonemeSnapshot,
    updatePhonemeSnapshot,
    listPhonemeSnapshots,
    listUserBadges,
    createUserBadge,
    listUserBookmarks,
    createFreeAttempt,
    getFreeAttempt,
    listFreeAttempts,
    listFreeAttemptsByDate,
    createAdviceFeedback,
    listAdviceFeedback,
    deleteRowsByUserId,
    deleteAttemptPhonemeResultsForUser,
    deleteDailySessionItemsForUser,
    createErrorLog,
    listActiveAdvicePages,
    findSubscription,
    insertSubscription,
    updateSubscription
  };
}
