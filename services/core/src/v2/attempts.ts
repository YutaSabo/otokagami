import type { EvidenceKind, FocusEvidence, LearningAttempt, PromptRole } from "./types.js";
import { assertDateOnly, assertIanaTimeZone, assertRfc3339Instant } from "./dates.js";

export type AttemptExclusionReason =
  | "idempotency_payload_conflict"
  | "duplicate_client_attempt"
  | "technical_invalid"
  | "invalid_valid_ordinal"
  | "duplicate_valid_ordinal"
  | "guided_retry_missing_source"
  | "guided_retry_source_mismatch"
  | "invalid_attempt_metadata"
  | "not_server_normalized"
  | "assisted_not_durable"
  | "duplicate_durable_evidence";

export interface AttemptExclusion {
  attemptId: string;
  reason: AttemptExclusionReason;
}

export function selectCountedAttempts(attempts: readonly LearningAttempt[]): {
  accepted: LearningAttempt[];
  excluded: AttemptExclusion[];
} {
  const sorted = [...attempts].sort(compareAttempt);
  const byClientId = new Map<string, LearningAttempt[]>();
  for (const attempt of sorted) {
    const group = byClientId.get(attempt.clientAttemptId) ?? [];
    group.push(attempt);
    byClientId.set(attempt.clientAttemptId, group);
  }

  const candidates: LearningAttempt[] = [];
  const excluded: AttemptExclusion[] = [];
  for (const group of byClientId.values()) {
    const hashes = new Set(group.map((attempt) => attempt.payloadSha256));
    if (hashes.size > 1) {
      excluded.push(...group.map((attempt) => exclusion(attempt, "idempotency_payload_conflict")));
      continue;
    }
    candidates.push(group[0]!);
    excluded.push(...group.slice(1).map((attempt) => exclusion(attempt, "duplicate_client_attempt")));
  }

  const accepted: LearningAttempt[] = [];
  const acceptedUnassisted = new Map<string, LearningAttempt>();
  const ordinals = new Set<string>();
  const orderedCandidates = candidates.sort(compareAttempt);
  for (const attempt of orderedCandidates.filter((candidate) => candidate.attemptRole !== "guided_retry")) {
    if (!hasValidAttemptMetadata(attempt)) {
      excluded.push(exclusion(attempt, "invalid_attempt_metadata"));
      continue;
    }
    if (attempt.technicalValidity === "invalid") {
      excluded.push(exclusion(attempt, "technical_invalid"));
      continue;
    }
    if (
      attempt.validAttemptOrdinal === undefined ||
      !Number.isInteger(attempt.validAttemptOrdinal) ||
      attempt.validAttemptOrdinal < 1 ||
      attempt.validAttemptOrdinal > 3
    ) {
      excluded.push(exclusion(attempt, "invalid_valid_ordinal"));
      continue;
    }
    const ordinalKey = `${attempt.sessionItemId}:${attempt.validAttemptOrdinal}`;
    if (ordinals.has(ordinalKey)) {
      excluded.push(exclusion(attempt, "duplicate_valid_ordinal"));
      continue;
    }
    ordinals.add(ordinalKey);
    accepted.push(attempt);
    if (!attempt.assisted && !attempt.coachingShown && attempt.serverNormalized) {
      acceptedUnassisted.set(attempt.id, attempt);
    }
  }

  for (const attempt of orderedCandidates.filter((candidate) => candidate.attemptRole === "guided_retry")) {
    if (!hasValidAttemptMetadata(attempt)) {
      excluded.push(exclusion(attempt, "invalid_attempt_metadata"));
      continue;
    }
    if (attempt.technicalValidity === "invalid") {
      excluded.push(exclusion(attempt, "technical_invalid"));
      continue;
    }
    if (
      attempt.validAttemptOrdinal === undefined ||
      !Number.isInteger(attempt.validAttemptOrdinal) ||
      attempt.validAttemptOrdinal < 1 ||
      attempt.validAttemptOrdinal > 3
    ) {
      excluded.push(exclusion(attempt, "invalid_valid_ordinal"));
      continue;
    }
    if (attempt.retryFromAttemptId === undefined) {
      excluded.push(exclusion(attempt, "guided_retry_missing_source"));
      continue;
    }
    const source = acceptedUnassisted.get(attempt.retryFromAttemptId);
    if (
      source === undefined ||
      source.userId !== attempt.userId ||
      source.sessionId !== attempt.sessionId ||
      source.sessionItemId !== attempt.sessionItemId ||
      source.focusGroupKey !== attempt.focusGroupKey ||
      source.technicalValidity !== "valid" ||
      !source.serverNormalized
    ) {
      excluded.push(exclusion(attempt, "guided_retry_source_mismatch"));
      continue;
    }
    const ordinalKey = `${attempt.sessionItemId}:${attempt.validAttemptOrdinal}`;
    if (ordinals.has(ordinalKey)) {
      excluded.push(exclusion(attempt, "duplicate_valid_ordinal"));
      continue;
    }
    ordinals.add(ordinalKey);
    accepted.push(attempt);
  }

  return {
    accepted: accepted.sort(compareAttempt),
    excluded: excluded.sort((left, right) =>
      left.attemptId.localeCompare(right.attemptId) || left.reason.localeCompare(right.reason)
    )
  };
}

function hasValidAttemptMetadata(attempt: LearningAttempt): boolean {
  try {
    assertRfc3339Instant(attempt.attemptedAt);
    assertDateOnly(attempt.calendarDate);
    assertIanaTimeZone(attempt.timezone);
    return attempt.userId.trim().length > 0 && attempt.sessionId.trim().length > 0 && attempt.sessionItemId.trim().length > 0;
  } catch {
    return false;
  }
}

export function selectDurableEvidenceCandidates(input: {
  attempts: readonly LearningAttempt[];
  evidenceKind: Exclude<EvidenceKind, "immediate_change">;
}): {
  evidence: Array<{
    attemptId: string;
    focusGroupKey: string;
    calendarDate: string;
    promptRole: PromptRole;
    evidenceKind: Exclude<EvidenceKind, "immediate_change">;
  }>;
  excluded: AttemptExclusion[];
} {
  const counted = selectCountedAttempts(input.attempts);
  const excluded = [...counted.excluded];
  const seen = new Set<string>();
  const evidence: Array<{
    attemptId: string;
    focusGroupKey: string;
    calendarDate: string;
    promptRole: PromptRole;
    evidenceKind: Exclude<EvidenceKind, "immediate_change">;
  }> = [];

  for (const attempt of counted.accepted) {
    if (!attempt.serverNormalized) {
      excluded.push(exclusion(attempt, "not_server_normalized"));
      continue;
    }
    if (attempt.assisted || attempt.coachingShown || attempt.attemptRole === "guided_retry") {
      excluded.push(exclusion(attempt, "assisted_not_durable"));
      continue;
    }
    const key = `${attempt.calendarDate}:${attempt.focusGroupKey}:${attempt.promptRole}:${input.evidenceKind}`;
    if (seen.has(key)) {
      excluded.push(exclusion(attempt, "duplicate_durable_evidence"));
      continue;
    }
    seen.add(key);
    evidence.push({
      attemptId: attempt.id,
      focusGroupKey: attempt.focusGroupKey,
      calendarDate: attempt.calendarDate,
      promptRole: attempt.promptRole,
      evidenceKind: input.evidenceKind
    });
  }

  return { evidence, excluded: excluded.sort(compareExclusion) };
}

export function isValidImmediateChangeEvidence(input: {
  evidence: FocusEvidence;
  before: LearningAttempt;
  after: LearningAttempt;
}): boolean {
  return (
    input.evidence.kind === "immediate_change" &&
    input.evidence.correctionCycleId !== undefined &&
    input.evidence.serverNormalized &&
    input.before.technicalValidity === "valid" &&
    input.after.technicalValidity === "valid" &&
    input.before.serverNormalized &&
    input.after.serverNormalized &&
    !input.before.assisted &&
    input.before.attemptRole !== "guided_retry" &&
    input.after.attemptRole === "guided_retry" &&
    input.after.retryFromAttemptId === input.before.id &&
    input.before.sessionItemId === input.after.sessionItemId &&
    input.before.focusGroupKey === input.after.focusGroupKey &&
    input.evidence.focusGroupKey === input.before.focusGroupKey
  );
}

export function compareAttempt(left: LearningAttempt, right: LearningAttempt): number {
  return (
    left.attemptedAt.localeCompare(right.attemptedAt) ||
    left.attemptSequence - right.attemptSequence ||
    left.id.localeCompare(right.id)
  );
}

function exclusion(attempt: LearningAttempt, reason: AttemptExclusionReason): AttemptExclusion {
  return { attemptId: attempt.id, reason };
}

function compareExclusion(left: AttemptExclusion, right: AttemptExclusion): number {
  return left.attemptId.localeCompare(right.attemptId) || left.reason.localeCompare(right.reason);
}
