import assert from "node:assert/strict";
import test from "node:test";

import {
  addCalendarDays,
  calendarDateFromInstant,
  createDailyPlan,
  createReviewScheduleCandidates,
  deriveFocusState,
  evaluateSessionCompletion,
  evaluateShortening,
  optionalExtensionsAvailable,
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
  assert.throws(() => calendarDateFromInstant("2026-01-01T00:00:00Z", "Mars/Base"), RangeError);
});

test("review schedules use 1, 3, 7, 14 date-only days and avoid duplicate basis", () => {
  const result = createReviewScheduleCandidates({
    evidence: {
      id: "e1",
      focusGroupKey: FOCUS,
      calendarDate: "2026-02-27",
      serverVerified: true,
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
    serverVerified: false,
    kind: "held" as const
  };
  assert.deepEqual(createReviewScheduleCandidates({ evidence: base }), {
    status: "ineligible",
    reason: "unverified_basis"
  });
  assert.deepEqual(
    createReviewScheduleCandidates({ evidence: { ...base, serverVerified: true, assisted: true } }),
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
    programDay: 1,
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
    programDay: 1,
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
      programDay: 2,
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
    assert.equal(resolved.plan.programDay, 1);
    assert.equal(resolved.plan.calendarDate, "2026-08-09");
  }
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
    serverVerified: false
  });
  const result = selectDurableEvidenceCandidates({
    attempts: [later, guided, unverified, first],
    evidenceKind: "held"
  });
  assert.deepEqual(result.evidence.map((item) => item.attemptId), ["a1"]);
  assert.ok(result.excluded.some((item) => item.reason === "duplicate_durable_evidence"));
  assert.ok(result.excluded.some((item) => item.reason === "assisted_not_durable"));
  assert.ok(result.excluded.some((item) => item.reason === "not_server_verified"));
});

test("focus state is policy-driven, deterministic and reaches stable then maintenance with proper evidence", () => {
  const attempts = focusAttempts();
  const cycles: CorrectionCycle[] = [
    { id: "cycle-1", focusGroupKey: FOCUS, sessionItemId: "item-1", beforeAttemptId: "before", afterAttemptId: "after" }
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
      { id: "cycle-1", focusGroupKey: FOCUS, sessionItemId: "item-1", beforeAttemptId: "before", afterAttemptId: "after" }
    ],
    policy: metPolicy()
  });
  assert.equal(result.state, "immediate_change");
});

test("stable requires day-7 evidence and maintenance requires day-14 evidence", () => {
  const base = focusEvidence();
  const cycles = [
    { id: "cycle-1", focusGroupKey: FOCUS, sessionItemId: "item-1", beforeAttemptId: "before", afterAttemptId: "after" }
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

test("completion accepts only normal five or shortened three with verified learning evidence", () => {
  const normalItems = completionItems(5);
  const verified = attempt("a1", "required-1", "anchor");
  const normal = evaluateSessionCompletion({
    idempotencyKey: "complete-1",
    calendarDate: "2026-08-09",
    requiredCount: 5,
    items: normalItems,
    attempts: [verified],
    priorCompletedCalendarDates: []
  });
  assert.equal(normal.status, "eligible");
  assert.deepEqual(
    normal,
    evaluateSessionCompletion({
      idempotencyKey: "complete-1",
      calendarDate: "2026-08-09",
      requiredCount: 5,
      items: normalItems,
      attempts: [verified],
      priorCompletedCalendarDates: []
    })
  );

  const shortened = completionItems(5).map((item, index) =>
    index < 3 ? item : { ...item, completionReason: "shortened" as const }
  );
  assert.equal(
    evaluateSessionCompletion({
      idempotencyKey: "complete-2",
      calendarDate: "2026-08-10",
      requiredCount: 3,
      items: shortened,
      attempts: [verified],
      priorCompletedCalendarDates: []
    }).status,
    "eligible"
  );
});

test("completion rejects open, invalid-only, optional-only, wrong counts and same-date duplicate", () => {
  const base = {
    idempotencyKey: "complete-x",
    calendarDate: "2026-08-09",
    items: completionItems(5),
    attempts: [attempt("a1", "required-1", "anchor")],
    priorCompletedCalendarDates: [] as string[]
  };
  for (const requiredCount of [1, 2, 4]) {
    assert.equal(evaluateSessionCompletion({ ...base, requiredCount }).status, "ineligible");
  }
  assert.equal(
    evaluateSessionCompletion({ ...base, requiredCount: 5, items: [{ ...base.items[0]!, completionReason: undefined }] }).status,
    "ineligible"
  );
  assert.equal(
    evaluateSessionCompletion({
      ...base,
      requiredCount: 5,
      attempts: [attempt("unverified", "required-1", "anchor", { serverVerified: false })]
    }).status,
    "ineligible"
  );
  assert.equal(
    evaluateSessionCompletion({
      ...base,
      requiredCount: 5,
      attempts: [attempt("bad", "required-1", "anchor", { technicalValidity: "invalid", ordinal: undefined })]
    }).status,
    "ineligible"
  );
  assert.equal(
    evaluateSessionCompletion({
      ...base,
      requiredCount: 5,
      attempts: [attempt("optional", "optional-1", "optional_extension")]
    }).status,
    "ineligible"
  );
  assert.equal(
    evaluateSessionCompletion({ ...base, requiredCount: 5, priorCompletedCalendarDates: ["2026-08-09"] }).status,
    "ineligible"
  );
});

function createPlan(contentRows: ContentCandidate[], focusRows: FocusCandidate[] = focuses()) {
  return createDailyPlan({
    programDay: 1,
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
    serverVerifiedBasis: true,
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
    serverVerified?: boolean;
  } = {}
): LearningAttempt {
  return {
    id,
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
    serverVerified: overrides.serverVerified ?? true,
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
    focusGroupKey: FOCUS,
    kind,
    calendarDate,
    promptRole,
    promptContext,
    assisted: false,
    serverVerified: true,
    contentVersionId: CONTENT_VERSION,
    ...overrides
  };
}

function completionItems(count: number): CompletionItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `required-${index + 1}`,
    required: true,
    promptRole: (index === 0 ? "anchor" : index === 1 ? "contrast" : "transfer_word") as PromptRole,
    completionReason: "completed"
  }));
}
