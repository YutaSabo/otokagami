import assert from "node:assert/strict";
import test from "node:test";

import { capabilitiesForLocale, handleSpeechToken, issueSpeechToken } from "../lib/speech-token.mjs";

function request(locale = "en-US") {
  return new Request("http://api.test/api/speech-token", {
    method: "POST",
    headers: { authorization: "Bearer valid", "content-type": "application/json" },
    body: JSON.stringify({ locale })
  });
}

const contextImpl = async () => ({
  config: {
    azureSpeechKey: "server-only-key",
    azureSpeechRegion: "japaneast",
    azureAssessmentMode: "auto"
  }
});

test("en-US advertises IPA, candidate, syllable, prosody, and miscue capabilities", () => {
  assert.deepEqual(capabilitiesForLocale("en-US"), {
    phonemeScores: true,
    ipaPhonemeNames: true,
    spokenPhonemeCandidates: true,
    syllables: true,
    prosody: true,
    miscue: true
  });
  assert.equal(capabilitiesForLocale("xx-XX"), null);
});

test("speech token endpoint returns a ten-minute token without exposing the subscription key", async () => {
  let azureRequest;
  const data = await issueSpeechToken({
    request: request(),
    contextImpl,
    now: new Date("2026-07-12T00:00:00.000Z"),
    fetchImpl: async (url, options) => {
      azureRequest = { url, options };
      return new Response("short-token", { status: 200 });
    }
  });

  assert.equal(data.token, "short-token");
  assert.equal(data.region, "japaneast");
  assert.equal(data.expires_at, "2026-07-12T00:10:00.000Z");
  assert.equal(data.refresh_after, "2026-07-12T00:08:00.000Z");
  assert.match(azureRequest.url, /japaneast\.api\.cognitive\.microsoft\.com\/sts\/v1\.0\/issueToken/);
  assert.equal(azureRequest.options.headers["Ocp-Apim-Subscription-Key"], "server-only-key");
  assert.doesNotMatch(JSON.stringify(data), /server-only-key/);
});

test("unsupported locale and Azure token failures are explicit", async () => {
  await assert.rejects(issueSpeechToken({ request: request("xx-XX"), contextImpl }), (error) => error.code === "UNSUPPORTED_LOCALE");
  await assert.rejects(
    issueSpeechToken({ request: request(), contextImpl, fetchImpl: async () => new Response("", { status: 401 }) }),
    (error) => error.code === "AZURE_TOKEN_UNAVAILABLE" && error.retryable
  );
});

test("authentication and missing Azure configuration fail without leaking secrets", async () => {
  await assert.rejects(
    issueSpeechToken({
      request: request(),
      contextImpl: async () => {
        const error = new Error("認証が必要です。");
        error.code = "UNAUTHORIZED";
        throw error;
      }
    }),
    (error) => error.code === "UNAUTHORIZED"
  );
  await assert.rejects(
    issueSpeechToken({ request: request(), contextImpl: async () => ({ config: {} }) }),
    (error) => error.code === "AZURE_SPEECH_CONFIG_MISSING" && !JSON.stringify(error).includes("server-only-key")
  );
});

test("token HTTP responses are private and never cacheable", async () => {
  const response = await handleSpeechToken({
    request: request(),
    contextImpl,
    fetchImpl: async () => new Response("short-token", { status: 200 })
  });
  assert.equal(response.headers.get("cache-control"), "no-store, private");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.doesNotMatch(await response.text(), /server-only-key/);
});
