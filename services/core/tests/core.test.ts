import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateOverallMastery,
  calculateStreak,
  evaluateNewBadges,
  evaluateTitle,
  getLevel,
  getScoreColor,
  isPerfectAttempt,
  isQuestionCorrect,
  normalizePhonemeResult,
  resolveDailySession,
  selectBestAttempt,
  selectDailyItems,
  selectPhonemePracticeItems,
  selectWeakDrillItems,
  updateEwma,
  updatePhonemeStatesForBestAttempt,
  type PhonemeResult,
  type PhonemeState,
  type PracticeItem
} from "../src/index.js";

test("score colors use MVP boundaries", () => {
  assert.equal(getScoreColor(80), "green");
  assert.equal(getScoreColor(79.9), "yellow");
  assert.equal(getScoreColor(60), "yellow");
  assert.equal(getScoreColor(59.9), "red");
});

test("question correctness only uses target phonemes while perfect uses every phoneme", () => {
  const results = [
    result({ expectedPhonemeId: "r", score: 80, isTarget: true }),
    result({ expectedPhonemeId: "l", score: 20, isTarget: false })
  ];

  assert.equal(isQuestionCorrect(results), true);
  assert.equal(isPerfectAttempt(results), false);
  assert.equal(isPerfectAttempt(results.map((phoneme) => ({ ...phoneme, score: 80 }))), true);
});

test("EWMA uses first score as-is and then 0.3 score plus 0.7 old", () => {
  assert.equal(updateEwma(null, 70), 70);
  assert.equal(updateEwma(70, 100), 79);
});

test("phoneme state updates only pack target phonemes and advances review per phoneme", () => {
  const states = makeStates([
    ["r", 70, 1, "2026-07-01", 3, "2026-07-01", "high"],
    ["l", 90, 2, "2026-07-01", 4, "2026-07-01", "high"],
    ["theta", null, 0, null, 0, null, "high"]
  ]);

  const updated = updatePhonemeStatesForBestAttempt({
    states,
    practicedDate: "2026-07-04",
    bestAttempt: {
      id: "attempt_1",
      attemptNo: 1,
      overallScore: 50,
      phonemeResults: [
        result({ expectedPhonemeId: "r", score: 90, isTarget: true }),
        result({ expectedPhonemeId: "l", score: 50, isTarget: true }),
        result({ expectedPhonemeId: "theta", score: 95, isTarget: false })
      ]
    }
  });

  assert.equal(updated.find((state) => state.phonemeId === "r")?.masteryEwma, 76);
  assert.equal(updated.find((state) => state.phonemeId === "r")?.reviewStage, 2);
  assert.equal(updated.find((state) => state.phonemeId === "r")?.nextReviewDate, "2026-07-11");
  assert.equal(updated.find((state) => state.phonemeId === "l")?.reviewStage, 0);
  assert.equal(updated.find((state) => state.phonemeId === "l")?.nextReviewDate, "2026-07-05");
  assert.equal(updated.find((state) => state.phonemeId === "theta")?.masteryEwma, null);
});

test("free input does not update aggregation state", () => {
  const states = makeStates([["r", 70, 1, "2026-07-01", 3, "2026-07-01", "high"]]);

  const updated = updatePhonemeStatesForBestAttempt({
    states,
    practicedDate: "2026-07-04",
    isFreeInput: true,
    bestAttempt: {
      id: "free_1",
      attemptNo: 1,
      overallScore: 100,
      phonemeResults: [result({ expectedPhonemeId: "r", score: 100, isTarget: true })]
    }
  });

  assert.deepEqual(updated, states);
  assert.notEqual(updated[0], states[0]);
});

test("best attempt uses target average, then overall, then later attempt number", () => {
  const best = selectBestAttempt([
    attempt("a1", 1, 99, [80, 80]),
    attempt("a2", 2, 70, [90, 85]),
    attempt("a3", 3, 70, [90, 85]),
    attempt("a4", 4, 65, [90, 85])
  ]);

  assert.equal(best?.id, "a3");
});

test("overall mastery ignores unevaluated phonemes", () => {
  assert.equal(calculateOverallMastery(makeStates([
    ["r", 80, 1, "2026-07-07", 1, "2026-07-04", "high"],
    ["l", null, 0, null, 0, null, "high"],
    ["v", 60, 0, "2026-07-05", 1, "2026-07-04", "medium"]
  ])), 70);
});

test("streak uses scored pack attempt dates only supplied by caller", () => {
  assert.deepEqual(calculateStreak(["2026-07-01", "2026-07-02", "2026-07-04"], "2026-07-04"), {
    currentStreak: 1,
    longestStreak: 2
  });
  assert.deepEqual(calculateStreak(["2026-07-01", "2026-07-02", "2026-07-03"], "2026-07-04"), {
    currentStreak: 3,
    longestStreak: 3
  });
});

test("level, badges, and title follow MVP thresholds and priority", () => {
  const states = makeStates([
    ["theta", 81, 1, "2026-07-05", 2, "2026-07-04", "high"],
    ["dh", 20, 0, "2026-07-05", 1, "2026-07-04", "high"],
    ["r", 70, 0, "2026-07-05", 1, "2026-07-04", "high"],
    ["l", 90, 0, "2026-07-05", 1, "2026-07-04", "high"],
    ["v", 80, 0, "2026-07-05", 1, "2026-07-04", "medium"],
    ["b", 82, 0, "2026-07-05", 1, "2026-07-04", "medium"]
  ]);

  assert.equal(getLevel(50).level, 4);
  assert.deepEqual(
    evaluateNewBadges({
      existingBadgeIds: ["streak_3"],
      completedDailyCount: 1,
      currentStreak: 7,
      hasPerfectItem: true,
      phonemeStates: states,
      completedItemCount: 100
    }).map((badge) => badge.badgeId),
    [
      "first_daily_complete",
      "streak_7",
      "first_perfect_item",
      "th_green",
      "v_b_green",
      "daily_30_items",
      "daily_100_items"
    ]
  );
  assert.equal(
    evaluateTitle({
      today: "2026-07-04",
      currentStreak: 2,
      phonemeStates: states,
      recentPracticeDatesByPhoneme: { theta: ["2026-07-02"], r: ["2026-07-04"] },
      completedItemCount: 100
    }).titleId,
    "th_specialist"
  );
});

test("daily selection returns word5 sentence2 with slot distribution and no duplicates when enough items exist", () => {
  const selected = selectDailyItems({
    today: "2026-07-04",
    phonemeStates: selectionStates(),
    practiceItems: practiceItems()
  });

  assert.equal(selected.length, 7);
  assert.equal(selected.filter((item) => item.itemType === "word").length, 5);
  assert.equal(selected.filter((item) => item.itemType === "sentence").length, 2);
  assert.deepEqual(
    selected.map((item) => item.slotType),
    ["weak", "weak", "weak", "new", "new", "review", "review"]
  );
  assert.equal(new Set(selected.map((item) => item.practiceItemId)).size, 7);
  assert.equal(selected[0].selectionReason.phonemeId, "r");
  assert.equal(selected[3].selectionReason.phonemeId, "dh");
  assert.equal(selected[5].selectionReason.phonemeId, "v");
});

test("daily selection falls back when new candidates are short and marks duplicates only when unavoidable", () => {
  const selected = selectDailyItems({
    today: "2026-07-04",
    phonemeStates: makeStates([
      ["r", 50, 0, "2026-07-01", 3, "2026-07-01", "high"],
      ["v", 65, 0, "2026-06-30", 2, "2026-07-01", "high"]
    ]),
    practiceItems: [
      item("word_r_1", "word", ["r"], "high"),
      item("sent_r_1", "sentence", ["r"], "high")
    ]
  });

  assert.equal(selected.length, 7);
  assert.ok(selected.some((selectedItem) => selectedItem.selectionReason.fallbackFrom === "new"));
  assert.ok(selected.some((selectedItem) => selectedItem.selectionReason.duplicateAllowed));
});

test("weak drill and phoneme table practice use pack items only", () => {
  const weakDrill = selectWeakDrillItems({
    today: "2026-07-04",
    phonemeStates: selectionStates(),
    practiceItems: practiceItems(),
    limit: 3
  });
  const phonemePractice = selectPhonemePracticeItems({
    phonemeId: "theta",
    practiceItems: practiceItems(),
    limit: 2
  });

  assert.deepEqual(weakDrill.map((selected) => selected.selectionReason.source), ["weak", "weak", "weak"]);
  assert.ok(phonemePractice.every((selected) => selected.targetPhonemeIds.includes("theta")));
});

test("same session date reuses fixed daily session", () => {
  const existing = {
    sessionDate: "2026-07-04",
    timezone: "Asia/Tokyo",
    items: [{ practiceItemId: "word_r_1" }]
  };

  const resolved = resolveDailySession({
    existingSessions: [existing],
    sessionDate: "2026-07-04",
    timezone: "Asia/Tokyo",
    createItems: () => [{ practiceItemId: "word_new" }]
  });

  assert.equal(resolved.reusedExisting, true);
  assert.equal(resolved.items[0].practiceItemId, "word_r_1");
});

function result(overrides: Partial<PhonemeResult> = {}): PhonemeResult {
  return normalizePhonemeResult({
    index: overrides.index ?? 0,
    wordIndex: overrides.wordIndex ?? null,
    expectedPhonemeId: overrides.expectedPhonemeId ?? "r",
    expectedIpa: overrides.expectedIpa ?? "r",
    observedPhonemeId: overrides.observedPhonemeId ?? overrides.expectedPhonemeId ?? "r",
    observedIpa: overrides.observedIpa ?? overrides.expectedIpa ?? "r",
    score: overrides.score ?? 80,
    isTarget: overrides.isTarget ?? true,
    confusionPairId: overrides.confusionPairId ?? null
  });
}

function attempt(id: string, attemptNo: number, overallScore: number, targetScores: number[]) {
  return {
    id,
    attemptNo,
    overallScore,
    phonemeResults: targetScores.map((score, index) =>
      result({ index, expectedPhonemeId: `p_${index}`, score, isTarget: true })
    )
  };
}

function makeStates(rows: Array<[string, number | null, number, string | null, number, string | null, PhonemeState["jaDifficulty"]]>): PhonemeState[] {
  return rows.map(([phonemeId, masteryEwma, reviewStage, nextReviewDate, practiceCount, lastPracticedDate, jaDifficulty]) => ({
    phonemeId,
    masteryEwma,
    reviewStage,
    nextReviewDate,
    practiceCount,
    lastPracticedDate,
    jaDifficulty
  }));
}

function selectionStates(): PhonemeState[] {
  return makeStates([
    ["r", 45, 0, "2026-07-10", 5, "2026-07-01", "high"],
    ["l", 58, 0, "2026-07-10", 5, "2026-07-02", "high"],
    ["theta", null, 0, null, 0, null, "high"],
    ["dh", null, 0, null, 0, null, "high"],
    ["v", 65, 1, "2026-07-03", 3, "2026-06-29", "medium"],
    ["b", 75, 1, "2026-07-04", 3, "2026-06-30", "medium"]
  ]);
}

function practiceItems(): PracticeItem[] {
  return [
    item("word_r_1", "word", ["r"], "high"),
    item("word_r_2", "word", ["r"], "medium"),
    item("sent_r_1", "sentence", ["r"], "high"),
    item("word_l_1", "word", ["l"], "high"),
    item("sent_l_1", "sentence", ["l"], "high"),
    item("word_theta_1", "word", ["theta"], "high"),
    item("word_dh_1", "word", ["dh"], "high"),
    item("word_v_1", "word", ["v"], "medium"),
    item("sent_b_1", "sentence", ["b"], "medium"),
    item("word_inactive", "word", ["r"], "high", false)
  ];
}

function item(
  practiceItemId: string,
  itemType: PracticeItem["itemType"],
  targetPhonemeIds: string[],
  jaDifficulty: PracticeItem["jaDifficulty"],
  isActive = true
): PracticeItem {
  return {
    practiceItemId,
    itemType,
    targetPhonemeIds,
    jaDifficulty,
    isActive
  };
}
