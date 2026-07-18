import { handleAssess } from "../../../lib/assess.mjs";
import { route } from "../../../lib/http.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const startedAt = performance.now();
  const timing: Record<string, number> = {};
  const response = await route(() => handleAssess({ request, timing }));
  timing.total_ms = timing.total_ms ?? Math.round(performance.now() - startedAt);

  // Server-Timing is readable by the mobile client and APM/proxies. It contains only
  // durations and byte counts--never audio, text, identifiers, or credentials.
  const serverTiming = Object.entries(timing)
    .filter(([name, value]) => name.endsWith("_ms") && Number.isFinite(value))
    .map(([name, value]) => `${name.replace(/_ms$/, "")};dur=${value}`)
    .join(", ");
  if (serverTiming) response.headers.set("Server-Timing", serverTiming);
  console.info("assessment_performance", JSON.stringify({ operation: "assess", status: response.status, ...timing }));
  return response;
}
