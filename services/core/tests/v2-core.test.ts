import assert from "node:assert/strict";
import test from "node:test";

import {
  addCalendarDays,
  calendarDateFromInstant,
  canonicalPayloadSha256,
  createDailyPlan,
  createReviewScheduleCandidates,
  deriveFocusState,
  evaluateSessionCompletion,
  evaluateShortening,
  optionalExtensionsAvailable,
  normalizeAzureFocusResult,
  AZURE_V2_CAPACITY_REFERENCE,
  AZURE_V2_PROVIDER_PAYLOAD_MAX_BYTES,
  resumeProgramDayPlan,
  resolveProgramDayPlan,
  reviewStatusForDate,
  selectCountedAttempts,
  selectDueReview,
  selectDurableEvidenceCandidates,
  type CompletionItem,
  type ContentCandidate,
  type CorrectionCycle,
  type DailyPlan,
  type FocusCandidate,
  type FocusEvidence,
  type FocusState,
  type LearningAttempt,
  type LearningPolicy,
  type PolicyDecision,
  type PromptRole,
  type ReviewScheduleCandidate
} from "../src/v2/index.js";

const CONTENT_VERSION = "content-v1";
const FOCUS = "r-l";
const USER = "user-a";
const COMPLETION_KEY = "11111111-1111-4111-8111-111111111111";

test("date-only addition handles month, year and leap boundaries", () => {
  assert.equal(addCalendarDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addCalendarDays("2024-02-29", 1), "2024-03-01");
  assert.equal(addCalendarDays("2025-12-31", 1), "2026-01-01");
  assert.equal(addCalendarDays("2026-03-01", -1), "2026-02-28");
  assert.throws(() => addCalendarDays("2026-02-30", 1), RangeError);
  assert.throws(() => addCalendarDays("2026-01-01", 0.5), RangeError);
});

test("Calendar Date uses explicit IANA timezone across DST and day boundaries", () => {
  assert.equal(calendarDateFromInstant("2026-03-08T07:30:00Z", "America/New_York"), "2026-03-08");
  assert.equal(calendarDateFromInstant("2026-08-01T15:30:00Z", "Asia/Tokyo"), "2026-08-02");
  assert.equal(calendarDateFromInstant("2026-08-01T15:30:00Z", "America/Los_Angeles"), "2026-08-01");
  assert.throws(() => calendarDateFromInstant("not-an-instant", "Asia/Tokyo"), RangeError);
  assert.throws(() => calendarDateFromInstant("2026-02-30T00:00:00Z", "Asia/Tokyo"), RangeError);
  assert.throws(() => calendarDateFromInstant("2026-08-01", "Asia/Tokyo"), RangeError);
  assert.throws(() => calendarDateFromInstant("2026-01-01T00:00:00Z", "Mars/Base"), RangeError);
});

test("v2 Azure normalizer emits only allowlisted focus fields with a fixture-derived byte limit", () => {
  const checkedFixtureEnvelope = new TextEncoder().encode(JSON.stringify(AZURE_V2_CAPACITY_REFERENCE)).byteLength * 4;
  assert.ok(AZURE_V2_PROVIDER_PAYLOAD_MAX_BYTES >= checkedFixtureEnvelope);
  assert.equal(Math.log2(AZURE_V2_PROVIDER_PAYLOAD_MAX_BYTES) % 1, 0);
  const result = normalizeAzureFocusResult({
    providerPayload: AZURE_V2_CAPACITY_REFERENCE,
    referenceText: "think now",
    contentVersionId: CONTENT_VERSION,
    practiceItemKey: "think-now",
    targetLocator: { wordIndex: 0, phonemeIndex: 0 },
    expectedFocusRepresentation: "θ",
    referenceTextVersion: "fixture-v1",
    nextActionKey: "tongue_forward",
    assessmentLocale: "en-US"
  });
  assert.equal(result.observedCandidate, "s");
  assert.equal(result.targetScore, 46);
  assert.equal(result.resultLabel, "measured");
  assert.deepEqual(Object.keys(result.normalizedDetail), ["recognitionStatus"]);
  assert.equal(canonicalPayloadSha256({ b: 2, a: 1 }), canonicalPayloadSha256({ a: 1, b: 2 }));
});

test("v2 Azure normalizer rejects audio, URI, token, raw secret and oversized provider input", () => {
  const base = {
    referenceText: "think now",
    contentVersionId: CONTENT_VERSION,
    practiceItemKey: "think-now",
    targetLocator: { wordIndex: 0, phonemeIndex: 0 },
    expectedFocusRepresentation: "θ",
    referenceTextVersion: "fixture-v1",
    assessmentLocale: "en-US" as const
  };
  for (const providerPayload of [
    { audio: "bytes" },
    { file_uri: "file:///private/audio.wav" },
    { token: "server-secret" },
    { nested: { authorization: "Bearer secret" } }
  ]) {
    assert.throws(() => normalizeAzureFocusResult({ ...base, providerPayload }), /Forbidden provider field/);
  }
  assert.throws(
    () => normalizeAzureFocusResult({ ...base, providerPayload: AZURE_V2_CAPACITY_REFERENCE, payloadByteLimit: 1 }),
    /measured fixture limit/
  );
});

test("v2 Azure normalizer fails closed for empty, missing status, missing target and cross-reference results", () => {
  const base = {
    referenceText: "think",
    contentVersionId: CONTENT_VERSION,
    practiceItemKey: "think",
    targetLocator: { wordIndex: 0, phonemeIndex: 0 },
    expectedFocusRepresentation: "θ",
    referenceTextVersion: "fixture-v1",
    assessmentLocale: "en-US" as const
  };
  assert.throws(() => normalizeAzureFocusResult({ ...base, providerPayload: {} }), /RecognitionStatus/);
  assert.throws(
    () => normalizeAzureFocusResult({
      ...base,
      providerPayload: { NBest: [{ Words: [{ Phonemes: [{ Phoneme: "θ", PronunciationAssessment: { AccuracyScore: 80 } }] }] }] }
    }),
    /RecognitionStatus/
  );
  assert.throws(
    () => normalizeAzureFocusResult({
      ...base,
      providerPayload: {
        RecognitionStatus: "Success",
        DisplayText: "think",
        NBest: [{ Words: [{ Phonemes: [{ Phoneme: "s", PronunciationAssessment: { AccuracyScore: 80 } }] }] }]
      }
    }),
    /target/i
  );
});

test("v2 Azure normalizer accepts a representative complete result and rejects normalized forbidden keys", () => {
  const representative = {
    RecognitionStatus: "Success",
    DisplayText: "think now",
    Offset: 900000,
    Duration: 12800000,
    NBest: [{
      Confidence: 0.91,
      Lexical: "think now",
      ITN: "think now",
      MaskedITN: "think now",
      Display: "think now",
      PronunciationAssessment: {
        AccuracyScore: 81,
        FluencyScore: 74,
        CompletenessScore: 100,
        PronScore: 78,
        ProsodyScore: 72
      },
      Words: [{
        Word: "think",
        Offset: 900000,
        Duration: 6400000,
        PronunciationAssessment: { AccuracyScore: 46, ErrorType: "None" },
        Syllables: [{ Syllable: "θɪŋk", Offset: 900000, Duration: 6400000, PronunciationAssessment: { AccuracyScore: 46 } }],
        Phonemes: [{
          Phoneme: "θ",
          Offset: 900000,
          Duration: 1200000,
          PronunciationAssessment: {
            AccuracyScore: 46,
            NBestPhonemes: [{ Phoneme: "θ", Score: 46 }, { Phoneme: "s", Score: 91 }]
          }
        }]
      }, {
        Word: "now",
        Offset: 7400000,
        Duration: 6300000,
        PronunciationAssessment: { AccuracyScore: 88, ErrorType: "None" },
        Syllables: [],
        Phonemes: []
      }]
    }]
  };
  assert.ok(new TextEncoder().encode(JSON.stringify(representative)).byteLength > 356);
  const result = normalizeAzureFocusResult({
    providerPayload: representative,
    referenceText: "think now",
    contentVersionId: CONTENT_VERSION,
    practiceItemKey: "think-now",
    targetLocator: { wordIndex: 0, phonemeIndex: 0 },
    expectedFocusRepresentation: "θ",
    referenceTextVersion: "fixture-v1",
    assessmentLocale: "en-US"
  });
  assert.equal(result.technicalValid, true);

  const forbidden = [
    { audioData: "bytes" },
    { audioBase64: "bytes" },
    { fileUri: "file:///tmp/a.wav" },
    { accessToken: "token" },
    { nested_value: { "authorization-header": "Bearer secret" } }
  ];
  for (const providerPayload of forbidden) {
    assert.throws(() => normalizeAzureFocusResult({
      providerPayload,
      referenceText: "think now",
      contentVersionId: CONTENT_VERSION,
      practiceItemKey: "think-now",
      targetLocator: { wordIndex: 0, phonemeIndex: 0 },
      expectedFocusRepresentation: "θ",
      referenceTextVersion: "fixture-v1",
      assessmentLocale: "en-US"
    }), /Forbidden provider field/);
  }
});

test("review schedules use 1, 3, 7, 14 date-only days and avoid duplicate basis", () => {
  const result = createReviewScheduleCandidates({
    evidence: {
      id: "e1",
      focusGroupKey: FOCUS,
      calendarDate: "2026-02-27",
      serverNormalized: true,
      assisted: false,
      kind: "held"
    },
    existing: [{ basedOnEvidenceId: "e1", intervalKind: "day_3" }]
  });
  assert.equal(result.status, "created");
  if (result.status !== "created") return;
  assert.deepEqual(
    result.schedules.map((schedule) => [schedule.intervalKind, schedule.dueDate]),
    [
      ["day_1", "2026-02-28"],
      ["day_7", "2026-03-06"],
      ["day_14", "2026-03-13"]
    ]
  );
  assert.equal(reviewStatusForDate("2026-08-09", "2026-08-08"), "scheduled");
  assert.equal(reviewStatusForDate("2026-08-09", "2026-08-09"), "due");
  assert.equal(reviewStatusForDate("2026-08-08", "2026-08-09"), "overdue");
});

test("review schedules reject unverified or assisted basis evidence", () => {
  const base = {
    id: "e1",
    focusGroupKey: FOCUS,
    calendarDate: "2026-08-01",
    assisted: false,
    serverNormalized: false,
    kind: "held" as const
  };
  assert.deepEqual(createReviewScheduleCandidates({ evidence: base }), {
    status: "ineligible",
    reason: "unnormalized_basis"
  });
  assert.deepEqual(
    createReviewScheduleCandidates({ evidence: { ...base, serverNormalized: true, assisted: true } }),
    { status: "ineligible", reason: "assisted_basis" }
  );
});

test("daily review selection returns at most one deterministic overdue item", () => {
  const schedules: ReviewScheduleCandidate[] = [
    review("z", "v-b", "2026-08-01", "e-z", "day_1"),
    review("a2", "r-l", "2026-08-01", "e-a", "day_1"),
    review("a1", "r-l", "2026-08-01", "e-a", "day_1"),
    review("future", "r-l", "2026-08-10", "e-f", "day_3")
  ];
  const result = selectDueReview({ calendarDate: "2026-08-09", schedules });
  assert.equal(result.selected?.id, "a1");
  assert.deepEqual(result.ignoredDuplicateIds, ["a2"]);
});

test("daily plan creates five roles, one focus, no duplicate and reviewed content only", () => {
  const result = createDailyPlan({
    learningDaySequence: 1,
    trialProgramDay: 1,
    contentVersionId: CONTENT_VERSION,
    calendarDate: "2026-08-09",
    focusCandidates: focuses(),
    content: [
      ...standardContent(),
      content("bad-inactive", "anchor", { active: false }),
      content("bad-review", "anchor", { humanReviewed: false }),
      content("bad-azure", "anchor", { azureValidated: false }),
      content("bad-version", "anchor", { contentVersionId: "other" })
    ],
    reviewSchedules: []
  });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.plan.requiredItems.map((item) => item.slotRole), [
    "anchor",
    "contrast",
    "transfer_word",
    "sentence",
    "review"
  ]);
  assert.equal(new Set(result.plan.requiredItems.map((item) => item.practiceItemKey)).size, 5);
  assert.equal(result.plan.focusGroupKey, FOCUS);
  assert.equal(result.plan.requiredItems[4]?.selectionReason, "review_substitute_transfer_word");
  assert.equal(result.plan.reviewSubstitutionReason, "review_substitute_transfer_word");
  assert.equal(result.plan.optionalItems.length, 2);
  const reversed = createPlan([...standardContent()].reverse());
  assert.equal(reversed.status, "ok");
  if (reversed.status === "ok") {
    assert.deepEqual(reversed.plan.requiredItems, result.plan.requiredItems);
    assert.deepEqual(reversed.plan.optionalItems, result.plan.optionalItems);
  }
});

test("review slot fallback is transfer, sentence, practical sentence then insufficient", () => {
  const base = standardContent().filter((item) => item.practiceItemKey !== "transfer-2");
  const sentenceFallback = createPlan(base.concat(content("sentence-2", "sentence")));
  assert.equal(sentenceFallback.status, "ok");
  if (sentenceFallback.status === "ok") {
    assert.equal(sentenceFallback.plan.requiredItems[4]?.selectionReason, "review_substitute_sentence");
  }

  const practicalFallback = createPlan(base.concat(content("practical-2", "practical_sentence")));
  assert.equal(practicalFallback.status, "ok");
  if (practicalFallback.status === "ok") {
    assert.equal(
      practicalFallback.plan.requiredItems[4]?.selectionReason,
      "review_substitute_practical_sentence"
    );
  }

  const insufficient = createPlan(base);
  assert.deepEqual(insufficient, {
    status: "insufficient_content",
    reason: "missing_review_substitute",
    focusGroupKey: FOCUS
  });
});

test("due review uses at most one past focus item", () => {
  const result = createDailyPlan({
    learningDaySequence: 1,
    trialProgramDay: 1,
    contentVersionId: CONTENT_VERSION,
    calendarDate: "2026-08-09",
    focusCandidates: focuses(),
    content: [...standardContent(), content("review-vb", "review", { focusGroupKey: "v-b" })],
    reviewSchedules: [review("review-1", "v-b", "2026-08-08", "e-vb", "day_7")]
  });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.plan.requiredItems[4]?.focusGroupKey, "v-b");
  assert.equal(result.plan.requiredItems[4]?.selectionReason, "due_review");
});

test("focus selection priority is reproducible discovery, due, context, unevaluated", () => {
  const result = createPlan(standardContent(), [
    focus("u", "unevaluated", "z"),
    focus("c", "next_context", "th"),
    focus("d", "due", "v-b"),
    { ...focus("bad", "discovery", "x"), reproducible: false },
    { ...focus("good", "discovery", FOCUS), reproducible: true }
  ]);
  assert.equal(result.status, "ok");
  if (result.status === "ok") assert.equal(result.plan.focusGroupKey, FOCUS);
});

test("an unfinished Program Day keeps its plan when Calendar Date changes", () => {
  const existing = mustPlan();
  const resolved = resolveProgramDayPlan({
    existingUncompletedPlan: existing,
    nextPlanInput: {
      learningDaySequence: 2,
      trialProgramDay: 2,
      contentVersionId: CONTENT_VERSION,
      calendarDate: "2026-08-10",
      focusCandidates: focuses(),
      content: standardContent(),
      reviewSchedules: []
    }
  });
  assert.equal(resolved.status, "ok");
  if (resolved.status === "ok") {
    assert.equal(resolved.reusedExisting, true);
    assert.equal(resolved.plan.learningDaySequence, 1);
    assert.equal(resolved.plan.originatingCalendarDate, "2026-08-09");
  }
});

test("date rollover replaces only an unstarted review slot", () => {
  const plan = mustPlan();
  const replacement = content("review-vb", "review", { focusGroupKey: "v-b" });
  const changed = resumeProgramDayPlan({
    plan,
    calendarDate: "2026-08-10",
    startedItemPositions: [1, 2],
    content: [...standardContent(), replacement],
    reviewSchedules: [review("review-1", "v-b", "2026-08-10", "e-vb", "day_1")]
  });
  assert.equal(changed.requiredItems[4]?.practiceItemKey, "review-vb");
  assert.deepEqual(changed.requiredItems.slice(0, 4), plan.requiredItems.slice(0, 4));
  const preserved = resumeProgramDayPlan({
    plan,
    calendarDate: "2026-08-10",
    startedItemPositions: [5],
    content: [...standardContent(), replacement],
    reviewSchedules: [review("review-1", "v-b", "2026-08-10", "e-vb", "day_1")]
  });
  assert.equal(preserved.requiredItems[4]?.practiceItemKey, plan.requiredItems[4]?.practiceItemKey);
});

test("shortening needs policy and requires two distinct verified unassisted roles", () => {
  const plan = mustPlan();
  const anchor = attempt("a1", "item-anchor", "anchor", { practiceItemKey: "anchor-1" });
  const contrast = attempt("a2", "item-contrast", "contrast", { practiceItemKey: "contrast-1", ordinal: 1 });
  const noPolicy = evaluateShortening({
    plan,
    sessionId: "session-1",
    completedRequiredItemKeys: ["anchor-1", "contrast-1"],
    attempts: [anchor, contrast]
  });
  assert.equal(noPolicy.status, "needs_policy");

  const shortened = evaluateShortening({
    plan,
    sessionId: "session-1",
    completedRequiredItemKeys: ["anchor-1", "contrast-1"],
    attempts: [contrast, anchor],
    policy: metPolicy()
  });
  assert.equal(shortened.status, "shortened");
  if (shortened.status === "shortened") {
    assert.equal(shortened.requiredCount, 3);
    assert.deepEqual(shortened.evidenceAttemptIds, ["a1", "a2"]);
    assert.ok(shortened.keptPracticeItemKeys.includes("transfer-1"));
    assert.equal(shortened.shortenedPracticeItemKeys.length, 2);
  }
});

test("shortening rejects guided, same-role, unknown policy and late four-item evaluation", () => {
  const plan = mustPlan();
  const anchor = attempt("a1", "item-anchor", "anchor", { practiceItemKey: "anchor-1" });
  const guided = attempt("g1", "item-contrast", "contrast", {
    practiceItemKey: "contrast-1",
    attemptRole: "guided_retry",
    assisted: true,
    retryFromAttemptId: "a1"
  });
  assert.equal(
    evaluateShortening({
      plan,
      sessionId: "session-1",
      completedRequiredItemKeys: ["anchor-1", "contrast-1"],
      attempts: [anchor, guided],
      policy: metPolicy()
    }).status,
    "kept_standard"
  );
  assert.equal(
    evaluateShortening({
      plan,
      sessionId: "session-1",
      completedRequiredItemKeys: ["anchor-1"],
      attempts: [
        anchor,
        attempt("a-anchor-2", "item-anchor-2", "anchor", {
          practiceItemKey: "anchor-1",
          clientAttemptId: "anchor-again",
          ordinal: 2
        })
      ],
      policy: metPolicy()
    }).status,
    "kept_standard"
  );
  assert.equal(
    evaluateShortening({
      plan,
      sessionId: "session-1",
      completedRequiredItemKeys: ["anchor-1", "contrast-1", "transfer-1", "sentence-1"],
      attempts: [anchor],
      policy: metPolicy()
    }).status,
    "kept_standard"
  );
  assert.equal(
    evaluateShortening({
      plan,
      sessionId: "session-1",
      completedRequiredItemKeys: ["anchor-1", "contrast-1"],
      attempts: [anchor, attempt("a2", "item-contrast", "contrast", { practiceItemKey: "contrast-1" })],
      policy: metPolicy("unknown")
    }).status,
    "unknown"
  );
});

test("optional extensions are capped at two and appear only after required completion", () => {
  const plan = mustPlan();
  assert.deepEqual(
    optionalExtensionsAvailable({
      requiredItems: plan.requiredItems.map(() => ({})),
      optionalItems: plan.optionalItems
    }),
    []
  );
  assert.equal(
    optionalExtensionsAvailable({
      requiredItems: plan.requiredItems.map(() => ({ completionReason: "completed" })),
      optionalItems: [...plan.optionalItems, { ...plan.optionalItems[0]!, practiceItemKey: "optional-3" }]
    }).length,
    2
  );
});

test("attempt counting is deterministic, idempotent and invalid attempts do not consume ordinals", () => {
  const first = attempt("a1", "item-1", "anchor", { clientAttemptId: "client-1", ordinal: 1 });
  const duplicate = { ...first, id: "a2", attemptedAt: "2026-08-09T00:00:02Z" };
  const invalid = attempt("bad", "item-1", "anchor", {
    clientAttemptId: "bad-client",
    ordinal: undefined,
    technicalValidity: "invalid",
    invalidReason: "no_match"
  });
  const second = attempt("a3", "item-1", "anchor", { clientAttemptId: "client-2", ordinal: 2 });
  const result = selectCountedAttempts([second, duplicate, invalid, first]);
  assert.deepEqual(result.accepted.map((item) => item.id), ["a1", "a3"]);
  assert.ok(result.excluded.some((item) => item.reason === "duplicate_client_attempt"));
  assert.ok(result.excluded.some((item) => item.reason === "technical_invalid"));
});

test("same client id with a different payload is a conflict and valid ordinal is limited to three", () => {
  const first = attempt("a1", "item-1", "anchor", { clientAttemptId: "same", payloadSha256: "hash-a" });
  const conflict = attempt("a2", "item-1", "anchor", {
    clientAttemptId: "same",
    payloadSha256: "hash-b"
  });
  const fourth = attempt("a4", "item-1", "anchor", { clientAttemptId: "four", ordinal: 4 });
  const result = selectCountedAttempts([conflict, fourth, first]);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.excluded.filter((item) => item.reason === "idempotency_payload_conflict").length, 2);
  assert.ok(result.excluded.some((item) => item.reason === "invalid_valid_ordinal"));
});

test("at most three valid attempts per item are counted", () => {
  const attempts = [1, 2, 3, 4].map((ordinal) =>
    attempt(`a${ordinal}`, "item-1", "anchor", {
      clientAttemptId: `client-${ordinal}`,
      ordinal
    })
  );
  const result = selectCountedAttempts(attempts);
  assert.deepEqual(result.accepted.map((item) => item.validAttemptOrdinal), [1, 2, 3]);
  assert.ok(result.excluded.some((item) => item.reason === "invalid_valid_ordinal"));
});

test("guided retry requires an accepted verified unassisted source in the same owner, session, item and focus", () => {
  const source = attempt("source", "item-1", "anchor", { serverNormalized: false });
  const guided = attempt("guided", "item-1", "anchor", {
    attemptRole: "guided_retry",
    retryFromAttemptId: "source",
    ordinal: 2,
    assisted: true
  });
  const unverified = selectCountedAttempts([source, guided]);
  assert.ok(unverified.excluded.some((item) => item.attemptId === "guided" && item.reason === "guided_retry_source_mismatch"));

  const duplicateConflict = { ...source, id: "source-conflict", payloadSha256: "different" };
  const conflicted = selectCountedAttempts([{ ...source, serverNormalized: true }, duplicateConflict, guided]);
  assert.ok(conflicted.excluded.some((item) => item.attemptId === "guided" && item.reason === "guided_retry_source_mismatch"));

  const crossUser = selectCountedAttempts([
    { ...source, serverNormalized: true },
    { ...guided, userId: "user-b" }
  ]);
  assert.ok(crossUser.excluded.some((item) => item.attemptId === "guided" && item.reason === "guided_retry_source_mismatch"));
});

test("durable evidence keeps the first verified unassisted attempt for date, focus, role and kind", () => {
  const first = attempt("a1", "item-1", "anchor", { clientAttemptId: "c1" });
  const later = attempt("a2", "item-2", "anchor", {
    clientAttemptId: "c2",
    attemptedAt: "2026-08-09T00:00:10Z"
  });
  const guided = attempt("g1", "item-2", "anchor", {
    clientAttemptId: "c3",
    attemptRole: "guided_retry",
    assisted: true,
    retryFromAttemptId: "a2",
    ordinal: 2
  });
  const unverified = attempt("u1", "item-3", "contrast", {
    clientAttemptId: "c4",
    serverNormalized: false
  });
  const result = selectDurableEvidenceCandidates({
    attempts: [later, guided, unverified, first],
    evidenceKind: "held"
  });
  assert.deepEqual(result.evidence.map((item) => item.attemptId), ["a1"]);
  assert.ok(result.excluded.some((item) => item.reason === "duplicate_durable_evidence"));
  assert.ok(result.excluded.some((item) => item.reason === "assisted_not_durable"));
  assert.ok(result.excluded.some((item) => item.reason === "not_server_normalized"));
});

test("focus state is policy-driven, deterministic and reaches stable then maintenance with proper evidence", () => {
  const attempts = focusAttempts();
  const cycles: CorrectionCycle[] = [
    { id: "cycle-1", userId: USER, sessionId: "session-1", focusGroupKey: FOCUS, sessionItemId: "item-1", beforeAttemptId: "before", afterAttemptId: "after" }
  ];
  const evidence = focusEvidence();
  const stable = deriveFocusState({
    focusGroupKey: FOCUS,
    evidence: [...evidence].reverse().filter((item) => item.kind !== "maintenance"),
    attempts: [...attempts].reverse(),
    correctionCycles: cycles,
    policy: metPolicy()
  });
  assert.equal(stable.state, "stable");
  assert.equal(stable.policyVersion, "policy-test-v1");

  const maintenance = deriveFocusState({
    focusGroupKey: FOCUS,
    evidence,
    attempts,
    correctionCycles: cycles,
    policy: metPolicy()
  });
  assert.equal(maintenance.state, "maintenance");
  assert.deepEqual(
    maintenance.adoptedEvidenceIds,
    ["e-discovered", "e-immediate", "e-held", "e-transfer", "e-stable", "e-maintenance"]
  );
  const reversed = deriveFocusState({
    focusGroupKey: FOCUS,
    evidence: [...evidence].reverse(),
    attempts: [...attempts].reverse(),
    correctionCycles: [...cycles].reverse(),
    policy: metPolicy()
  });
  assert.deepEqual(reversed, maintenance);
});

test("focus state does not promote without policy, with same-day held, or guided durable evidence", () => {
  const evidence = focusEvidence();
  const noPolicy = deriveFocusState({
    focusGroupKey: FOCUS,
    currentState: "discovered",
    evidence,
    attempts: focusAttempts(),
    correctionCycles: [],
  });
  assert.equal(noPolicy.status, "needs_policy");
  assert.equal(noPolicy.state, "discovered");

  const invalid = evidence.map((item) =>
    item.kind === "held" ? { ...item, calendarDate: "2026-08-01" } : item
  );
  const result = deriveFocusState({
    focusGroupKey: FOCUS,
    evidence: invalid,
    attempts: focusAttempts(),
    correctionCycles: [
      { id: "cycle-1", userId: USER, sessionId: "session-1", focusGroupKey: FOCUS, sessionItemId: "item-1", beforeAttemptId: "before", afterAttemptId: "after" }
    ],
    policy: metPolicy()
  });
  assert.equal(result.state, "immediate_change");
});

test("stable requires day-7 evidence and maintenance requires day-14 evidence", () => {
  const base = focusEvidence();
  const cycles = [
    { id: "cycle-1", userId: USER, sessionId: "session-1", focusGroupKey: FOCUS, sessionItemId: "item-1", beforeAttemptId: "before", afterAttemptId: "after" }
  ];
  const withoutDay7 = deriveFocusState({
    focusGroupKey: FOCUS,
    evidence: base.filter((item) => item.kind !== "stable" && item.kind !== "maintenance"),
    attempts: focusAttempts(),
    correctionCycles: cycles,
    policy: metPolicy()
  });
  assert.equal(withoutDay7.state, "transferred");

  const withoutDay14 = deriveFocusState({
    focusGroupKey: FOCUS,
    evidence: base.filter((item) => item.kind !== "maintenance"),
    attempts: focusAttempts(),
    correctionCycles: cycles,
    policy: metPolicy()
  });
  assert.equal(withoutDay14.state, "stable");
});

test("unknown evidence policy does not promote focus state", () => {
  const result = deriveFocusState({
    focusGroupKey: FOCUS,
    evidence: [focusEvidence()[0]!],
    attempts: focusAttempts(),
    correctionCycles: [],
    policy: metPolicy("unknown")
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.state, undefined);
  assert.ok(result.exclusions[0]?.reason.startsWith("policy_unknown:"));
});

test("focus policy receives only verified unassisted target-focus evidence", () => {
  let observedEvidence: readonly FocusEvidence[] = [];
  const policy = metPolicy();
  policy.evaluateEvidence = (input) => {
    observedEvidence = input.allEvidence;
    return { status: "met", reason: "safe" };
  };
  deriveFocusState({
    focusGroupKey: FOCUS,
    evidence: [
      focusEvidence()[0]!,
      { ...focusEvidence()[2]!, id: "unverified", serverNormalized: false },
      { ...focusEvidence()[3]!, id: "assisted", assisted: true },
      { ...focusEvidence()[4]!, id: "other", focusGroupKey: "v-b" }
    ],
    attempts: focusAttempts(),
    correctionCycles: [],
    policy
  });
  assert.deepEqual(observedEvidence.map((item) => item.id), ["e-discovered"]);
});

test("focus state enforces held, transferred, stable and maintenance evidence order", () => {
  const reordered = focusEvidence().map((item) =>
    item.kind === "transferred" ? { ...item, calendarDate: "2026-08-01" } : item
  );
  const result = deriveFocusState({
    focusGroupKey: FOCUS,
    evidence: reordered,
    attempts: focusAttempts(),
    correctionCycles: [{ id: "cycle-1", userId: USER, sessionId: "session-1", focusGroupKey: FOCUS, sessionItemId: "item-1", beforeAttemptId: "before", afterAttemptId: "after" }],
    policy: metPolicy()
  });
  assert.equal(result.state, "held");
  assert.ok(result.exclusions.some((item) => item.evidenceId === "e-transfer"));
});

test("completion accepts normal five and re-evaluates shortening instead of trusting item reasons", () => {
  const normalItems = completionItems(5);
  const verified = attempt("a1", "required-1", "anchor");
  const normal = evaluateSessionCompletion({
    idempotencyKey: COMPLETION_KEY,
    calendarDate: "2026-08-09",
    sessionId: "session-1",
    sessionTimezone: "Asia/Tokyo",
    plan: mustPlan(),
    items: normalItems,
    attempts: [verified],
    priorCompletedCalendarDates: []
  });
  assert.equal(normal.status, "eligible");
  assert.deepEqual(
    normal,
    evaluateSessionCompletion({
      idempotencyKey: COMPLETION_KEY,
      calendarDate: "2026-08-09",
      sessionId: "session-1",
      sessionTimezone: "Asia/Tokyo",
      plan: mustPlan(),
      items: normalItems,
      attempts: [verified],
      priorCompletedCalendarDates: []
    })
  );

  const shortened = completionItems(5).map((item, index) => index < 3 ? item : { ...item, completionReason: undefined });
  assert.equal(
    evaluateSessionCompletion({
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      calendarDate: "2026-08-10",
      sessionId: "session-1",
      sessionTimezone: "Asia/Tokyo",
      plan: mustPlan(),
      items: shortened,
      attempts: [
        attempt("a1", "required-1", "anchor", { practiceItemKey: "anchor-1" }),
        attempt("a2", "required-2", "contrast", { practiceItemKey: "contrast-1" })
      ],
      priorCompletedCalendarDates: [],
      shorteningPolicy: metPolicy()
    }).status,
    "eligible"
  );
});

test("three completed items are rejected without server shortening policy evidence", () => {
  const items = completionItems(5).map((item, index) => index < 3 ? item : { ...item, completionReason: undefined });
  const result = evaluateSessionCompletion({
    idempotencyKey: "33333333-3333-4333-8333-333333333333",
    calendarDate: "2026-08-09",
    sessionId: "session-1",
    sessionTimezone: "Asia/Tokyo",
    plan: mustPlan(),
    items,
    attempts: [attempt("a1", "required-1", "anchor", { practiceItemKey: "anchor-1" })],
    priorCompletedCalendarDates: []
  });
  assert.deepEqual(result, {
    status: "ineligible",
    idempotencyKey: "33333333-3333-4333-8333-333333333333",
    reason: "required_items_incomplete"
  });
});

test("completion rejects open, invalid-only, optional-only, wrong counts and same-date duplicate", () => {
  const base = {
    idempotencyKey: "44444444-4444-4444-8444-444444444444",
    calendarDate: "2026-08-09",
    sessionId: "session-1",
    sessionTimezone: "Asia/Tokyo",
    plan: mustPlan(),
    items: completionItems(5),
    attempts: [attempt("a1", "required-1", "anchor")],
    priorCompletedCalendarDates: [] as string[]
  };
  assert.equal(
    evaluateSessionCompletion({ ...base, items: [{ ...base.items[0]!, completionReason: undefined }] }).status,
    "ineligible"
  );
  assert.equal(
    evaluateSessionCompletion({
      ...base,
      attempts: [attempt("unverified", "required-1", "anchor", { serverNormalized: false })]
    }).status,
    "ineligible"
  );
  assert.equal(
    evaluateSessionCompletion({
      ...base,
      attempts: [attempt("bad", "required-1", "anchor", { technicalValidity: "invalid", ordinal: undefined })]
    }).status,
    "ineligible"
  );
  assert.equal(
    evaluateSessionCompletion({
      ...base,
      attempts: [attempt("optional", "optional-1", "optional_extension")]
    }).status,
    "ineligible"
  );
  assert.equal(
    evaluateSessionCompletion({ ...base, priorCompletedCalendarDates: ["2026-08-09"] }).status,
    "ineligible"
  );
});

test("completion rejects blank or malformed idempotency keys and invalid timezone boundaries", () => {
  const base = {
    calendarDate: "2026-08-09",
    sessionId: "session-1",
    sessionTimezone: "Asia/Tokyo",
    plan: mustPlan(),
    items: completionItems(5),
    attempts: [attempt("a1", "required-1", "anchor")],
    priorCompletedCalendarDates: [] as string[]
  };
  assert.equal(evaluateSessionCompletion({ ...base, idempotencyKey: "" }).status, "ineligible");
  assert.equal(evaluateSessionCompletion({ ...base, idempotencyKey: "not-a-uuid" }).status, "ineligible");
  assert.equal(evaluateSessionCompletion({ ...base, idempotencyKey: COMPLETION_KEY, sessionTimezone: "Mars/Base" }).status, "ineligible");
});

function createPlan(contentRows: ContentCandidate[], focusRows: FocusCandidate[] = focuses()) {
  return createDailyPlan({
    learningDaySequence: 1,
    trialProgramDay: 1,
    contentVersionId: CONTENT_VERSION,
    calendarDate: "2026-08-09",
    focusCandidates: focusRows,
    content: contentRows,
    reviewSchedules: []
  });
}

function mustPlan(): DailyPlan {
  const result = createPlan(standardContent());
  if (result.status !== "ok") throw new Error(result.reason);
  return result.plan;
}

function standardContent(): ContentCandidate[] {
  return [
    content("anchor-1", "anchor"),
    content("contrast-1", "contrast"),
    content("transfer-1", "transfer_word"),
    content("transfer-2", "transfer_word"),
    content("sentence-1", "sentence"),
    content("optional-1", "optional_extension"),
    content("optional-2", "optional_extension")
  ];
}

function content(
  practiceItemKey: string,
  promptRole: PromptRole,
  overrides: Partial<ContentCandidate> = {}
): ContentCandidate {
  return {
    contentVersionId: CONTENT_VERSION,
    practiceItemKey,
    focusGroupKey: FOCUS,
    promptRole,
    active: true,
    humanReviewed: true,
    azureValidated: true,
    ...overrides
  };
}

function focuses(): FocusCandidate[] {
  return [{ ...focus("focus-1", "discovery", FOCUS), reproducible: true }];
}

function focus(id: string, kind: FocusCandidate["kind"], focusGroupKey: string): FocusCandidate {
  return {
    id,
    focusGroupKey,
    kind,
    active: true,
    humanReviewed: true,
    azureValidated: true
  };
}

function review(
  id: string,
  focusGroupKey: string,
  dueDate: string,
  basedOnEvidenceId: string,
  intervalKind: ReviewScheduleCandidate["intervalKind"]
): ReviewScheduleCandidate {
  return {
    id,
    focusGroupKey,
    dueDate,
    basedOnEvidenceId,
    intervalKind,
    serverNormalizedBasis: true,
    unassistedBasis: true
  };
}

function attempt(
  id: string,
  sessionItemId: string,
  promptRole: PromptRole,
  overrides: {
    practiceItemKey?: string;
    clientAttemptId?: string;
    payloadSha256?: string;
    attemptRole?: LearningAttempt["attemptRole"];
    retryFromAttemptId?: string;
    ordinal?: number;
    attemptedAt?: string;
    assisted?: boolean;
    technicalValidity?: LearningAttempt["technicalValidity"];
    invalidReason?: string;
    serverNormalized?: boolean;
  } = {}
): LearningAttempt {
  return {
    id,
    userId: USER,
    sessionId: "session-1",
    sessionItemId,
    clientAttemptId: overrides.clientAttemptId ?? `client-${id}`,
    payloadSha256: overrides.payloadSha256 ?? `hash-${id}`,
    contentVersionId: CONTENT_VERSION,
    practiceItemKey: overrides.practiceItemKey ?? sessionItemId,
    focusGroupKey: FOCUS,
    promptRole,
    attemptRole: overrides.attemptRole ?? "cold",
    retryFromAttemptId: overrides.retryFromAttemptId,
    attemptSequence: 1,
    validAttemptOrdinal: overrides.ordinal === undefined && overrides.technicalValidity === "invalid" ? undefined : overrides.ordinal ?? 1,
    attemptedAt: overrides.attemptedAt ?? "2026-08-09T00:00:01Z",
    calendarDate: "2026-08-09",
    timezone: "Asia/Tokyo",
    coachingShown: overrides.assisted ?? false,
    assisted: overrides.assisted ?? false,
    technicalValidity: overrides.technicalValidity ?? "valid",
    invalidReason: overrides.invalidReason,
    serverNormalized: overrides.serverNormalized ?? true,
    providerAttested: false,
    provider: "fixture-provider",
    assessmentLocale: "en-US"
  };
}

function metPolicy(result: PolicyDecision["status"] = "met"): LearningPolicy {
  const decision = (): PolicyDecision => ({ status: result, reason: `fixture_${result}` });
  return {
    version: "policy-test-v1",
    evaluateAttempt: decision,
    evaluateEvidence: decision
  };
}

function focusAttempts(): LearningAttempt[] {
  return [
    attempt("before", "item-1", "anchor", { attemptedAt: "2026-08-01T00:00:00Z" }),
    attempt("after", "item-1", "anchor", {
      attemptRole: "guided_retry",
      retryFromAttemptId: "before",
      ordinal: 2,
      assisted: true,
      attemptedAt: "2026-08-01T00:01:00Z"
    })
  ];
}

function focusEvidence(): FocusEvidence[] {
  return [
    evidence("e-discovered", "discovered", "2026-08-01", "anchor", "word-a", { sourceAttemptId: "before" }),
    evidence("e-immediate", "immediate_change", "2026-08-01", "anchor", "word-a", {
      correctionCycleId: "cycle-1",
      assisted: true
    }),
    evidence("e-held", "held", "2026-08-02", "anchor", "word-a"),
    evidence("e-transfer", "transferred", "2026-08-04", "transfer_word", "word-b"),
    evidence("e-stable", "stable", "2026-08-08", "sentence", "sentence-a", { reviewIntervalKind: "day_7" }),
    evidence("e-maintenance", "maintenance", "2026-08-15", "practical_sentence", "sentence-b", {
      reviewIntervalKind: "day_14"
    })
  ];
}

function evidence(
  id: string,
  kind: FocusState,
  calendarDate: string,
  promptRole: PromptRole,
  promptContext: string,
  overrides: Partial<FocusEvidence> = {}
): FocusEvidence {
  return {
    id,
    userId: USER,
    sessionItemId: "item-1",
    focusGroupKey: FOCUS,
    kind,
    calendarDate,
    promptRole,
    promptContext,
    assisted: false,
    serverNormalized: true,
    contentVersionId: CONTENT_VERSION,
    ...overrides
  };
}

function completionItems(count: number): CompletionItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `required-${index + 1}`,
    practiceItemKey: ["anchor-1", "contrast-1", "transfer-1", "sentence-1", "transfer-2"][index]!,
    focusGroupKey: FOCUS,
    required: true,
    promptRole: (index === 0 ? "anchor" : index === 1 ? "contrast" : "transfer_word") as PromptRole,
    completionReason: "completed"
  }));
}
