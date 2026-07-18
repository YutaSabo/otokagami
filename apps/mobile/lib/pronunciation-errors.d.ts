export type PronunciationErrorCode =
  | "SILENCE"
  | "AUDIO_TOO_SHORT"
  | "AUDIO_TOO_LONG"
  | "STALE_REQUEST"
  | "AZURE_RESULT_TIMEOUT"
  | "MICROPHONE_PERMISSION"
  | "NOT_PREPARED"
  | "NOT_RECORDING"
  | "AUDIO_FORMAT_UNAVAILABLE"
  | "AZURE_RECOGNITION_FAILED";

export function pronunciationErrorCode(error: unknown): PronunciationErrorCode | null;
export function pronunciationErrorMessage(error: unknown): string;
export function isRecoverableStaleRequest(error: unknown): boolean;
