import { selectCountedAttempts } from "./attempts.js";
import { assertDateOnly, assertIanaTimeZone, assertUuid } from "./dates.js";
import { evaluateShortening } from "./planner.js";
import type { CompletionItem, DailyPlan, DateOnly, LearningAttempt, LearningPolicy } from "./types.js";

export function evaluateSessionCompletion(input: {
  idempotencyKey: string;
  calendarDate: DateOnly;
  sessionId: string;
  sessionTimezone: string;
  plan: DailyPlan;
  items: readonly CompletionItem[];
  attempts: readonly LearningAttempt[];
  priorCompletedCalendarDates: readonly DateOnly[];
  shorteningPolicy?: LearningPolicy;
}):
  | {
      status: "eligible";
      idempotencyKey: string;
      calendarDate: DateOnly;
      completedRequiredCount: number;
    }
  | { status: "ineligible"; idempotencyKey: string; reason: string } {
  try {
    assertUuid(input.idempotencyKey, "idempotencyKey");
    assertDateOnly(input.calendarDate);
    assertIanaTimeZone(input.sessionTimezone);
  } catch {
    return ineligible(input.idempotencyKey, "invalid_completion_boundary");
  }
  if (input.priorCompletedCalendarDates.includes(input.calendarDate)) {
    return ineligible(input.idempotencyKey, "calendar_date_already_completed");
  }

  const required = input.items.filter((item) => item.required);
  if (required.length !== 5) {
    return ineligible(input.idempotencyKey, "plan_must_contain_exactly_five_required_items");
  }
  const completed = required.filter((item) =>
    item.completionReason === "completed" ||
    item.completionReason === "substituted" ||
    item.completionReason === "skipped_after_technical_failures"
  );
  const shortening = evaluateShortening({
    plan: input.plan,
    sessionId: input.sessionId,
    completedRequiredItemKeys: completed.map((item) => item.practiceItemKey),
    attempts: input.attempts,
    policy: input.shorteningPolicy
  });
  const effectiveRequiredCount = shortening.status === "shortened" ? 3 : 5;
  if (effectiveRequiredCount === 5 && completed.length !== required.length) {
    return ineligible(input.idempotencyKey, "required_items_incomplete");
  }
  if (shortening.status === "shortened") {
    if (
      completed.length !== 3 ||
      completed.some((item) => !shortening.keptPracticeItemKeys.includes(item.practiceItemKey))
    ) {
      return ineligible(input.idempotencyKey, "server_shortening_evidence_mismatch");
    }
  }

  const requiredIds = new Set(required.map((item) => item.id));
  const hasVerifiedLearningAttempt = selectCountedAttempts(input.attempts).accepted.some(
    (attempt) =>
      requiredIds.has(attempt.sessionItemId) &&
      attempt.serverNormalized &&
      attempt.technicalValidity === "valid"
  );
  if (!hasVerifiedLearningAttempt) {
    return ineligible(input.idempotencyKey, "no_valid_server_normalized_learning_attempt");
  }

  return {
    status: "eligible",
    idempotencyKey: input.idempotencyKey,
    calendarDate: input.calendarDate,
    completedRequiredCount: effectiveRequiredCount
  };
}

function ineligible(idempotencyKey: string, reason: string) {
  return { status: "ineligible" as const, idempotencyKey, reason };
}
