import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ApiError, ok, readJson } from "./http.mjs";
import { getPracticeContext } from "./practice-access.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TTS_CACHE_DIR = path.resolve(__dirname, "../.cache/tts");

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

  await mkdirImpl(TTS_CACHE_DIR, { recursive: true });
  await writeFileImpl(ttsCacheFilePath(cacheKey), Buffer.from(payload.data.audio_base64, "base64"));

  const storagePath = ttsStoragePath(cacheKey);
  const row = await supabase.createTtsCache({
    cache_key: cacheKey,
    text_hash: textHash,
    normalized_text: normalizedText,
    accent,
    speed,
    storage_path: storagePath,
    duration_ms: payload.data.duration_ms ?? null,
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
