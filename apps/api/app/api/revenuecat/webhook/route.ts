import { route } from "../../../../lib/http.mjs";
import { handleRevenueCatWebhook } from "../../../../lib/revenuecat-webhook.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return route(() => handleRevenueCatWebhook({ request }));
}
