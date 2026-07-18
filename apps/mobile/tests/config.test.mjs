import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Expo config is iPhone-only and dev-client ready", async () => {
  const config = JSON.parse(await readFile(new URL("../app.json", import.meta.url), "utf8"));

  assert.equal(config.expo.version, "0.1.1");
  assert.deepEqual(config.expo.platforms, ["ios"]);
  assert.equal(config.expo.ios.supportsTablet, false);
  const devClientPlugin = config.expo.plugins.find((plugin) =>
    Array.isArray(plugin) ? plugin[0] === "expo-dev-client" : plugin === "expo-dev-client"
  );
  assert.ok(devClientPlugin);
  assert.ok(Array.isArray(devClientPlugin));
  assert.equal(devClientPlugin[1].skipOnboarding, true);
  assert.equal(devClientPlugin[1].showMenuAtLaunch, false);
  assert.equal(config.expo.owner, "yutasabos-team");
  assert.match(config.expo.extra.eas.projectId, /^[0-9a-f-]{36}$/);
  assert.equal(config.expo.runtimeVersion.policy, "appVersion");
  assert.equal(config.expo.updates.url, `https://u.expo.dev/${config.expo.extra.eas.projectId}`);
  assert.equal(config.expo.android, undefined);
  assert.ok(config.expo.plugins.includes("expo-secure-store"));
  assert.ok(
    config.expo.plugins.some((plugin) =>
      Array.isArray(plugin) ? plugin[0] === "expo-notifications" : plugin === "expo-notifications"
    )
  );
  assert.ok(config.expo.plugins.includes("expo-sharing"));
});

test("EAS staging profile uses a store build and an isolated update channel", async () => {
  const easConfig = JSON.parse(await readFile(new URL("../eas.json", import.meta.url), "utf8"));
  const mobilePackage = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(easConfig.cli.appVersionSource, "remote");
  assert.equal(easConfig.build.staging.distribution, "store");
  assert.equal(easConfig.build.staging.channel, "staging");
  assert.equal(easConfig.build.staging.environment, "preview");
  assert.equal(easConfig.build.staging.autoIncrement, true);
  assert.equal(easConfig.submit.staging.ios.ascAppId, "6788276202");
  assert.match(mobilePackage.scripts["eas:submit:staging"], /--profile staging/);
  assert.match(mobilePackage.scripts["eas:update:staging"], /--channel staging/);
  assert.match(mobilePackage.scripts["eas:update:staging"], /--environment preview/);
});

test("mobile app uses Phase 10 public environment variables only", async () => {
  const source = await readFile(new URL("../App.tsx", import.meta.url), "utf8");

  for (const name of [
    "EXPO_PUBLIC_SUPABASE_URL",
    "EXPO_PUBLIC_SUPABASE_ANON_KEY",
    "EXPO_PUBLIC_API_BASE_URL",
    "EXPO_PUBLIC_REVENUECAT_IOS_PUBLIC_SDK_KEY"
  ]) {
    assert.match(source, new RegExp(name));
  }

  for (const serverOnlyName of [
    "AZURE_SPEECH_KEY",
    "OPENAI_API_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "REVENUECAT_SECRET_KEY",
    "REVENUECAT_WEBHOOK_AUTH_TOKEN",
    "PYTHON_SERVICE_API_KEY"
  ]) {
    assert.doesNotMatch(source, new RegExp(serverOnlyName));
  }
});

test("mobile foundation includes anonymous auth, bootstrap, tabs, and paywall", async () => {
  const source = await readFile(new URL("../App.tsx", import.meta.url), "utf8");

  assert.match(source, /signInAnonymously/);
  assert.match(source, /\/api\/bootstrap/);
  assert.match(source, /device_install_id/);
  assert.match(source, /ホーム/);
  assert.match(source, /進捗/);
  assert.match(source, /練習/);
  assert.match(source, /設定/);
  assert.match(source, /580円/);
  assert.match(source, /4,980円/);
  assert.doesNotMatch(source, /今日の7個一覧/);
});

test("Phase 11 daily assessment flow calls required APIs and keeps recordings local", async () => {
  const source = await readFile(new URL("../App.tsx", import.meta.url), "utf8");

  for (const apiPath of [
    "/api/daily-session",
    "/api/assess",
    "/api/advice/",
    "/api/advice-feedback"
  ]) {
    assert.match(source, new RegExp(apiPath.replaceAll("/", "\\/")));
  }

  assert.match(source, /AzurePronunciationStream/);
  assert.match(source, /\/api\/speech-token/);
  assert.match(source, /azure_result: azureResult/);
  assert.match(source, /"Content-Type": "application\/json"/);
  assert.doesNotMatch(source, /FormData|new File\(audioUri\)/);
  assert.match(source, /attempt_no/);
  assert.match(source, /localAudioUri/);
  assert.match(source, /azureResult: nativeResult\?\.rawJson/);
  assert.match(source, /素晴らしい！/);
  assert.match(source, /期待IPA/);
  assert.match(source, /実測IPA/);
  assert.match(source, /役立った/);
  assert.match(source, /役立たなかった/);
  assert.match(source, /7 \/ 7/);
  assert.doesNotMatch(source, /Supabase Storage/);
});

test("native streaming module configures Azure assessment and explicit audio boundary errors", async () => {
  const source = await readFile(
    new URL("../modules/azure-pronunciation-stream/ios/AzurePronunciationStreamModule.swift", import.meta.url),
    "utf8"
  );
  for (const contract of [
    "SPXPushAudioInputStream",
    "usingPCMWithSampleRate: 16_000",
    "gradingSystem: .hundredMark",
    "granularity: .phoneme",
    'phonemeAlphabet = "IPA"',
    "nbestPhonemeCount = 5",
    "enableProsodyAssessment()",
    "AUDIO_TOO_SHORT",
    "AUDIO_TOO_LONG",
    "SILENCE",
    "AZURE_RESULT_TIMEOUT",
    "AZURE_RECOGNITION_FAILED",
    "STALE_REQUEST"
  ]) assert.match(source, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(source, /Ocp-Apim-Subscription-Key|AZURE_SPEECH_KEY/);
});

test("pronunciation UI exposes loading, error, retry, simple result, and detail states", async () => {
  const source = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  for (const label of [
    "発音判定を準備中です。",
    "音声を確定しています。",
    "結果を保存しています。",
    "再試行",
    "詳細を見る",
    "発音スコア / 100",
    "正解確率ではありません。",
    "近く聞こえた音"
  ]) assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, /requestRecordingPermissionsAsync/);
  assert.match(source, /assessmentActionInFlightRef\.current/);
  assert.match(source, /epoch !== assessmentEpochRef\.current/);
});

test("Phase 12 mobile surfaces progress, practice variants, free input, reminders, and data management", async () => {
  const source = await readFile(new URL("../App.tsx", import.meta.url), "utf8");

  for (const apiPath of [
    "/api/progress",
    "/api/practice-session",
    "/api/free-text-consent",
    "/api/free-assess",
    "/api/export",
    "/api/delete-learning-data"
  ]) {
    assert.match(source, new RegExp(apiPath.replaceAll("/", "\\/")));
  }

  for (const text of [
    "苦手ドリル",
    "音素表",
    "自由入力",
    "保存同意",
    "復習リマインダー",
    "購入復元",
    "JSON書き出し",
    "学習データ削除"
  ]) {
    assert.match(source, new RegExp(text));
  }

  assert.match(source, /scheduleNotificationAsync/);
  assert.match(source, /cancelAllScheduledNotificationsAsync/);
  assert.match(source, /free_text_ja_v1/);
  assert.match(source, /localAudioUri/);
});
