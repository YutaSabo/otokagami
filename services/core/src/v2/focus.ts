import { compareAttempt, selectCountedAttempts } from "./attempts.js";
import { addCalendarDays, compareDateOnly } from "./dates.js";
import type {
  CorrectionCycle,
  FocusEvidence,
  FocusState,
  LearningAttempt,
  LearningPolicy
} from "./types.js";

const STATE_ORDER: readonly FocusState[] = [
  "discovered",
  "immediate_change",
  "held",
  "transferred",
  "stable",
  "maintenance"
];

export function deriveFocusState(input: {
  focusGroupKey: string;
  currentState?: FocusState;
  evidence: readonly FocusEvidence[];
  attempts: readonly LearningAttempt[];
  correctionCycles: readonly CorrectionCycle[];
  policy?: LearningPolicy;
}): {
  status: "ok" | "needs_policy" | "unknown";
  state?: FocusState;
  adoptedEvidenceIds: string[];
  exclusions: Array<{ evidenceId: string; reason: string }>;
  nextNeeded: string;
  policyVersion?: string;
} {
  const relevant = [...input.evidence]
    .filter((evidence) => evidence.focusGroupKey === input.focusGroupKey)
    .sort(compareEvidence);
  if (input.policy === undefined) {
    return {
      status: "needs_policy",
      state: input.currentState,
      adoptedEvidenceIds: [],
      exclusions: [],
      nextNeeded: nextNeededFor(input.currentState),
      policyVersion: undefined
    };
  }

  const exclusions: Array<{ evidenceId: string; reason: string }> = [];
  const safe: FocusEvidence[] = [];
  for (const evidence of relevant) {
    if (!evidence.serverNormalized) {
      exclusions.push({ evidenceId: evidence.id, reason: "not_server_normalized" });
      continue;
    }
    if (evidence.kind !== "immediate_change" && evidence.assisted) {
      exclusions.push({ evidenceId: evidence.id, reason: "assisted_not_durable" });
      continue;
    }
    if (evidence.kind === "immediate_change" && !isValidCycleEvidence(evidence, input)) {
      exclusions.push({ evidenceId: evidence.id, reason: "invalid_correction_cycle" });
      continue;
    }
    safe.push(evidence);
  }
  const qualified: FocusEvidence[] = [];
  let hasUnknown = false;
  for (const evidence of safe) {
    const decision = input.policy.evaluateEvidence({
      targetState: evidence.kind,
      evidence,
      allEvidence: safe
    });
    if (decision.status === "unknown") {
      hasUnknown = true;
      exclusions.push({ evidenceId: evidence.id, reason: `policy_unknown:${decision.reason}` });
      continue;
    }
    if (decision.status === "not_met") {
      exclusions.push({ evidenceId: evidence.id, reason: `policy_not_met:${decision.reason}` });
      continue;
    }
    qualified.push(evidence);
  }

  const adopted: FocusEvidence[] = [];
  const discovery = qualified.find((evidence) => evidence.kind === "discovered" && !evidence.assisted);
  let derived: FocusState | undefined;
  if (discovery !== undefined) {
    derived = "discovered";
    adopted.push(discovery);
  }

  const immediate = qualified.find((evidence) => evidence.kind === "immediate_change");
  if (derived === "discovered" && immediate !== undefined) {
    derived = "immediate_change";
    adopted.push(immediate);
  }

  const held = qualified.find(
    (evidence) =>
      evidence.kind === "held" &&
      discovery !== undefined &&
      compareDateOnly(evidence.calendarDate, discovery.calendarDate) > 0
  );
  if (discovery !== undefined && held !== undefined) {
    derived = "held";
    adopted.push(held);
  }

  const transferred = qualified.find(
    (evidence) =>
      evidence.kind === "transferred" &&
      discovery !== undefined &&
      held !== undefined &&
      compareEvidence(evidence, held) > 0 &&
      (evidence.promptRole !== discovery.promptRole || evidence.promptContext !== discovery.promptContext)
  );
  if (held !== undefined && transferred !== undefined) {
    derived = "transferred";
    adopted.push(transferred);
  }

  const stable = qualified.find(
    (evidence) =>
      evidence.kind === "stable" &&
      evidence.reviewIntervalKind === "day_7" &&
      discovery !== undefined &&
      transferred !== undefined &&
      compareEvidence(evidence, transferred) > 0 &&
      compareDateOnly(evidence.calendarDate, addCalendarDays(discovery.calendarDate, 7)) >= 0
  );
  if (
    held !== undefined &&
    transferred !== undefined &&
    stable !== undefined &&
    distinctDates([discovery!, held, transferred, stable]).size >= 2 &&
    distinctContexts([discovery!, held, transferred, stable]).size >= 2
  ) {
    derived = "stable";
    adopted.push(stable);
  }

  const maintenance = qualified.find(
    (evidence) =>
      evidence.kind === "maintenance" &&
      evidence.reviewIntervalKind === "day_14" &&
      discovery !== undefined &&
      stable !== undefined &&
      compareDateOnly(evidence.calendarDate, stable.calendarDate) > 0 &&
      compareDateOnly(evidence.calendarDate, addCalendarDays(discovery.calendarDate, 14)) >= 0
  );
  if (derived === "stable" && maintenance !== undefined && stable !== undefined) {
    derived = "maintenance";
    adopted.push(maintenance);
  }

  const state = higherState(input.currentState, derived);
  const adoptedIds = new Set(adopted.map((evidence) => evidence.id));
  for (const evidence of qualified) {
    if (!adoptedIds.has(evidence.id)) {
      exclusions.push({ evidenceId: evidence.id, reason: `prerequisite_not_met_for_${evidence.kind}` });
    }
  }
  return {
    status: hasUnknown && state === input.currentState ? "unknown" : "ok",
    state,
    adoptedEvidenceIds: unique(adopted.map((evidence) => evidence.id)),
    exclusions: exclusions.sort(
      (left, right) => left.evidenceId.localeCompare(right.evidenceId) || left.reason.localeCompare(right.reason)
    ),
    nextNeeded: nextNeededFor(state),
    policyVersion: input.policy.version
  };
}

function isValidCycleEvidence(
  evidence: FocusEvidence,
  input: {
    attempts: readonly LearningAttempt[];
    correctionCycles: readonly CorrectionCycle[];
  }
): boolean {
  const cycle = input.correctionCycles.find((candidate) => candidate.id === evidence.correctionCycleId);
  if (cycle === undefined) return false;
  const attempts = selectCountedAttempts(input.attempts).accepted.sort(compareAttempt);
  const before = attempts.find((attempt) => attempt.id === cycle.beforeAttemptId);
  const after = attempts.find((attempt) => attempt.id === cycle.afterAttemptId);
  return (
    before !== undefined &&
    after !== undefined &&
    cycle.userId === evidence.userId &&
    cycle.sessionId === before.sessionId &&
    evidence.sessionItemId === cycle.sessionItemId &&
    before.userId === after.userId &&
    before.userId === evidence.userId &&
    before.sessionId === after.sessionId &&
    before.serverNormalized &&
    after.serverNormalized &&
    before.technicalValidity === "valid" &&
    after.technicalValidity === "valid" &&
    !before.assisted &&
    before.attemptRole !== "guided_retry" &&
    after.attemptRole === "guided_retry" &&
    after.retryFromAttemptId === before.id &&
    before.sessionItemId === after.sessionItemId &&
    before.focusGroupKey === after.focusGroupKey &&
    evidence.focusGroupKey === cycle.focusGroupKey &&
    cycle.focusGroupKey === before.focusGroupKey
  );
}

function higherState(current: FocusState | undefined, candidate: FocusState | undefined): FocusState | undefined {
  if (current === undefined) return candidate;
  if (candidate === undefined) return current;
  return STATE_ORDER.indexOf(candidate) > STATE_ORDER.indexOf(current) ? candidate : current;
}

function nextNeededFor(state: FocusState | undefined): string {
  switch (state) {
    case undefined:
      return "discovery_evidence";
    case "discovered":
      return "guided_correction_or_next_day_unassisted";
    case "immediate_change":
      return "different_calendar_date_unassisted";
    case "held":
      return "different_context_unassisted";
    case "transferred":
      return "day_7_unassisted_review";
    case "stable":
      return "day_14_unassisted_review";
    case "maintenance":
      return "future_maintenance_review";
  }
}

function compareEvidence(left: FocusEvidence, right: FocusEvidence): number {
  return compareDateOnly(left.calendarDate, right.calendarDate) || left.id.localeCompare(right.id);
}

function distinctDates(evidence: readonly FocusEvidence[]): Set<string> {
  return new Set(evidence.map((item) => item.calendarDate));
}

function distinctContexts(evidence: readonly FocusEvidence[]): Set<string> {
  return new Set(evidence.map((item) => `${item.promptRole}:${item.promptContext}`));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
