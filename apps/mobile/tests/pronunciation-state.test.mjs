import assert from "node:assert/strict";
import test from "node:test";

import {
  PRONUNCIATION_STATES,
  isPronunciationBusy,
  transitionPronunciationState
} from "../lib/pronunciation-state.mjs";

test("happy path covers preparation, recording, assessment, and completion", () => {
  const path = ["preparing", "ready", "recording", "finalizing", "assessing", "completed"];
  assert.equal(path.reduce(transitionPronunciationState, "idle"), "completed");
});

test("failure, retry, cancel, and reset transitions are explicit", () => {
  for (const state of PRONUNCIATION_STATES) assert.equal(transitionPronunciationState(state, "failed"), "failed");
  assert.equal(transitionPronunciationState("failed", "assessing"), "assessing");
  assert.equal(transitionPronunciationState("recording", "cancelled"), "cancelled");
  assert.equal(transitionPronunciationState("cancelled", "idle"), "idle");
});

test("duplicate state writes are idempotent and stale completions cannot skip states", () => {
  assert.equal(transitionPronunciationState("recording", "recording"), "recording");
  assert.throws(() => transitionPronunciationState("ready", "completed"), /Invalid pronunciation transition/);
  assert.throws(() => transitionPronunciationState("cancelled", "completed"), /Invalid pronunciation transition/);
});

test("busy states cover preparation through assessment only", () => {
  for (const state of ["preparing", "recording", "finalizing", "assessing"]) assert.equal(isPronunciationBusy(state), true);
  for (const state of ["idle", "ready", "completed", "failed", "cancelled"]) assert.equal(isPronunciationBusy(state), false);
});
