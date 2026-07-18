import { ApiError, ok, readJson } from "./http.mjs";
import { getPracticeContext } from "./practice-access.mjs";

export const PRONUNCIATION_CAPABILITIES = Object.freeze({
  "en-US": Object.freeze({
    phonemeScores: true,
    ipaPhonemeNames: true,
    spokenPhonemeCandidates: true,
    syllables: true,
    prosody: true,
    miscue: true
  })
});

export function capabilitiesForLocale(locale) {
  return PRONUNCIATION_CAPABILITIES[locale] ?? null;
}

export async function issueSpeechToken({
  request,
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  contextImpl = getPracticeContext
}) {
  const body = await readJson(request);
  const { config } = await contextImpl({ request, env, fetchImpl, now });
  const locale = typeof body?.locale === "string" ? body.locale : config.azureSpeechLocale ?? "en-US";
  const capabilities = capabilitiesForLocale(locale);
  if (!capabilities) {
    throw new ApiError("UNSUPPORTED_LOCALE", "この発音判定ロケールには対応していません。", 400, false);
  }

  if (!config.azureSpeechKey || !config.azureSpeechRegion) {
    throw new ApiError("AZURE_SPEECH_CONFIG_MISSING", "Azure Speech設定が未設定です。", 500, false);
  }

  if (config.azureAssessmentMode === "mock") {
    return tokenResponse({ token: "mock-speech-token", region: config.azureSpeechRegion, locale, capabilities, now });
  }

  const tokenEndpoint = `https://${config.azureSpeechRegion}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
  let response;
  try {
    response = await fetchImpl(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": "0",
        "Ocp-Apim-Subscription-Key": config.azureSpeechKey
      },
      body: ""
    });
  } catch {
    throw new ApiError("AZURE_TOKEN_UNAVAILABLE", "発音判定の準備に失敗しました。", 502, true);
  }

  if (!response.ok) {
    throw new ApiError("AZURE_TOKEN_UNAVAILABLE", "発音判定の準備に失敗しました。", 502, true);
  }
  const token = (await response.text()).trim();
  if (!token) {
    throw new ApiError("AZURE_TOKEN_UNAVAILABLE", "発音判定の準備に失敗しました。", 502, true);
  }
  return tokenResponse({ token, region: config.azureSpeechRegion, locale, capabilities, now });
}

function tokenResponse({ token, region, locale, capabilities, now }) {
  const issuedAt = new Date(now);
  const refreshAfter = new Date(issuedAt.getTime() + 8 * 60 * 1000);
  const expiresAt = new Date(issuedAt.getTime() + 10 * 60 * 1000);
  return {
    token,
    region,
    locale,
    issued_at: issuedAt.toISOString(),
    refresh_after: refreshAfter.toISOString(),
    expires_at: expiresAt.toISOString(),
    capabilities
  };
}

export async function handleSpeechToken(options) {
  return ok(await issueSpeechToken(options), {
    headers: {
      "Cache-Control": "no-store, private",
      Pragma: "no-cache"
    }
  });
}
