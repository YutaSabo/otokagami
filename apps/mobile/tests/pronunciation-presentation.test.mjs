import assert from "node:assert/strict";
import test from "node:test";

import {
  PRONUNCIATION_SCORE_THRESHOLDS,
  pronunciationBand,
  visibleScoreMetrics
} from "../lib/pronunciation-presentation.mjs";

test("initial result uses versioned 80/60 bands with text labels as well as colors", () => {
  assert.match(PRONUNCIATION_SCORE_THRESHOLDS.version, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(pronunciationBand(80), { key: "good", label: "よく伝わっています", color: "green" });
  assert.deepEqual(pronunciationBand(79), { key: "warning", label: "あと少しです", color: "yellow" });
  assert.deepEqual(pronunciationBand(59), { key: "needsImprovement", label: "もう一度ゆっくり", color: "red" });
});

test("detail presentation hides unavailable scores instead of rendering zero", () => {
  assert.deepEqual(
    visibleScoreMetrics({ pronunciationScore: 78, accuracyScore: null, fluencyScore: 74, completenessScore: undefined, prosodyScore: 0 }),
    [["発音", 78], ["流暢さ", 74], ["プロソディ", 0]]
  );
});
