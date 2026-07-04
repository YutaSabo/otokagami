import assert from "node:assert/strict";
import test from "node:test";

import { assessPractice } from "../lib/assess.mjs";
import { ApiError } from "../lib/http.mjs";

const userId = "11111111-1111-4111-8111-111111111111";
const env = {
  SUPABASE_URL: "http://supabase.test",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  REVENUECAT_SECRET_KEY: "revenuecat-secret",
  REVENUECAT_WEBHOOK_AUTH_TOKEN: "webhook-token",
  REVENUECAT_PRO_ENTITLEMENT_ID: "pro",
  AZURE_ASSESSMENT_MODE: "mock"
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

function createFetchMock(state) {
  return async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method ?? "GET";

    if (parsed.pathname === "/auth/v1/user") {
      const authorization = options.headers?.authorization ?? options.headers?.Authorization;
      return authorization === "Bearer valid-token" ? jsonResponse({ id: userId }) : jsonResponse({}, 401);
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

    return jsonResponse({ error: "unsupported method" }, 405);
  };
}

function assessRequest(overrides = {}) {
  const form = new FormData();
  form.set("audio", new Blob([Buffer.from("RIFFmock")], { type: "audio/wav; codecs=audio/pcm; samplerate=16000" }), "audio.wav");
  form.set("practice_item_id", overrides.practice_item_id ?? "word_r_001");
  form.set("practice_mode", overrides.practice_mode ?? "daily");
  form.set("daily_session_id", overrides.daily_session_id ?? "daily_sessions-1");
  form.set("daily_session_item_id", overrides.daily_session_item_id ?? "daily_session_items-1");
  form.set("attempt_no", String(overrides.attempt_no ?? 1));
  form.set("timezone", "Asia/Tokyo");
  form.set("practiced_date", overrides.practiced_date ?? "2026-07-04");
  form.set("app_version", "1.0.0");

  return new Request("http://api.test/api/assess", {
    method: "POST",
    headers: { authorization: "Bearer valid-token" },
    body: form
  });
}

function seedState({ completedDailyItems = 0, existingAttempts = [], existingResults = [] } = {}) {
  return {
    profiles: [
      {
        user_id: userId,
        free_trial_started_at: "2026-07-04T00:00:00.000Z",
        native_language: "ja",
        target_accent: "US"
      }
    ],
    subscriptions: [],
    phonemes: [
      phoneme("r", "consonant"),
      phoneme("l", "consonant"),
      phoneme("theta", "consonant"),
      phoneme("dh", "consonant"),
      phoneme("v", "consonant"),
      phoneme("b", "consonant")
    ],
    practice_items: [
      {
        practice_item_id: "word_r_001",
        item_type: "word",
        text: "right",
        normalized_text: "right",
        expected_ipa: "/raɪt/",
        accent: "US",
        ja_difficulty: "high",
        source: "manual_reviewed",
        is_active: true
      }
    ],
    practice_item_targets: [{ practice_item_id: "word_r_001", target_type: "phoneme", target_id: "r" }],
    daily_sessions: [
      {
        id: "daily_sessions-1",
        user_id: userId,
        session_date: "2026-07-04",
        timezone: "Asia/Tokyo",
        status: "in_progress",
        completed_count: completedDailyItems,
        created_at: "2026-07-04T00:00:00.000Z",
        completed_at: null
      }
    ],
    daily_session_items: Array.from({ length: 7 }, (_, index) => ({
      id: `daily_session_items-${index + 1}`,
      daily_session_id: "daily_sessions-1",
      position: index + 1,
      slot_type: index < 3 ? "weak" : index < 5 ? "new" : "review",
      practice_item_id: "word_r_001",
      target_phoneme_ids: ["r"],
      selection_reason: { source: "weak", phonemeId: "r" },
      status: index > 0 && index <= completedDailyItems ? "completed" : "pending",
      best_attempt_id: null,
      completed_at: index > 0 && index <= completedDailyItems ? "2026-07-04T00:00:00.000Z" : null
    })),
    attempts: existingAttempts,
    attempt_phoneme_results: existingResults,
    phoneme_state: [
      stateRow("r", 40, 2),
      stateRow("l", 82, 4),
      stateRow("theta", 70, 1),
      stateRow("dh", 70, 1),
      stateRow("v", 70, 1),
      stateRow("b", 70, 1)
    ],
    phoneme_snapshots: [],
    user_badges: [],
    advice_pages: [
      {
        advice_id: "r_to_l",
        confusion_pair_id: "r_to_l",
        generic_advice_id: null,
        native_language: "ja",
        target_accent: "US",
        title: "RとL",
        short_tip: "舌先をつけずに出します。",
        is_template: true,
        is_active: true
      },
      {
        advice_id: "generic_consonant_ja_us",
        confusion_pair_id: null,
        generic_advice_id: "generic_consonant",
        native_language: "ja",
        target_accent: "US",
        title: "子音",
        short_tip: "子音を確認します。",
        is_template: true,
        is_active: true
      }
    ],
    error_logs: []
  };
}

function phoneme(phonemeId, category) {
  return {
    phoneme_id: phonemeId,
    ipa: `/${phonemeId}/`,
    category,
    example_word: phonemeId,
    ja_difficulty: "high",
    sort_order: 1,
    is_active: true
  };
}

function stateRow(phonemeId, mastery, practiceCount) {
  return {
    user_id: userId,
    phoneme_id: phonemeId,
    mastery_ewma: mastery,
    practice_count: practiceCount,
    last_practiced_date: "2026-07-01",
    next_review_date: "2026-07-02",
    review_stage: 1
  };
}

function azureResult(score, observed = "l") {
  return {
    RecognitionStatus: "Success",
    DisplayText: "right",
    phoneme_results: [
      {
        index: 0,
        word_index: 0,
        expected_phoneme_id: "r",
        expected_ipa: "r",
        observed_phoneme_id: observed,
        observed_ipa: observed,
        score
      }
    ]
  };
}

test("assess saves attempt, phoneme results, aggregate state, snapshot, daily completion, badge, and advice", async () => {
  const state = seedState({ completedDailyItems: 6 });

  const result = await assessPractice({
    request: assessRequest(),
    env,
    fetchImpl: createFetchMock(state),
    now: new Date("2026-07-04T01:00:00.000Z")
  });

  assert.equal(state.attempts.length, 1);
  assert.equal(state.attempt_phoneme_results.length, 1);
  assert.equal(state.attempts[0].is_best, true);
  assert.equal(result.is_best, true);
  assert.equal(result.phoneme_results[0].confusion_pair_id, "r_to_l");
  assert.equal(result.next.recommended_advice_id, "r_to_l");
  assert.equal(state.phoneme_state.find((row) => row.phoneme_id === "r").mastery_ewma, 43.6);
  assert.equal(state.phoneme_state.find((row) => row.phoneme_id === "r").practice_count, 3);
  assert.equal(state.phoneme_snapshots.length, 1);
  assert.equal(state.daily_session_items[0].status, "completed");
  assert.equal(state.daily_sessions[0].status, "completed");
  assert.deepEqual(result.earned_badges, ["first_daily_complete"]);
  assert.equal(state.error_logs.length, 0);
});

test("assess recomputes best attempt and only new best updates aggregation", async () => {
  const state = seedState({
    existingAttempts: [
      {
        id: "attempts-1",
        user_id: userId,
        daily_session_id: "daily_sessions-1",
        daily_session_item_id: "daily_session_items-1",
        practice_item_id: "word_r_001",
        practice_mode: "daily",
        attempt_no: 1,
        practiced_at: "2026-07-04T00:30:00.000Z",
        practiced_date: "2026-07-04",
        timezone: "Asia/Tokyo",
        target_phoneme_ids: ["r"],
        overall_score: 52,
        target_score_avg: 52,
        is_correct: false,
        is_perfect: false,
        is_best: true,
        azure_raw_json: azureResult(52),
        created_at: "2026-07-04T00:30:00.000Z"
      }
    ],
    existingResults: [
      {
        id: "attempt_phoneme_results-1",
        attempt_id: "attempts-1",
        index: 0,
        expected_phoneme_id: "r",
        expected_ipa: "r",
        observed_phoneme_id: "l",
        observed_ipa: "l",
        score: 52,
        color: "red",
        is_target: true,
        confusion_pair_id: "r_to_l"
      }
    ]
  });

  const result = await assessPractice({
    request: assessRequest({ attempt_no: 2 }),
    env,
    fetchImpl: createFetchMock(state),
    now: new Date("2026-07-04T01:00:00.000Z"),
    azureAssessImpl: async () => azureResult(90, "r")
  });

  assert.equal(state.attempts[0].is_best, false);
  assert.equal(state.attempts[1].is_best, true);
  assert.equal(result.is_best, true);
  assert.equal(result.is_correct, true);
  assert.equal(result.is_perfect, true);
  assert.equal(state.phoneme_state.find((row) => row.phoneme_id === "r").mastery_ewma, 55);
  assert.deepEqual(result.earned_badges, ["first_perfect_item"]);
});

test("assess logs Azure failure without saving scored attempt or aggregation", async () => {
  const state = seedState();

  await assert.rejects(
    assessPractice({
      request: assessRequest(),
      env,
      fetchImpl: createFetchMock(state),
      now: new Date("2026-07-04T01:00:00.000Z"),
      azureAssessImpl: async () => {
        throw new ApiError("AZURE_ASSESSMENT_FAILED", "判定に失敗しました。", 502, true);
      }
    }),
    /判定に失敗しました。/
  );

  assert.equal(state.attempts.length, 0);
  assert.equal(state.attempt_phoneme_results.length, 0);
  assert.equal(state.phoneme_state.find((row) => row.phoneme_id === "r").mastery_ewma, 40);
  assert.equal(state.phoneme_snapshots.length, 0);
  assert.equal(state.user_badges.length, 0);
  assert.equal(state.error_logs.length, 1);
  assert.equal(state.error_logs[0].source, "azure");
  assert.doesNotMatch(JSON.stringify(state.error_logs), /RIFFmock|valid-token|service-role-key/);
});
