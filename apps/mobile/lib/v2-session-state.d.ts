export type V2SessionState = "loading" | "read_only" | "ready" | "preparing" | "recording" | "normalizing" | "local_result_pending_sync" | "confirmed" | "retryable_failure" | "permanent_failure" | "completing" | "completed";
export const V2_SESSION_STATES: readonly V2SessionState[];
export function transitionV2SessionState(current: V2SessionState, next: V2SessionState): V2SessionState;
export function resolveV2ShellState(input: { mode: "off" | "read_only" | "learning"; contentVersion: string | null; online: boolean; hasSnapshot: boolean; liveConfigReady: boolean }): { kind: "learning" | "read_only"; reason: string | null };
export function canAdvanceAfterLocalResult(state: V2SessionState): boolean;
