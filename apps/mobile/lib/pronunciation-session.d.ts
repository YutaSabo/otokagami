export class PronunciationSessionTracker {
  readonly requestId: string | null;
  readonly preparedText: string | null;
  setPrepared(requestId: string, preparedText: string): void;
  canReuse(preparedText: string): boolean;
  consume(): string | null;
  clear(): void;
}

export function shouldRetrySavedAzureResult<T extends { requestId?: unknown; rawJson?: unknown }>(
  pendingResult: T | null | undefined
): pendingResult is T;
