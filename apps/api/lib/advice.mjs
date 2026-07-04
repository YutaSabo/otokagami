import { createHash } from "node:crypto";

import { ApiError, ok } from "./http.mjs";
import { getPracticeContext } from "./practice-access.mjs";

const PROMPT_VERSION = "phase7-short-advice-v1";

function cacheKeyForAdvice({ page, expectedPhonemeId, observedPhonemeId }) {
  const identity = {
    native_language: page.native_language,
    target_accent: page.target_accent,
    confusion_pair_id: page.confusion_pair_id,
    generic_advice_id: page.generic_advice_id,
    expected_phoneme_id: expectedPhonemeId ?? null,
    observed_phoneme_id: observedPhonemeId ?? null,
    prompt_version: PROMPT_VERSION
  };
  return `advice:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}

function toAdvicePayload(page, shortTip, aiSource = "template") {
  return {
    advice_id: page.advice_id,
    confusion_pair_id: page.confusion_pair_id,
    generic_advice_id: page.generic_advice_id,
    native_language: page.native_language,
    target_accent: page.target_accent,
    title: page.title,
    short_tip: shortTip,
    comparison_text: page.comparison_text,
    coach_example_text: page.coach_example_text,
    asset_id: page.asset_id,
    is_template: page.is_template,
    ai_source: aiSource
  };
}

function shouldUseAiFallback(page, expectedPhonemeId, observedPhonemeId) {
  if (page.confusion_pair_id && page.is_template) return false;
  return Boolean(page.generic_advice_id && expectedPhonemeId);
}

async function callOpenAiAdvice({ config, page, expectedPhonemeId, observedPhonemeId, fetchImpl }) {
  if (!config.openAiApiKey) return null;

  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.openAiApiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: config.openAiAdviceModel,
      input: [
        {
          role: "system",
          content:
            "You rewrite pronunciation coaching tips for Japanese learners. Keep the answer in Japanese, one or two short lines, and do not add unverified claims."
        },
        {
          role: "user",
          content: [
            `Base tip: ${page.short_tip}`,
            `Comparison: ${page.comparison_text ?? ""}`,
            `Expected phoneme: ${expectedPhonemeId ?? ""}`,
            `Observed phoneme: ${observedPhonemeId ?? "missing or unknown"}`
          ].join("\n")
        }
      ],
      max_output_tokens: 120
    })
  });

  if (!response.ok) return null;
  const payload = await response.json();
  const text = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? [])
    .map((content) => content.text)
    .filter(Boolean)
    .join("\n");
  return typeof text === "string" && text.trim() ? text.trim() : null;
}

export async function getAdvice({
  request,
  adviceId,
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  openAiImpl = callOpenAiAdvice
}) {
  const { config, supabase } = await getPracticeContext({ request, env, fetchImpl, now });
  const page = await supabase.getAdvicePage(adviceId);
  if (!page) {
    throw new ApiError("ADVICE_NOT_FOUND", "助言が見つかりません。", 404, false);
  }

  const url = new URL(request.url);
  const expectedPhonemeId = url.searchParams.get("expected_phoneme_id");
  const observedPhonemeId = url.searchParams.get("observed_phoneme_id");

  if (!shouldUseAiFallback(page, expectedPhonemeId, observedPhonemeId)) {
    return toAdvicePayload(page, page.short_tip, "template");
  }

  const cacheKey = cacheKeyForAdvice({ page, expectedPhonemeId, observedPhonemeId });
  const cached = await supabase.getAiAdviceCache(cacheKey);
  if (cached) {
    await supabase.touchAiAdviceCache(cacheKey, now.toISOString());
    return toAdvicePayload(page, cached.output_text, "cache");
  }

  try {
    const outputText = await openAiImpl({ config, page, expectedPhonemeId, observedPhonemeId, fetchImpl });
    if (outputText) {
      await supabase.createAiAdviceCache({
        cache_key: cacheKey,
        native_language: page.native_language,
        target_accent: page.target_accent,
        confusion_pair_id: page.confusion_pair_id,
        generic_advice_id: page.generic_advice_id,
        prompt_version: PROMPT_VERSION,
        output_text: outputText,
        last_used_at: now.toISOString()
      });
      return toAdvicePayload(page, outputText, "openai");
    }
  } catch {
    // Keep practice usable when advice personalization fails.
  }

  return toAdvicePayload(page, page.short_tip, "template_fallback");
}

export async function handleAdvice(options) {
  return ok(await getAdvice(options));
}
