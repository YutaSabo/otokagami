import { handleAssess } from "../../../lib/assess.mjs";
import { route } from "../../../lib/http.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return route(() => handleAssess({ request }));
}
