export class V2ApiError extends Error {
  code: string;
  status: number;
  retryable: boolean;
}
export function classifyV2OutboxError(error: unknown): "retryable" | "permanent_failure";
export function createV2ApiClient(options: {
  baseUrl: string;
  getAccessToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
}): {
  bootstrap(): Promise<any>;
  accessStatus(): Promise<any>;
  dailySession(timezone: string): Promise<any>;
  speechToken(sessionItemId: string, attemptPurpose: "initial" | "guided_retry"): Promise<any>;
  persistAttempt(command: unknown): Promise<any>;
  completeReview(command: unknown): Promise<any>;
  completeSession(sessionId: string, idempotencyKey: string): Promise<any>;
  progress(): Promise<any>;
  reports(): Promise<any>;
  exportLearningData(): Promise<any>;
  deleteLearningData(deletionRequestId: string, expectedDeletionEpoch: number): Promise<any>;
};
