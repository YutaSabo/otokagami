export type DateOnly = string;

export type PromptRole =
  | "anchor"
  | "contrast"
  | "transfer_word"
  | "sentence"
  | "practical_sentence"
  | "review"
  | "optional_extension";

export type AttemptRole = "cold" | "guided_retry" | "transfer" | "review" | "optional_extension";
export type ReviewIntervalKind = "day_1" | "day_3" | "day_7" | "day_14";
export type ReviewStatus = "scheduled" | "due" | "overdue" | "completed" | "superseded";
export type FocusState =
  | "discovered"
  | "immediate_change"
  | "held"
  | "transferred"
  | "stable"
  | "maintenance";
export type EvidenceKind = FocusState;

export type PolicyDecision =
  | { status: "met"; reason: string }
  | { status: "not_met"; reason: string }
  | { status: "unknown"; reason: string };

export interface LearningAttempt {
  id: string;
  userId: string;
  sessionId: string;
  sessionItemId: string;
  clientAttemptId: string;
  payloadSha256: string;
  contentVersionId: string;
  practiceItemKey: string;
  focusGroupKey: string;
  promptRole: PromptRole;
  attemptRole: AttemptRole;
  retryFromAttemptId?: string;
  attemptSequence: number;
  validAttemptOrdinal?: number;
  attemptedAt: string;
  calendarDate: DateOnly;
  timezone: string;
  coachingShown: boolean;
  assisted: boolean;
  technicalValidity: "valid" | "invalid";
  invalidReason?: string;
  serverVerified: boolean;
  provider: string;
  assessmentLocale: string;
}

export interface LearningPolicy {
  version: string;
  evaluateAttempt(input: {
    purpose: "shortening";
    attempt: LearningAttempt;
  }): PolicyDecision;
  evaluateEvidence(input: {
    targetState: FocusState;
    evidence: FocusEvidence;
    allEvidence: readonly FocusEvidence[];
  }): PolicyDecision;
}

export interface ContentCandidate {
  contentVersionId: string;
  practiceItemKey: string;
  focusGroupKey: string;
  promptRole: PromptRole;
  active: boolean;
  humanReviewed: boolean;
  azureValidated: boolean;
  referenceText?: string;
  referenceTextVersion?: string;
  expectedFocusRepresentation?: string;
  nextActionKey?: string;
}

export interface FocusCandidate {
  id: string;
  focusGroupKey: string;
  kind: "discovery" | "due" | "next_context" | "unevaluated";
  reproducible?: boolean;
  dueDate?: DateOnly;
  contextOrder?: number;
  active: boolean;
  humanReviewed: boolean;
  azureValidated: boolean;
}

export interface ReviewScheduleCandidate {
  id: string;
  focusGroupKey: string;
  basedOnEvidenceId: string;
  intervalKind: ReviewIntervalKind;
  dueDate: DateOnly;
  status?: ReviewStatus;
  serverVerifiedBasis: boolean;
  unassistedBasis: boolean;
}

export interface PlannedItem {
  position: number;
  slotRole: PromptRole;
  promptRole: PromptRole;
  contentVersionId: string;
  practiceItemKey: string;
  focusGroupKey: string;
  required: boolean;
  reviewScheduleId?: string;
  selectionReason:
    | "standard"
    | "due_review"
    | "review_substitute_transfer_word"
    | "review_substitute_sentence"
    | "review_substitute_practical_sentence"
    | "optional_extension";
}

export interface DailyPlan {
  learningDaySequence: number;
  trialProgramDay?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  contentVersionId: string;
  originatingCalendarDate: DateOnly;
  effectiveCalendarDate: DateOnly;
  focusGroupKey: string;
  requiredCount: 5;
  requiredItems: PlannedItem[];
  optionalItems: PlannedItem[];
  selectedReview?: ReviewScheduleCandidate;
  reviewSubstitutionReason?: string;
}

export interface FocusEvidence {
  id: string;
  userId: string;
  sessionItemId: string;
  focusGroupKey: string;
  kind: EvidenceKind;
  calendarDate: DateOnly;
  promptRole: PromptRole;
  promptContext: string;
  assisted: boolean;
  serverVerified: boolean;
  contentVersionId: string;
  sourceAttemptId?: string;
  correctionCycleId?: string;
  reviewIntervalKind?: ReviewIntervalKind;
}

export interface CorrectionCycle {
  id: string;
  userId: string;
  sessionId: string;
  focusGroupKey: string;
  sessionItemId: string;
  beforeAttemptId: string;
  afterAttemptId: string;
}

export interface CompletionItem {
  id: string;
  practiceItemKey: string;
  focusGroupKey: string;
  required: boolean;
  promptRole: PromptRole;
  completionReason?: "completed" | "shortened" | "substituted" | "skipped_after_technical_failures";
}
