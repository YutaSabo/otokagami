import { selectCountedAttempts } from "./attempts.js";
import { assertDateOnly, assertPositiveLearningSequence, assertTrialProgramDay } from "./dates.js";
import { selectDueReview } from "./reviews.js";
import type {
  ContentCandidate,
  DailyPlan,
  FocusCandidate,
  LearningAttempt,
  LearningPolicy,
  PlannedItem,
  PromptRole,
  ReviewScheduleCandidate
} from "./types.js";

const FOCUS_PRIORITY: Record<FocusCandidate["kind"], number> = {
  discovery: 0,
  due: 1,
  next_context: 2,
  unevaluated: 3
};

export function selectFocusCandidate(candidates: readonly FocusCandidate[]): FocusCandidate | undefined {
  return [...candidates]
    .filter(isUsableFocus)
    .filter((candidate) => candidate.kind !== "discovery" || candidate.reproducible === true)
    .sort((left, right) => {
      return (
        FOCUS_PRIORITY[left.kind] - FOCUS_PRIORITY[right.kind] ||
        nullableString(left.dueDate).localeCompare(nullableString(right.dueDate)) ||
        (left.contextOrder ?? Number.MAX_SAFE_INTEGER) -
          (right.contextOrder ?? Number.MAX_SAFE_INTEGER) ||
        left.focusGroupKey.localeCompare(right.focusGroupKey) ||
        left.id.localeCompare(right.id)
      );
    })[0];
}

export function createDailyPlan(input: {
  learningDaySequence: number;
  trialProgramDay?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  contentVersionId: string;
  calendarDate: string;
  focusCandidates: readonly FocusCandidate[];
  content: readonly ContentCandidate[];
  reviewSchedules: readonly ReviewScheduleCandidate[];
}):
  | { status: "ok"; plan: DailyPlan }
  | { status: "insufficient_content"; reason: string; focusGroupKey?: string } {
  const focus = selectFocusCandidate(input.focusCandidates);
  assertPositiveLearningSequence(input.learningDaySequence);
  assertTrialProgramDay(input.trialProgramDay);
  assertDateOnly(input.calendarDate);
  if (focus === undefined) return { status: "insufficient_content", reason: "no_eligible_focus" };

  const usable = input.content
    .filter(
      (candidate) =>
        candidate.contentVersionId === input.contentVersionId &&
        candidate.active &&
        candidate.humanReviewed &&
        candidate.azureValidated
    )
    .sort(compareContent);
  const used = new Set<string>();
  const requiredItems: PlannedItem[] = [];

  const addStandard = (slotRole: PromptRole, roleCandidates: readonly PromptRole[]): boolean => {
    let selected: ContentCandidate | undefined;
    for (const role of roleCandidates) {
      selected = firstUnused(
        usable.filter(
          (candidate) => candidate.focusGroupKey === focus.focusGroupKey && candidate.promptRole === role
        ),
        used
      );
      if (selected !== undefined) break;
    }
    if (selected === undefined) return false;
    used.add(selected.practiceItemKey);
    requiredItems.push(toPlannedItem(selected, requiredItems.length + 1, slotRole, true, "standard"));
    return true;
  };

  if (!addStandard("anchor", ["anchor"])) return insufficient("missing_anchor", focus.focusGroupKey);
  if (!addStandard("contrast", ["contrast"])) return insufficient("missing_contrast", focus.focusGroupKey);
  if (!addStandard("transfer_word", ["transfer_word"])) {
    return insufficient("missing_transfer_word", focus.focusGroupKey);
  }
  if (!addStandard("sentence", ["sentence", "practical_sentence"])) {
    return insufficient("missing_sentence", focus.focusGroupKey);
  }

  const review = selectDueReview({
    calendarDate: input.calendarDate,
    schedules: input.reviewSchedules
  }).selected;
  let reviewSubstitutionReason: string | undefined;
  if (review !== undefined) {
    const reviewContent = firstUnused(
      usable.filter(
        (candidate) => candidate.focusGroupKey === review.focusGroupKey && candidate.promptRole === "review"
      ),
      used
    );
    if (reviewContent === undefined) {
      return insufficient("missing_due_review_content", focus.focusGroupKey);
    }
    used.add(reviewContent.practiceItemKey);
    requiredItems.push({
      ...toPlannedItem(reviewContent, 5, "review", true, "due_review"),
      reviewScheduleId: review.id
    });
  } else {
    const fallbackRoles: Array<readonly [PromptRole, PlannedItem["selectionReason"]]> = [
      ["transfer_word", "review_substitute_transfer_word"],
      ["sentence", "review_substitute_sentence"],
      ["practical_sentence", "review_substitute_practical_sentence"]
    ];
    let substitute: ContentCandidate | undefined;
    let reason: PlannedItem["selectionReason"] | undefined;
    for (const [role, selectionReason] of fallbackRoles) {
      substitute = firstUnused(
        usable.filter(
          (candidate) => candidate.focusGroupKey === focus.focusGroupKey && candidate.promptRole === role
        ),
        used
      );
      if (substitute !== undefined) {
        reason = selectionReason;
        break;
      }
    }
    if (substitute === undefined || reason === undefined) {
      return insufficient("missing_review_substitute", focus.focusGroupKey);
    }
    used.add(substitute.practiceItemKey);
    reviewSubstitutionReason = reason;
    requiredItems.push(toPlannedItem(substitute, 5, "review", true, reason));
  }

  const optionalSeen = new Set(used);
  const optionalItems = usable
    .filter(
      (candidate) =>
        candidate.focusGroupKey === focus.focusGroupKey &&
        candidate.promptRole === "optional_extension" &&
        !optionalSeen.has(candidate.practiceItemKey)
    )
    .filter((candidate) => {
      optionalSeen.add(candidate.practiceItemKey);
      return true;
    })
    .slice(0, 2)
    .map((candidate, index) =>
      toPlannedItem(candidate, requiredItems.length + index + 1, "optional_extension", false, "optional_extension")
    );

  return {
    status: "ok",
    plan: {
      learningDaySequence: input.learningDaySequence,
      trialProgramDay: input.trialProgramDay,
      contentVersionId: input.contentVersionId,
      originatingCalendarDate: input.calendarDate,
      effectiveCalendarDate: input.calendarDate,
      focusGroupKey: focus.focusGroupKey,
      requiredCount: 5,
      requiredItems,
      optionalItems,
      selectedReview: review,
      reviewSubstitutionReason
    }
  };
}

export function resumeProgramDayPlan(input: {
  plan: DailyPlan;
  calendarDate: string;
  startedItemPositions: readonly number[];
  content: readonly ContentCandidate[];
  reviewSchedules: readonly ReviewScheduleCandidate[];
}): DailyPlan {
  assertDateOnly(input.calendarDate);
  if (input.calendarDate === input.plan.effectiveCalendarDate) return input.plan;
  const reviewItem = input.plan.requiredItems.find((item) => item.slotRole === "review");
  if (reviewItem === undefined || input.startedItemPositions.includes(reviewItem.position)) {
    return { ...input.plan, effectiveCalendarDate: input.calendarDate };
  }
  const selectedReview = selectDueReview({
    calendarDate: input.calendarDate,
    schedules: input.reviewSchedules
  }).selected;
  if (selectedReview === undefined) {
    return { ...input.plan, effectiveCalendarDate: input.calendarDate };
  }
  const replacement = [...input.content]
    .filter(
      (candidate) =>
        candidate.contentVersionId === input.plan.contentVersionId &&
        candidate.focusGroupKey === selectedReview.focusGroupKey &&
        candidate.promptRole === "review" &&
        candidate.active &&
        candidate.humanReviewed &&
        candidate.azureValidated
    )
    .sort(compareContent)[0];
  if (replacement === undefined) return { ...input.plan, effectiveCalendarDate: input.calendarDate };
  return {
    ...input.plan,
    effectiveCalendarDate: input.calendarDate,
    selectedReview,
    requiredItems: input.plan.requiredItems.map((item) =>
      item.position === reviewItem.position
        ? { ...toPlannedItem(replacement, item.position, "review", true, "due_review"), reviewScheduleId: selectedReview.id }
        : item
    )
  };
}

export function resolveProgramDayPlan(input: {
  existingUncompletedPlan?: DailyPlan;
  nextPlanInput: Parameters<typeof createDailyPlan>[0];
}):
  | { status: "ok"; plan: DailyPlan; reusedExisting: boolean }
  | { status: "insufficient_content"; reason: string; focusGroupKey?: string; reusedExisting: false } {
  if (input.existingUncompletedPlan !== undefined) {
    return { status: "ok", plan: input.existingUncompletedPlan, reusedExisting: true };
  }
  const created = createDailyPlan(input.nextPlanInput);
  return created.status === "ok"
    ? { ...created, reusedExisting: false }
    : { ...created, reusedExisting: false };
}

export function evaluateShortening(input: {
  plan: DailyPlan;
  sessionId: string;
  completedRequiredItemKeys: readonly string[];
  attempts: readonly LearningAttempt[];
  policy?: LearningPolicy;
}):
  | {
      status: "shortened";
      requiredCount: 3;
      keptPracticeItemKeys: string[];
      shortenedPracticeItemKeys: string[];
      evidenceAttemptIds: [string, string];
      policyVersion: string;
      reason: string;
    }
  | { status: "kept_standard" | "needs_policy" | "unknown"; requiredCount: 5; reason: string } {
  const completed = new Set(input.completedRequiredItemKeys);
  if (completed.size >= 4) {
    return { status: "kept_standard", requiredCount: 5, reason: "too_late_after_four_required_items" };
  }
  if (input.policy === undefined) {
    return { status: "needs_policy", requiredCount: 5, reason: "shortening_policy_not_configured" };
  }

  const planKeys = new Set(input.plan.requiredItems.map((item) => item.practiceItemKey));
  if ([...completed].some((key) => !planKeys.has(key))) {
    return { status: "kept_standard", requiredCount: 5, reason: "completed_item_not_in_plan" };
  }
  const accepted = selectCountedAttempts(input.attempts).accepted.filter(
    (attempt) =>
      attempt.sessionId === input.sessionId &&
      attempt.focusGroupKey === input.plan.focusGroupKey &&
      planKeys.has(attempt.practiceItemKey) &&
      attempt.serverVerified &&
      !attempt.assisted &&
      !attempt.coachingShown &&
      attempt.attemptRole !== "guided_retry"
  );
  const firstByRole = new Map<PromptRole, LearningAttempt>();
  for (const attempt of accepted) {
    if (!firstByRole.has(attempt.promptRole)) firstByRole.set(attempt.promptRole, attempt);
  }
  const anchor = firstByRole.get("anchor");
  const other = [...firstByRole.values()].find((attempt) => attempt.promptRole !== "anchor");
  if (anchor === undefined || other === undefined) {
    return { status: "kept_standard", requiredCount: 5, reason: "insufficient_unassisted_evidence" };
  }

  const anchorDecision = input.policy.evaluateAttempt({ purpose: "shortening", attempt: anchor });
  const otherDecision = input.policy.evaluateAttempt({ purpose: "shortening", attempt: other });
  if (anchorDecision.status === "unknown" || otherDecision.status === "unknown") {
    return { status: "unknown", requiredCount: 5, reason: "shortening_policy_result_unknown" };
  }
  if (anchorDecision.status !== "met" || otherDecision.status !== "met") {
    return { status: "kept_standard", requiredCount: 5, reason: "shortening_policy_not_met" };
  }

  const kept = new Set<string>([...completed, anchor.practiceItemKey, other.practiceItemKey]);
  if (kept.size > 3) {
    return { status: "kept_standard", requiredCount: 5, reason: "completed_items_conflict_with_short_plan" };
  }
  const reviewItem =
    input.plan.selectedReview === undefined
      ? undefined
      : input.plan.requiredItems.find((item) => item.reviewScheduleId === input.plan.selectedReview?.id);
  if (reviewItem !== undefined && kept.size === 3 && !kept.has(reviewItem.practiceItemKey)) {
    return { status: "kept_standard", requiredCount: 5, reason: "selected_review_must_remain_in_short_plan" };
  }
  if (reviewItem !== undefined && !kept.has(reviewItem.practiceItemKey) && kept.size < 3) {
    kept.add(reviewItem.practiceItemKey);
  }
  for (const item of input.plan.requiredItems) {
    if (kept.size >= 3) break;
    kept.add(item.practiceItemKey);
  }

  const keptPracticeItemKeys = input.plan.requiredItems
    .filter((item) => kept.has(item.practiceItemKey))
    .map((item) => item.practiceItemKey);
  if (keptPracticeItemKeys.length !== 3) {
    return { status: "kept_standard", requiredCount: 5, reason: "unable_to_form_three_item_plan" };
  }

  return {
    status: "shortened",
    requiredCount: 3,
    keptPracticeItemKeys,
    shortenedPracticeItemKeys: input.plan.requiredItems
      .filter((item) => !kept.has(item.practiceItemKey))
      .map((item) => item.practiceItemKey),
    evidenceAttemptIds: [anchor.id, other.id],
    policyVersion: input.policy.version,
    reason: "two_distinct_unassisted_roles_met_policy"
  };
}

export function optionalExtensionsAvailable(input: {
  requiredItems: readonly { completionReason?: string }[];
  optionalItems: readonly PlannedItem[];
}): PlannedItem[] {
  const complete = input.requiredItems.every((item) => item.completionReason !== undefined);
  return complete ? input.optionalItems.slice(0, 2) : [];
}

function toPlannedItem(
  candidate: ContentCandidate,
  position: number,
  slotRole: PromptRole,
  required: boolean,
  selectionReason: PlannedItem["selectionReason"]
): PlannedItem {
  return {
    position,
    slotRole,
    promptRole: candidate.promptRole,
    contentVersionId: candidate.contentVersionId,
    practiceItemKey: candidate.practiceItemKey,
    focusGroupKey: candidate.focusGroupKey,
    required,
    selectionReason
  };
}

function firstUnused(candidates: readonly ContentCandidate[], used: ReadonlySet<string>): ContentCandidate | undefined {
  return candidates.find((candidate) => !used.has(candidate.practiceItemKey));
}

function compareContent(left: ContentCandidate, right: ContentCandidate): number {
  return left.promptRole.localeCompare(right.promptRole) || left.practiceItemKey.localeCompare(right.practiceItemKey);
}

function isUsableFocus(candidate: FocusCandidate): boolean {
  return candidate.active && candidate.humanReviewed && candidate.azureValidated;
}

function nullableString(value: string | undefined): string {
  return value ?? "9999-99-99";
}

function insufficient(reason: string, focusGroupKey: string) {
  return { status: "insufficient_content" as const, reason, focusGroupKey };
}
