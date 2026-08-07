import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import {
  LEGACY_UI_DISABLED_CODE,
  LEGACY_UI_FEATURES,
  createLegacyUiGate,
  legacyUiGate
} from "../lib/legacy-ui-gate.mjs";

function assertOrdered(source, startMarker, orderedMarkers) {
  let cursor = source.indexOf(startMarker);
  assert.notEqual(cursor, -1, `missing start marker: ${startMarker}`);

  for (const marker of orderedMarkers) {
    const next = source.indexOf(marker, cursor + 1);
    assert.notEqual(next, -1, `missing marker after ${startMarker}: ${marker}`);
    assert.ok(next > cursor, `${marker} must follow the previous guard or handler marker`);
    cursor = next;
  }
}

test("default build exposes only Home, Practice, Settings, and daily practice", () => {
  assert.equal(legacyUiGate.legacyUiEnabled, false);
  assert.deepEqual(legacyUiGate.tabs, ["home", "practice", "settings"]);
  assert.deepEqual(legacyUiGate.practiceModes, ["daily"]);
  assert.equal(legacyUiGate.homeCompletionAction, null);
  assert.equal(legacyUiGate.allowsTab("progress"), false);
  assert.equal(legacyUiGate.allowsPracticeMode("daily"), true);

  for (const mode of ["weak_drill", "phoneme_select", "free_input"]) {
    assert.equal(legacyUiGate.allowsPracticeMode(mode), false);
    assert.throws(
      () => legacyUiGate.assertPracticeModeAllowed(mode),
      (error) => error.code === LEGACY_UI_DISABLED_CODE && error.target === `practice:${mode}`
    );
  }

  for (const feature of Object.values(LEGACY_UI_FEATURES)) {
    assert.equal(legacyUiGate.allowsFeature(feature), false);
  }
  assert.throws(
    () => legacyUiGate.assertTabAllowed("progress"),
    (error) => error.code === LEGACY_UI_DISABLED_CODE && error.target === "tab:progress"
  );
});

test("an explicit development or test rollback restores all legacy entries", () => {
  const rollbackGate = createLegacyUiGate({ legacyUiEnabled: true });

  assert.equal(rollbackGate.legacyUiEnabled, true);
  assert.deepEqual(rollbackGate.tabs, ["home", "progress", "practice", "settings"]);
  assert.deepEqual(rollbackGate.practiceModes, ["daily", "weak_drill", "phoneme_select", "free_input"]);
  assert.equal(rollbackGate.homeCompletionAction, "progress");

  for (const tab of rollbackGate.tabs) assert.doesNotThrow(() => rollbackGate.assertTabAllowed(tab));
  for (const mode of rollbackGate.practiceModes) {
    assert.doesNotThrow(() => rollbackGate.assertPracticeModeAllowed(mode));
  }
  for (const feature of Object.values(LEGACY_UI_FEATURES)) {
    assert.doesNotThrow(() => rollbackGate.assertFeatureAllowed(feature));
  }
});

test("legacy handlers reject before network calls or hidden state transitions", async () => {
  const source = await readFile(new URL("../App.tsx", import.meta.url), "utf8");

  assertOrdered(source, "async function fetchPracticeSession", [
    "legacyUiGate.assertPracticeModeAllowed(mode)",
    'path: "/api/practice-session"'
  ]);
  assertOrdered(source, "async function fetchProgress", [
    "legacyUiGate.assertFeatureAllowed(LEGACY_UI_FEATURES.progress)",
    'path: "/api/progress"'
  ]);
  assertOrdered(source, "async function saveFreeTextConsent", [
    "legacyUiGate.assertFeatureAllowed(LEGACY_UI_FEATURES.freeInput)",
    'path: "/api/free-text-consent"'
  ]);
  assertOrdered(source, "async function assessFreeInput", [
    "legacyUiGate.assertFeatureAllowed(LEGACY_UI_FEATURES.freeInput)",
    'fetch(`${mobileConfig.apiBaseUrl}/api/free-assess`'
  ]);
  assertOrdered(source, "async function assessDailyItem", [
    "legacyUiGate.assertPracticeModeAllowed(practiceMode)",
    'fetch(`${mobileConfig.apiBaseUrl}/api/assess`'
  ]);
  assertOrdered(source, "const startPracticeSession = useCallback", [
    "legacyUiGate.allowsPracticeMode(mode)",
    "setDailyStep(\"loading\")"
  ]);
  assertOrdered(source, "const requestPracticeStart = useCallback", [
    "legacyUiGate.allowsPracticeMode(mode)",
    "ensureOnline()",
    'if (mode === "phoneme_select")',
    "setPhonemePickerVisible(true)"
  ]);
  assertOrdered(source, "const changeTab = useCallback", [
    "legacyUiGate.allowsTab(tab)",
    "confirmDiscardRecording"
  ]);
  assertOrdered(source, "const acceptFreeTextConsent = useCallback", [
    "legacyUiGate.allowsFeature(LEGACY_UI_FEATURES.freeInput)",
    "saveFreeTextConsent(bootstrapState.session)"
  ]);
  assertOrdered(source, "const startFreeInputRecording = useCallback", [
    'legacyUiGate.allowsPracticeMode("free_input")',
    "startRecording(freeText.trim(), false)"
  ]);
  assertOrdered(source, "const stopAndAssessFreeInput = useCallback", [
    'legacyUiGate.allowsPracticeMode("free_input")',
    "streamSessionRef.current.consume()",
    "assessFreeInput({"
  ]);
  assertOrdered(source, "const retryFreeInputAssessment = useCallback", [
    'legacyUiGate.allowsPracticeMode("free_input")',
    "assessFreeInput({"
  ]);
});

test("default rendering cannot expose progress, free input, phoneme picker, or the completed-daily progress CTA", async () => {
  const source = await readFile(new URL("../App.tsx", import.meta.url), "utf8");

  assert.match(source, /activeTab === "progress" && legacyUiGate\.allowsTab\("progress"\)/);
  assert.match(source, /legacyUiGate\.allowsPracticeMode\("free_input"\) && freeInputActive/);
  assert.match(source, /legacyUiGate\.allowsPracticeMode\("phoneme_select"\) && phonemePickerVisible/);
  assert.match(source, /modes=\{legacyUiGate\.practiceModes\}/);
  assert.match(source, /tabs=\{legacyUiGate\.tabs\}/);
  assert.match(source, /!isComplete \|\| completionAction === "progress"/);
  assertOrdered(source, "const goNextDailyItem = useCallback", [
    "legacyUiGate.allowsFeature(LEGACY_UI_FEATURES.progress)",
    "loadProgress()"
  ]);
});

test("v1 UI, route references, and compatibility files remain present", async () => {
  const source = await readFile(new URL("../App.tsx", import.meta.url), "utf8");

  for (const symbol of ["DailyAssessmentFlow", "ProgressScreen", "FreeInputScreen"]) {
    assert.match(source, new RegExp(`function ${symbol}`));
  }
  for (const apiPath of [
    "/api/daily-session",
    "/api/practice-session",
    "/api/speech-token",
    "/api/assess",
    "/api/progress",
    "/api/free-text-consent",
    "/api/free-assess"
  ]) {
    assert.match(source, new RegExp(apiPath.replaceAll("/", "\\/")));
  }

  for (const route of ["daily-session", "speech-token", "assess", "practice-session", "progress", "free-assess"]) {
    await access(new URL(`../../api/app/api/${route}/route.ts`, import.meta.url));
  }
});
