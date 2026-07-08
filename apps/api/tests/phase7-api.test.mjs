import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { getAdvice } from "../lib/advice.mjs";
import { createPracticeSession, getOrCreateDailySession } from "../lib/practice-session.mjs";
import {
  createTts,
  getCachedOrRegeneratedTtsAudio,
  getTtsCacheKey,
  normalizeTtsText,
  ttsStoragePath
} from "../lib/tts.mjs";

const env = {
  SUPABASE_URL: "http://supabase.test",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  REVENUECAT_SECRET_KEY: "revenuecat-secret",
  REVENUECAT_WEBHOOK_AUTH_TOKEN: "webhook-token",
  REVENUECAT_PRO_ENTITLEMENT_ID: "pro",
  PYTHON_SERVICE_URL: "http://inference.test",
  PYTHON_SERVICE_API_KEY: "python-key",
  OPENAI_API_KEY: "openai-key"
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
    filtered.sort((a, b) => String(a[field]).localeCompare(String(b[field])));
    if (direction === "desc") filtered.reverse();
  }

  const limit = Number(searchParams.get("limit"));
  return Number.isFinite(limit) && limit > 0 ? filtered.slice(0, limit) : filtered;
}

function createFetchMock(state, userId = "11111111-1111-4111-8111-111111111111") {
  const calls = { ttsGeneration: 0 };

  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method ?? "GET";

    if (parsed.pathname === "/auth/v1/user") {
      const authorization = options.headers?.authorization ?? options.headers?.Authorization;
      return authorization === "Bearer valid-token" ? jsonResponse({ id: userId }) : jsonResponse({}, 401);
    }

    if (parsed.origin === "http://inference.test" && parsed.pathname === "/internal/tts") {
      calls.ttsGeneration += 1;
      return jsonResponse({
        ok: true,
        data: {
          audio_format: "wav",
          audio_base64: Buffer.from("RIFFmock").toString("base64"),
          duration_ms: 321
        }
      });
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

  fetchImpl.calls = calls;
  return fetchImpl;
}

function apiRequest(path, { method = "POST", body, token = "valid-token" } = {}) {
  return new Request(`http://api.test${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function seedState({ expiredTrial = false, aiCache = [] } = {}) {
  const userId = "11111111-1111-4111-8111-111111111111";
  const practiceItems = [
    item("word_r_001", "word", "right", "right", ["r"], "high"),
    item("word_r_inactive", "word", "wrong r", "wrong r", ["r"], "high", false),
    item("sent_r_001", "sentence", "Read it again.", "read it again", ["r"], "high"),
    item("word_l_001", "word", "light", "light", ["l"], "high"),
    item("sent_l_001", "sentence", "Light it up.", "light it up", ["l"], "high"),
    item("word_theta_001", "word", "think", "think", ["theta"], "high"),
    item("sent_theta_001", "sentence", "Think again.", "think again", ["theta"], "high"),
    item("word_dh_001", "word", "this", "this", ["dh"], "high"),
    item("word_ae_001", "word", "cat", "cat", ["ae"], "high"),
    item("word_v_001", "word", "van", "van", ["v"], "high"),
    item("sent_v_001", "sentence", "Move the van.", "move the van", ["v"], "high")
  ];
  const tts_cache = [];
  for (const row of practiceItems.filter((practiceItem) => practiceItem.is_active)) {
    for (const speed of ["normal", "slow"]) {
      const normalizedText = normalizeTtsText(row.normalized_text);
      const { cacheKey, textHash } = getTtsCacheKey({ normalizedText, accent: "US", speed });
      tts_cache.push({
        cache_key: cacheKey,
        text_hash: textHash,
        normalized_text: normalizedText,
        accent: "US",
        speed,
        storage_path: ttsStoragePath(cacheKey),
        duration_ms: 100,
        last_used_at: "2026-07-04T00:00:00.000Z"
      });
    }
  }

  return {
    profiles: [
      {
        user_id: userId,
        free_trial_started_at: expiredTrial ? "2026-06-20T00:00:00.000Z" : "2026-07-04T00:00:00.000Z",
        native_language: "ja",
        target_accent: "US"
      }
    ],
    subscriptions: [],
    phonemes: [
      phoneme("ae", "high", 10),
      phoneme("dh", "high", 20),
      phoneme("l", "high", 30),
      phoneme("r", "high", 40),
      phoneme("theta", "high", 50),
      phoneme("v", "high", 60)
    ],
    phoneme_state: [
      stateRow(userId, "r", 30, 5, "2026-07-01", "2026-07-02"),
      stateRow(userId, "l", 45, 4, "2026-07-01", "2026-07-05"),
      stateRow(userId, "theta", 70, 2, "2026-07-01", "2026-07-08"),
      stateRow(userId, "v", 80, 3, "2026-07-01", "2026-07-03")
    ],
    practice_items: practiceItems,
    practice_item_targets: practiceItems.flatMap((practiceItem) =>
      practiceItem.target_phoneme_ids.map((targetId) => ({
        practice_item_id: practiceItem.practice_item_id,
        target_type: "phoneme",
        target_id: targetId
      }))
    ),
    daily_sessions: [],
    daily_session_items: [],
    tts_cache,
    advice_pages: [
      {
        advice_id: "r_to_l",
        confusion_pair_id: "r_to_l",
        generic_advice_id: null,
        native_language: "ja",
        target_accent: "US",
        title: "RとL",
        short_tip: "舌先を奥へ引いて、口の天井に触れないようにします。",
        comparison_text: "Rは舌を奥へ、Lは舌先を上につけます。",
        coach_example_text: "right light",
        asset_id: "r_to_l",
        is_template: true,
        is_active: true
      },
      {
        advice_id: "generic_consonant",
        confusion_pair_id: null,
        generic_advice_id: "generic_consonant",
        native_language: "ja",
        target_accent: "US",
        title: "子音の調整",
        short_tip: "口の形を小さく変えて、狙う子音を短く出します。",
        comparison_text: "子音ごとの舌と唇の位置を確認します。",
        coach_example_text: "say it again",
        asset_id: "generic_consonant",
        is_template: false,
        is_active: true
      }
    ],
    ai_advice_cache: aiCache
  };
}

function phoneme(phonemeId, jaDifficulty, sortOrder) {
  return {
    phoneme_id: phonemeId,
    ipa: `/${phonemeId}/`,
    category: "consonant",
    example_word: phonemeId,
    ja_difficulty: jaDifficulty,
    sort_order: sortOrder,
    is_active: true
  };
}

function stateRow(userId, phonemeId, mastery, practiceCount, lastPracticedDate, nextReviewDate) {
  return {
    user_id: userId,
    phoneme_id: phonemeId,
    mastery_ewma: mastery,
    practice_count: practiceCount,
    last_practiced_date: lastPracticedDate,
    next_review_date: nextReviewDate,
    review_stage: 1
  };
}

function item(practiceItemId, itemType, text, normalizedText, targetPhonemeIds, jaDifficulty, isActive = true) {
  return {
    practice_item_id: practiceItemId,
    item_type: itemType,
    text,
    normalized_text: normalizedText,
    expected_ipa: `/${normalizedText}/`,
    accent: "US",
    ja_difficulty: jaDifficulty,
    source: isActive ? "manual_reviewed" : "seed_ai_generated",
    is_active: isActive,
    target_phoneme_ids: targetPhonemeIds
  };
}

test("daily-session creates seven fixed items with word/sentence and slot distribution, then reuses the same day", async () => {
  const state = seedState();
  const fetchImpl = createFetchMock(state);

  const first = await getOrCreateDailySession({
    request: apiRequest("/api/daily-session", {
      body: { session_date: "2026-07-04", timezone: "Asia/Tokyo" }
    }),
    env,
    fetchImpl,
    now: new Date("2026-07-04T01:00:00.000Z")
  });

  assert.equal(first.items.length, 7);
  assert.equal(first.items.filter((item) => item.practice_item_id.startsWith("word_")).length, 5);
  assert.equal(first.items.filter((item) => item.practice_item_id.startsWith("sent_")).length, 2);
  assert.deepEqual(first.items.map((item) => item.slot_type), ["weak", "weak", "weak", "new", "new", "review", "review"]);
  assert.equal(new Set(first.items.map((item) => item.practice_item_id)).size, 7);
  assert.ok(first.items.every((item) => item.tts.normal_url && item.tts.slow_url));
  assert.ok(!first.items.some((item) => item.practice_item_id === "word_r_inactive"));

  const second = await getOrCreateDailySession({
    request: apiRequest("/api/daily-session", {
      body: { session_date: "2026-07-04", timezone: "Asia/Tokyo" }
    }),
    env,
    fetchImpl,
    now: new Date("2026-07-04T02:00:00.000Z")
  });

  assert.deepEqual(
    second.items.map((item) => item.practice_item_id),
    first.items.map((item) => item.practice_item_id)
  );
  assert.equal(state.daily_sessions.length, 1);
});

test("practice-session weak drill prioritizes weak phonemes and phoneme_select requires and filters phoneme_id", async () => {
  const state = seedState();
  const fetchImpl = createFetchMock(state);

  const weak = await createPracticeSession({
    request: apiRequest("/api/practice-session", {
      body: { mode: "weak_drill", session_date: "2026-07-04", timezone: "Asia/Tokyo", limit: 3 }
    }),
    env,
    fetchImpl
  });

  assert.equal(weak.mode, "weak_drill");
  assert.equal(weak.items[0].target_phoneme_ids[0], "r");
  assert.ok(!weak.items.some((practiceItem) => practiceItem.practice_item_id === "word_r_inactive"));

  const selected = await createPracticeSession({
    request: apiRequest("/api/practice-session", {
      body: { mode: "phoneme_select", phoneme_id: "theta", session_date: "2026-07-04", limit: 2 }
    }),
    env,
    fetchImpl
  });

  assert.ok(selected.items.every((practiceItem) => practiceItem.target_phoneme_ids.includes("theta")));

  await assert.rejects(
    createPracticeSession({
      request: apiRequest("/api/practice-session", {
        body: { mode: "phoneme_select", session_date: "2026-07-04" }
      }),
      env,
      fetchImpl
    }),
    /phoneme_id が必要です。/
  );
});

test("practice access rejects expired trial without Pro", async () => {
  const fetchImpl = createFetchMock(seedState({ expiredTrial: true }));

  await assert.rejects(
    getOrCreateDailySession({
      request: apiRequest("/api/daily-session", {
        body: { session_date: "2026-07-12", timezone: "Asia/Tokyo" }
      }),
      env,
      fetchImpl,
      now: new Date("2026-07-12T00:00:00.000Z")
    }),
    /Proプランが必要です。/
  );
});

test("tts uses cache without regenerating audio", async () => {
  const state = seedState();
  const fetchImpl = createFetchMock(state);

  const tts = await createTts({
    request: apiRequest("/api/tts", {
      body: { text: "right", accent: "US", speed: "normal" }
    }),
    env,
    fetchImpl
  });

  assert.equal(tts.cached, true);
  assert.equal(fetchImpl.calls.ttsGeneration, 0);
});

test("tts audio regenerates missing tmp file from cache metadata", async () => {
  const state = seedState();
  const fetchImpl = createFetchMock(state);
  const normalizedText = normalizeTtsText("right");
  const { cacheKey } = getTtsCacheKey({ normalizedText, accent: "US", speed: "normal" });
  let writtenAudio = null;

  const audio = await getCachedOrRegeneratedTtsAudio({
    cacheKey,
    env,
    fetchImpl,
    readFileImpl: async () => {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    },
    mkdirImpl: async () => {},
    writeFileImpl: async (_path, data) => {
      writtenAudio = data;
    }
  });

  assert.equal(audio.toString(), "RIFFmock");
  assert.equal(writtenAudio.toString(), "RIFFmock");
  assert.equal(fetchImpl.calls.ttsGeneration, 1);
});

test("advice returns active template pages without OpenAI and uses ai_advice_cache before fallback generation", async () => {
  const cachedKey = "advice:cached";
  const cachedState = seedState({
    aiCache: [
      {
        cache_key: cachedKey,
        native_language: "ja",
        target_accent: "US",
        confusion_pair_id: null,
        generic_advice_id: "generic_consonant",
        prompt_version: "phase7-short-advice-v1",
        output_text: "キャッシュ済みの短い助言です。",
        last_used_at: "2026-07-04T00:00:00.000Z"
      }
    ]
  });
  let openAiCalls = 0;

  const template = await getAdvice({
    request: apiRequest("/api/advice/r_to_l?expected_phoneme_id=r&observed_phoneme_id=l", { method: "GET" }),
    adviceId: "r_to_l",
    env,
    fetchImpl: createFetchMock(cachedState),
    openAiImpl: async () => {
      openAiCalls += 1;
      return "should not be used";
    }
  });
  assert.equal(template.ai_source, "template");
  assert.equal(openAiCalls, 0);

  const page = cachedState.advice_pages.find((row) => row.advice_id === "generic_consonant");
  const realCacheKey = cacheKeyForTest(page, "theta", "s");
  cachedState.ai_advice_cache[0].cache_key = realCacheKey;

  const cached = await getAdvice({
    request: apiRequest("/api/advice/generic_consonant?expected_phoneme_id=theta&observed_phoneme_id=s", { method: "GET" }),
    adviceId: "generic_consonant",
    env,
    fetchImpl: createFetchMock(cachedState),
    openAiImpl: async () => {
      openAiCalls += 1;
      return "should not be used";
    }
  });
  assert.equal(cached.short_tip, "キャッシュ済みの短い助言です。");
  assert.equal(cached.ai_source, "cache");
  assert.equal(openAiCalls, 0);

  const missState = seedState();
  const generated = await getAdvice({
    request: apiRequest("/api/advice/generic_consonant?expected_phoneme_id=theta&observed_phoneme_id=t", { method: "GET" }),
    adviceId: "generic_consonant",
    env,
    fetchImpl: createFetchMock(missState),
    openAiImpl: async () => {
      openAiCalls += 1;
      return "舌先を歯に近づけ、息を細く出します。";
    }
  });

  assert.equal(generated.ai_source, "openai");
  assert.equal(openAiCalls, 1);
  assert.equal(missState.ai_advice_cache.length, 1);
});

function cacheKeyForTest(page, expectedPhonemeId, observedPhonemeId) {
  const identity = {
    native_language: page.native_language,
    target_accent: page.target_accent,
    confusion_pair_id: page.confusion_pair_id,
    generic_advice_id: page.generic_advice_id,
    expected_phoneme_id: expectedPhonemeId,
    observed_phoneme_id: observedPhonemeId,
    prompt_version: "phase7-short-advice-v1"
  };
  return `advice:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}
