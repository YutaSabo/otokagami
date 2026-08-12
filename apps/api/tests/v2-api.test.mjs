import assert from "node:assert/strict";
import test from "node:test";

import {
  AZURE_V2_CAPACITY_REFERENCE,
  AZURE_V2_TEST_PAYLOAD_MAX_BYTES,
  canonicalPayloadSha256,
  projectAzureFocusPayload
} from "@pronunciation-mirror/core/v2";
import { ApiError } from "../lib/http.mjs";
import { createValidationContentRepository, VALIDATION_CONTENT_MANIFEST } from "../lib/validation-content.mjs";
import {
  createEmptyV2ContentRepository,
  createV2Repository,
  getV2Mode,
  handleV2,
  v2CompleteSession,
  v2CompleteReview,
  v2DailySession,
  v2DeleteLearningData,
  v2ExportLearningData,
  v2PersistAttempt,
  v2SpeechToken
} from "../lib/v2.mjs";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ITEM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONTENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CLIENT_ATTEMPT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const COMPLETION = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const TICKET = "12121212-1212-4212-8212-121212121212";
const TICKET_REQUEST = "23232323-2323-4232-8232-232323232323";
const TICKET_NONCE = "34343434-3434-4434-8434-343434343434";
const REVIEW_SCHEDULE = "45454545-4545-4545-8545-454545454545";
const REVIEW_ATTEMPT = "46464646-4646-4646-8646-464646464646";
const AZURE_V2_PROJECTION = projectAzureFocusPayload({
  providerPayload: AZURE_V2_CAPACITY_REFERENCE,
  targetLocator: { wordIndex: 0, phonemeIndex: 0 },
  payloadByteLimit: AZURE_V2_TEST_PAYLOAD_MAX_BYTES
}).projection;
const ENV = {
  SUPABASE_URL: "https://example.invalid",
  SUPABASE_ANON_KEY: "public-test-key",
  SUPABASE_SERVICE_ROLE_KEY: "server-test-key",
  AZURE_SPEECH_KEY: "azure-server-key",
  AZURE_SPEECH_REGION: "japaneast",
  AZURE_ASSESSMENT_MODE: "mock",
  OTOKAGAMI_V2_MODE: "learning",
  OTOKAGAMI_V2_TICKET_TTL_SECONDS: "600",
  OTOKAGAMI_V2_CAPTURE_WINDOW_SECONDS: "120",
  OTOKAGAMI_V2_SUBMISSION_WINDOW_SECONDS: "86400",
  OTOKAGAMI_V2_SPEECH_TOKEN_TTL_SECONDS: "600",
  OTOKAGAMI_V2_PROVIDER_PROJECTION_MAX_BYTES: "32768",
  OTOKAGAMI_V2_RATE_LIMIT_WINDOW_SECONDS: "60",
  OTOKAGAMI_V2_RATE_LIMIT_MAX: "3",
  OTOKAGAMI_V2_OUTBOX_RETENTION_SECONDS: "86400",
  OTOKAGAMI_V2_OUTBOX_MAX_ITEMS: "100",
  OTOKAGAMI_V2_OUTBOX_MAX_BYTES: "1048576",
  OTOKAGAMI_V2_OUTBOX_BACKOFF_BASE_SECONDS: "5",
  OTOKAGAMI_V2_OUTBOX_BACKOFF_MAX_SECONDS: "300",
  OTOKAGAMI_V2_EXPORT_MAX_BYTES: "1048576",
  REVENUECAT_PRO_ENTITLEMENT_ID: "pro"
};

test("v2 mode defaults and invalid values fail closed", () => {
  assert.equal(getV2Mode({}), "off");
  assert.equal(getV2Mode({ OTOKAGAMI_V2_MODE: "unexpected" }), "off");
  assert.equal(getV2Mode({ OTOKAGAMI_V2_MODE: "read_only" }), "read_only");
});

test("all v2 routes reject unauthenticated requests in enabled mode", async () => {
  for (const kind of ["bootstrap", "access-status", "daily-session", "speech-token", "attempts", "session-completion", "review-completion", "progress", "reports", "export", "delete-learning-data"]) {
    const response = await handleV2(kind, {
      request: requestFor(kind, {}, false),
      env: ENV,
      repository: fakeRepository({ rejectAuthentication: true })
    }).catch((error) => error);
    assert.equal(response instanceof ApiError, true, kind);
    assert.equal(response.code, "UNAUTHORIZED", kind);
  }
});

test("off blocks every v2 route and read_only permits reads but not learning writes", async () => {
  const off = await handleV2("bootstrap", { request: requestFor("bootstrap"), env: { ...ENV, OTOKAGAMI_V2_MODE: "off" }, repository: fakeRepository() }).catch((error) => error);
  assert.equal(off.code, "V2_DISABLED");
  const read = await handleV2("progress", { request: requestFor("progress"), env: { ...ENV, OTOKAGAMI_V2_MODE: "read_only" }, repository: fakeRepository() });
  assert.equal(read.status, 200);
  const write = await v2DailySession({
    request: requestFor("daily-session", { timezone: "Asia/Tokyo" }),
    env: { ...ENV, OTOKAGAMI_V2_MODE: "read_only" },
    repository: fakeRepository()
  }).catch((error) => error);
  assert.equal(write.code, "V2_READ_ONLY");
});

test("read_only resume performs no review mutation and reports a pending refresh", async () => {
  const repository = fakeRepository({ activeSession: rolloverSessionFixture() });
  const result = await v2DailySession({
    request: requestFor("daily-session", { timezone: "UTC" }),
    env: { ...ENV, OTOKAGAMI_V2_MODE: "read_only" },
    repository,
    contentRepository: contentRepositoryFixture(),
    now: new Date("2026-08-09T01:00:00Z")
  });
  assert.equal(repository.calls.reviewRefreshes.length, 0);
  assert.equal(result.refresh_pending, true);
});

test("bootstrap, access, progress and reports use only v2 state with no legacy trial or gamification", async () => {
  const repository = fakeRepository({
    enrollment: { trial_status: "in_progress", completed_program_days: 2, day_7_report_status: "not_started" }
  });
  for (const kind of ["bootstrap", "access-status", "progress", "reports"]) {
    const response = await handleV2(kind, { request: requestFor(kind), env: ENV, repository });
    const payload = await response.json();
    assert.equal(response.headers.get("cache-control"), "no-store, private");
    assert.doesNotMatch(JSON.stringify(payload), /free_trial_started_at|mastery_ewma|badge|level|overall_score/);
  }
});

test("daily session resumes an owned session and otherwise requires reviewed v2 content", async () => {
  const existing = fakeRepository({ activeSession: sessionFixture(), activeContent: null });
  const resumed = await v2DailySession({
    request: requestFor("daily-session", { timezone: "UTC" }),
    env: ENV,
    repository: existing,
    now: new Date("2026-08-09T01:00:00Z")
  });
  assert.equal(resumed.resumed, true);
  const notReady = await v2DailySession({
    request: requestFor("daily-session", { timezone: "Asia/Tokyo" }),
    env: ENV,
    repository: fakeRepository({ activeContent: null }),
    contentRepository: createEmptyV2ContentRepository()
  }).catch((error) => error);
  assert.equal(notReady.code, "CONTENT_NOT_READY");
});

test("a timezone change cannot create a second learning day before the previous fixed timezone advances", async () => {
  const error = await v2DailySession({
    request: requestFor("daily-session", { timezone: "Asia/Tokyo" }),
    env: ENV,
    repository: fakeRepository({
      latestCompletedSession: {
        id: "abababab-abab-4aba-8aba-abababababab",
        learning_day_sequence: 1,
        completed_calendar_date: "2026-08-09",
        timezone: "America/Los_Angeles"
      }
    }),
    contentRepository: contentRepositoryFixture(),
    now: new Date("2026-08-10T00:30:00Z")
  }).catch((caught) => caught);
  assert.equal(error.code, "CALENDAR_DATE_NOT_ADVANCED");
});

test("subscription access requires the configured entitlement, user mapping, active flag, status and future end", async () => {
  const now = new Date("2026-08-10T00:00:00Z");
  const config = { supabaseUrl: "https://example.invalid", supabaseAnonKey: "public", supabaseServiceRoleKey: "server" };
  for (const [row, expected] of [
    [{ user_id: USER, revenuecat_app_user_id: USER, entitlement_id: "pro", status: "active", is_active: true, current_period_ends_at: "2026-08-11T00:00:00Z" }, true],
    [{ user_id: USER, revenuecat_app_user_id: USER, entitlement_id: "pro", status: "active", is_active: true, current_period_ends_at: "2026-08-09T00:00:00Z" }, false],
    [{ user_id: USER, revenuecat_app_user_id: "another-user", entitlement_id: "pro", status: "active", is_active: true, current_period_ends_at: "2026-08-11T00:00:00Z" }, false],
    [{ user_id: USER, revenuecat_app_user_id: USER, entitlement_id: "pro", status: "cancelled", is_active: true, current_period_ends_at: "2026-08-11T00:00:00Z" }, false]
  ]) {
    const repository = createV2Repository(config, async () => Response.json([row]));
    assert.equal(await repository.getSubscriptionAccess(USER, "pro", now), expected);
  }
});

test("daily session rollover refreshes only the unstarted review slot in the fixed session timezone", async () => {
  const activeSession = rolloverSessionFixture();
  const repository = fakeRepository({ activeSession });
  const contentRepository = {
    async listFocusCandidates() { return []; },
    async listContentCandidates() {
      return [{
        contentVersionId: CONTENT,
        practiceItemKey: "review-vb",
        focusGroupKey: "v-b",
        promptRole: "review",
        active: true,
        humanReviewed: true,
        azureValidated: true,
        referenceText: "very",
        referenceTextVersion: "text-v2",
        expectedFocusRepresentation: "v",
        nextActionKey: "lower_lip"
      }];
    },
    async listReviewSchedules() {
      return [{
        id: "99999999-1111-4111-8111-111111111111",
        focusGroupKey: "v-b",
        basedOnEvidenceId: "99999999-2222-4222-8222-222222222222",
        intervalKind: "day_1",
        dueDate: "2026-08-09",
        status: "due",
        serverNormalizedBasis: true,
        unassistedBasis: true
      }];
    }
  };
  const result = await v2DailySession({
    request: requestFor("daily-session", { timezone: "America/New_York" }),
    env: ENV,
    repository,
    contentRepository,
    now: new Date("2026-08-09T01:00:00Z")
  });
  assert.equal(repository.calls.reviewRefreshes.length, 1);
  assert.equal(repository.calls.reviewRefreshes[0].p_calendar_date, "2026-08-09");
  assert.equal(repository.calls.reviewRefreshes[0].p_review_item.practiceItemKey, "review-vb");
  assert.equal(result.session.items.find((item) => item.slot_role === "review").focus_group_key, "v-b");
});

test("daily session is server planned from reviewed fixtures and never falls back to legacy content", async () => {
  const repository = fakeRepository();
  const result = await v2DailySession({
    request: requestFor("daily-session", { timezone: "Asia/Tokyo" }),
    env: ENV,
    repository,
    contentRepository: contentRepositoryFixture(),
    now: new Date("2026-08-09T01:00:00Z")
  });
  assert.equal(result.session.items.length, 5);
  assert.deepEqual(repository.calls.createdItems.map((item) => item.slotRole), ["anchor", "contrast", "transfer_word", "sentence", "review"]);
  assert.equal(repository.calls.createdItems.some((item) => item.referenceText.includes("free")), false);
  assert.deepEqual(result.session.items[0].referenceAudio, {
    standardUrl: "/validation-audio/test-0-standard.wav",
    slowUrl: "/validation-audio/test-0-slow.wav",
    version: "fixture-v1",
    manifestSha256: "a".repeat(64)
  });
  assert.equal(result.session.requiredItemCount, 5);
  assert.equal(result.session.optionalItemCount, 0);
});

test("speech token accepts only an owned managed item and fixes reference text and en-US on the server", async () => {
  const repository = fakeRepository({ activeSession: sessionFixture() });
  const result = await v2SpeechToken({
    request: requestFor("speech-token", speechTokenBody()),
    env: ENV,
    repository,
    now: new Date("2026-08-09T00:00:00Z")
  });
  assert.equal(result.locale, "en-US");
  assert.equal(result.reference_text, "think now");
  assert.equal(result.token, "mock-speech-token");
  assert.equal(result.provider_projection_max_bytes, 32768);
  assert.equal(result.contract_version, "2026-08-s6-08-stage-7");
  assert.match(result.assessment_ticket.id, /^[0-9a-f-]{36}$/);
  assert.equal("nonce" in result.assessment_ticket, false);
  assert.equal(result.assessment_ticket.request_id, TICKET_REQUEST);
  const arbitrary = await v2SpeechToken({
    request: requestFor("speech-token", { ...speechTokenBody(), text: "client text" }),
    env: ENV,
    repository
  }).catch((error) => error);
  assert.equal(arbitrary.code, "BAD_REQUEST");
});

test("speech token checks ticket eligibility before Azure and abandons its reservation after token failure", async () => {
  let azureCalls = 0;
  const ineligible = fakeRepository({ activeSession: sessionFixture(), ticketIssueError: "VALID_ATTEMPT_LIMIT_REACHED" });
  const blocked = await v2SpeechToken({
    request: requestFor("speech-token", speechTokenBody()),
    env: { ...ENV, AZURE_ASSESSMENT_MODE: "auto" },
    repository: ineligible,
    fetchImpl: async () => { azureCalls += 1; throw new Error("must not run"); }
  }).catch((error) => error);
  assert.equal(blocked.code, "VALID_ATTEMPT_LIMIT_REACHED");
  assert.equal(azureCalls, 0);

  const reserved = fakeRepository({ activeSession: sessionFixture() });
  const unavailable = await v2SpeechToken({
    request: requestFor("speech-token", speechTokenBody()),
    env: { ...ENV, AZURE_ASSESSMENT_MODE: "auto" },
    repository: reserved,
    fetchImpl: async () => { azureCalls += 1; throw new Error("network"); }
  }).catch((error) => error);
  assert.equal(unavailable.code, "AZURE_TOKEN_UNAVAILABLE");
  assert.equal(azureCalls, 1);
  assert.equal(reserved.calls.abandonedTickets.length, 1);
});

test("speech ticket request can be recovered or cancelled only with the same request id and nonce", async () => {
  const repository = fakeRepository({ activeSession: sessionFixture() });
  const recovered = await v2SpeechToken({
    request: requestFor("speech-token", speechTokenBody({ operation: "recover", session_item_id: undefined })),
    env: ENV,
    repository
  });
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.assessment_ticket.request_id, TICKET_REQUEST);
  assert.equal(recovered.token, "mock-speech-token");
  const cancelled = await v2SpeechToken({
    request: requestFor("speech-token", speechTokenBody({ operation: "cancel", session_item_id: undefined })),
    env: { ...ENV, AZURE_SPEECH_KEY: "", AZURE_SPEECH_REGION: "" },
    repository
  });
  assert.equal(cancelled.cancelled, true);
  assert.equal(repository.calls.recoveredTickets.length, 1);
  assert.equal(repository.calls.abandonedTickets.length, 1);
});

test("validation content requires non-production environment, explicit tester and ready immutable manifest", async () => {
  const config = {
    v2ValidationContentEnabled: true,
    v2ValidationTesterUserIds: new Set([USER]),
    v2ValidationInstallationIds: new Set(["installation-a"]),
    v2ValidationDevelopmentClientMarker: "development-client",
    v2ValidationContentVersionId: CONTENT,
    deploymentEnvironment: "preview"
  };
  const hash = "a".repeat(64);
  const variant = (name) => ({ url: `/validation-audio/r-l/${name}.wav`, sha256: hash });
  const manifest = {
    status: "ready",
    contentVersionId:CONTENT,stableReleaseId:"development-validation-r-l",version:1,focusGroupKey:"r-l",
    audioVersion: "validation-v1",
    coachVersion: "development-validation-static-coach-v1",
    coachManifestSha256: hash,
    coach: { r_to_l: "server-owned r coach", l_to_r: "server-owned l coach" },
    manifestSha256: hash,
    assets: [
      { key: "light", standard: variant("light-standard"), slow: variant("light-slow") },
      { key: "right", standard: variant("right-standard"), slow: variant("right-slow") },
      { key: "read", standard: variant("read-standard"), slow: variant("read-slow") }
    ]
  };
  const repository = createValidationContentRepository({
    config, userId: USER, installationId: "installation-a",
    developmentClientMarker: "development-client", manifest
  });
  assert.equal((await repository.listContentCandidates()).length, 7);
  assert.equal((await repository.listContentCandidates())[0].coachText, manifest.coach.l_to_r);
  assert.throws(() => createValidationContentRepository({
    config: { ...config, deploymentEnvironment: "production" }, userId: USER,
    installationId: "installation-a", developmentClientMarker: "development-client", manifest
  }), /FORBIDDEN_IN_PRODUCTION/);
  assert.throws(() => createValidationContentRepository({
    config: { ...config, v2ValidationTesterUserIds: new Set() }, userId: USER,
    installationId: "installation-a", developmentClientMarker: "development-client", manifest
  }), /TESTER_NOT_ALLOWED/);
  assert.throws(() => createValidationContentRepository({
    config, userId: USER, installationId: "installation-b",
    developmentClientMarker: "development-client", manifest
  }), /TESTER_NOT_ALLOWED/);
});

test("validation daily session preserves five required, two optional, review substitute, static coach and audio", async()=>{
  const validationContentId=VALIDATION_CONTENT_MANIFEST.contentVersionId;
  const repository=fakeRepository({validationContent:true,contentVersionId:validationContentId});
  const env={...ENV,VERCEL_ENV:"preview",OTOKAGAMI_V2_VALIDATION_CONTENT_ENABLED:"true",
    OTOKAGAMI_V2_VALIDATION_TESTER_USER_IDS:USER,OTOKAGAMI_V2_VALIDATION_INSTALLATION_IDS:"installation-a",
    OTOKAGAMI_V2_VALIDATION_DEVELOPMENT_CLIENT_MARKER:"development-client",
    OTOKAGAMI_V2_VALIDATION_CONTENT_VERSION_ID:validationContentId};
  const result=await v2DailySession({
    request:requestFor("daily-session",{timezone:"UTC"},true,{
      "x-otokagami-installation-id":"installation-a",
      "x-otokagami-development-client":"development-client"
    }),env,repository,now:new Date("2026-08-13T01:00:00Z")
  });
  assert.equal(result.session.requiredItemCount,5);
  assert.equal(result.session.optionalItemCount,2);
  assert.equal(result.session.items[4].slot_role,"review");
  assert.equal(result.session.items[4].prompt_role,"transfer_word");
  assert.equal(result.session.items[0].next_action_key,"l_to_r");
  assert.match(result.session.items[0].coach_text,/舌先/);
  assert.match(result.session.items[0].referenceAudio.standardUrl,/validation-audio/);
  assert.equal(repository.calls.validationSessions.length,1);
});

test("live v2 assessment fails closed when verified payload, expiry or outbox policy is absent", async () => {
  for (const missing of [
    "OTOKAGAMI_V2_CAPTURE_WINDOW_SECONDS",
    "OTOKAGAMI_V2_SUBMISSION_WINDOW_SECONDS",
    "OTOKAGAMI_V2_SPEECH_TOKEN_TTL_SECONDS",
    "OTOKAGAMI_V2_PROVIDER_PROJECTION_MAX_BYTES",
    "OTOKAGAMI_V2_OUTBOX_RETENTION_SECONDS"
  ]) {
    const env = { ...ENV };
    delete env[missing];
    const error = await v2SpeechToken({
      request: requestFor("speech-token", speechTokenBody()),
      env,
      repository: fakeRepository({ activeSession: sessionFixture() })
    }).catch((caught) => caught);
    assert.equal(error.code, "SERVER_ENV_MISSING", missing);
  }
});

test("attempt contract rejects client-selected trust and role fields and requires a one-time assessment ticket", async () => {
  const repository = fakeRepository({ activeSession: sessionFixture() });
  const clientRole = await v2PersistAttempt({
    request: requestFor("attempts", { ...attemptBody(), attempt_role: "transfer" }), env: ENV, repository
  }).catch((error) => error);
  assert.equal(clientRole.code, "BAD_REQUEST");

  const noTicket = await v2PersistAttempt({
    request: requestFor("attempts", {
      session_item_id: ITEM,
      client_attempt_id: CLIENT_ATTEMPT,
      deletion_epoch: 0,
      provider_projection: AZURE_V2_PROJECTION
    }), env: ENV, repository
  }).catch((error) => error);
  assert.equal(noTicket.code, "ASSESSMENT_TICKET_REQUIRED");
});

test("attempt command normalizes on the server and persists no raw provider, audio, URI, token or authorization", async () => {
  const repository = fakeRepository({ activeSession: sessionFixture() });
  const result = await v2PersistAttempt({
    request: requestFor("attempts", attemptBody()),
    env: ENV,
    repository,
    now: new Date("2026-08-09T02:00:00Z")
  });
  assert.equal(result.result.observedCandidate, "s");
  const persisted = repository.calls.attempts[0];
  const serialized = JSON.stringify(persisted);
  assert.doesNotMatch(serialized, /provider_payload|provider_projection|NBest|audio_base64|file_uri|authorization|azure-server-key/);
  assert.equal(persisted.p_assessment_locale, "en-US");
  assert.match(persisted.p_payload_sha256, /^[0-9a-f]{64}$/);
  assert.equal(persisted.p_ticket_request_id, TICKET_REQUEST);
  assert.equal(persisted.p_recording_started_at, "2026-08-09T00:00:00.000Z");
});

test("attempt canonical hash includes capture chronology", async () => {
  const first = fakeRepository({ activeSession: sessionFixture() });
  const second = fakeRepository({ activeSession: sessionFixture() });
  await v2PersistAttempt({ request: requestFor("attempts", attemptBody()), env: ENV, repository: first });
  await v2PersistAttempt({
    request: requestFor("attempts", { ...attemptBody(), captured_at: "2026-08-09T00:00:02.000Z" }),
    env: ENV,
    repository: second
  });
  assert.notEqual(first.calls.attempts[0].p_payload_sha256, second.calls.attempts[0].p_payload_sha256);
  const equivalent=fakeRepository({activeSession:sessionFixture()});
  await v2PersistAttempt({request:requestFor("attempts",{
    ...attemptBody(),recording_started_at:"2026-08-09T09:00:00+09:00",
    captured_at:"2026-08-09T09:00:01+09:00",provider_result_received_at:"2026-08-09T09:00:02+09:00"
  }),env:ENV,repository:equivalent});
  assert.equal(first.calls.attempts[0].p_payload_sha256,equivalent.calls.attempts[0].p_payload_sha256);
});

test("attempt replay is idempotent, changed canonical payload conflicts, invalid does not consume valid ordinal and fourth valid is rejected", async () => {
  const repository = fakeRepository({ activeSession: sessionFixture(), emulateAttemptRules: true });
  const request = () => requestFor("attempts", attemptBody());
  const [first, replay] = await Promise.all([
    v2PersistAttempt({ request: request(), env: ENV, repository }),
    v2PersistAttempt({ request: request(), env: ENV, repository })
  ]);
  assert.equal([first.replayed, replay.replayed].filter(Boolean).length, 1);
  const changedProvider = structuredClone(AZURE_V2_PROJECTION);
  changedProvider.target.accuracyScore = 47;
  const conflict = await v2PersistAttempt({
    request: requestFor("attempts", { ...attemptBody(), provider_projection: changedProvider }),
    env: ENV,
    repository
  }).catch((error) => error);
  assert.equal(conflict.code, "IDEMPOTENCY_CONFLICT");

  const invalidRepository = fakeRepository({ activeSession: sessionFixture(), emulateAttemptRules: true });
  await v2PersistAttempt({
    request: requestFor("attempts", {
      ...attemptBody(),
      provider_projection: {
        projectionVersion: "azure-en-us-focus-projection-v1",
        recognitionStatus: "no_match",
        displayText: null,
        target: null
      }
    }),
    env: ENV,
    repository: invalidRepository
  });
  for (let index = 0; index < 3; index += 1) {
    await v2PersistAttempt({
      request: requestFor("attempts", { ...attemptBody(), client_attempt_id: `${index + 1}1111111-1111-4111-8111-111111111111` }),
      env: ENV,
      repository: invalidRepository
    });
  }
  const fourth = await v2PersistAttempt({
    request: requestFor("attempts", { ...attemptBody(), client_attempt_id: "99999999-9999-4999-8999-999999999999" }),
    env: ENV,
    repository: invalidRepository
  }).catch((error) => error);
  assert.equal(fourth.code, "VALID_ATTEMPT_LIMIT_REACHED");
});

test("attempt rejects stale deletion epoch and forbidden provider fields before persistence", async () => {
  const repository = fakeRepository({ activeSession: sessionFixture(), expectedDeletionEpoch: 2 });
  const stale = await v2PersistAttempt({ request: requestFor("attempts", attemptBody()), env: ENV, repository }).catch((error) => error);
  assert.equal(stale.code, "DELETION_EPOCH_CONFLICT");
  const forbidden = await v2PersistAttempt({
    request: requestFor("attempts", { ...attemptBody(), provider_projection: { audio: "base64" } }),
    env: ENV,
    repository: fakeRepository({ activeSession: sessionFixture() })
  }).catch((error) => error);
  assert.equal(forbidden.code, "BAD_REQUEST");
});

test("attempt request body is rejected before JSON parsing when the declared size exceeds the measured envelope", async () => {
  const request = new Request("https://example.invalid/api/v2/attempts", {
    method: "POST",
    headers: {
      authorization: "Bearer user-token",
      "content-type": "application/json",
      "content-length": String(Number(ENV.OTOKAGAMI_V2_PROVIDER_PROJECTION_MAX_BYTES) + 4_097)
    },
    body: "{}"
  });
  const error = await v2PersistAttempt({ request, env: ENV, repository: fakeRepository() }).catch((caught) => caught);
  assert.equal(error.code, "REQUEST_TOO_LARGE");
});

test("session completion sends only server-derived date, hash and idempotency input to the transaction", async () => {
  const repository = fakeRepository({ activeSession: sessionFixture() });
  const result = await v2CompleteSession({
    request: requestFor("session-completion", { session_id: SESSION, completion_idempotency_key: COMPLETION }),
    env: ENV,
    repository,
    now: new Date("2026-08-09T03:00:00Z")
  });
  assert.equal(result.replayed, false);
  assert.deepEqual(Object.keys(repository.calls.completions[0]).sort(), [
    "p_calendar_date", "p_completed_at", "p_completion_idempotency_key", "p_completion_payload_sha256", "p_entitlement_id", "p_session_id", "p_user_id"
  ]);
  await v2CompleteSession({
    request: requestFor("session-completion", { session_id: SESSION, completion_idempotency_key: COMPLETION }),
    env: ENV,
    repository,
    now: new Date("2026-08-10T03:00:00Z")
  });
  assert.equal(repository.calls.completions[1].p_calendar_date, "2026-08-10");
  assert.equal(repository.calls.completions[1].p_completion_payload_sha256, repository.calls.completions[0].p_completion_payload_sha256);
});

test("validation session completion uses the isolated receipt and never sends entitlement metadata", async () => {
  const session = { ...sessionFixture(), validation_only: true,
    validation_installation_sha256: canonicalPayloadSha256("installation-a") };
  const repository = fakeRepository({ activeSession: session });
  await v2CompleteSession({
    request: requestFor("session-completion", { session_id: SESSION, completion_idempotency_key: COMPLETION },true,{
      "x-otokagami-installation-id":"installation-a","x-otokagami-development-client":"development-client"
    }),
    env: { ...ENV,VERCEL_ENV:"preview",OTOKAGAMI_V2_VALIDATION_CONTENT_ENABLED:"true",
      OTOKAGAMI_V2_VALIDATION_TESTER_USER_IDS:USER,OTOKAGAMI_V2_VALIDATION_INSTALLATION_IDS:"installation-a",
      OTOKAGAMI_V2_VALIDATION_DEVELOPMENT_CLIENT_MARKER:"development-client",
      OTOKAGAMI_V2_VALIDATION_CONTENT_VERSION_ID:CONTENT },
    repository,
    now: new Date("2026-08-09T03:00:00Z")
  });
  assert.equal(repository.calls.completions.length, 0);
  assert.deepEqual(Object.keys(repository.calls.validationCompletions[0]).sort(), [
    "p_calendar_date", "p_completed_at", "p_completion_idempotency_key",
    "p_completion_payload_sha256", "p_installation_sha256", "p_session_id", "p_user_id"
  ]);
});

test("review completion is bound to the owned review snapshot and server-derived calendar date", async () => {
  const session = sessionFixture();
  session.items[0] = {
    ...session.items[0],
    prompt_role: "review",
    slot_role: "review",
    review_schedule_id: REVIEW_SCHEDULE,
    review_source_evidence_id: "47474747-4747-4747-8747-474747474747",
    review_due_date: "2026-08-09",
    review_interval_kind: "day_1"
  };
  const repository = fakeRepository({ activeSession: session });
  const result = await v2CompleteReview({
    request: requestFor("review-completion", {
      review_schedule_id: REVIEW_SCHEDULE,
      session_item_id: ITEM,
      attempt_id: REVIEW_ATTEMPT,
      deletion_epoch: 0,
      completion_idempotency_key: COMPLETION
    }),
    env: ENV,
    repository,
    now: new Date("2026-08-09T03:00:00Z")
  });
  assert.equal(result.replayed, false);
  assert.deepEqual(repository.calls.reviewCompletions[0], {
    p_user_id: USER,
    p_review_schedule_id: REVIEW_SCHEDULE,
    p_session_item_id: ITEM,
    p_attempt_id: REVIEW_ATTEMPT,
    p_deletion_epoch: 0,
    p_completion_idempotency_key: COMPLETION,
    p_completed_at: "2026-08-09T03:00:00.000Z",
    p_calendar_date: "2026-08-09"
  });
});

test("v2 export and delete use authenticated ownership, redact service inputs and keep delete idempotency explicit", async () => {
  const repository = fakeRepository();
  const exported = await v2ExportLearningData({
    request: requestFor("export", {}),
    env: { ...ENV, OTOKAGAMI_V2_MODE: "read_only" },
    repository,
    now: new Date("2026-08-09T04:00:00Z")
  });
  assert.equal(exported.schema_version, "v2");
  assert.deepEqual(Object.keys(repository.calls.exports[0]).sort(), ["p_max_bytes", "p_server_now", "p_user_id"]);

  const deletionRequestId = "56565656-5656-4656-8656-565656565656";
  const readOnlyDeleted = await v2DeleteLearningData({
    request: requestFor("delete-learning-data", {
      confirm: true,
      deletion_request_id: deletionRequestId,
      expected_deletion_epoch: 4
    }),
    env: { ...ENV, OTOKAGAMI_V2_MODE: "read_only" },
    repository,
    now: new Date("2026-08-09T04:00:00Z")
  });
  assert.equal(readOnlyDeleted.deletion_epoch, 5);

  const deleted = await v2DeleteLearningData({
    request: requestFor("delete-learning-data", {
      confirm: true,
      deletion_request_id: deletionRequestId,
      expected_deletion_epoch: 4
    }),
    env: { ...ENV, OTOKAGAMI_V2_MODE: "learning" },
    repository,
    now: new Date("2026-08-09T04:00:00Z")
  });
  assert.equal(deleted.deletion_epoch, 5);
  assert.deepEqual(repository.calls.deletions[0], {
    p_user_id: USER,
    p_deletion_request_id: deletionRequestId,
    p_expected_deletion_epoch: 4,
    p_server_now: "2026-08-09T04:00:00.000Z"
  });
  assert.doesNotMatch(JSON.stringify({ exported, deleted }), /nonce|payload_hash|authorization|token|audio|file_uri/i);
});

function requestFor(kind, body = {}, authorized = true,extraHeaders = {}) {
  const method = ["access-status", "progress", "reports"].includes(kind) ? "GET" : "POST";
  return new Request(`http://api.test/api/v2/${kind}`, {
    method,
    headers: { ...(authorized ? { authorization: "Bearer user-token" } : {}), ...(method === "POST" ? { "content-type": "application/json" } : {}),...extraHeaders },
    body: method === "POST" ? JSON.stringify(body) : undefined
  });
}

function attemptBody() {
  return {
    session_item_id: ITEM,
    client_attempt_id: CLIENT_ATTEMPT,
    assessment_ticket_id: TICKET,
    ticket_request_id: TICKET_REQUEST,
    assessment_ticket_nonce: TICKET_NONCE,
    deletion_epoch: 0,
    recording_started_at: "2026-08-09T00:00:00.000Z",
    captured_at: "2026-08-09T00:00:01.000Z",
    provider_result_received_at: "2026-08-09T00:00:02.000Z",
    provider_projection: AZURE_V2_PROJECTION
  };
}

function speechTokenBody(overrides = {}) {
  return {
    operation: "issue",
    ticket_request_id: TICKET_REQUEST,
    assessment_ticket_nonce: TICKET_NONCE,
    session_item_id: ITEM,
    ...overrides
  };
}

function sessionFixture() {
  return {
    id: SESSION,
    user_id: USER,
    learning_day_sequence: 1,
    trial_program_day: 1,
    originating_calendar_date: "2026-08-09",
    review_effective_calendar_date: "2026-08-09",
    timezone: "Asia/Tokyo",
    content_version_id: CONTENT,
    focus_group_key: "theta-s-t",
    status: "in_progress",
    current_position: 0,
    items: [{
      id: ITEM,
      user_id: USER,
      session_id: SESSION,
      content_version_id: CONTENT,
      position: 1,
      slot_role: "anchor",
      prompt_role: "anchor",
      practice_item_key: "think-anchor",
      focus_group_key: "theta-s-t",
      is_required: true,
      status: "planned",
      reference_text: "think now",
      reference_text_version: "text-v1",
      expected_focus_representation: "θ",
      target_locator: { wordIndex: 0, phonemeIndex: 0 },
      next_action_key: "tongue_forward"
    }]
  };
}

function rolloverSessionFixture() {
  const session = sessionFixture();
  return {
    ...session,
    originating_calendar_date: "2026-08-08",
    review_effective_calendar_date: "2026-08-08",
    items: [
      session.items[0],
      {
        ...session.items[0],
        id: "cccccccc-dddd-4ccc-8ccc-cccccccccccc",
        position: 5,
        slot_role: "review",
        prompt_role: "transfer_word",
        practice_item_key: "review-fallback",
        selection_reason: "review_substitute_transfer_word",
        review_source_evidence_id: null,
        review_due_date: null,
        reference_text: "thick"
      }
    ]
  };
}

function contentRepositoryFixture() {
  const roles = ["anchor", "contrast", "transfer_word", "sentence", "transfer_word"];
  const rows = roles.map((promptRole, index) => ({
    contentVersionId: CONTENT,
    practiceItemKey: `${promptRole}-${index}`,
    focusGroupKey: "theta-s-t",
    promptRole,
    active: true,
    humanReviewed: true,
    azureValidated: true,
    referenceText: `managed-${index}`,
    referenceTextVersion: "text-v1",
    expectedFocusRepresentation: "θ",
    targetLocator: { wordIndex: 0, phonemeIndex: 0 },
    nextActionKey: "tongue_forward",
    referenceAudio: {
      standardUrl: `/validation-audio/test-${index}-standard.wav`,
      slowUrl: `/validation-audio/test-${index}-slow.wav`,
      version: "fixture-v1",
      manifestSha256: "a".repeat(64)
    }
  }));
  return {
    async listFocusCandidates() { return [{ id: "focus", focusGroupKey: "theta-s-t", kind: "discovery", reproducible: true, active: true, humanReviewed: true, azureValidated: true }]; },
    async listContentCandidates() { return rows; },
    async listReviewSchedules() { return []; }
  };
}

function fakeRepository(options = {}) {
  let enrollment = options.enrollment ?? null;
  let activeSession = options.activeSession ?? null;
  const attempts = new Map();
  let validCount = 0;
  const calls = { attempts: [], completions: [], validationCompletions: [], validationSessions: [], reviewCompletions: [], createdItems: [], reviewRefreshes: [] };
  return {
    calls,
    async authenticate(token) {
      if (options.rejectAuthentication || token !== "user-token") throw new ApiError("UNAUTHORIZED", "認証が必要です。", 401, false);
      return { id: USER };
    },
    async getEnrollment() { return enrollment; },
    async getDeletionEpoch() { return options.missingDeletionEpoch ? null : (options.expectedDeletionEpoch ?? 0); },
    async getSubscriptionAccess() { return options.subscribed ?? false; },
    async getActiveContentVersion() { return options.activeContent === null ? null : { id: CONTENT, stable_release_id: "content-v2", version: 1, status: "active", assessment_locale: "en-US", coaching_locale: "ja-JP" }; },
    async getContentVersion() { return { id:options.contentVersionId??CONTENT,stable_release_id:"development-validation-r-l",version:1,status:"draft",assessment_locale:"en-US",coaching_locale:"ja-JP",validation_only:true }; },
    async getActiveSession() { return activeSession; },
    async getLatestCompletedSession() { return options.latestCompletedSession ?? null; },
    async listSessionItems() { return activeSession?.items ?? []; },
    async getSessionItem(_userId, itemId) {
      const item = activeSession?.items.find((candidate) => candidate.id === itemId);
      return item ? { ...item, session: activeSession } : null;
    },
    async createDailySession(command) {
      calls.createdItems = command.p_items;
      activeSession = {
        ...sessionFixture(),
        content_version_id:command.p_content_version_id,
        status: "planned",
        items: command.p_items.map((item, index) => ({
          id: index === 0 ? ITEM : `0000000${index}-0000-4000-8000-00000000000${index}`,
          session_id: SESSION,
          position: item.position,
          slot_role: item.slotRole,
          prompt_role: item.promptRole,
          practice_item_key: item.practiceItemKey,
          focus_group_key: item.focusGroupKey,
          is_required: item.required,
          status: "planned",
          reference_text: item.referenceText,
          reference_text_version: item.referenceTextVersion,
          expected_focus_representation: item.expectedFocusRepresentation,
          target_locator: item.targetLocator,
          next_action_key: item.nextActionKey,
          advice_version: item.adviceVersion,
          coach_text: item.coachText,
          reference_audio_standard_url: item.referenceAudioStandardUrl,
          reference_audio_slow_url: item.referenceAudioSlowUrl,
          reference_audio_version: item.referenceAudioVersion,
          reference_audio_manifest_sha256: item.referenceAudioManifestSha256
        }))
      };
      enrollment ??= { trial_status: "not_started", completed_program_days: 0, day_7_report_status: "not_started" };
      return { session_id: SESSION, replayed: false };
    },
    async createValidationDailySession(command){
      calls.validationSessions.push(command);
      const result=await this.createDailySession(command);
      activeSession.validation_only=true;
      activeSession.trial_program_day=null;
      activeSession.validation_installation_sha256=command.p_installation_sha256;
      return {...result,validation_only:true};
    },
    async refreshReviewSlot(command) {
      calls.reviewRefreshes.push(command);
      activeSession.review_effective_calendar_date = command.p_calendar_date;
      if (command.p_review_item) {
        const reviewItem = activeSession.items.find((item) => item.slot_role === "review");
        Object.assign(reviewItem, {
          practice_item_key: command.p_review_item.practiceItemKey,
          focus_group_key: command.p_review_item.focusGroupKey,
          prompt_role: command.p_review_item.promptRole,
          selection_reason: command.p_review_item.selectionReason,
          review_source_evidence_id: command.p_review_item.reviewSourceEvidenceId,
          review_due_date: command.p_review_item.reviewDueDate,
          reference_text: command.p_review_item.referenceText,
          reference_text_version: command.p_review_item.referenceTextVersion,
          expected_focus_representation: command.p_review_item.expectedFocusRepresentation,
          next_action_key: command.p_review_item.nextActionKey
        });
      }
      return { session_id: SESSION, changed: Boolean(command.p_review_item), replayed: false };
    },
    async issueAssessmentTicket(command) {
      if (options.ticketIssueError) throw new ApiError(options.ticketIssueError, "blocked", 409, false);
      calls.tickets ??= [];
      calls.tickets.push(command);
      return {
        ticket_id: TICKET,
        ticket_request_id: command.p_ticket_request_id,
        session_item_id: command.p_session_item_id,
        deletion_epoch: command.p_deletion_epoch,
        capture_expires_at: "2026-08-09T00:02:00.000Z",
        submission_expires_at: "2026-08-10T00:00:00.000Z",
        status: "issued"
      };
    },
    async recoverAssessmentTicket(command) {
      calls.recoveredTickets ??= [];
      calls.recoveredTickets.push(command);
      return { ticket_id: TICKET, ticket_request_id: command.p_ticket_request_id, session_item_id: ITEM, deletion_epoch: 0, status:"issued", capture_expires_at: "2026-08-09T00:02:00.000Z", submission_expires_at: "2026-08-10T00:00:00.000Z", recovered: true };
    },
    async cancelAssessmentTicket(command) {
      calls.abandonedTickets ??= [];
      calls.abandonedTickets.push(command);
      return { ticket_id: TICKET, ticket_request_id: command.p_ticket_request_id, cancelled: true };
    },
    async persistAttempt(command) {
      calls.attempts.push(command);
      if ((options.expectedDeletionEpoch ?? 0) !== command.p_deletion_epoch) throw new ApiError("DELETION_EPOCH_CONFLICT", "epoch", 409, false);
      const existing = attempts.get(command.p_client_attempt_id);
      if (existing) {
        if (existing.hash !== command.p_payload_sha256) throw new ApiError("IDEMPOTENCY_CONFLICT", "conflict", 409, false);
        return { ...existing.result, replayed: true };
      }
      if (command.p_technical_valid) {
        validCount += 1;
        if (options.emulateAttemptRules && validCount > 3) throw new ApiError("VALID_ATTEMPT_LIMIT_REACHED", "limit", 409, false);
      }
      const result = { attempt_id: `attempt-${attempts.size + 1}`, technical_valid: command.p_technical_valid, valid_attempt_ordinal: command.p_technical_valid ? validCount : null, replayed: false };
      attempts.set(command.p_client_attempt_id, { hash: command.p_payload_sha256, result });
      return result;
    },
    async completeSession(command) { calls.completions.push(command); return { session_id: SESSION, replayed: false }; },
    async completeValidationSession(command) {
      calls.validationCompletions.push(command);
      return { session_id: SESSION, replayed: false, validation_only: true };
    },
    async completeReview(command) {
      calls.reviewCompletions.push(command);
      return { review_schedule_id: command.p_review_schedule_id, replayed: false };
    },
    async getProgress() { return { enrollment, sessions: [], focus_states: [], reviews: [] }; },
    async getReports() { return []; }
    ,async exportLearningData(command) {
      calls.exports ??= [];
      calls.exports.push(command);
      return { schema_version: "v2", data: {} };
    }
    ,async deleteLearningData(command) {
      calls.deletions ??= [];
      calls.deletions.push(command);
      return { replayed: false, deletion_epoch: command.p_expected_deletion_epoch + 1 };
    }
  };
}
