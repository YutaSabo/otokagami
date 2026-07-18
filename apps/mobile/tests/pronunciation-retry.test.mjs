import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { classifyAudioActivity } from "../lib/pronunciation-audio.mjs";
import {
  isRecoverableStaleRequest,
  pronunciationErrorCode,
  pronunciationErrorMessage
} from "../lib/pronunciation-errors.mjs";
import {
  PronunciationSessionTracker,
  shouldRetrySavedAzureResult
} from "../lib/pronunciation-session.mjs";

function failedNativeFinish(code) {
  const tracker = new PronunciationSessionTracker();
  tracker.setPrepared("old-request", "think");
  const consumed = tracker.consume();
  assert.equal(consumed, "old-request");
  assert.equal(tracker.canReuse("think"), false);
  tracker.setPrepared(`new-after-${code}`, "think");
  return tracker.requestId;
}

test("SILENCE, AUDIO_TOO_SHORT, and timeout retries always prepare a new request", () => {
  for (const code of ["SILENCE", "AUDIO_TOO_SHORT", "AZURE_RESULT_TIMEOUT"]) {
    assert.equal(failedNativeFinish(code), `new-after-${code}`);
  }
});

test("API failure can retry the saved Azure result without reusing its native session", () => {
  const tracker = new PronunciationSessionTracker();
  tracker.setPrepared("native-1", "light");
  tracker.consume();
  const pending = { requestId: "native-1", rawJson: { RecognitionStatus: "Success" } };
  assert.equal(shouldRetrySavedAzureResult(pending), true);
  assert.equal(tracker.requestId, null);
});

test("session tracker prevents stale completion and repeated reuse", () => {
  const tracker = new PronunciationSessionTracker();
  tracker.setPrepared("request-1", "light");
  assert.equal(tracker.consume(), "request-1");
  assert.equal(tracker.consume(), null);
  tracker.setPrepared("request-2", "light");
  assert.equal(tracker.requestId, "request-2");
});

test("native error codes map to Japanese without exposing Expo wrappers", () => {
  const stale = {
    code: "STALE_REQUEST",
    message: "Calling the 'start' function has failed → Caused by: 古い発音判定リクエストです。"
  };
  assert.equal(isRecoverableStaleRequest(stale), true);
  assert.equal(pronunciationErrorCode(stale), "STALE_REQUEST");
  assert.equal(pronunciationErrorMessage(stale), "録音の準備を更新しました。もう一度お試しください。");
  assert.doesNotMatch(pronunciationErrorMessage(stale), /Calling|Caused by/);
});

test("audio activity distinguishes silence, steady noise, small speech, and normal speech", () => {
  assert.equal(classifyAudioActivity({ frameRms: Array(50).fill(0), peak: 0 }).hasSpeech, false);
  assert.equal(classifyAudioActivity({ frameRms: Array(50).fill(220), peak: 700 }).hasSpeech, false);
  assert.equal(
    classifyAudioActivity({ frameRms: [...Array(47).fill(35), 280, 310, 260], peak: 650 }).hasSpeech,
    true
  );
  assert.equal(
    classifyAudioActivity({ frameRms: [...Array(35).fill(60), ...Array(15).fill(1_800)], peak: 5_000 }).hasSpeech,
    true
  );
});

test("daily and free-input finish paths consume the request before awaiting native finish", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.equal((app.match(/streamSessionRef\.current\.consume\(\)/g) ?? []).length, 2);
  assert.match(app, /nativeResult \? getApiErrorMessage\(error\) : pronunciationErrorMessage\(error\)/);
  assert.match(app, /setFreeInputPendingResult\(nativeResult\)/);
  assert.match(app, /if \(epoch !== assessmentEpochRef\.current\) return/g);
  assert.match(app, /assessmentActionInFlightRef\.current \|\| recordingState === "recording"/);
  assert.match(app, /assessmentActionInFlightRef\.current \|\| recordingState !== "recording"/);
});

test("native implementation rebuilds conversion after route activation and exposes stable error codes", () => {
  const swift = fs.readFileSync(
    new URL("../modules/azure-pronunciation-stream/ios/AzurePronunciationStreamModule.swift", import.meta.url),
    "utf8"
  );
  assert.match(swift, /try session\.setActive\(true\)[\s\S]*AVAudioConverter\(from: inputFormat/);
  assert.match(swift, /override var code: String/);
  assert.match(swift, /activeFrames >= 2 && activeRatio >= 0\.02/);
  assert.match(swift, /pronunciation_audio_diagnostics/);
});
