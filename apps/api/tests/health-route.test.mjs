import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("health route stays minimal and server-side", async () => {
  const source = await readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8");

  assert.match(source, /status/);
  assert.doesNotMatch(source, /EXPO_PUBLIC_/);
});
