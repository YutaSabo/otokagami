import { getCachedOrRegeneratedTtsAudio } from "../../../../../lib/tts.mjs";
import { route } from "../../../../../lib/http.mjs";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ cache_key: string }> | { cache_key: string } }
) {
  return route(async () => {
    const params = await context.params;
    const cacheKey = params.cache_key.endsWith(".wav") ? params.cache_key.slice(0, -4) : params.cache_key;
    const audio = await getCachedOrRegeneratedTtsAudio({ cacheKey });

    return new Response(audio, {
      headers: {
        "content-type": "audio/wav",
        "cache-control": "private, max-age=3600"
      }
    });
  });
}
