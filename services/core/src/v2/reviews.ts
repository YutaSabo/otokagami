import { addCalendarDays, compareDateOnly } from "./dates.js";
import type {
  DateOnly,
  FocusEvidence,
  ReviewIntervalKind,
  ReviewScheduleCandidate,
  ReviewStatus
} from "./types.js";

const REVIEW_OFFSETS: ReadonlyArray<readonly [ReviewIntervalKind, number]> = [
  ["day_1", 1],
  ["day_3", 3],
  ["day_7", 7],
  ["day_14", 14]
];

export function reviewStatusForDate(dueDate: DateOnly, calendarDate: DateOnly): ReviewStatus {
  const comparison = compareDateOnly(dueDate, calendarDate);
  if (comparison < 0) return "overdue";
  if (comparison === 0) return "due";
  return "scheduled";
}

export function createReviewScheduleCandidates(input: {
  evidence: Pick<
    FocusEvidence,
    "id" | "focusGroupKey" | "calendarDate" | "serverNormalized" | "assisted" | "kind"
  >;
  existing?: readonly Pick<ReviewScheduleCandidate, "basedOnEvidenceId" | "intervalKind">[];
}):
  | { status: "created"; schedules: ReviewScheduleCandidate[] }
  | { status: "ineligible"; reason: "unnormalized_basis" | "assisted_basis" | "non_durable_basis" } {
  if (!input.evidence.serverNormalized) return { status: "ineligible", reason: "unnormalized_basis" };
  if (input.evidence.assisted) return { status: "ineligible", reason: "assisted_basis" };
  if (input.evidence.kind === "immediate_change") {
    return { status: "ineligible", reason: "non_durable_basis" };
  }
  const existingKeys = new Set(
    (input.existing ?? []).map((schedule) => `${schedule.basedOnEvidenceId}:${schedule.intervalKind}`)
  );

  return {
    status: "created",
    schedules: REVIEW_OFFSETS.filter(
      ([intervalKind]) => !existingKeys.has(`${input.evidence.id}:${intervalKind}`)
    ).map(([intervalKind, offset]) => ({
      id: `${input.evidence.id}:${intervalKind}`,
      focusGroupKey: input.evidence.focusGroupKey,
      basedOnEvidenceId: input.evidence.id,
      intervalKind,
      dueDate: addCalendarDays(input.evidence.calendarDate, offset),
      serverNormalizedBasis: true,
      unassistedBasis: true
    }))
  };
}

export function selectDueReview(input: {
  calendarDate: DateOnly;
  schedules: readonly ReviewScheduleCandidate[];
}): {
  selected?: ReviewScheduleCandidate;
  ignoredDuplicateIds: string[];
} {
  const seen = new Set<string>();
  const ignoredDuplicateIds: string[] = [];
  const eligible = [...input.schedules]
    .sort(compareReview)
    .filter((schedule) => {
      const key = `${schedule.basedOnEvidenceId}:${schedule.intervalKind}`;
      if (seen.has(key)) {
        ignoredDuplicateIds.push(schedule.id);
        return false;
      }
      seen.add(key);
      if (!schedule.serverNormalizedBasis || !schedule.unassistedBasis) return false;
      if (schedule.status === "completed" || schedule.status === "superseded") return false;
      return reviewStatusForDate(schedule.dueDate, input.calendarDate) !== "scheduled";
    });

  return { selected: eligible[0], ignoredDuplicateIds: ignoredDuplicateIds.sort() };
}

function compareReview(left: ReviewScheduleCandidate, right: ReviewScheduleCandidate): number {
  return (
    compareDateOnly(left.dueDate, right.dueDate) ||
    left.focusGroupKey.localeCompare(right.focusGroupKey) ||
    left.id.localeCompare(right.id)
  );
}
