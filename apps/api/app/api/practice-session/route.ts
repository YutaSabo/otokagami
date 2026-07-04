import { handlePracticeSession } from "../../../lib/practice-session.mjs";
import { route } from "../../../lib/http.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return route(() => handlePracticeSession({ request }));
}
