import { handleFreeAssess } from "../../../lib/phase9.mjs";
import { route } from "../../../lib/http.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const startedAt = performance.now();
  const timing: Record<string, number> = {};
  const response = await route(() => handleFreeAssess({ request, timing }));
  timing.total_ms = timing.total_ms ?? Math.round(performance.now() - startedAt);
  const serverTiming = Object.entries(timing)
    .filter(([name, value]) => name.endsWith("_ms") && Number.isFinite(value))
    .map(([name, value]) => `${name.replace(/_ms$/, "")};dur=${value}`)
    .join(", ");
  if (serverTiming) response.headers.set("Server-Timing", serverTiming);
  console.info("assessment_performance", JSON.stringify({ operation: "free_assess", status: response.status, ...timing }));
  return response;
}
