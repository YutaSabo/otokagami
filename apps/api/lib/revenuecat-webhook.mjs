import { getApiEnv } from "./env.mjs";
import { ApiError, ok, readJson } from "./http.mjs";
import { redactSecrets } from "./security.mjs";
import { createSupabaseRestClient } from "./supabase-rest.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_EVENT_TYPES = new Set(["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE"]);
const INACTIVE_EVENT_TYPES = new Set(["EXPIRATION", "CANCELLATION"]);

function getWebhookAuthorization(request) {
  return request.headers.get("authorization") ?? request.headers.get("x-revenuecat-authorization") ?? "";
}

function assertWebhookAuthorization(request, token) {
  const authorization = getWebhookAuthorization(request);
  if (authorization !== token && authorization !== `Bearer ${token}`) {
    throw new ApiError("UNAUTHORIZED", "認証が必要です。", 401, false);
  }
}

function fromMillis(value) {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function getRevenueCatEvent(body) {
  const event = body?.event ?? body;
  if (!event || typeof event !== "object") {
    throw new ApiError("BAD_REQUEST", "webhookイベントが不正です。", 400, false);
  }
  return event;
}

function mapSubscriptionStatus(event, proEntitlementId, receivedAt) {
  const appUserId = event.app_user_id ?? event.appUserId;
  const entitlementId = event.entitlement_id ?? event.entitlementId ?? proEntitlementId;
  const productId = event.product_id ?? event.productId ?? "unknown";
  const eventType = event.type ?? "UNKNOWN";
  const expiresAt = fromMillis(event.expiration_at_ms ?? event.expirationAtMs);
  const startsAt = fromMillis(event.purchased_at_ms ?? event.purchasedAtMs);

  if (typeof appUserId !== "string" || !UUID_PATTERN.test(appUserId)) {
    throw new ApiError("BAD_REQUEST", "RevenueCat App User ID が不正です。", 400, false);
  }

  let status = "unknown";
  if (ACTIVE_EVENT_TYPES.has(eventType)) status = "active";
  if (INACTIVE_EVENT_TYPES.has(eventType)) status = "expired";
  if (eventType === "BILLING_ISSUE") status = "billing_issue";

  const isProEntitlement = entitlementId === proEntitlementId;
  const notExpired = !expiresAt || new Date(expiresAt).getTime() > new Date(receivedAt).getTime();
  const isActive = isProEntitlement && status === "active" && notExpired;

  return {
    user_id: appUserId,
    revenuecat_app_user_id: appUserId,
    entitlement_id: entitlementId,
    product_id: productId,
    status,
    is_active: isActive,
    current_period_started_at: startsAt,
    current_period_ends_at: expiresAt,
    latest_event_at: receivedAt
  };
}

export async function processRevenueCatWebhook({
  request,
  env = process.env,
  fetchImpl = fetch,
  now = new Date()
}) {
  const config = getApiEnv(env);
  assertWebhookAuthorization(request, config.revenueCatWebhookAuthToken);

  const body = await readJson(request);
  const event = getRevenueCatEvent(body);
  const receivedAt = now.toISOString();
  const subscriptionPatch = {
    ...mapSubscriptionStatus(event, config.revenueCatProEntitlementId, receivedAt),
    raw_event: redactSecrets(body)
  };

  const supabase = createSupabaseRestClient(config, fetchImpl);
  const existingSubscription = await supabase.findSubscription(
    subscriptionPatch.user_id,
    subscriptionPatch.entitlement_id,
    subscriptionPatch.product_id
  );

  const subscription = existingSubscription
    ? await supabase.updateSubscription(existingSubscription.id, subscriptionPatch)
    : await supabase.insertSubscription(subscriptionPatch);

  return subscription;
}

export async function handleRevenueCatWebhook(options) {
  const subscription = await processRevenueCatWebhook(options);
  return ok({
    subscription: {
      user_id: subscription.user_id,
      revenuecat_app_user_id: subscription.revenuecat_app_user_id,
      entitlement_id: subscription.entitlement_id,
      product_id: subscription.product_id,
      status: subscription.status,
      is_active: subscription.is_active
    }
  });
}
