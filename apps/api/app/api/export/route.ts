import { handleExport } from "../../../lib/phase9.mjs";
import { route } from "../../../lib/http.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return route(() => handleExport({ request }));
}
