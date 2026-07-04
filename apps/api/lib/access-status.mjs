import { computeAccess } from "./access.mjs";
import { getApiEnv } from "./env.mjs";
import { ApiError, getBearerToken, ok } from "./http.mjs";
import { createSupabaseRestClient } from "./supabase-rest.mjs";

export async function getAccessStatus({
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
  return computeAccess(profile, subscriptions, now, config.revenueCatProEntitlementId);
}

export async function handleAccessStatus(options) {
  return ok(await getAccessStatus(options));
}
