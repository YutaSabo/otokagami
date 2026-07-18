import { ApiError, ok } from "./http.mjs";
import { getPracticeContext } from "./practice-access.mjs";
import { normalizePronunciationAssessment, sanitizePerformanceTiming } from "./pronunciation-result.mjs";
import { capabilitiesForLocale } from "./speech-token.mjs";

const VALID_MODES = new Set(["daily", "weak_drill", "phoneme_select"]);
const CONFUSION_PAIRS = new Set([
  "r_to_l",
  "l_to_r",
  "theta_to_s",
  "theta_to_t",
  "dh_to_z",
  "dh_to_d",
  "v_to_b",
  "b_to_v",
  "f_to_h",
  "w_to_u",
  "ae_to_eh",
  "ih_to_iy",
  "iy_to_ih",
  "ah_to_aa",
  "aa_to_ah",
  "uh_to_uw",
  "er_to_ah",
  "ng_to_n",
  "z_to_s",
  "s_to_sh",
  "sh_to_s",
  "ch_to_sh",
  "j_to_ch",
  "final_t_missing",
  "final_d_missing",
  "final_s_missing",
  "final_z_missing",
  "final_l_missing"
]);
const FINAL_CONSONANTS = new Set(["t", "d", "s", "z", "l"]);
const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14];
const PHONEME_ALIASES = new Map(
  Object.entries({
    "/r/": "r",
    r: "r",
    "ɹ": "r",
    l: "l",
    theta: "theta",
    "θ": "theta",
    dh: "dh",
    "ð": "dh",
    v: "v",
    b: "b",
    f: "f",
    h: "h",
    w: "w",
    u: "uw",
    uw: "uw",
    "uː": "uw",
    ae: "ae",
    "æ": "ae",
    eh: "eh",
    "ɛ": "eh",
    e: "eh",
    ih: "ih",
    "ɪ": "ih",
    iy: "iy",
    i: "iy",
    "iː": "iy",
    ah: "ah",
    "ʌ": "ah",
    "ə": "ah",
    aa: "aa",
    "ɑ": "aa",
    uh: "uh",
    "ʊ": "uh",
    er: "er",
    "ɝ": "er",
    "ɚ": "er",
    ng: "ng",
    "ŋ": "ng",
    n: "n",
    z: "z",
    s: "s",
    sh: "sh",
    "ʃ": "sh",
    ch: "ch",
    "tʃ": "ch",
    j: "j",
    "dʒ": "j",
    y: "y",
    t: "t",
    d: "d",
    k: "k",
    g: "g",
    p: "p",
    m: "m",
    o: "ow",
    ow: "ow",
    "oʊ": "ow",
    ay: "ay",
    "aɪ": "ay",
    aw: "aw",
    "aʊ": "aw",
    oy: "oy",
    "ɔɪ": "oy"
  })
);
const KNOWN_PHONEME_IDS = new Set(PHONEME_ALIASES.values());

function assertDateOnly(value, fieldName) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError("BAD_REQUEST", `${fieldName} が不正です。`, 400, false);
  }
  return value;
}

function parseAttemptNo(value) {
  const attemptNo = Number(value);
  if (!Number.isInteger(attemptNo) || attemptNo <= 0) {
    throw new ApiError("BAD_REQUEST", "attempt_no が不正です。", 400, false);
  }
  return attemptNo;
}

async function readAssessmentInput(request) {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "application/json が必要です。", 415, false);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("BAD_REQUEST", "JSON本文が不正です。", 400, false);
  }
  const practiceMode = String(body?.practice_mode ?? "");
  if (!VALID_MODES.has(practiceMode)) throw new ApiError("BAD_REQUEST", "practice_mode が不正です。", 400, false);
  if (!body?.azure_result || typeof body.azure_result !== "object" || Array.isArray(body.azure_result)) {
    throw new ApiError("BAD_REQUEST", "azure_result が必要です。", 400, false);
  }
  if (JSON.stringify(body.azure_result).length > 1_000_000) {
    throw new ApiError("BAD_REQUEST", "azure_result が大きすぎます。", 413, false);
  }
  const input = {
    azureRawJson: body.azure_result,
    clientTiming: sanitizePerformanceTiming(body.client_timing),
    locale: typeof body.locale === "string" ? body.locale : "en-US",
    practiceItemId: String(body.practice_item_id ?? "").trim(),
    practiceMode,
    dailySessionId: typeof body.daily_session_id === "string" ? body.daily_session_id : null,
    dailySessionItemId: typeof body.daily_session_item_id === "string" ? body.daily_session_item_id : null,
    attemptNo: parseAttemptNo(body.attempt_no),
    timezone: typeof body.timezone === "string" ? body.timezone : "Asia/Tokyo",
    practicedDate: assertDateOnly(body.practiced_date, "practiced_date"),
    appVersion: typeof body.app_version === "string" ? body.app_version : null
  };
  if (!input.practiceItemId) throw new ApiError("BAD_REQUEST", "practice_item_id が必要です。", 400, false);
  if (!capabilitiesForLocale(input.locale)) throw new ApiError("UNSUPPORTED_LOCALE", "この発音判定ロケールには対応していません。", 400, false);
  if (practiceMode === "daily" && (!input.dailySessionId || !input.dailySessionItemId)) {
    throw new ApiError("BAD_REQUEST", "daily_session_id と daily_session_item_id が必要です。", 400, false);
  }
  return input;
}

function normalizePhonemeId(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.replace(/^\/|\/$/g, "").toLowerCase();
  const phonemeId = PHONEME_ALIASES.get(raw) ?? PHONEME_ALIASES.get(normalized) ?? null;
  // observed_phoneme_id has a foreign key to phonemes. Azure can return tokens such
  // as silence or an unmodelled phone; keep its IPA for display but never persist an
  // unknown ID that would reject the whole assessment transaction.
  return phonemeId && KNOWN_PHONEME_IDS.has(phonemeId) ? phonemeId : null;
}

function scoreColor(score) {
  if (score >= 80) return "green";
  if (score >= 60) return "yellow";
  return "red";
}

function confusionPairId(expectedPhonemeId, observedPhonemeId) {
  if (!observedPhonemeId && FINAL_CONSONANTS.has(expectedPhonemeId)) {
    const finalPair = `final_${expectedPhonemeId}_missing`;
    return CONFUSION_PAIRS.has(finalPair) ? finalPair : null;
  }
  if (!expectedPhonemeId || !observedPhonemeId || expectedPhonemeId === observedPhonemeId) return null;
  const pair = `${expectedPhonemeId}_to_${observedPhonemeId}`;
  return CONFUSION_PAIRS.has(pair) ? pair : null;
}

function average(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + Number(value), 0) / values.length;
}

function pronunciationAssessment(node) {
  return node?.PronunciationAssessment ?? node?.pronunciationAssessment ?? node ?? {};
}

function scoreFromNode(node) {
  const assessment = pronunciationAssessment(node);
  const score = assessment.AccuracyScore ?? assessment.accuracyScore ?? node?.AccuracyScore ?? node?.score;
  return Math.max(0, Math.min(100, Number(score ?? 0)));
}

function observedFromNode(node) {
  const nBest = node?.NBestPhonemes ?? node?.nBestPhonemes ?? pronunciationAssessment(node)?.NBestPhonemes;
  if (Array.isArray(nBest) && nBest.length > 0) {
    return nBest[0]?.Phoneme ?? nBest[0]?.phoneme ?? nBest[0]?.phoneme_id ?? null;
  }
  return node?.ObservedPhoneme ?? node?.observed_phoneme ?? node?.observed_ipa ?? node?.Phoneme ?? node?.phoneme ?? null;
}

function phonemesFromAzureWords(azureRawJson) {
  const nBest = azureRawJson?.NBest?.[0] ?? azureRawJson?.nBest?.[0] ?? azureRawJson?.n_best?.[0] ?? {};
  const words = nBest.Words ?? nBest.words ?? [];
  const flattened = [];
  for (const [wordIndex, word] of words.entries()) {
    const phonemes = word.Phonemes ?? word.phonemes ?? [];
    for (const phoneme of phonemes) {
      flattened.push({ ...phoneme, wordIndex });
    }
  }
  return flattened;
}

export function normalizeAzurePhonemeResults({ azureRawJson, targetPhonemeIds }) {
  const targetSet = new Set(targetPhonemeIds);
  const rawPhonemes = Array.isArray(azureRawJson?.phoneme_results)
    ? azureRawJson.phoneme_results
    : phonemesFromAzureWords(azureRawJson);

  const normalized = rawPhonemes
    .map((phoneme, index) => {
      const expectedIpa = phoneme.expected_ipa ?? phoneme.ExpectedPhoneme ?? phoneme.Phoneme ?? phoneme.phoneme;
      const expectedPhonemeId = normalizePhonemeId(phoneme.expected_phoneme_id ?? expectedIpa);
      const observedIpa = observedFromNode(phoneme);
      const observedPhonemeId = normalizePhonemeId(phoneme.observed_phoneme_id ?? observedIpa);
      const score = scoreFromNode(phoneme);
      return {
        index: Number(phoneme.index ?? index),
        word_index: phoneme.word_index ?? phoneme.wordIndex ?? null,
        expected_phoneme_id: expectedPhonemeId,
        expected_ipa: String(expectedIpa ?? expectedPhonemeId),
        observed_phoneme_id: observedPhonemeId,
        observed_ipa: observedIpa === null || observedIpa === undefined ? null : String(observedIpa),
        score,
        color: scoreColor(score),
        is_target: targetSet.has(expectedPhonemeId),
        confusion_pair_id: confusionPairId(expectedPhonemeId, observedPhonemeId)
      };
    })
    .filter((result) => result.expected_phoneme_id);

  if (normalized.length === 0) {
    throw new ApiError("AZURE_ASSESSMENT_FAILED", "判定結果の音素情報が取得できませんでした。", 502, true);
  }

  return normalized.sort((a, b) => a.index - b.index);
}

export function summarizeAttempt(phonemeResults) {
  const targetResults = phonemeResults.filter((result) => result.is_target);
  const scoreBasis = targetResults.length > 0 ? targetResults : phonemeResults;
  return {
    overallScore: average(phonemeResults.map((result) => result.score)),
    targetScoreAvg: average(scoreBasis.map((result) => result.score)),
    isCorrect: scoreBasis.every((result) => result.score >= 80),
    isPerfect: phonemeResults.every((result) => result.score >= 80)
  };
}

function compareAttempt(a, b) {
  return (
    Number(b.target_score_avg) - Number(a.target_score_avg) ||
    Number(b.overall_score) - Number(a.overall_score) ||
    Number(b.attempt_no) - Number(a.attempt_no)
  );
}

function addDays(dateOnly, days) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function targetScoresByPhoneme(phonemeResults, targetPhonemeIds) {
  const scores = new Map();
  for (const phonemeId of targetPhonemeIds) {
    const matching = phonemeResults.filter((result) => result.is_target && result.expected_phoneme_id === phonemeId);
    if (matching.length > 0) {
      scores.set(phonemeId, average(matching.map((result) => result.score)));
    }
  }
  return scores;
}

function badgeMetadata(now, extra = {}) {
  return { phase: 8, awarded_reason_at: now.toISOString(), ...extra };
}

export function currentStreak(dates) {
  const uniqueDates = [...new Set(dates)].sort().reverse();
  if (uniqueDates.length === 0) return 0;
  let streak = 1;
  let cursor = uniqueDates[0];
  for (const nextDate of uniqueDates.slice(1)) {
    const expectedPrevious = addDays(cursor, -1);
    if (nextDate !== expectedPrevious) break;
    streak += 1;
    cursor = nextDate;
  }
  return streak;
}

function genericAdviceIdFor(phoneme, result) {
  if (result.confusion_pair_id?.startsWith("final_")) return "generic_final_consonant_ja_us";
  if (phoneme?.category === "monophthong" || phoneme?.category === "diphthong") return "generic_vowel_ja_us";
  return "generic_consonant_ja_us";
}

function chooseRecommendedAdviceId({ phonemeResults, advicePages, phonemes }) {
  const candidates = phonemeResults
    .filter((result) => result.is_target && result.score < 80)
    .sort((a, b) => Number(a.color === "yellow") - Number(b.color === "yellow") || a.score - b.score);
  if (candidates.length === 0) return null;

  const pagesByConfusion = new Map(advicePages.filter((page) => page.confusion_pair_id).map((page) => [page.confusion_pair_id, page]));
  const pagesByAdviceId = new Map(advicePages.map((page) => [page.advice_id, page]));
  const phonemesById = new Map(phonemes.map((phoneme) => [phoneme.phoneme_id, phoneme]));

  for (const result of candidates) {
    if (result.confusion_pair_id && pagesByConfusion.has(result.confusion_pair_id)) {
      return pagesByConfusion.get(result.confusion_pair_id).advice_id;
    }
    const genericAdviceId = genericAdviceIdFor(phonemesById.get(result.expected_phoneme_id), result);
    if (pagesByAdviceId.has(genericAdviceId)) return genericAdviceId;
  }

  return pagesByAdviceId.has("generic_unknown_ja_us") ? "generic_unknown_ja_us" : null;
}

function sanitizeErrorDetails(details) {
  return JSON.parse(
    JSON.stringify(details, (key, value) => {
      if (/authorization|token|key|secret|audio/i.test(key)) return "[REDACTED]";
      if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}...`;
      return value;
    })
  );
}

async function logError(supabase, { userId = null, source, operation, message, details = {}, now }) {
  try {
    await supabase.createErrorLog({
      user_id: userId,
      source,
      operation,
      message,
      details: sanitizeErrorDetails(details),
      created_at: now.toISOString()
    });
  } catch {
    // Error logging must not mask the original failure.
  }
}

export async function defaultAzureAssessment({ input }) {
  return input.azureRawJson;
}

async function resolvePracticeContext({ supabase, userId, input }) {
  const contextReads =
    input.practiceMode === "daily"
      ? Promise.all([
          supabase.getPracticeItem(input.practiceItemId),
          supabase.getDailySessionById(input.dailySessionId),
          supabase.getDailySessionItem(input.dailySessionItemId)
        ])
      : Promise.all([supabase.getPracticeItem(input.practiceItemId), supabase.listPracticeItemTargets([input.practiceItemId])]);
  const [practiceItem, dailySession, dailySessionItem] = await contextReads;
  if (!practiceItem) {
    throw new ApiError("PRACTICE_ITEM_NOT_FOUND", "練習問題が見つかりません。", 404, false);
  }

  let targetPhonemeIds = [];
  if (input.practiceMode === "daily") {
    if (!dailySession || dailySession.user_id !== userId || dailySessionItem?.daily_session_id !== dailySession.id) {
      throw new ApiError("FORBIDDEN", "daily session が不正です。", 403, false);
    }
    if (dailySessionItem.practice_item_id !== input.practiceItemId) {
      throw new ApiError("BAD_REQUEST", "daily_session_item_id と practice_item_id が一致しません。", 400, false);
    }
    targetPhonemeIds = dailySessionItem.target_phoneme_ids ?? [];
  } else {
    const targets = dailySession;
    targetPhonemeIds = targets.map((target) => target.target_id);
  }

  if (targetPhonemeIds.length === 0) {
    throw new ApiError("PRACTICE_ITEM_TARGETS_MISSING", "練習問題のターゲット音素が見つかりません。", 409, false);
  }

  return { practiceItem, targetPhonemeIds };
}

async function recomputeBestAttempt({ supabase, userId, input, attempt }) {
  const attempts = input.dailySessionItemId
    ? await supabase.listAttemptsByDailySessionItem(userId, input.dailySessionItemId)
    : await supabase.listAttemptsByPracticeItem(userId, input.practiceItemId, input.practiceMode);
  const best = [...attempts].sort(compareAttempt)[0];
  const oldBest = attempts.find((row) => row.is_best);
  const nonBestIds = attempts.filter((row) => row.id !== best.id && row.is_best).map((row) => row.id);

  if (nonBestIds.length > 0) await supabase.updateAttemptsIsBest(nonBestIds, false);
  if (!best.is_best) await supabase.updateAttemptsIsBest([best.id], true);

  return {
    bestAttempt: { ...best, is_best: true },
    isNewAttemptBest: best.id === attempt.id,
    didBestChange: oldBest?.id !== best.id
  };
}

async function upsertPhonemeStateAndSnapshots({ supabase, userId, targetScores, practicedDate, now }) {
  const updatedStates = [];
  for (const [phonemeId, score] of targetScores.entries()) {
    const current = await supabase.getPhonemeState(userId, phonemeId);
    const oldMastery = current?.mastery_ewma === null || current?.mastery_ewma === undefined ? null : Number(current.mastery_ewma);
    const masteryEwma = oldMastery === null ? score : 0.3 * score + 0.7 * oldMastery;
    const nextReviewStage = score >= 80 ? Math.min(Number(current?.review_stage ?? 0) + 1, 3) : 0;
    const nextReviewDate = addDays(practicedDate, score >= 80 ? REVIEW_INTERVAL_DAYS[nextReviewStage] : 1);
    const patch = {
      mastery_ewma: masteryEwma,
      practice_count: Number(current?.practice_count ?? 0) + 1,
      last_practiced_date: practicedDate,
      next_review_date: nextReviewDate,
      review_stage: nextReviewStage,
      updated_at: now.toISOString()
    };

    const updated = current
      ? await supabase.updatePhonemeState(userId, phonemeId, patch)
      : await supabase.createPhonemeState({ user_id: userId, phoneme_id: phonemeId, ...patch });

    const snapshot = await supabase.getPhonemeSnapshot(userId, practicedDate, phonemeId);
    if (snapshot) {
      await supabase.updatePhonemeSnapshot(userId, practicedDate, phonemeId, {
        mastery_ewma: masteryEwma,
        updated_at: now.toISOString()
      });
    } else {
      await supabase.createPhonemeSnapshot({
        user_id: userId,
        snapshot_date: practicedDate,
        phoneme_id: phonemeId,
        mastery_ewma: masteryEwma,
        created_at: now.toISOString(),
        updated_at: now.toISOString()
      });
    }
    updatedStates.push(updated);
  }
  return updatedStates;
}

async function updateDailyCompletion({ supabase, input, attemptId, now }) {
  if (input.practiceMode !== "daily") return { completedDailySession: false };
  await supabase.updateDailySessionItem(input.dailySessionItemId, {
    best_attempt_id: attemptId,
    status: "completed",
    completed_at: now.toISOString()
  });
  const items = await supabase.listDailySessionItems(input.dailySessionId);
  const completedCount = items.filter((item) => item.status === "completed" || item.id === input.dailySessionItemId).length;
  const completed = completedCount >= 7;
  await supabase.updateDailySession(input.dailySessionId, {
    completed_count: Math.min(7, completedCount),
    status: completed ? "completed" : "in_progress",
    completed_at: completed ? now.toISOString() : null
  });
  return { completedDailySession: completed };
}

async function awardBadges({ supabase, userId, attempt, completedDailySession, updatedStates, now }) {
  const [existingBadges, bestAttempts, allStates] = await Promise.all([
    supabase.listUserBadges(userId),
    supabase.listBestAttempts(userId),
    supabase.listPhonemeStates(userId)
  ]);
  const existing = new Set(existingBadges.map((badge) => badge.badge_id));
  const stateById = new Map(allStates.concat(updatedStates).map((state) => [state.phoneme_id, state]));
  const badges = [];
  const add = (badgeId, metadata = {}) => {
    if (!existing.has(badgeId)) badges.push({ badgeId, metadata });
  };

  if (completedDailySession) add("first_daily_complete");
  if (attempt.is_perfect) add("first_perfect_item", { attempt_id: attempt.id });

  const dates = bestAttempts.map((row) => row.practiced_date).concat(attempt.practiced_date);
  const streak = currentStreak(dates);
  if (streak >= 3) add("streak_3", { streak });
  if (streak >= 7) add("streak_7", { streak });
  if (streak >= 14) add("streak_14", { streak });

  if (["theta", "dh"].some((id) => Number(stateById.get(id)?.mastery_ewma ?? 0) >= 80)) add("th_green");
  if (["r", "l"].every((id) => Number(stateById.get(id)?.mastery_ewma ?? 0) >= 80)) add("r_l_green");
  if (["v", "b"].every((id) => Number(stateById.get(id)?.mastery_ewma ?? 0) >= 80)) add("v_b_green");

  const completedItems = new Set(bestAttempts.map((row) => row.id).concat(attempt.id)).size;
  if (completedItems >= 30) add("daily_30_items", { completed_items: completedItems });
  if (completedItems >= 100) add("daily_100_items", { completed_items: completedItems });

  const awarded = [];
  for (const badge of badges) {
    const row = await supabase.createUserBadge({
      user_id: userId,
      badge_id: badge.badgeId,
      awarded_at: now.toISOString(),
      metadata: badgeMetadata(now, badge.metadata)
    });
    awarded.push(row);
    existing.add(badge.badgeId);
  }
  return awarded.map((badge) => badge.badge_id);
}

export async function assessPractice({
  request,
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  azureAssessImpl = defaultAzureAssessment,
  timing = null
}) {
  const startedAt = performance.now();
  // Multipart parsing is independent from authentication. Running them together removes
  // one otherwise unnecessary server-side network wait from the critical path.
  const [input, { config, supabase, user }] = await Promise.all([
    readAssessmentInput(request),
    getPracticeContext({ request, env, fetchImpl, now })
  ]);
  if (timing) {
    timing.input_and_auth_ms = Math.round(performance.now() - startedAt);
    timing.result_json_bytes = JSON.stringify(input.azureRawJson).length;
  }

  const contextStartedAt = performance.now();
  const { practiceItem, targetPhonemeIds } = await resolvePracticeContext({ supabase, userId: user.id, input });
  if (timing) timing.practice_context_ms = Math.round(performance.now() - contextStartedAt);

  // Static advice metadata does not depend on Azure's result. Fetch it while the
  // external pronunciation service is working instead of adding it after saves.
  const presentationPromise = Promise.all([supabase.listActiveAdvicePages(), supabase.listActivePhonemes()]);
  void presentationPromise.catch(() => undefined);
  let azureRawJson;
  const assessmentStartedAt = performance.now();
  try {
    azureRawJson = await azureAssessImpl({ config, input, practiceItem, targetPhonemeIds, fetchImpl });
  } catch (error) {
    await logError(supabase, {
      userId: user.id,
      source: "azure",
      operation: "pronunciation_assessment",
      message: error instanceof ApiError ? error.message : "判定に失敗しました。",
      details: {
        code: error?.code,
        database: error?.details ?? null,
        practice_item_id: input.practiceItemId,
        practice_mode: input.practiceMode
      },
      now
    });
    throw error instanceof ApiError
      ? error
      : new ApiError("AZURE_ASSESSMENT_FAILED", "判定に失敗しました。", 502, true);
  }
  if (timing) timing.speech_assessment_ms = Math.round(performance.now() - assessmentStartedAt);

  try {
    const normalizationStartedAt = performance.now();
    const phonemeResults = normalizeAzurePhonemeResults({ azureRawJson, targetPhonemeIds });
    const normalizedResult = normalizePronunciationAssessment({
      azureRawJson,
      locale: input.locale ?? "en-US",
      referenceText: practiceItem.normalized_text,
      capabilities: capabilitiesForLocale(input.locale ?? "en-US"),
      timing: {
        buttonToResultMs: input.clientTiming?.buttonToResultMs ?? null,
        recognitionLatencyMs: input.clientTiming?.recognitionLatencyMs ?? null,
        totalProcessingMs: input.clientTiming?.totalProcessingMs ?? null
      }
    });
    const summary = summarizeAttempt(phonemeResults);
    if (timing) timing.normalization_ms = Math.round(performance.now() - normalizationStartedAt);
    const persistenceStartedAt = performance.now();
    const attempt = await supabase.createAttempt({
      user_id: user.id,
      daily_session_id: input.dailySessionId,
      daily_session_item_id: input.dailySessionItemId,
      practice_item_id: input.practiceItemId,
      practice_mode: input.practiceMode,
      attempt_no: input.attemptNo,
      practiced_at: now.toISOString(),
      practiced_date: input.practicedDate,
      timezone: input.timezone,
      target_phoneme_ids: targetPhonemeIds,
      overall_score: summary.overallScore,
      target_score_avg: summary.targetScoreAvg,
      is_correct: summary.isCorrect,
      is_perfect: summary.isPerfect,
      is_best: false,
      azure_raw_json: azureRawJson,
      normalized_result: normalizedResult,
      performance_metrics: input.clientTiming ?? null,
      app_version: input.appVersion
    });

    // Neither operation depends on the other. Keeping both durable while issuing them
    // concurrently avoids an extra Supabase round trip before the result is shown.
    const [best] = await Promise.all([
      recomputeBestAttempt({ supabase, userId: user.id, input, attempt }),
      supabase.createAttemptPhonemeResults(
        phonemeResults.map((result) => ({
          attempt_id: attempt.id,
          ...result
        }))
      )
    ]);
    let updatedStates = [];
    let completedDailySession = false;
    let earnedBadges = [];
    if (best.didBestChange && best.isNewAttemptBest) {
      const targetScores = targetScoresByPhoneme(phonemeResults, targetPhonemeIds);
      updatedStates = await upsertPhonemeStateAndSnapshots({
        supabase,
        userId: user.id,
        targetScores,
        practicedDate: input.practicedDate,
        now
      });
      const daily = await updateDailyCompletion({ supabase, input, attemptId: attempt.id, now });
      completedDailySession = daily.completedDailySession;
      earnedBadges = await awardBadges({
        supabase,
        userId: user.id,
        attempt: { ...attempt, ...summary, is_perfect: summary.isPerfect },
        completedDailySession,
        updatedStates,
        now
      });
    }

    const [advicePages, phonemes] = await presentationPromise;
    if (timing) {
      timing.persistence_ms = Math.round(performance.now() - persistenceStartedAt);
      timing.total_ms = Math.round(performance.now() - startedAt);
    }
    return {
      attempt_id: attempt.id,
      is_best: best.isNewAttemptBest,
      overall_score: summary.overallScore,
      target_score_avg: summary.targetScoreAvg,
      is_correct: summary.isCorrect,
      is_perfect: summary.isPerfect,
      pronunciation_assessment: normalizedResult,
      phoneme_results: phonemeResults.map((result) => ({
        index: result.index,
        word_index: result.word_index,
        expected_phoneme_id: result.expected_phoneme_id,
        expected_ipa: result.expected_ipa,
        observed_phoneme_id: result.observed_phoneme_id,
        observed_ipa: result.observed_ipa,
        score: result.score,
        color: result.color,
        is_target: result.is_target,
        confusion_pair_id: result.confusion_pair_id
      })),
      next: {
        recommended_advice_id: chooseRecommendedAdviceId({ phonemeResults, advicePages, phonemes })
      },
      earned_badges: earnedBadges
    };
  } catch (error) {
    await logError(supabase, {
      userId: user.id,
      source: "supabase",
      operation: "save_assessment",
      message: error instanceof ApiError ? error.message : "判定結果の保存に失敗しました。",
      details: {
        code: error?.code,
        database: error?.details ?? null,
        practice_item_id: input.practiceItemId,
        practice_mode: input.practiceMode
      },
      now
    });
    throw error;
  }
}

export async function handleAssess(options) {
  return ok(await assessPractice(options));
}
