import { selectCountedAttempts } from "./attempts.js";
import type { CompletionItem, DateOnly, LearningAttempt } from "./types.js";

export function evaluateSessionCompletion(input: {
  idempotencyKey: string;
  calendarDate: DateOnly;
  requiredCount: number;
  items: readonly CompletionItem[];
  attempts: readonly LearningAttempt[];
  priorCompletedCalendarDates: readonly DateOnly[];
}):
  | {
      status: "eligible";
      idempotencyKey: string;
      calendarDate: DateOnly;
      completedRequiredCount: number;
    }
  | { status: "ineligible"; idempotencyKey: string; reason: string } {
  if (input.requiredCount !== 3 && input.requiredCount !== 5) {
    return ineligible(input.idempotencyKey, "required_count_must_be_three_or_five");
  }
  if (input.priorCompletedCalendarDates.includes(input.calendarDate)) {
    return ineligible(input.idempotencyKey, "calendar_date_already_completed");
  }

  const required = input.items.filter((item) => item.required);
  if (required.length !== 5) {
    return ineligible(input.idempotencyKey, "plan_must_contain_exactly_five_required_items");
  }
  const completed = required.filter((item) => {
    if (input.requiredCount === 5) {
      return (
        item.completionReason === "completed" ||
        item.completionReason === "substituted" ||
        item.completionReason === "skipped_after_technical_failures"
      );
    }
    return item.completionReason !== undefined;
  });
  if (input.requiredCount === 5 && completed.length !== required.length) {
    return ineligible(input.idempotencyKey, "required_items_incomplete");
  }
  if (input.requiredCount === 3) {
    const activeCompleted = required.filter((item) => item.completionReason !== "shortened");
    const shortened = required.filter((item) => item.completionReason === "shortened");
    if (activeCompleted.length !== 3 || activeCompleted.some((item) => item.completionReason === undefined)) {
      return ineligible(input.idempotencyKey, "short_plan_requires_exactly_three_completed_items");
    }
    if (required.length !== 3 + shortened.length) {
      return ineligible(input.idempotencyKey, "short_plan_shape_invalid");
    }
  }

  const requiredIds = new Set(required.map((item) => item.id));
  const hasVerifiedLearningAttempt = selectCountedAttempts(input.attempts).accepted.some(
    (attempt) =>
      requiredIds.has(attempt.sessionItemId) &&
      attempt.serverVerified &&
      attempt.technicalValidity === "valid"
  );
  if (!hasVerifiedLearningAttempt) {
    return ineligible(input.idempotencyKey, "no_valid_server_verified_learning_attempt");
  }

  return {
    status: "eligible",
    idempotencyKey: input.idempotencyKey,
    calendarDate: input.calendarDate,
    completedRequiredCount: input.requiredCount
  };
}

function ineligible(idempotencyKey: string, reason: string) {
  return { status: "ineligible" as const, idempotencyKey, reason };
}
