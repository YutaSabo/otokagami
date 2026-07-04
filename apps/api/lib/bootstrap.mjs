import { computeAccess } from "./access.mjs";
import { getApiEnv } from "./env.mjs";
import { ApiError, getBearerToken, ok, readJson } from "./http.mjs";
import { generateAnonPublicId, hashDeviceInstallId } from "./security.mjs";
import { createSupabaseRestClient } from "./supabase-rest.mjs";

function assertBootstrapBody(body) {
  if (!body || typeof body !== "object") {
    throw new ApiError("BAD_REQUEST", "リクエスト本文が不正です。", 400, false);
  }
  if (typeof body.device_install_id !== "string" || body.device_install_id.trim().length < 8) {
    throw new ApiError("BAD_REQUEST", "device_install_id が不正です。", 400, false);
  }

  return {
    timezone: typeof body.timezone === "string" && body.timezone ? body.timezone : "Asia/Tokyo",
    deviceInstallId: body.device_install_id,
    appVersion: typeof body.app_version === "string" ? body.app_version : null
  };
}

export async function bootstrapUser({
  request,
  env = process.env,
  fetchImpl = fetch,
  now = new Date()
}) {
  const accessToken = getBearerToken(request);
  const body = assertBootstrapBody(await readJson(request));
  const config = getApiEnv(env);
  const supabase = createSupabaseRestClient(config, fetchImpl);
  const user = await supabase.getAuthenticatedUser(accessToken);
  const nowIso = now.toISOString();
  const deviceInstallIdHash = hashDeviceInstallId(body.deviceInstallId);

  const existingInstallation = await supabase.getInstallationByHash(deviceInstallIdHash);
  let installation = existingInstallation;

  if (installation) {
    installation = await supabase.touchInstallation(installation.id, nowIso);
  } else {
    installation = await supabase.createInstallation({
      device_install_id_hash: deviceInstallIdHash,
      user_id: user.id,
      first_seen_at: nowIso,
      last_seen_at: nowIso
    });
  }

  let profile = await supabase.getProfile(user.id);
  if (!profile) {
    try {
      profile = await supabase.createProfile({
        user_id: user.id,
        anon_public_id: generateAnonPublicId(),
        native_language: "ja",
        target_accent: "US",
        timezone: body.timezone,
        free_trial_started_at: existingInstallation?.first_seen_at ?? nowIso,
        reminder_enabled: false,
        playback_speed_default: "normal",
        free_text_consent_version: null,
        free_text_consented_at: null
      });
    } catch (error) {
      profile = await supabase.getProfile(user.id);
      if (!profile) throw error;
    }
  }

  const subscriptions = await supabase.listActiveSubscriptions(user.id);
  return {
    profile,
    installation,
    access: computeAccess(profile, subscriptions, now, config.revenueCatProEntitlementId),
    received_app_version: body.appVersion
  };
}

export async function handleBootstrap(options) {
  const result = await bootstrapUser(options);
  return ok({
    profile: result.profile,
    access: {
      is_pro: result.access.is_pro,
      is_trial_active: result.access.is_trial_active,
      requires_paywall: result.access.requires_paywall,
      trial_day: result.access.trial_day
    }
  });
}
