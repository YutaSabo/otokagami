export const PRONUNCIATION_STATES = Object.freeze([
  "idle",
  "preparing",
  "ready",
  "recording",
  "finalizing",
  "assessing",
  "completed",
  "failed",
  "cancelled"
]);

const ALLOWED_PREVIOUS = Object.freeze({
  idle: new Set(PRONUNCIATION_STATES),
  preparing: new Set(["idle", "ready", "completed", "failed", "cancelled"]),
  ready: new Set(["preparing"]),
  recording: new Set(["ready"]),
  finalizing: new Set(["recording"]),
  assessing: new Set(["finalizing", "ready", "failed"]),
  completed: new Set(["assessing"]),
  failed: new Set(PRONUNCIATION_STATES),
  cancelled: new Set(["preparing", "ready", "recording", "finalizing", "assessing", "failed"])
});

export function transitionPronunciationState(current, next) {
  if (!PRONUNCIATION_STATES.includes(current) || !PRONUNCIATION_STATES.includes(next)) {
    throw new TypeError("Unknown pronunciation state");
  }
  if (current === next) return current;
  if (!ALLOWED_PREVIOUS[next].has(current)) {
    throw new Error(`Invalid pronunciation transition: ${current} -> ${next}`);
  }
  return next;
}

export function isPronunciationBusy(state) {
  return ["preparing", "recording", "finalizing", "assessing"].includes(state);
}
