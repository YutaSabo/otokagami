export const PRONUNCIATION_SCORE_THRESHOLDS = Object.freeze({
  version: "2026-07-12",
  goodMin: 80,
  warningMin: 60
});

export function pronunciationBand(score, thresholds = PRONUNCIATION_SCORE_THRESHOLDS) {
  if (score === null || !Number.isFinite(Number(score))) return { key: "unavailable", label: "判定なし", color: "red" };
  if (Number(score) >= thresholds.goodMin) return { key: "good", label: "よく伝わっています", color: "green" };
  if (Number(score) >= thresholds.warningMin) return { key: "warning", label: "あと少しです", color: "yellow" };
  return { key: "needsImprovement", label: "もう一度ゆっくり", color: "red" };
}

export function visibleScoreMetrics(overall) {
  return [
    ["発音", overall?.pronunciationScore],
    ["正確さ", overall?.accuracyScore],
    ["流暢さ", overall?.fluencyScore],
    ["完全さ", overall?.completenessScore],
    ["プロソディ", overall?.prosodyScore]
  ].filter(([, score]) => score !== null && score !== undefined && Number.isFinite(Number(score)));
}
