export type PhonemeColor = "green" | "yellow" | "red";
export const PRONUNCIATION_SCORE_THRESHOLDS: Readonly<{ version: string; goodMin: number; warningMin: number }>;
export function pronunciationBand(score: number | null): { key: string; label: string; color: PhonemeColor };
export function visibleScoreMetrics(overall: {
  pronunciationScore?: number | null;
  accuracyScore?: number | null;
  fluencyScore?: number | null;
  completenessScore?: number | null;
  prosodyScore?: number | null;
}): Array<[string, number]>;
