import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Expo config is iPhone-only for Phase 1", async () => {
  const config = JSON.parse(await readFile(new URL("../app.json", import.meta.url), "utf8"));

  assert.deepEqual(config.expo.platforms, ["ios"]);
  assert.equal(config.expo.ios.supportsTablet, false);
  assert.ok(config.expo.plugins.includes("expo-dev-client"));
});
