import assert from "node:assert/strict";
import test from "node:test";

import {
  assessFreeText,
  deleteLearningData,
  exportLearningData,
  getProgress,
  saveAdviceFeedback,
  saveFreeTextConsent
} from "../lib/phase9.mjs";

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const env = {
  SUPABASE_URL: "http://supabase.test",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  REVENUECAT_SECRET_KEY: "revenuecat-secret",
  REVENUECAT_WEBHOOK_AUTH_TOKEN: "webhook-token",
  REVENUECAT_PRO_ENTITLEMENT_ID: "pro",
  PYTHON_SERVICE_URL: "http://inference.test",
  PYTHON_SERVICE_API_KEY: "python-key",
  AZURE_ASSESSMENT_MODE: "mock",
  FREE_TEXT_DAILY_SOFT_CAP: "20"
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function parseComparable(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return decodeURIComponent(value);
}

function filterRows(rows, searchParams) {
  let filtered = [...rows];
  for (const [key, value] of searchParams.entries()) {
    if (["select", "limit", "order"].includes(key)) continue;
    if (value.startsWith("eq.")) {
      const expected = parseComparable(value.slice(3));
      filtered = filtered.filter((row) => row[key] === expected || String(row[key]) === String(expected));
    } else if (value.startsWith("in.(") && value.endsWith(")")) {
      const expected = new Set(value.slice(4, -1).split(",").map(parseComparable));
      filtered = filtered.filter((row) => expected.has(row[key]));
    }
  }

  const order = searchParams.get("order");
  if (order) {
    const [field, direction = "asc"] = order.split(".");
    filtered.sort((a, b) => String(a[field] ?? "").localeCompare(String(b[field] ?? "")));
    if (direction === "desc") filtered.reverse();
  }

  const limit = Number(searchParams.get("limit"));
  return Number.isFinite(limit) && limit > 0 ? filtered.slice(0, limit) : filtered;
}

function createFetchMock(state, currentUserId = userId) {
  return async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method ?? "GET";

    if (parsed.pathname === "/auth/v1/user") {
      const authorization = options.headers?.authorization ?? options.headers?.Authorization;
      return authorization === "Bearer valid-token" ? jsonResponse({ id: currentUserId }) : jsonResponse({}, 401);
    }

    const table = parsed.pathname.split("/").at(-1);
    const collection = state[table];
    if (!collection) return jsonResponse({ error: "not found" }, 404);

    if (method === "GET") return jsonResponse(filterRows(collection, parsed.searchParams));

    if (method === "POST") {
      const body = JSON.parse(options.body);
      const rows = Array.isArray(body) ? body : [body];
      const stored = rows.map((row) => {
        const id = row.id ?? `${table}-${collection.length + 1}`;
        const next = { id, ...row };
        collection.push(next);
        return next;
      });
      return jsonResponse(stored, 201);
    }

    if (method === "PATCH") {
      const rows = filterRows(collection, parsed.searchParams);
      const patch = JSON.parse(options.body);
      for (const row of rows) Object.assign(row, patch);
      return jsonResponse(rows);
    }

    if (method === "DELETE") {
      const rows = new Set(filterRows(collection, parsed.searchParams));
      for (let index = collection.length - 1; index >= 0; index -= 1) {
        if (rows.has(collection[index])) collection.splice(index, 1);
      }
      return new Response(null, { status: 204 });
    }

    return jsonResponse({ error: "unsupported method" }, 405);
  };
}

function jsonRequest(path, body, method = "POST") {
  return new Request(`http://api.test${path}`, {
    method,
    headers: {
      authorization: "Bearer valid-token",
      "content-type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function freeAssessRequest(overrides = {}) {
  const form = new FormData();
  form.set("text", overrides.text ?? "Read it again.");
  form.set("audio", new Blob([Buffer.from("RIFFmock-user-audio")], { type: "audio/wav" }), "audio.wav");
  form.set("timezone", "Asia/Tokyo");
  form.set("attempted_date", overrides.attempted_date ?? "2026-07-04");
  form.set("consent_version", overrides.consent_version ?? "free_text_ja_v1");
  form.set("app_version", "1.0.0");

  return new Request("http://api.test/api/free-assess", {
    method: "POST",
    headers: { authorization: "Bearer valid-token" },
    body: form
  });
}

function seedState({ pro = true, consent = true, freeAttemptCount = 0 } = {}) {
  return {
    profiles: [
      {
        user_id: userId,
        anon_public_id: "pm_user",
        native_language: "ja",
        target_accent: "US",
        free_trial_started_at: "2026-07-04T00:00:00.000Z",
        timezone: "Asia/Tokyo",
        free_text_consent_version: consent ? "free_text_ja_v1" : null,
        free_text_consented_at: consent ? "2026-07-04T00:00:00.000Z" : null
      }
    ],
    subscriptions: pro
      ? [
          {
            id: "sub-1",
            user_id: userId,
            revenuecat_app_user_id: userId,
            entitlement_id: "pro",
            product_id: "pm_pro_monthly",
            is_active: true
          }
        ]
      : [],
    phonemes: [
      phoneme("r", 10),
      phoneme("l", 20),
      phoneme("theta", 30)
    ],
    attempts: [
      attempt("attempt-1", "2026-07-01", ["r"]),
      attempt("attempt-2", "2026-07-02", ["r"]),
      attempt("attempt-3", "2026-07-04", ["theta"])
    ],
    attempt_phoneme_results: [
      {
        id: "result-1",
        attempt_id: "attempt-1",
        index: 0,
        expected_phoneme_id: "r",
        expected_ipa: "r",
        score: 85,
        color: "green",
        is_target: true
      }
    ],
    daily_sessions: [
      {
        id: "daily-1",
        user_id: userId,
        session_date: "2026-07-04",
        timezone: "Asia/Tokyo",
        status: "completed",
        completed_count: 7
      }
    ],
    daily_session_items: [
      {
        id: "daily-item-1",
        daily_session_id: "daily-1",
        position: 1,
        slot_type: "weak",
        practice_item_id: "word_r_001",
        target_phoneme_ids: ["r"],
        status: "completed"
      }
    ],
    phoneme_state: [
      {
        user_id: userId,
        phoneme_id: "r",
        mastery_ewma: 80,
        practice_count: 3,
        last_practiced_date: "2026-07-02",
        next_review_date: "2026-07-05",
        review_stage: 2
      },
      {
        user_id: userId,
        phoneme_id: "theta",
        mastery_ewma: 60,
        practice_count: 1,
        last_practiced_date: "2026-07-04",
        next_review_date: "2026-07-05",
        review_stage: 1
      }
    ],
    phoneme_snapshots: [
      {
        user_id: userId,
        snapshot_date: "2026-07-04",
        phoneme_id: "r",
        mastery_ewma: 80
      },
      {
        user_id: userId,
        snapshot_date: "2026-07-04",
        phoneme_id: "theta",
        mastery_ewma: 60
      }
    ],
    user_badges: [{ user_id: userId, badge_id: "streak_3", awarded_at: "2026-07-04T00:00:00.000Z" }],
    user_bookmarks: [
      {
        id: "bookmark-1",
        user_id: userId,
        bookmark_type: "phoneme",
        phoneme_id: "r",
        created_at: "2026-07-04T00:00:00.000Z"
      }
    ],
    free_attempts: Array.from({ length: freeAttemptCount }, (_, index) => freeAttempt(`free-${index + 1}`, userId)),
    advice_pages: [
      {
        advice_id: "r_to_l",
        confusion_pair_id: "r_to_l",
        native_language: "ja",
        target_accent: "US",
        title: "RとL",
        short_tip: "舌先をつけずに出します。",
        is_template: true,
        is_active: true
      }
    ],
    advice_feedback: [],
    error_logs: []
  };
}

function phoneme(phonemeId, sortOrder) {
  return {
    phoneme_id: phonemeId,
    ipa: `/${phonemeId}/`,
    category: "consonant",
    example_word: phonemeId,
    ja_difficulty: "high",
    sort_order: sortOrder,
    is_active: true
  };
}

function attempt(id, practicedDate, targetPhonemeIds, ownerId = userId) {
  return {
    id,
    user_id: ownerId,
    practice_item_id: "word_r_001",
    practice_mode: "daily",
    attempt_no: 1,
    practiced_at: `${practicedDate}T00:00:00.000Z`,
    practiced_date: practicedDate,
    timezone: "Asia/Tokyo",
    target_phoneme_ids: targetPhonemeIds,
    overall_score: 80,
    target_score_avg: 80,
    is_correct: true,
    is_perfect: true,
    is_best: true,
    azure_raw_json: { RecognitionStatus: "Success" }
  };
}

function freeAttempt(id, ownerId) {
  return {
    id,
    user_id: ownerId,
    attempted_at: "2026-07-04T00:00:00.000Z",
    attempted_date: "2026-07-04",
    timezone: "Asia/Tokyo",
    input_text: "Read it again.",
    normalized_text: "read it again",
    ipa_result: { ipa: "r i d" },
    oov_words: [],
    conversion_confidence: 0.9,
    phoneme_scores: [{ expected_phoneme_id: "r", score: 88 }],
    word_scores: null,
    overall_score: 88,
    azure_raw_json: { RecognitionStatus: "Success" },
    native_language: "ja",
    target_accent: "US",
    pii_flag: false,
    consent_version: "free_text_ja_v1",
    app_version: "1.0.0"
  };
}

const ipaConversionImpl = async () => ({
  normalized_text: "read it again",
  ipa: "r i d",
  words: [],
  oov_words: [],
  conversion_confidence: 0.91,
  phoneme_ids: ["r"]
});

const azureAssessImpl = async () => ({
  RecognitionStatus: "Success",
  phoneme_results: [
    {
      index: 0,
      word_index: 0,
      expected_phoneme_id: "r",
      expected_ipa: "r",
      observed_phoneme_id: "r",
      observed_ipa: "r",
      score: 88
    }
  ]
});

test("free-text consent and free-assess reject trial-only users because free input is Pro-only", async () => {
  const state = seedState({ pro: false, consent: false });
  const fetchImpl = createFetchMock(state);

  await assert.rejects(
    saveFreeTextConsent({
      request: jsonRequest("/api/free-text-consent", { consent_version: "free_text_ja_v1" }),
      env,
      fetchImpl
    }),
    { code: "FREE_TEXT_PRO_REQUIRED" }
  );

  await assert.rejects(
    assessFreeText({
      request: freeAssessRequest(),
      env,
      fetchImpl,
      ipaConversionImpl,
      azureAssessImpl
    }),
    { code: "FREE_TEXT_PRO_REQUIRED" }
  );
});

test("free-text consent stores version and timestamp for Pro users", async () => {
  const state = seedState({ pro: true, consent: false });
  const result = await saveFreeTextConsent({
    request: jsonRequest("/api/free-text-consent", { consent_version: "free_text_ja_v1" }),
    env,
    fetchImpl: createFetchMock(state),
    now: new Date("2026-07-04T02:00:00.000Z")
  });

  assert.equal(result.free_text_consent_version, "free_text_ja_v1");
  assert.equal(result.free_text_consented_at, "2026-07-04T02:00:00.000Z");
  assert.equal(state.profiles[0].free_text_consent_version, "free_text_ja_v1");
});

test("free-assess rejects missing consent and daily soft-cap overage", async () => {
  await assert.rejects(
    assessFreeText({
      request: freeAssessRequest(),
      env,
      fetchImpl: createFetchMock(seedState({ pro: true, consent: false })),
      ipaConversionImpl,
      azureAssessImpl
    }),
    { code: "FREE_TEXT_CONSENT_REQUIRED" }
  );

  await assert.rejects(
    assessFreeText({
      request: freeAssessRequest(),
      env,
      fetchImpl: createFetchMock(seedState({ pro: true, consent: true, freeAttemptCount: 20 })),
      ipaConversionImpl,
      azureAssessImpl
    }),
    { code: "RATE_LIMITED" }
  );
});

test("successful free-assess saves only free_attempts and leaves aggregation untouched", async () => {
  const state = seedState({ pro: true, consent: true });
  const beforeState = structuredClone(state.phoneme_state);

  const result = await assessFreeText({
    request: freeAssessRequest(),
    env,
    fetchImpl: createFetchMock(state),
    ipaConversionImpl,
    azureAssessImpl,
    now: new Date("2026-07-04T03:00:00.000Z")
  });

  assert.equal(result.free_attempt_id, "free_attempts-1");
  assert.equal(state.free_attempts.length, 1);
  assert.equal(state.free_attempts[0].input_text, "Read it again.");
  assert.equal(state.free_attempts[0].overall_score, 88);
  assert.deepEqual(state.phoneme_state, beforeState);
  assert.equal(state.phoneme_snapshots.length, 2);
  assert.equal(state.attempts.length, 3);
  assert.equal(state.user_badges.length, 1);
});

test("progress uses attempts and phoneme_state, not free_attempts", async () => {
  const state = seedState({ pro: true, consent: true, freeAttemptCount: 3 });
  state.free_attempts.push({ ...freeAttempt("free-future", userId), attempted_date: "2026-07-05" });

  const progress = await getProgress({
    request: jsonRequest("/api/progress", undefined, "GET"),
    env,
    fetchImpl: createFetchMock(state),
    now: new Date("2026-07-05T00:00:00.000Z")
  });

  assert.equal(progress.streak.current, 1);
  assert.equal(progress.streak.longest, 2);
  assert.equal(progress.overall_mastery, 70);
  assert.equal(progress.level.completed_items, 3);
  assert.equal(progress.phoneme_heatmap.find((item) => item.phoneme_id === "r").color, "green");
});

test("advice-feedback stores only for the caller's attempt or free_attempt", async () => {
  const state = seedState({ pro: true, consent: true, freeAttemptCount: 1 });
  state.attempts.push(attempt("other-attempt", "2026-07-04", ["r"], otherUserId));
  state.free_attempts.push(freeAttempt("other-free", otherUserId));

  const packFeedback = await saveAdviceFeedback({
    request: jsonRequest("/api/advice-feedback", {
      attempt_id: "attempt-1",
      free_attempt_id: null,
      advice_id: "r_to_l",
      rating: "up"
    }),
    env,
    fetchImpl: createFetchMock(state)
  });

  assert.equal(packFeedback.attempt_id, "attempt-1");
  assert.equal(packFeedback.free_attempt_id, null);

  const freeFeedback = await saveAdviceFeedback({
    request: jsonRequest("/api/advice-feedback", {
      attempt_id: null,
      free_attempt_id: "free-1",
      advice_id: "r_to_l",
      rating: "down"
    }),
    env,
    fetchImpl: createFetchMock(state)
  });

  assert.equal(freeFeedback.free_attempt_id, "free-1");

  await assert.rejects(
    saveAdviceFeedback({
      request: jsonRequest("/api/advice-feedback", {
        attempt_id: "other-attempt",
        advice_id: "r_to_l",
        rating: "up"
      }),
      env,
      fetchImpl: createFetchMock(state)
    }),
    { code: "FORBIDDEN" }
  );
});

test("export includes learning data but no audio body or secrets", async () => {
  const state = seedState({ pro: true, consent: true, freeAttemptCount: 1 });
  const exported = await exportLearningData({
    request: jsonRequest("/api/export", {}),
    env,
    fetchImpl: createFetchMock(state),
    now: new Date("2026-07-04T04:00:00.000Z")
  });
  const serialized = JSON.stringify(exported);

  assert.equal(exported.free_attempts.length, 1);
  assert.equal(exported.attempt_phoneme_results.length, 1);
  assert.equal(exported.daily_sessions.length, 1);
  assert.equal(exported.daily_session_items.length, 1);
  assert.doesNotMatch(serialized, /RIFFmock-user-audio/);
  assert.doesNotMatch(serialized, /service-role-key|revenuecat-secret|python-key/);
});

test("delete-learning-data removes learning rows and keeps profile and subscription state", async () => {
  const state = seedState({ pro: true, consent: true, freeAttemptCount: 1 });
  state.advice_feedback.push({
    id: "feedback-1",
    user_id: userId,
    attempt_id: "attempt-1",
    free_attempt_id: null,
    advice_id: "r_to_l",
    rating: "up"
  });

  const deleted = await deleteLearningData({
    request: jsonRequest("/api/delete-learning-data", { confirm: true }),
    env,
    fetchImpl: createFetchMock(state),
    now: new Date("2026-07-04T05:00:00.000Z")
  });

  assert.equal(deleted.local_recordings_action_required, true);
  assert.equal(state.attempts.length, 0);
  assert.equal(state.attempt_phoneme_results.length, 0);
  assert.equal(state.daily_sessions.length, 0);
  assert.equal(state.daily_session_items.length, 0);
  assert.equal(state.phoneme_state.length, 0);
  assert.equal(state.phoneme_snapshots.length, 0);
  assert.equal(state.user_badges.length, 0);
  assert.equal(state.user_bookmarks.length, 0);
  assert.equal(state.free_attempts.length, 0);
  assert.equal(state.advice_feedback.length, 0);
  assert.equal(state.profiles.length, 1);
  assert.equal(state.profiles[0].free_trial_started_at, "2026-07-04T00:00:00.000Z");
  assert.equal(state.subscriptions.length, 1);
});
