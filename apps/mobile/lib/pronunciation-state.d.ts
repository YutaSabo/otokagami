export type PronunciationState =
  | "idle"
  | "preparing"
  | "ready"
  | "recording"
  | "finalizing"
  | "assessing"
  | "completed"
  | "failed"
  | "cancelled";

export const PRONUNCIATION_STATES: readonly PronunciationState[];
export function transitionPronunciationState(current: PronunciationState, next: PronunciationState): PronunciationState;
export function isPronunciationBusy(state: PronunciationState): boolean;
