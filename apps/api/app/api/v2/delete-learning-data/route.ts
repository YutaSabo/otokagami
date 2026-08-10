import { handleV2 } from "../../../../lib/v2.mjs";
import { route } from "../../../../lib/http.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return route(() => handleV2("delete-learning-data", { request }));
}
