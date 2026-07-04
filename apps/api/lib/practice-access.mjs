import { computeAccess } from "./access.mjs";
import { getApiEnv } from "./env.mjs";
import { ApiError, getBearerToken } from "./http.mjs";
import { createSupabaseRestClient } from "./supabase-rest.mjs";

export async function getPracticeContext({
  request,
  env = process.env,
  fetchImpl = fetch,
  now = new Date()
}) {
  const accessToken = getBearerToken(request);
  const config = getApiEnv(env);
  const supabase = createSupabaseRestClient(config, fetchImpl);
  const user = await supabase.getAuthenticatedUser(accessToken);
  const profile = await supabase.getProfile(user.id);

  if (!profile) {
    throw new ApiError("PROFILE_NOT_INITIALIZED", "初期化が必要です。", 409, false);
  }

  const subscriptions = await supabase.listActiveSubscriptions(user.id);
  const access = computeAccess(profile, subscriptions, now, config.revenueCatProEntitlementId);
  if (access.requires_paywall) {
    throw new ApiError("PAYWALL_REQUIRED", "Proプランが必要です。", 402, false);
  }

  return { config, supabase, user, profile, access };
}
