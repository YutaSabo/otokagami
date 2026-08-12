import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { canonicalPayloadSha256 } from "@pronunciation-mirror/core/v2";
import { handleV2 } from "../../lib/v2.mjs";
import { VALIDATION_CONTENT_MANIFEST } from "../../lib/validation-content.mjs";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`Missing integration environment: ${key}`);
}

const serviceHeaders = {
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  "content-type": "application/json"
};

const baseEnv = {
  ...process.env,
  AZURE_ASSESSMENT_MODE: "mock",
  AZURE_SPEECH_KEY: "local-integration-only",
  AZURE_SPEECH_REGION: "local-integration",
  OTOKAGAMI_V2_MODE: "learning",
  OTOKAGAMI_V2_CAPTURE_WINDOW_SECONDS: "120",
  OTOKAGAMI_V2_SUBMISSION_WINDOW_SECONDS: "3600",
  OTOKAGAMI_V2_SPEECH_TOKEN_TTL_SECONDS: "120",
  OTOKAGAMI_V2_PROVIDER_PROJECTION_MAX_BYTES: "32768",
  OTOKAGAMI_V2_RATE_LIMIT_WINDOW_SECONDS: "60",
  OTOKAGAMI_V2_RATE_LIMIT_MAX: "50",
  OTOKAGAMI_V2_OUTBOX_RETENTION_SECONDS: "3600",
  OTOKAGAMI_V2_OUTBOX_MAX_ITEMS: "100",
  OTOKAGAMI_V2_OUTBOX_MAX_BYTES: "1048576",
  OTOKAGAMI_V2_OUTBOX_BACKOFF_BASE_SECONDS: "1",
  OTOKAGAMI_V2_OUTBOX_BACKOFF_MAX_SECONDS: "30",
  OTOKAGAMI_V2_EXPORT_MAX_BYTES: "1048576",
  OTOKAGAMI_V2_VALIDATION_CONTENT_ENABLED: "true",
  OTOKAGAMI_V2_VALIDATION_CONTENT_VERSION_ID: VALIDATION_CONTENT_MANIFEST.contentVersionId,
  OTOKAGAMI_V2_VALIDATION_DEVELOPMENT_CLIENT_MARKER: "local-db-e2e",
  VERCEL_ENV: "test"
};

await main().catch(reportFailure);

async function main() {
  await ensureValidationContentVersion();

  const scenarios = [];
  for (const optionalCount of [0, 1, 2]) {
    scenarios.push(await completeValidationDay(optionalCount, optionalCount === 0));
  }

  for (const scenario of scenarios) {
    assert.equal(scenario.requiredCompleted, 5);
    assert.equal(scenario.optionalCompleted, scenario.optionalCount);
    assert.equal(scenario.sessionStatus, "completed");
    assert.equal(scenario.trialStartedAt, null);
    assert.equal(scenario.completedProgramDays, 0);
  }

  console.log(JSON.stringify({
    status: "passed",
    authenticatedUsers: scenarios.length,
    validationSessions: scenarios.length,
    requiredAttempts: scenarios.reduce((sum, item) => sum + item.requiredCompleted, 0),
    optionalAttempts: scenarios.reduce((sum, item) => sum + item.optionalCompleted, 0),
    ticketRecoveryAndCancellation: "passed",
    apiRpcDatabasePath: "passed"
  }));
}

async function completeValidationDay(optionalCount, exerciseTicketRecovery) {
  const identity = await createAnonymousIdentity();
  const installationId = randomUUID();
  const installationSha256 = canonicalPayloadSha256(installationId);
  await serviceWrite("v2_validation_content_access?on_conflict=user_id,content_version_id,installation_sha256", {
    user_id: identity.userId,
    content_version_id: VALIDATION_CONTENT_MANIFEST.contentVersionId,
    installation_sha256: installationSha256
  });

  const env = {
    ...baseEnv,
    OTOKAGAMI_V2_VALIDATION_TESTER_USER_IDS: identity.userId,
    OTOKAGAMI_V2_VALIDATION_INSTALLATION_IDS: installationId
  };
  const headers = {
    authorization: `Bearer ${identity.accessToken}`,
    "x-otokagami-installation-id": installationId,
    "x-otokagami-development-client": "local-db-e2e"
  };

  const daily = await callApi("daily-session", { timezone: "UTC" }, { env, headers });
  assert.equal(daily.contract_version, "2026-08-s6-08-stage-7");
  assert.equal(daily.session.requiredItemCount, 5);
  assert.equal(daily.session.optionalItemCount, 2);
  assert.equal(daily.session.items.length, 7);
  assert.equal(daily.session.items.every((item) => item.referenceAudio?.standardUrl && item.referenceAudio?.slowUrl), true);

  const chosen = [
    ...daily.session.items.filter((item) => item.required),
    ...daily.session.items.filter((item) => !item.required).slice(0, optionalCount)
  ];
  let logicalClock = Date.now();

  if (exerciseTicketRecovery) {
    const item = chosen[0];
    const ticketRequestId = randomUUID();
    const nonce = randomUUID();
    const issued = await callApi("speech-token", {
      operation: "issue",
      ticket_request_id: ticketRequestId,
      assessment_ticket_nonce: nonce,
      session_item_id: item.id
    }, { env, headers, now: new Date(logicalClock) });
    const recovered = await callApi("speech-token", {
      operation: "recover",
      ticket_request_id: ticketRequestId,
      assessment_ticket_nonce: nonce
    }, { env, headers, now: new Date(logicalClock + 100) });
    assert.equal(recovered.assessment_ticket.id, issued.assessment_ticket.id);
    assert.equal(recovered.recovered, true);
    const cancelled = await callApi("speech-token", {
      operation: "cancel",
      ticket_request_id: ticketRequestId,
      assessment_ticket_nonce: nonce
    }, { env, headers, now: new Date(logicalClock + 200) });
    assert.equal(cancelled.cancelled, true);
    logicalClock += 1_000;
  }

  for (const item of chosen) {
    const attempt = await persistManagedAttempt({ item, env, headers, logicalClock });
    assert.equal(attempt.result.technicalValid, true);
    assert.equal(attempt.technical_valid, true);
    logicalClock += 5_000;
  }

  const completion = await callApi("session-completion", {
    session_id: daily.session.id,
    completion_idempotency_key: randomUUID()
  }, { env, headers, now: new Date(logicalClock) });
  assert.equal(completion.validation_only, true);

  const [sessionRows, enrollmentRows] = await Promise.all([
    serviceRead(`program_day_sessions?id=eq.${daily.session.id}&select=status`),
    serviceRead(`program_enrollments?user_id=eq.${identity.userId}&select=trial_started_at,completed_program_days`)
  ]);
  const itemRows = await serviceRead(`program_session_items?session_id=eq.${daily.session.id}&select=is_required,status`);
  return {
    optionalCount,
    requiredCompleted: itemRows.filter((item) => item.is_required && item.status === "completed").length,
    optionalCompleted: itemRows.filter((item) => !item.is_required && item.status === "completed").length,
    sessionStatus: sessionRows[0]?.status,
    trialStartedAt: enrollmentRows[0]?.trial_started_at ?? null,
    completedProgramDays: enrollmentRows[0]?.completed_program_days
  };
}

async function persistManagedAttempt({ item, env, headers, logicalClock }) {
  const ticketRequestId = randomUUID();
  const nonce = randomUUID();
  const issuedAt = new Date(logicalClock);
  const ticket = await callApi("speech-token", {
    operation: "issue",
    ticket_request_id: ticketRequestId,
    assessment_ticket_nonce: nonce,
    session_item_id: item.id
  }, { env, headers, now: issuedAt });
  const recordingStartedAt = new Date(logicalClock + 100).toISOString();
  const capturedAt = new Date(logicalClock + 200).toISOString();
  const providerResultReceivedAt = new Date(logicalClock + 300).toISOString();
  return callApi("attempts", {
    session_item_id: item.id,
    client_attempt_id: randomUUID(),
    assessment_ticket_id: ticket.assessment_ticket.id,
    ticket_request_id: ticketRequestId,
    assessment_ticket_nonce: nonce,
    deletion_epoch: ticket.assessment_ticket.deletion_epoch,
    recording_started_at: recordingStartedAt,
    captured_at: capturedAt,
    provider_result_received_at: providerResultReceivedAt,
    provider_projection: providerProjection(item)
  }, { env, headers, now: new Date(logicalClock + 400) });
}

function providerProjection(item) {
  return {
    projectionVersion: "azure-en-us-focus-projection-v1",
    recognitionStatus: "success",
    displayText: item.reference_text,
    target: {
      phoneme: item.expected_focus_representation,
      accuracyScore: 46,
      candidates: [{ phoneme: item.expected_focus_representation, score: 46 }]
    }
  };
}

async function callApi(kind, body, { env, headers, now = new Date() }) {
  const method = ["access-status", "progress", "reports"].includes(kind) ? "GET" : "POST";
  const request = new Request(`http://local.integration/api/v2/${kind}`, {
    method,
    headers: { ...headers, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
    body: method === "POST" ? JSON.stringify(body) : undefined
  });
  let response;
  try {
    response = await handleV2(kind, { request, env, now });
  } catch (error) {
    error.message = `${kind}: ${error.message}`;
    throw error;
  }
  assert.equal(response.ok, true, `${kind} returned ${response.status}`);
  const envelope = await response.json();
  assert.equal(envelope.ok, true);
  return envelope.data;
}

async function createAnonymousIdentity() {
  const response = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: "{}"
  });
  if (response.ok) {
    const body = await response.json();
    assert.equal(typeof body.access_token, "string");
    assert.equal(typeof body.user?.id, "string");
    return { accessToken: body.access_token, userId: body.user.id };
  }

  // Local anonymous auth can be disabled independently of the production
  // contract. Create an isolated synthetic local user through the admin API,
  // then authenticate through the normal password grant so API JWT validation
  // still traverses GoTrue. No credential is logged or written to disk.
  const suffix = randomUUID();
  const email = `v2-db-e2e-${suffix}@example.test`;
  const password = `Local-${randomUUID()}-Only`;
  const admin = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders,
    body: JSON.stringify({ email, password, email_confirm: true })
  });
  assert.equal(admin.ok, true, "local synthetic authentication setup failed");
  const token = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  assert.equal(token.ok, true, "local synthetic authentication failed");
  const body = await token.json();
  assert.equal(typeof body.access_token, "string");
  assert.equal(typeof body.user?.id, "string");
  return { accessToken: body.access_token, userId: body.user.id };
}

async function ensureValidationContentVersion() {
  await serviceWrite("content_versions?on_conflict=id", {
    id: VALIDATION_CONTENT_MANIFEST.contentVersionId,
    stable_release_id: VALIDATION_CONTENT_MANIFEST.stableReleaseId,
    version: VALIDATION_CONTENT_MANIFEST.version,
    assessment_locale: "en-US",
    coaching_locale: "ja-JP",
    status: "draft",
    manifest_sha256: VALIDATION_CONTENT_MANIFEST.manifestSha256,
    manifest_metadata: { validation_only: true },
    release_channel: "development_validation",
    validation_only: true
  });
}

async function serviceWrite(path, body) {
  const response = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
    method: "POST",
    headers: { ...serviceHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(body)
  });
  assert.equal(response.ok, true, `local service write failed (${response.status})`);
}

async function serviceRead(path) {
  const response = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
    headers: serviceHeaders
  });
  assert.equal(response.ok, true, `local service read failed (${response.status})`);
  return response.json();
}

function reportFailure(error) {
  const message = String(error?.message ?? error)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, "[uuid]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  const code = typeof error?.code === "string" ? error.code : "UNCLASSIFIED";
  const status = Number.isInteger(error?.status) ? error.status : "unknown";
  console.error(`v2-db-e2e failed: ${code}/${status}: ${message}`);
  process.exit(1);
}
