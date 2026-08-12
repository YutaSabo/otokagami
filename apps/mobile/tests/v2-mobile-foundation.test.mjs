import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createV2ApiClient, V2ApiError, classifyV2OutboxError } from "../lib/v2-api-client.mjs";
import { createCaptureFixture } from "../lib/v2-capture-harness.mjs";
import { createV2FixtureGate, releaseV2FixtureGate } from "../lib/v2-fixture-gate.mjs";
import { canAdvanceAfterLocalResult, resolveV2ShellState, transitionV2SessionState } from "../lib/v2-session-state.mjs";

test("v2 API client preserves typed errors and sends the atomic deletion contract", async () => {
  const requests = [];
  const client = createV2ApiClient({
    baseUrl: "https://api.example.test",
    getAccessToken: async () => "public-user-session",
    requestTimeoutMs:1000,
    responseMaxBytes:1_048_576,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return Response.json({ ok: true, data: { deletion_epoch: 3 } });
    }
  });
  await client.exportLearningData();
  await client.deleteLearningData("delete-request", 2);
  assert.equal(requests[0].init.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].init.body), {});
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    confirm: true,
    deletion_request_id: "delete-request",
    expected_deletion_epoch: 2
  });

  const failed = createV2ApiClient({
    baseUrl: "https://api.example.test",
    getAccessToken: async () => "public-user-session",
    requestTimeoutMs:1000,
    responseMaxBytes:1_048_576,
    fetchImpl: async () => Response.json({
      ok: false,
      error: { code: "DELETION_EPOCH_CONFLICT", message: "conflict", retryable: false }
    }, { status: 409 })
  });
  await assert.rejects(() => failed.bootstrap(), (error) => {
    assert.ok(error instanceof V2ApiError);
    assert.equal(error.code, "DELETION_EPOCH_CONFLICT");
    assert.equal(classifyV2OutboxError(error), "permanent_failure");
    return true;
  });
});

test("v2 API client fails closed without a measured timeout and aborts bounded requests", async () => {
  const missing=createV2ApiClient({baseUrl:"https://api.example.test",getAccessToken:async()=>"session"});
  await assert.rejects(()=>missing.bootstrap(),(error)=>error.code==="V2_CLIENT_TIMEOUT_CONFIG_REQUIRED");
  const timed=createV2ApiClient({
    baseUrl:"https://api.example.test",getAccessToken:async()=>"session",requestTimeoutMs:1,responseMaxBytes:1_048_576,
    fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(Object.assign(new Error("aborted"),{name:"AbortError"}))))
  });
  await assert.rejects(()=>timed.bootstrap(),(error)=>error.code==="REQUEST_TIMEOUT"&&error.retryable===true);

  const stalledBody=createV2ApiClient({
    baseUrl:"https://api.example.test",getAccessToken:async()=>"session",requestTimeoutMs:5,responseMaxBytes:1_048_576,
    fetchImpl:async()=>new Response(new ReadableStream({start(){}}),{status:200})
  });
  await assert.rejects(()=>stalledBody.bootstrap(),(error)=>error.code==="REQUEST_TIMEOUT"&&error.retryable===true);
});

test("v2 API client rejects a response larger than the injected verified limit",async()=>{
  const client=createV2ApiClient({baseUrl:"https://api.example.test",getAccessToken:async()=>"session",
    requestTimeoutMs:1000,responseMaxBytes:32,
    fetchImpl:async()=>new Response(JSON.stringify({ok:true,data:{value:"x".repeat(80)}}),{
      headers:{"content-type":"application/json"}
    })
  });
  await assert.rejects(()=>client.bootstrap(),(error)=>error.code==="RESPONSE_TOO_LARGE"&&error.retryable===false);
});

test("v2 shell is fail-closed while an on-device result can advance before ACK", () => {
  assert.deepEqual(resolveV2ShellState({
    mode: "learning", contentVersion: "content", online: true, hasSnapshot: false, liveConfigReady: false
  }), { kind: "read_only", reason: "LIVE_CONFIG_NOT_READY" });
  assert.deepEqual(resolveV2ShellState({
    mode: "learning", contentVersion: null, online: true, hasSnapshot: false, liveConfigReady: true
  }), { kind: "read_only", reason: "CONTENT_NOT_READY" });
  assert.equal(canAdvanceAfterLocalResult("local_result_pending_sync"), true);
  assert.equal(canAdvanceAfterLocalResult("confirmed"), true);
  assert.equal(
    transitionV2SessionState("normalizing", "local_result_pending_sync"),
    "local_result_pending_sync"
  );
  assert.throws(() => transitionV2SessionState("local_result_pending_sync", "completed"));
});

test("fixture capture is test/development-only and contains strict anonymous projection only", () => {
  assert.equal(releaseV2FixtureGate.enabled, false);
  assert.throws(() => releaseV2FixtureGate.assertAvailable(), /unavailable in release/);
  const gate = createV2FixtureGate({ test: true, enabled: true });
  const fixture = createCaptureFixture({
    gate,
    projection: {
      projectionVersion: "projection-v1",
      recognitionStatus: "success",
      displayText: "light",
      target: { phoneme: "l", accuracyScore: 75, candidates: [] }
    },
    metrics: { providerPayloadBytes: 800, projectionBytes: 160 },
    provenance: {
      managedPracticeItemKey: "anchor-light",
      deviceClass: "iphone",
      osMajor: "ios-19",
      capturedAt: "2026-08-10"
    }
  });
  assert.deepEqual(Object.keys(fixture), ["fixtureVersion", "projection", "metrics", "provenance"]);
  assert.doesNotMatch(JSON.stringify(fixture), /token|authorization|file.?uri|audio|raw.?json/i);
});

test("new shell replaces default legacy flow without changing durable app identity", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const config = JSON.parse(await readFile(new URL("../app.json", import.meta.url), "utf8"));
  assert.match(app, /if \(!legacyUiGate\.legacyUiEnabled\)/);
  assert.match(app, /if \(!legacyUiGate\.legacyUiEnabled\) return <V2AuthRoot/);
  const v2Root = app.slice(app.indexOf("function V2AuthRoot"), app.indexOf("function LegacyApp"));
  assert.doesNotMatch(v2Root, /\/api\/bootstrap|bootstrap\(session\)/);
  assert.match(v2Root, /getAnonymousSession/);
  assert.match(app, /<V2Experience/);
  assert.equal(config.expo.ios.bundleIdentifier, "com.yutahemmi.otokagami");
  assert.equal(config.expo.scheme, "pronunciationmirror");
  assert.equal(config.expo.extra.eas.projectId, "c4f399f5-6039-45d9-aec0-1c72629ec47a");
});

test("center question UI is action-focused, accessible, and does not reintroduce gamification", async () => {
  const source = await readFile(new URL("../src/v2/V2PracticeShell.tsx", import.meta.url), "utf8");
  for (const text of ["今日の音", "焦点音", "端末に保存済み・同期待ち", "修正前と再挑戦", "次の課題へ",
    "今日を完了","追加練習へ","ゆっくりのお手本を聞く"]) {
    assert.match(source, new RegExp(text));
  }
  assert.match(source, /accessibilityHint/);
  assert.match(source, /accessibilityLiveRegion/);
  assert.match(source, /minHeight: 52/);
  assert.match(source, /technicalValid/);
  assert.doesNotMatch(source, /総合点|レベル|バッジ|称号|全音素/);
});

test("only the coached anchor item is eligible for representative before/after audio retention", async () => {
  const source = await readFile(new URL("../src/v2/V2Experience.tsx", import.meta.url), "utf8");
  assert.match(source, /result\.technicalValid && item\.prompt_role === "anchor"/);
  assert.match(source, /discardTemporary\(result\.localAudioSource\)/);
});
