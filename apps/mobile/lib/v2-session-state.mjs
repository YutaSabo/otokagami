export const V2_SESSION_STATES = Object.freeze([
  "loading",
  "read_only",
  "ready",
  "preparing",
  "recording",
  "normalizing",
  "local_result_pending_sync",
  "confirmed",
  "retryable_failure",
  "permanent_failure",
  "completing",
  "completed"
]);

const ALLOWED = Object.freeze({
  loading: new Set(["loading"]),
  read_only: new Set(["loading", "read_only", "retryable_failure"]),
  ready: new Set(["loading", "read_only", "confirmed", "retryable_failure", "permanent_failure"]),
  preparing: new Set(["ready", "retryable_failure"]),
  recording: new Set(["preparing"]),
  normalizing: new Set(["recording"]),
  local_result_pending_sync: new Set(["normalizing", "retryable_failure"]),
  confirmed: new Set(["local_result_pending_sync"]),
  retryable_failure: new Set(["preparing", "normalizing", "local_result_pending_sync", "completing"]),
  permanent_failure: new Set(["normalizing", "local_result_pending_sync", "completing"]),
  completing: new Set(["confirmed"]),
  completed: new Set(["completing"])
});

export function transitionV2SessionState(current, next) {
  if (!V2_SESSION_STATES.includes(current) || !V2_SESSION_STATES.includes(next)) {
    throw new TypeError("Unknown v2 session state.");
  }
  if (current === next) return current;
  if (!ALLOWED[next].has(current)) throw new Error(`Invalid v2 session transition: ${current} -> ${next}`);
  return next;
}

export function resolveV2ShellState({ mode, contentVersion, online, hasSnapshot, liveConfigReady }) {
  if (mode === "off") return { kind: "read_only", reason: "V2_DISABLED" };
  if (!online) return hasSnapshot
    ? { kind: "read_only", reason: "OFFLINE_SNAPSHOT" }
    : { kind: "read_only", reason: "OFFLINE_NO_SNAPSHOT" };
  if (mode === "read_only") return { kind: "read_only", reason: "SERVER_READ_ONLY" };
  if (!contentVersion) return { kind: "read_only", reason: "CONTENT_NOT_READY" };
  if (!liveConfigReady) return { kind: "read_only", reason: "LIVE_CONFIG_NOT_READY" };
  return { kind: "learning", reason: null };
}

export function canAdvanceAfterLocalResult(state) {
  // The learner may continue once the result is durable on-device. Server ACK is
  // still required before a dependent review/session-completion command can run.
  return state === "local_result_pending_sync" || state === "confirmed";
}
