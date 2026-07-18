import { route } from "../../../lib/http.mjs";
import { handleSpeechToken } from "../../../lib/speech-token.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return route(() => handleSpeechToken({ request }));
}
