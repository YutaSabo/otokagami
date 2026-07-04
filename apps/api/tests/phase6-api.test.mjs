import assert from "node:assert/strict";
import test from "node:test";

import { computeAccess } from "../lib/access.mjs";
import { getAccessStatus } from "../lib/access-status.mjs";
import { bootstrapUser } from "../lib/bootstrap.mjs";
import { processRevenueCatWebhook } from "../lib/revenuecat-webhook.mjs";

const env = {
  SUPABASE_URL: "http://supabase.test",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  REVENUECAT_SECRET_KEY: "revenuecat-secret",
  REVENUECAT_WEBHOOK_AUTH_TOKEN: "webhook-token",
  REVENUECAT_PRO_ENTITLEMENT_ID: "pro"
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function filterRows(rows, searchParams) {
  let filtered = [...rows];
  for (const [key, value] of searchParams.entries()) {
    if (["select", "limit", "order"].includes(key)) continue;
    if (value.startsWith("eq.")) {
      const expected = decodeURIComponent(value.slice(3));
      filtered = filtered.filter((row) => String(row[key]) === expected);
    }
  }
  const limit = Number(searchParams.get("limit"));
  return Number.isFinite(limit) && limit > 0 ? filtered.slice(0, limit) : filtered;
}

function createFetchMock(state, userIdRef) {
  return async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method ?? "GET";

    if (parsed.pathname === "/auth/v1/user") {
      const authorization = options.headers?.authorization ?? options.headers?.Authorization;
      return authorization === "Bearer valid-token"
        ? jsonResponse({ id: userIdRef.current })
        : jsonResponse({ error: "invalid jwt" }, 401);
    }

    const table = parsed.pathname.split("/").at(-1);
    const collection = state[table];
    if (!collection) return jsonResponse({ error: "not found" }, 404);

    if (method === "GET") {
      return jsonResponse(filterRows(collection, parsed.searchParams));
    }

    if (method === "POST") {
      const row = JSON.parse(options.body);
      const stored = { id: `${table}-${collection.length + 1}`, ...row };
      collection.push(stored);
      return jsonResponse([stored], 201);
    }

    if (method === "PATCH") {
      const rows = filterRows(collection, parsed.searchParams);
      const patch = JSON.parse(options.body);
      for (const row of rows) Object.assign(row, patch);
      return jsonResponse(rows);
    }

    return jsonResponse({ error: "unsupported method" }, 405);
  };
}

function apiRequest(path, { method = "POST", body, token = "valid-token", headers = {} } = {}) {
  return new Request(`http://api.test${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

test("bootstrap creates and then reuses profile and installation without storing raw device id", async () => {
  const state = { profiles: [], installations: [], subscriptions: [] };
  const userIdRef = { current: "11111111-1111-4111-8111-111111111111" };
  const fetchImpl = createFetchMock(state, userIdRef);
  const firstSeenAt = new Date("2026-07-04T00:00:00.000Z");
  const secondSeenAt = new Date("2026-07-04T01:00:00.000Z");
  const deviceInstallId = "keychain-generated-device-id";

  const first = await bootstrapUser({
    request: apiRequest("/api/bootstrap", {
      body: { timezone: "Asia/Tokyo", device_install_id: deviceInstallId, app_version: "1.0.0" }
    }),
    env,
    fetchImpl,
    now: firstSeenAt
  });

  assert.equal(first.profile.user_id, userIdRef.current);
  assert.equal(first.profile.native_language, "ja");
  assert.equal(first.profile.target_accent, "US");
  assert.equal(first.profile.free_trial_started_at, firstSeenAt.toISOString());
  assert.equal(state.profiles.length, 1);
  assert.equal(state.installations.length, 1);
  assert.notEqual(state.installations[0].device_install_id_hash, deviceInstallId);
  assert.doesNotMatch(JSON.stringify(state.installations), /keychain-generated-device-id/);

  const second = await bootstrapUser({
    request: apiRequest("/api/bootstrap", {
      body: { timezone: "Asia/Tokyo", device_install_id: deviceInstallId, app_version: "1.0.1" }
    }),
    env,
    fetchImpl,
    now: secondSeenAt
  });

  assert.equal(second.profile.user_id, first.profile.user_id);
  assert.equal(state.profiles.length, 1);
  assert.equal(state.installations.length, 1);
  assert.equal(state.installations[0].last_seen_at, secondSeenAt.toISOString());
});

test("bootstrap reuses existing installation first_seen_at for a new anonymous user on the same device", async () => {
  const state = { profiles: [], installations: [], subscriptions: [] };
  const userIdRef = { current: "11111111-1111-4111-8111-111111111111" };
  const fetchImpl = createFetchMock(state, userIdRef);
  const firstSeenAt = new Date("2026-07-04T00:00:00.000Z");
  const reinstallSeenAt = new Date("2026-07-13T00:00:00.000Z");
  const deviceInstallId = "same-keychain-id";

  await bootstrapUser({
    request: apiRequest("/api/bootstrap", { body: { timezone: "Asia/Tokyo", device_install_id: deviceInstallId } }),
    env,
    fetchImpl,
    now: firstSeenAt
  });

  userIdRef.current = "22222222-2222-4222-8222-222222222222";
  const reinstalled = await bootstrapUser({
    request: apiRequest("/api/bootstrap", { body: { timezone: "Asia/Tokyo", device_install_id: deviceInstallId } }),
    env,
    fetchImpl,
    now: reinstallSeenAt
  });

  assert.equal(reinstalled.profile.user_id, userIdRef.current);
  assert.equal(reinstalled.profile.free_trial_started_at, firstSeenAt.toISOString());
  assert.equal(reinstalled.access.is_trial_active, false);
  assert.equal(reinstalled.access.requires_paywall, true);
});

test("bootstrap rejects an invalid Supabase JWT", async () => {
  await assert.rejects(
    bootstrapUser({
      request: apiRequest("/api/bootstrap", {
        token: "invalid-token",
        body: { timezone: "Asia/Tokyo", device_install_id: "keychain-generated-device-id" }
      }),
      env,
      fetchImpl: createFetchMock({ profiles: [], installations: [], subscriptions: [] }, { current: "" })
    }),
    /認証が必要です。/
  );
});

test("access status reflects trial, expired trial, and active Pro entitlement", () => {
  const profile = { free_trial_started_at: "2026-07-04T00:00:00.000Z" };

  assert.deepEqual(
    computeAccess(profile, [], new Date("2026-07-05T00:00:00.000Z")),
    {
      is_pro: false,
      is_trial_active: true,
      requires_paywall: false,
      trial_day: 2,
      free_trial_ends_at: "2026-07-11T00:00:00.000Z"
    }
  );

  assert.equal(computeAccess(profile, [], new Date("2026-07-12T00:00:00.000Z")).requires_paywall, true);
  assert.equal(
    computeAccess(profile, [{ is_active: true, entitlement_id: "pro" }], new Date("2026-07-12T00:00:00.000Z")).requires_paywall,
    false
  );
  assert.equal(
    computeAccess(profile, [{ is_active: true, entitlement_id: "team" }], new Date("2026-07-12T00:00:00.000Z")).requires_paywall,
    true
  );
});

test("access-status reads profile and active subscription through the API data path", async () => {
  const userId = "33333333-3333-4333-8333-333333333333";
  const state = {
    profiles: [
      {
        user_id: userId,
        free_trial_started_at: "2026-07-04T00:00:00.000Z"
      }
    ],
    installations: [],
    subscriptions: [
      {
        user_id: userId,
        revenuecat_app_user_id: userId,
        entitlement_id: "pro",
        product_id: "pm_pro_monthly",
        is_active: true
      }
    ]
  };

  const access = await getAccessStatus({
    request: apiRequest("/api/access-status", { method: "GET" }),
    env,
    fetchImpl: createFetchMock(state, { current: userId }),
    now: new Date("2026-07-12T00:00:00.000Z")
  });

  assert.equal(access.is_pro, true);
  assert.equal(access.is_trial_active, false);
  assert.equal(access.requires_paywall, false);
});

test("RevenueCat webhook rejects missing authorization", async () => {
  await assert.rejects(
    processRevenueCatWebhook({
      request: new Request("http://api.test/api/revenuecat/webhook", {
        method: "POST",
        body: JSON.stringify({ event: {} })
      }),
      env,
      fetchImpl: createFetchMock({ profiles: [], installations: [], subscriptions: [] }, { current: "" })
    }),
    /認証が必要です。/
  );
});

test("RevenueCat webhook updates subscriptions using App User ID as Supabase user_id", async () => {
  const state = { profiles: [], installations: [], subscriptions: [] };
  const userId = "33333333-3333-4333-8333-333333333333";
  const subscription = await processRevenueCatWebhook({
    request: new Request("http://api.test/api/revenuecat/webhook", {
      method: "POST",
      headers: {
        authorization: "Bearer webhook-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        event: {
          type: "INITIAL_PURCHASE",
          app_user_id: userId,
          entitlement_id: "pro",
          product_id: "pm_pro_monthly",
          purchased_at_ms: Date.parse("2026-07-04T00:00:00.000Z"),
          expiration_at_ms: Date.parse("2026-08-04T00:00:00.000Z"),
          secret_token: "must-not-be-stored"
        }
      })
    }),
    env,
    fetchImpl: createFetchMock(state, { current: userId }),
    now: new Date("2026-07-04T00:00:00.000Z")
  });

  assert.equal(subscription.user_id, userId);
  assert.equal(subscription.revenuecat_app_user_id, userId);
  assert.equal(subscription.entitlement_id, "pro");
  assert.equal(subscription.is_active, true);
  assert.equal(state.subscriptions.length, 1);
  assert.equal(state.subscriptions[0].raw_event.event.secret_token, "[REDACTED]");
});
