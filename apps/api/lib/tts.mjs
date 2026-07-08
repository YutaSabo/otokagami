import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { getApiEnv } from "./env.mjs";
import { ApiError, ok, readJson } from "./http.mjs";
import { getPracticeContext } from "./practice-access.mjs";
import { createSupabaseRestClient } from "./supabase-rest.mjs";

const TTS_CACHE_DIR = path.join(tmpdir(), "pronunciation-mirror-tts");

export function normalizeTtsText(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function getTtsCacheKey({ normalizedText, accent, speed }) {
  const textHash = createHash("sha256").update(normalizedText).digest("hex");
  return {
    textHash,
    cacheKey: `tts:${accent}:${speed}:${textHash}`
  };
}

export function ttsStoragePath(cacheKey) {
  return `/api/tts/audio/${encodeURIComponent(cacheKey)}.wav`;
}

export function ttsCacheFilePath(cacheKey) {
  const fileName = `${createHash("sha256").update(cacheKey).digest("hex")}.wav`;
  return path.join(TTS_CACHE_DIR, fileName);
}

export async function getCachedTtsAudio(cacheKey, readFileImpl = readFile) {
  return readFileImpl(ttsCacheFilePath(cacheKey));
}

async function fetchTtsAudioBase64({ config, normalizedText, accent, speed, fetchImpl }) {
  if (!config.pythonServiceUrl || !config.pythonServiceApiKey) {
    throw new ApiError("TTS_SERVICE_UNCONFIGURED", "TTSサービスが未設定です。", 500, false);
  }

  const response = await fetchImpl(`${config.pythonServiceUrl.replace(/\/$/, "")}/internal/tts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-api-key": config.pythonServiceApiKey
    },
    body: JSON.stringify({ text: normalizedText, accent, speed })
  });

  if (!response.ok) {
    throw new ApiError("TTS_GENERATION_FAILED", "お手本音声の生成に失敗しました。", 502, true);
  }

  const payload = await response.json();
  if (!payload?.ok || !payload.data?.audio_base64) {
    throw new ApiError("TTS_GENERATION_FAILED", "お手本音声の生成に失敗しました。", 502, true);
  }

  return {
    audioBase64: payload.data.audio_base64,
    durationMs: payload.data.duration_ms ?? null
  };
}

export async function getCachedOrRegeneratedTtsAudio({
  cacheKey,
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  readFileImpl = readFile,
  writeFileImpl = writeFile,
  mkdirImpl = mkdir
}) {
  try {
    return await getCachedTtsAudio(cacheKey, readFileImpl);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const config = getApiEnv(env);
  const supabase = createSupabaseRestClient(config, fetchImpl);
  const cached = await supabase.getTtsCache(cacheKey);
  if (!cached) {
    throw new ApiError("TTS_AUDIO_NOT_FOUND", "お手本音声が見つかりません。", 404, false);
  }

  const { audioBase64 } = await fetchTtsAudioBase64({
    config,
    normalizedText: cached.normalized_text,
    accent: cached.accent,
    speed: cached.speed,
    fetchImpl
  });
  const audio = Buffer.from(audioBase64, "base64");

  await mkdirImpl(TTS_CACHE_DIR, { recursive: true });
  await writeFileImpl(ttsCacheFilePath(cacheKey), audio);
  await supabase.touchTtsCache(cacheKey, now.toISOString());

  return audio;
}

export async function getOrCreateTts({
  supabase,
  config,
  text,
  accent = "US",
  speed = "normal",
  fetchImpl = fetch,
  now = new Date(),
  writeFileImpl = writeFile,
  mkdirImpl = mkdir
}) {
  if (accent !== "US") {
    throw new ApiError("UNSUPPORTED_ACCENT", "USアクセントのみ対応しています。", 400, false);
  }
  if (!["normal", "slow"].includes(speed)) {
    throw new ApiError("INVALID_SPEED", "speed は normal または slow を指定してください。", 400, false);
  }

  const normalizedText = normalizeTtsText(text);
  if (!normalizedText) {
    throw new ApiError("BAD_REQUEST", "text が不正です。", 400, false);
  }

  const { textHash, cacheKey } = getTtsCacheKey({ normalizedText, accent, speed });
  const cached = await supabase.getTtsCache(cacheKey);
  if (cached) {
    await supabase.touchTtsCache(cacheKey, now.toISOString());
    return {
      cache_key: cacheKey,
      audio_url: cached.storage_path,
      storage_path: cached.storage_path,
      duration_ms: cached.duration_ms,
      cached: true
    };
  }

  const { audioBase64, durationMs } = await fetchTtsAudioBase64({
    config,
    normalizedText,
    accent,
    speed,
    fetchImpl
  });

  await mkdirImpl(TTS_CACHE_DIR, { recursive: true });
  await writeFileImpl(ttsCacheFilePath(cacheKey), Buffer.from(audioBase64, "base64"));

  const storagePath = ttsStoragePath(cacheKey);
  const row = await supabase.createTtsCache({
    cache_key: cacheKey,
    text_hash: textHash,
    normalized_text: normalizedText,
    accent,
    speed,
    storage_path: storagePath,
    duration_ms: durationMs,
    last_used_at: now.toISOString()
  });

  return {
    cache_key: cacheKey,
    audio_url: row.storage_path,
    storage_path: row.storage_path,
    duration_ms: row.duration_ms,
    cached: false
  };
}

export async function createTts({
  request,
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  writeFileImpl = writeFile,
  mkdirImpl = mkdir
}) {
  const body = await readJson(request);
  const { config, supabase } = await getPracticeContext({ request, env, fetchImpl, now });
  return getOrCreateTts({
    supabase,
    config,
    text: body?.text,
    accent: body?.accent ?? "US",
    speed: body?.speed ?? "normal",
    fetchImpl,
    now,
    writeFileImpl,
    mkdirImpl
  });
}

export async function handleTts(options) {
  return ok(await createTts(options));
}
