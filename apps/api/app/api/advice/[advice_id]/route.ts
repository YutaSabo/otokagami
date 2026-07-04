import { handleAdvice } from "../../../../lib/advice.mjs";
import { route } from "../../../../lib/http.mjs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ advice_id: string }> | { advice_id: string } }
) {
  return route(async () => {
    const params = await context.params;
    return handleAdvice({ request, adviceId: params.advice_id });
  });
}
