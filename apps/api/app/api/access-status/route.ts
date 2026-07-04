import { handleAccessStatus } from "../../../lib/access-status.mjs";
import { route } from "../../../lib/http.mjs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return route(() => handleAccessStatus({ request }));
}
