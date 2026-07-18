import { computeAccess } from "./access.mjs";
import {
  defaultAzureAssessment,
  normalizeAzurePhonemeResults,
  summarizeAttempt
} from "./assess.mjs";
import { normalizePronunciationAssessment, sanitizePerformanceTiming } from "./pronunciation-result.mjs";
import { capabilitiesForLocale } from "./speech-token.mjs";
import { getApiEnv } from "./env.mjs";
import { ApiError, getBearerToken, ok, readJson } from "./http.mjs";
import { createSupabaseRestClient } from "./supabase-rest.mjs";

const VALID_FEEDBACK_RATINGS = new Set(["up", "down"]);

async function getAuthenticatedContext({ request, env = process.env, fetchImpl = fetch, now = new Date() }) {
  const accessToken = getBearerToken(request);
  const config = getApiEnv(env);
  const supabase = createSupabaseRestClient(config, fetchImpl);
  const user = await supabase.getAuthenticatedUser(accessToken);
  const profile = await supabase.getProfile(user.id);

  if (!profile) {
    throw new ApiError("PROFILE_NOT_INITIALIZED", "初期化が必要です。", 409, false);
  }

  const subscriptions = await supabase.listActiveSubscriptions(user.id);
  const access = computeAccess(profile, subscriptions, now, config.revenueCatProEntitlementId);
  return { config, supabase, user, profile, access };
}

function requirePro(access) {
  if (!access.is_pro) {
    throw new ApiError("FREE_TEXT_PRO_REQUIRED", "自由入力はPro限定です。", 402, false);
  }
}

function requiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError("BAD_REQUEST", `${fieldName} が必要です。`, 400, false);
  }
  return value.trim();
}

function assertDateOnly(value, fieldName) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError("BAD_REQUEST", `${fieldName} が不正です。`, 400, false);
  }
  return value;
}

function average(values) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + Number(value), 0) / values.length;
}

function addDays(dateOnly, days) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function longestStreak(dates) {
  const uniqueDates = [...new Set(dates)].sort();
  if (uniqueDates.length === 0) return 0;

  let best = 1;
  let current = 1;
  for (let index = 1; index < uniqueDates.length; index += 1) {
    if (uniqueDates[index] === addDays(uniqueDates[index - 1], 1)) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 1;
    }
  }
  return best;
}

function currentDisplayStreak(dates, now) {
  const uniqueDates = new Set(dates);
  if (uniqueDates.size === 0) return 0;

  const today = now.toISOString().slice(0, 10);
  let cursor;
  if (uniqueDates.has(today)) {
    cursor = today;
  } else {
    const yesterday = addDays(today, -1);
    if (!uniqueDates.has(yesterday)) return 0;
    cursor = yesterday;
  }

  let streak = 0;
  while (uniqueDates.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function masteryColor(mastery) {
  if (mastery === null || mastery === undefined) return "unrated";
  if (Number(mastery) >= 80) return "green";
  if (Number(mastery) >= 60) return "yellow";
  return "red";
}

function levelFor(completedItems) {
  const levels = [
    { level: 1, required: 0, name: "はじめの一音" },
    { level: 2, required: 10, name: "発音ウォーカー" },
    { level: 3, required: 25, name: "音素トレーナー" },
    { level: 4, required: 50, name: "苦手音ハンター" },
    { level: 5, required: 100, name: "発音ミラー常連" },
    { level: 6, required: 200, name: "通じる音の職人" },
    { level: 7, required: 350, name: "音素マスター" },
    { level: 8, required: 500, name: "発音ミラー名人" }
  ];
  const level = levels.filter((candidate) => completedItems >= candidate.required).at(-1);
  return { level: level.level, name: level.name, completed_items: completedItems };
}

function titleFor({ streak, completedItems, states, attempts }) {
  const stateById = new Map(states.map((state) => [state.phoneme_id, state]));
  const latestDate = attempts.map((attempt) => attempt.practiced_date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
  const recentCutoff = addDays(latestDate, -7);
  const recentPracticeIds = new Set(
    attempts
      .filter((attempt) => attempt.practiced_date >= recentCutoff)
      .flatMap((attempt) => attempt.target_phoneme_ids ?? [])
  );

  if (streak >= 7) return { title_id: "seven_day_streak", name: "7日継続中" };
  if (["theta", "dh"].some((id) => Number(stateById.get(id)?.mastery_ewma ?? 0) >= 80 && recentPracticeIds.has(id))) {
    return { title_id: "th_specialist", name: "TH集中突破中" };
  }
  if (["r", "l"].some((id) => recentPracticeIds.has(id) && Number(stateById.get(id)?.mastery_ewma ?? 0) < 80)) {
    return { title_id: "rl_specialist", name: "R/L調整中" };
  }
  if (completedItems >= 50) return { title_id: "daily_regular", name: "毎日の発音習慣" };
  return { title_id: "starter", name: "発音ミラー入門" };
}

async function readFreeAssessInput(request) {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "application/json が必要です。", 415, false);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("BAD_REQUEST", "JSON本文が不正です。", 400, false);
  }
  if (!body?.azure_result || typeof body.azure_result !== "object" || Array.isArray(body.azure_result)) {
    throw new ApiError("BAD_REQUEST", "azure_result が必要です。", 400, false);
  }
  if (JSON.stringify(body.azure_result).length > 1_000_000) {
    throw new ApiError("BAD_REQUEST", "azure_result が大きすぎます。", 413, false);
  }
  const locale = typeof body.locale === "string" ? body.locale : "en-US";
  if (!capabilitiesForLocale(locale)) throw new ApiError("UNSUPPORTED_LOCALE", "この発音判定ロケールには対応していません。", 400, false);

  return {
    text: requiredString(body.text, "text"),
    azureRawJson: body.azure_result,
    clientTiming: sanitizePerformanceTiming(body.client_timing),
    locale,
    timezone: requiredString(body.timezone ?? "Asia/Tokyo", "timezone"),
    attemptedDate: assertDateOnly(requiredString(body.attempted_date, "attempted_date"), "attempted_date"),
    consentVersion: requiredString(body.consent_version, "consent_version"),
    appVersion: typeof body.app_version === "string" ? body.app_version.trim() || null : null
  };
}

async function defaultIpaConversion({ config, text, fetchImpl }) {
  if (!config.pythonServiceUrl || !config.pythonServiceApiKey) {
    throw new ApiError("IPA_CONVERSION_FAILED", "IPA変換サービスが未設定です。", 502, true);
  }

  const response = await fetchImpl(`${config.pythonServiceUrl.replace(/\/$/, "")}/internal/ipa`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-api-key": config.pythonServiceApiKey
    },
    body: JSON.stringify({ text, accent: "US" })
  });

  if (!response.ok) {
    throw new ApiError("IPA_CONVERSION_FAILED", "IPA変換に失敗しました。", 502, true);
  }

  const payload = await response.json();
  if (!payload?.ok || !payload.data?.normalized_text) {
    throw new ApiError("IPA_CONVERSION_FAILED", "IPA変換に失敗しました。", 502, true);
  }
  return payload.data;
}

function freeTargetPhonemeIds(ipaResult, activePhonemes) {
  const activeIds = new Set(activePhonemes.map((phoneme) => phoneme.phoneme_id));
  const candidates = [
    ...(Array.isArray(ipaResult.phoneme_ids) ? ipaResult.phoneme_ids : []),
    ...(Array.isArray(ipaResult.phonemes) ? ipaResult.phonemes : [])
  ];
  const selected = candidates.map((value) => String(value)).filter((value) => activeIds.has(value));
  return selected.length > 0 ? [...new Set(selected)] : activePhonemes.map((phoneme) => phoneme.phoneme_id);
}

function toPhonemeScores(phonemeResults) {
  return phonemeResults.map((result) => ({
    index: result.index,
    word_index: result.word_index,
    expected_phoneme_id: result.expected_phoneme_id,
    expected_ipa: result.expected_ipa,
    observed_phoneme_id: result.observed_phoneme_id,
    observed_ipa: result.observed_ipa,
    score: result.score,
    color: result.color,
    confusion_pair_id: result.confusion_pair_id
  }));
}

export async function saveFreeTextConsent(options) {
  const body = await readJson(options.request);
  const { supabase, user, access } = await getAuthenticatedContext(options);
  requirePro(access);

  const consentVersion = requiredString(body?.consent_version, "consent_version");
  const consentedAt = (options.now ?? new Date()).toISOString();
  const profile = await supabase.updateProfile(user.id, {
    free_text_consent_version: consentVersion,
    free_text_consented_at: consentedAt
  });

  return {
    free_text_consent_version: profile.free_text_consent_version,
    free_text_consented_at: profile.free_text_consented_at
  };
}

export async function assessFreeText({
  request,
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  ipaConversionImpl = defaultIpaConversion,
  azureAssessImpl = defaultAzureAssessment,
  timing = null
}) {
  const startedAt = performance.now();
  const [input, { config, supabase, user, profile, access }] = await Promise.all([
    readFreeAssessInput(request),
    getAuthenticatedContext({ request, env, fetchImpl, now })
  ]);
  if (timing) {
    timing.input_and_auth_ms = Math.round(performance.now() - startedAt);
    timing.result_json_bytes = JSON.stringify(input.azureRawJson).length;
  }
  requirePro(access);

  if (!profile.free_text_consented_at || profile.free_text_consent_version !== input.consentVersion) {
    throw new ApiError("FREE_TEXT_CONSENT_REQUIRED", "自由入力保存同意が必要です。", 403, false);
  }

  const preflightStartedAt = performance.now();
  const softCap = Number.isFinite(config.freeTextDailySoftCap) && config.freeTextDailySoftCap > 0 ? config.freeTextDailySoftCap : 20;
  const usedToday = (await supabase.listFreeAttemptsByDate(user.id, input.attemptedDate)).length;
  if (usedToday >= softCap) {
    throw new ApiError("RATE_LIMITED", "今日はこれ以上利用できません。明日また試してください。", 429, false);
  }
  if (timing) timing.preflight_ms = Math.round(performance.now() - preflightStartedAt);

  const ipaStartedAt = performance.now();
  const ipaResult = await ipaConversionImpl({ config, text: input.text, fetchImpl });
  if (timing) timing.ipa_conversion_ms = Math.round(performance.now() - ipaStartedAt);
  const activePhonemes = await supabase.listActivePhonemes();
  const targetPhonemeIds = freeTargetPhonemeIds(ipaResult, activePhonemes);
  const practiceItem = {
    text: input.text,
    normalized_text: ipaResult.normalized_text,
    expected_ipa: ipaResult.ipa ?? null
  };
  const assessmentStartedAt = performance.now();
  const azureRawJson = await azureAssessImpl({ config, input, practiceItem, targetPhonemeIds, fetchImpl });
  if (timing) timing.speech_assessment_ms = Math.round(performance.now() - assessmentStartedAt);
  const normalizationStartedAt = performance.now();
  const phonemeResults = normalizeAzurePhonemeResults({ azureRawJson, targetPhonemeIds });
  const summary = summarizeAttempt(phonemeResults);
  const normalizedResult = normalizePronunciationAssessment({
    azureRawJson,
    locale: input.locale,
    referenceText: input.text,
    capabilities: capabilitiesForLocale(input.locale),
    timing: input.clientTiming
  });
  if (timing) timing.normalization_ms = Math.round(performance.now() - normalizationStartedAt);
  const persistenceStartedAt = performance.now();

  const freeAttempt = await supabase.createFreeAttempt({
    user_id: user.id,
    attempted_at: now.toISOString(),
    attempted_date: input.attemptedDate,
    timezone: input.timezone,
    input_text: input.text,
    normalized_text: ipaResult.normalized_text,
    ipa_result: ipaResult,
    oov_words: Array.isArray(ipaResult.oov_words) ? ipaResult.oov_words : [],
    conversion_confidence: ipaResult.conversion_confidence ?? null,
    phoneme_scores: toPhonemeScores(phonemeResults),
    word_scores: azureRawJson.word_scores ?? azureRawJson.wordScores ?? null,
    overall_score: summary.overallScore,
    azure_raw_json: azureRawJson,
    normalized_result: normalizedResult,
    performance_metrics: input.clientTiming,
    native_language: profile.native_language ?? "und",
    target_accent: profile.target_accent ?? "US",
    pii_flag: false,
    consent_version: input.consentVersion,
    app_version: input.appVersion
  });
  if (timing) {
    timing.persistence_ms = Math.round(performance.now() - persistenceStartedAt);
    timing.total_ms = Math.round(performance.now() - startedAt);
  }

  return {
    free_attempt_id: freeAttempt.id,
    overall_score: summary.overallScore,
    ipa_result: ipaResult,
    phoneme_scores: freeAttempt.phoneme_scores,
    pronunciation_assessment: normalizedResult,
    limit: {
      used_today: usedToday + 1,
      soft_cap: softCap
    }
  };
}

export async function getProgress(options) {
  const { supabase, user } = await getAuthenticatedContext(options);
  const [attempts, bestAttempts, states, snapshots, badges, phonemes] = await Promise.all([
    supabase.listAttempts(user.id),
    supabase.listBestAttempts(user.id),
    supabase.listPhonemeStates(user.id),
    supabase.listPhonemeSnapshots(user.id),
    supabase.listUserBadges(user.id),
    supabase.listActivePhonemes()
  ]);

  const practicedDates = attempts.map((attempt) => attempt.practiced_date);
  const stateById = new Map(states.map((state) => [state.phoneme_id, state]));
  const overallMastery = average(states.map((state) => state.mastery_ewma).filter((value) => value !== null && value !== undefined));
  const completedItems = new Set(bestAttempts.map((attempt) => attempt.id)).size;
  const current = currentDisplayStreak(practicedDates, options.now ?? new Date());

  const snapshotGroups = new Map();
  for (const snapshot of snapshots) {
    const values = snapshotGroups.get(snapshot.snapshot_date) ?? [];
    values.push(Number(snapshot.mastery_ewma));
    snapshotGroups.set(snapshot.snapshot_date, values);
  }

  return {
    streak: {
      current,
      longest: longestStreak(practicedDates)
    },
    overall_mastery: overallMastery,
    phoneme_heatmap: phonemes.map((phoneme) => {
      const state = stateById.get(phoneme.phoneme_id);
      return {
        phoneme_id: phoneme.phoneme_id,
        ipa: phoneme.ipa,
        category: phoneme.category,
        mastery_ewma: state?.mastery_ewma ?? null,
        color: masteryColor(state?.mastery_ewma)
      };
    }),
    mastery_series: [...snapshotGroups.entries()].map(([date, values]) => ({
      date,
      overall_mastery: average(values)
    })),
    level: levelFor(completedItems),
    title: titleFor({ streak: current, completedItems, states, attempts }),
    badges: badges.map((badge) => ({
      badge_id: badge.badge_id,
      awarded_at: badge.awarded_at,
      metadata: badge.metadata ?? null
    }))
  };
}

export async function saveAdviceFeedback(options) {
  const body = await readJson(options.request);
  const { supabase, user } = await getAuthenticatedContext(options);

  const attemptId = typeof body?.attempt_id === "string" && body.attempt_id.trim() ? body.attempt_id.trim() : null;
  const freeAttemptId =
    typeof body?.free_attempt_id === "string" && body.free_attempt_id.trim() ? body.free_attempt_id.trim() : null;
  const adviceId = requiredString(body?.advice_id, "advice_id");
  const rating = requiredString(body?.rating, "rating");

  if (!VALID_FEEDBACK_RATINGS.has(rating)) {
    throw new ApiError("BAD_REQUEST", "rating は up または down を指定してください。", 400, false);
  }
  if ((attemptId ? 1 : 0) + (freeAttemptId ? 1 : 0) !== 1) {
    throw new ApiError("BAD_REQUEST", "attempt_id または free_attempt_id のどちらか一方が必要です。", 400, false);
  }

  if (attemptId && !(await supabase.getAttempt(user.id, attemptId))) {
    throw new ApiError("FORBIDDEN", "attempt が不正です。", 403, false);
  }
  if (freeAttemptId && !(await supabase.getFreeAttempt(user.id, freeAttemptId))) {
    throw new ApiError("FORBIDDEN", "free_attempt が不正です。", 403, false);
  }
  if (!(await supabase.getAdvicePage(adviceId))) {
    throw new ApiError("ADVICE_NOT_FOUND", "助言が見つかりません。", 404, false);
  }

  return supabase.createAdviceFeedback({
    user_id: user.id,
    attempt_id: attemptId,
    free_attempt_id: freeAttemptId,
    advice_id: adviceId,
    rating,
    created_at: (options.now ?? new Date()).toISOString()
  });
}

export async function exportLearningData(options) {
  const { supabase, user, profile } = await getAuthenticatedContext(options);
  const [attempts, dailySessions, phonemeState, phonemeSnapshots, userBadges, userBookmarks, freeAttempts, adviceFeedback] =
    await Promise.all([
      supabase.listAttempts(user.id),
      supabase.listDailySessions(user.id),
      supabase.listPhonemeStates(user.id),
      supabase.listPhonemeSnapshots(user.id),
      supabase.listUserBadges(user.id),
      supabase.listUserBookmarks(user.id),
      supabase.listFreeAttempts(user.id),
      supabase.listAdviceFeedback(user.id)
    ]);

  const attemptPhonemeResults = (
    await Promise.all(attempts.map((attempt) => supabase.listAttemptPhonemeResults(attempt.id)))
  ).flat();
  const dailySessionItems = await supabase.listDailySessionItemsForSessions(dailySessions.map((session) => session.id));

  return {
    exported_at: (options.now ?? new Date()).toISOString(),
    profile,
    attempts,
    attempt_phoneme_results: attemptPhonemeResults,
    daily_sessions: dailySessions,
    daily_session_items: dailySessionItems,
    phoneme_state: phonemeState,
    phoneme_snapshots: phonemeSnapshots,
    user_badges: userBadges,
    user_bookmarks: userBookmarks,
    free_attempts: freeAttempts,
    advice_feedback: adviceFeedback
  };
}

export async function deleteLearningData(options) {
  const body = await readJson(options.request);
  if (body?.confirm !== true) {
    throw new ApiError("BAD_REQUEST", "confirm: true が必要です。", 400, false);
  }

  const { supabase, user } = await getAuthenticatedContext(options);
  await supabase.deleteRowsByUserId("advice_feedback", user.id);
  await supabase.deleteAttemptPhonemeResultsForUser(user.id);
  await supabase.deleteRowsByUserId("attempts", user.id);
  await supabase.deleteDailySessionItemsForUser(user.id);
  await supabase.deleteRowsByUserId("daily_sessions", user.id);
  await supabase.deleteRowsByUserId("phoneme_state", user.id);
  await supabase.deleteRowsByUserId("phoneme_snapshots", user.id);
  await supabase.deleteRowsByUserId("user_badges", user.id);
  await supabase.deleteRowsByUserId("user_bookmarks", user.id);
  await supabase.deleteRowsByUserId("free_attempts", user.id);

  return {
    deleted_at: (options.now ?? new Date()).toISOString(),
    local_recordings_action_required: true
  };
}

export async function handleFreeTextConsent(options) {
  return ok(await saveFreeTextConsent(options));
}

export async function handleFreeAssess(options) {
  return ok(await assessFreeText(options));
}

export async function handleProgress(options) {
  return ok(await getProgress(options));
}

export async function handleAdviceFeedback(options) {
  return ok(await saveAdviceFeedback(options));
}

export async function handleExport(options) {
  return ok(await exportLearningData(options));
}

export async function handleDeleteLearningData(options) {
  return ok(await deleteLearningData(options));
}
