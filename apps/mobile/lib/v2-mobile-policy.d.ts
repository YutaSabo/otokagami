export function validateV2SessionShape(session: any): Readonly<{requiredCount: number; optionalCount: number}>;
export function countValidAttempts(rows: any[], sessionItemId: string): number;
export function canRequestAnotherTicket(rows: any[], sessionItemId: string): boolean;
export function nextRestoredPosition(session: any, resultsByItem: Record<string, unknown>): number;
export function timeoutError(code?: string): Error & {code: string; retryable: boolean};
