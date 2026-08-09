import { handleV2 } from "../../../../lib/v2.mjs";
import { route } from "../../../../lib/http.mjs";
export const runtime = "nodejs";
export async function GET(request: Request) { return route(() => handleV2("progress", { request })); }
