import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("protected storage uses Application Support, excludes backup, and applies iOS file protection", async () => {
  const swift = await readFile(
    new URL("../modules/otokagami-protected-storage/ios/OtokagamiProtectedStorageModule.swift", import.meta.url),
    "utf8"
  );
  assert.match(swift, /applicationSupportDirectory/);
  assert.match(swift, /isExcludedFromBackup = true/);
  assert.match(swift, /completeUntilFirstUserAuthentication/);
  assert.match(swift, /\["", "-wal", "-shm"\]/);
  assert.doesNotMatch(swift, /NSLog|print\(/);
});

test("SDK 57-compatible SQLite and protected module are declared without identity changes", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const config = JSON.parse(await readFile(new URL("../app.json", import.meta.url), "utf8"));
  assert.equal(pkg.dependencies["expo-sqlite"], "~57.0.0");
  assert.equal(pkg.dependencies["otokagami-protected-storage"], "file:modules/otokagami-protected-storage");
  assert.equal(config.expo.ios.bundleIdentifier, "com.yutahemmi.otokagami");
  assert.equal(config.expo.extra.eas.projectId, "c4f399f5-6039-45d9-aec0-1c72629ec47a");
});

test("real expo-sqlite API and dev-build diagnostics use supported SDK 57 boundaries",async()=>{
 const local=await readFile(new URL("../src/v2/local-storage.ts",import.meta.url),"utf8");
 const diagnostic=await readFile(new URL("../src/v2/dev-build-diagnostics.ts",import.meta.url),"utf8");
 assert.match(local,/openDatabaseAsync\(databaseName, \{\}, prepared\.databaseDirectoryUri\)/);
 assert.match(local,/withTransactionAsync|SQLiteDatabase/);
 assert.match(diagnostic,/ProtectedStorage\.prepare\(\)/);
 assert.match(diagnostic,/Application Support\|Application%20Support/);
});
