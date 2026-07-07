import { handleDailySession } from "../../../lib/practice-session.mjs";
import { route } from "../../../lib/http.mjs";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return route(() => handleDailySession({ request }));
}
