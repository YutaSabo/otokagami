import { handleTts } from "../../../lib/tts.mjs";
import { route } from "../../../lib/http.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return route(() => handleTts({ request }));
}
