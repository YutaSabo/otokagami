import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createV2AttemptPipeline } from "../lib/v2-attempt-pipeline.mjs";
import {canRequestAnotherTicket,nextRestoredPosition,validateV2SessionShape} from "../lib/v2-mobile-policy.mjs";
import {createV2TicketJournal,V2_TICKET_JOURNAL_SCHEMA} from "../lib/v2-ticket-journal.mjs";
import { V2_AUDIO_INDEX_SCHEMA,audioDeletionReason,createV2AudioRepository,fixedDayClock } from "../lib/v2-audio-lifecycle.mjs";
import { V2_DELETION_SCHEMA, canSendLearningCommands, createV2DeletionCoordinator, nextDeletionAction } from "../lib/v2-deletion.mjs";
import { V2_OUTBOX_SCHEMA, createV2OutboxRepository, createV2OutboxWorker } from "../lib/v2-outbox.mjs";

test("SQLite schema has no audio, URI, token, authorization, nonce, or raw-provider value column", () => {
  const normalizedColumns = [...V2_OUTBOX_SCHEMA.matchAll(/^\s*([a-z][a-z0-9_]*)\s+(?:TEXT|INTEGER|REAL)/gim)]
    .map((match) => match[1]);
  for (const column of normalizedColumns) {
    assert.doesNotMatch(column, /audio|uri|token|authorization|nonce|raw.*(?:json|payload|provider)/i);
  }
  assert.match(V2_OUTBOX_SCHEMA, /protected_material_handle/);
  assert.match(V2_AUDIO_INDEX_SCHEMA, /file_key/);
  assert.doesNotMatch(V2_AUDIO_INDEX_SCHEMA, /file_uri|audio_uri/i);
});

test("enqueue and local result are one transaction; FIFO dependencies wait for confirmation", async () => {
  const db = sqliteAdapter();
  await db.execAsync(`${V2_DELETION_SCHEMA}\n${V2_OUTBOX_SCHEMA}`);
  const repository = createV2OutboxRepository(db);
  repository.setLimits(syncConfig());
  await repository.enqueue(command("a", null), localResult());
  await repository.enqueue(command("b", "a"), localResult());
  assert.equal((await repository.get("a")).sync_state, "pending");

  const first = await repository.leaseNext({userId:"user", leaseId: "lease-a", now: iso(0), leaseExpiresAt: iso(60) });
  assert.equal(first.command_id, "a");
  const whileBlocked = await repository.leaseNext({userId:"user", leaseId: "lease-b", now: iso(0), leaseExpiresAt: iso(60) });
  assert.equal(whileBlocked, undefined);
  await repository.acknowledge("a", "lease-a", iso(1));
  const second = await repository.leaseNext({userId:"user", leaseId: "lease-b", now: iso(1), leaseExpiresAt: iso(60) });
  assert.equal(second.command_id, "b");
});

test("outbox capacity and dependencies are isolated by authenticated user",async()=>{
  const db=sqliteAdapter();await db.execAsync(`${V2_DELETION_SCHEMA}\n${V2_OUTBOX_SCHEMA}`);
  const repository=createV2OutboxRepository(db);repository.setLimits({...syncConfig(),maxItems:1});
  await repository.enqueue(command("user-a",null),localResult());
  const other=command("user-b",null);other.userId="other-user";other.clientAttemptId="attempt-other";
  await repository.enqueue(other,localResult());
  repository.setLimits({...syncConfig(),maxItems:2});
  const cross=control("cross","session_completion","user-a");cross.userId="other-user";
  await assert.rejects(()=>repository.enqueueControl(cross),(error)=>error.code==="CROSS_USER_DEPENDENCY");
  assert.equal((await repository.leaseNext({userId:"other-user",leaseId:"other-lease",now:iso(0),leaseExpiresAt:iso(60)})).command_id,"user-b");
});

test("outbox capacity is enforced in UTF-8 bytes rather than character count", async () => {
  const db = sqliteAdapter();
  await db.execAsync(`${V2_DELETION_SCHEMA}\n${V2_OUTBOX_SCHEMA}`);
  const repository = createV2OutboxRepository(db);
  repository.setLimits({ ...syncConfig(), maxBytes: 20 });
  const oversized = control("utf8", "session_completion", null);
  oversized.controlPayload = { message: "あいうえお" };
  await assert.rejects(() => repository.enqueueControl(oversized), (error) => error.code === "OUTBOX_CAPACITY_REACHED");
});

test("review completion waits for the confirmed attempt and session completion waits for review", async () => {
  const db = sqliteAdapter();
  await db.execAsync(`${V2_DELETION_SCHEMA}\n${V2_OUTBOX_SCHEMA}`);
  const repository = createV2OutboxRepository(db);
  repository.setLimits(syncConfig());
  await repository.enqueue(command("attempt", null), localResult());
  await repository.enqueueControl(control("review", "review_completion", "attempt"));
  await repository.enqueueControl(control("complete", "session_completion", "review"));
  assert.equal((await repository.leaseNext({userId:"user", leaseId: "a", now: iso(0), leaseExpiresAt: iso(60) })).command_id, "attempt");
  await repository.acknowledge("attempt", "a", iso(1), "server-attempt");
  const review = await repository.leaseNext({userId:"user", leaseId: "r", now: iso(1), leaseExpiresAt: iso(60) });
  assert.equal(review.command_id, "review");
  assert.equal(review.dependency_server_resource_id, "server-attempt");
  await repository.acknowledge("review", "r", iso(2), "server-review");
  assert.equal((await repository.leaseNext({userId:"user", leaseId: "c", now: iso(2), leaseExpiresAt: iso(60) })).command_id, "complete");
});

test("single-lease worker recovers ACK loss and purges protected material after confirmation", async () => {
  const db = sqliteAdapter();
  await db.execAsync(`${V2_DELETION_SCHEMA}\n${V2_OUTBOX_SCHEMA}`);
  const repository = createV2OutboxRepository(db);
  repository.setLimits(syncConfig());
  await repository.enqueue(command("a", null), localResult());
  const deleted = [];
  let sends = 0;
  const worker = createV2OutboxWorker({
    userId:"user",
    repository,
    api: {
      async send() { sends += 1; },
      classify() { return "retryable"; }
    },
    protectedMaterialStore: {
      async read() { return "ephemeral-nonce"; },
      async delete(handle) { deleted.push(handle); }
    },
    clock: { now: () => iso(0), id: () => "lease-a", addSeconds: (_, seconds) => iso(seconds) },
    config: { maxItems: 20, maxBytes: 20_000, submissionWindowSeconds: 600, initialBackoffSeconds: 1, maxBackoffSeconds: 30 }
  });
  const [one, two] = await Promise.all([worker.runOnce(), worker.runOnce()]);
  assert.deepEqual(new Set([one.status, two.status]), new Set(["confirmed", "busy"]));
  assert.equal(sends, 1);
  assert.deepEqual(deleted, ["material-a"]);
  const saved = await repository.get("a");
  assert.equal(saved.state, "confirmed");
  assert.equal(saved.strict_projection_json, null);
  assert.equal(saved.protected_material_handle, null);
});

test("server ACK is durable before nonce cleanup and startup cleanup never resends confirmed work", async () => {
  const db=sqliteAdapter();
  await db.execAsync(`${V2_DELETION_SCHEMA}\n${V2_OUTBOX_SCHEMA}`);
  const repository=createV2OutboxRepository(db);repository.setLimits(syncConfig());
  await repository.enqueue(command("crash",null),localResult());
  await repository.leaseNext({userId:"user",leaseId:"lease",now:iso(0),leaseExpiresAt:iso(60)});
  await repository.acknowledge("crash","lease",iso(1),"server-attempt",{attempt_id:"server-attempt"});
  const durable=await repository.get("crash");
  assert.equal(durable.state,"confirmed");
  assert.equal(durable.protected_material_handle,"material-crash");
  assert.equal(durable.protected_material_cleanup_pending,1);
  assert.equal((await repository.listProtectedMaterialCleanup("user")).length,1);
  assert.equal(await repository.leaseNext({userId:"user",leaseId:"other",now:iso(2),leaseExpiresAt:iso(60)}),undefined);
  await repository.finishProtectedMaterialCleanup("user","material-crash");
  assert.equal((await repository.get("crash")).protected_material_handle,null);
  assert.equal((await repository.listProtectedMaterialCleanup("user")).length,0);
});

test("expired submissions become permanent failures instead of remaining stuck", async () => {
  const db = sqliteAdapter();
  await db.execAsync(`${V2_DELETION_SCHEMA}\n${V2_OUTBOX_SCHEMA}`);
  const repository = createV2OutboxRepository(db);
  repository.setLimits(syncConfig());
  const expired = command("expired", null);
  expired.submissionExpiresAt = iso(1);
  await repository.enqueue(expired, localResult());
  const worker = createV2OutboxWorker({
    userId:"user",
    repository,
    api: { async send() { throw new Error("must not send"); }, classify() { return "retryable"; } },
    protectedMaterialStore: { async read() { return null; }, async delete() {} },
    clock: { now: () => iso(2), id: () => "lease-expired", addSeconds: (_, seconds) => iso(2 + seconds) },
    config: { maxItems: 20, maxBytes: 20_000, submissionWindowSeconds: 600, initialBackoffSeconds: 1, maxBackoffSeconds: 30 }
  });
  assert.deepEqual(await worker.runOnce(), { status: "permanent_failure", code: "SUBMISSION_EXPIRED" });
  assert.equal((await repository.get("expired")).state, "permanent_failure");
});

test("deletion barrier and epoch state recover deterministically after crashes", () => {
  assert.equal(canSendLearningCommands({ state: "server_pending" }), false);
  assert.equal(canSendLearningCommands({ state: "idle" }), true);
  assert.equal(nextDeletionAction({ state: "local_cleanup", local_epoch: 2 }, 2), "finish_local_cleanup");
  assert.equal(nextDeletionAction({ state: "server_pending", local_epoch: 2 }, 2), "retry_server_delete");
  assert.equal(nextDeletionAction({ state: "server_confirmed", local_epoch: 2 }, 3), "commit_server_epoch");
  assert.equal(nextDeletionAction({ state: "idle", local_epoch: 2 }, 3), "purge_stale_local");
});

test("session contract enforces required five, optional zero to two, and restores first unfinished item",()=>{
 const items=Array.from({length:7},(_,i)=>({id:`i${i}`,position:i+1,required:i<5}));
 assert.deepEqual(validateV2SessionShape({items}),{requiredCount:5,optionalCount:2});
 assert.throws(()=>validateV2SessionShape({items:items.slice(0,4)}),error=>error.code==="REQUIRED_ITEM_COUNT_INVALID");
 assert.equal(nextRestoredPosition({items},{i0:{},i1:{}}),2);
 assert.equal(nextRestoredPosition({items},{i0:{},i1:{},i2:{},i3:{},i4:{}}),4);
 assert.equal(nextRestoredPosition({items},{i0:{},i1:{},i2:{},i3:{},i4:{},i5:{}}),6);
});

test("valid attempt guard stops after three while invalid attempts do not consume capacity",()=>{
 const rows=[1,2,3].map(()=>({session_item_id:"item",technical_valid:1}));
 rows.push({session_item_id:"item",technical_valid:0});
 assert.equal(canRequestAnotherTicket(rows,"item"),false);
 assert.equal(canRequestAnotherTicket(rows.filter((_,i)=>i!==2),"item"),true);
});

test("ticket request intent survives a lost issue response",async()=>{
 const db=sqliteAdapter();await db.execAsync(V2_TICKET_JOURNAL_SCHEMA);
 const journal=createV2TicketJournal(db,{now:()=>iso(0)});
 await journal.begin({ticketRequestId:"req",userId:"user",sessionItemId:"item",attemptPurpose:"initial",protectedMaterialHandle:"handle"});
 assert.equal((await journal.findReusable("user","item","initial")).ticket_request_id,"req");
 await journal.markReady("user","req",{captureExpiresAt:iso(60),submissionExpiresAt:iso(600)});
 assert.equal((await journal.get("user","req")).state,"ready");
});

test("deletion cleanup is locally atomic and resumes the same server request after a lost response", async () => {
  const db = sqliteAdapter();
  await db.execAsync(`${V2_DELETION_SCHEMA}\n${V2_AUDIO_INDEX_SCHEMA}\n${V2_OUTBOX_SCHEMA}`);
  const repository = createV2OutboxRepository(db);
  repository.setLimits(syncConfig());
  await db.runAsync(
    "INSERT INTO v2_local_snapshots(user_id,deletion_epoch,contract_version,snapshot_json,updated_at) VALUES (?,?,?,?,?)",
    "user", 0, "contract-v1", "{}", iso(0)
  );
  await repository.enqueue(command("delete-me", null), localResult());
  await db.runAsync(
    `INSERT INTO v2_audio_index(file_key,user_id,correction_cycle_id,content_version_id,attempt_role,
       created_at,delete_after,availability) VALUES (?,?,?,?,?,?,?,'available')`,
    "opaque.wav", "user", "local-cycle", "content", "before", iso(0), iso(600)
  );
  const deletedFiles = [];
  const audio = {
    listFileKeysForUser: async (userId) => db.getAllAsync(
      "SELECT file_key FROM v2_audio_index WHERE user_id = ?", userId
    ),
    deleteIndexForUser: (userId) => db.runAsync("DELETE FROM v2_audio_index WHERE user_id = ?", userId),
    async deleteFiles(keys) { deletedFiles.push(...keys); }
  };
  let calls = 0;
  const api = {
    async deleteLearningData(requestId, expectedEpoch) {
      calls += 1;
      assert.equal(requestId, "delete-request");
      assert.equal(expectedEpoch, 0);
      if (calls === 1) throw Object.assign(new Error("lost response"), { code: "NETWORK_UNAVAILABLE" });
      return { deletion_epoch: 1 };
    }
  };
  const coordinator = createV2DeletionCoordinator({
    database: db,outbox: repository,audio,api,clock: { now: () => iso(1) },
    protectedMaterialStore: { async delete() {} }
  });
  await coordinator.begin({ requestId: "delete-request", userId: "user", localEpoch: 0 });
  await assert.rejects(() => coordinator.resume("user"), /lost response/);
  assert.equal((await db.getFirstAsync("SELECT count(*) AS n FROM v2_outbox_commands")).n, 0);
  assert.equal((await db.getFirstAsync("SELECT count(*) AS n FROM v2_local_snapshots")).n, 0);
  assert.equal((await db.getFirstAsync("SELECT count(*) AS n FROM v2_audio_index")).n, 0);
  assert.deepEqual(deletedFiles, ["opaque.wav"]);
  assert.equal((await db.getFirstAsync("SELECT state FROM v2_deletion_control WHERE user_id='user'")).state, "server_pending");
  const completed = await coordinator.resume("user");
  assert.deepEqual(completed, { status: "completed", deletionEpoch: 1 });
  const control = await db.getFirstAsync("SELECT state,local_epoch,pending_audio_keys_json FROM v2_deletion_control WHERE user_id='user'");
  assert.deepEqual({ ...control }, { state: "idle", local_epoch: 1, pending_audio_keys_json: "[]" });
  assert.equal(calls, 2);
});

test("stale delete replay cannot decrease the local deletion epoch",async()=>{
  const db=sqliteAdapter();await db.execAsync(`${V2_DELETION_SCHEMA}\n${V2_AUDIO_INDEX_SCHEMA}\n${V2_OUTBOX_SCHEMA}`);
  const coordinator=createV2DeletionCoordinator({database:db,
    outbox:{async purgeAllForUser(){},async listProtectedMaterialCleanup(){return[];}},
    audio:{async listFileKeysForUser(){return[];},async deleteIndexForUser(){},async deleteFiles(){}},
    api:{async deleteLearningData(){return{deletion_epoch:1};}},clock:{now:()=>iso(1)},
    protectedMaterialStore:{async delete(){}}
  });
  await coordinator.begin({requestId:"stale-request",userId:"user",localEpoch:3});
  const result=await coordinator.resume("user");
  assert.equal(result.deletionEpoch,3);
  assert.equal((await db.getFirstAsync("SELECT local_epoch FROM v2_deletion_control WHERE user_id='user'")).local_epoch,3);
});

test("local audio policy expires at 30 days, Day 14, or missing without exposing paths", () => {
  assert.equal(audioDeletionReason({ availability: "available", deleteAfter: "2026-09-09T00:00:00Z", day14CompletedAt: null }, "2026-08-10T00:00:00Z"), null);
  assert.equal(audioDeletionReason({ availability: "available", deleteAfter: "2026-09-09T00:00:00Z", day14CompletedAt: "2026-08-24T00:00:00Z" }, "2026-08-24T00:00:00Z"), "day_14_completed");
  assert.equal(audioDeletionReason({ availability: "available", deleteAfter: "2026-08-10T00:00:00Z", day14CompletedAt: null }, "2026-08-10T00:00:01Z"), "retention_expired");
  assert.equal(audioDeletionReason({ availability: "missing", deleteAfter: "2026-09-09T00:00:00Z", day14CompletedAt: null }, "2026-08-10T00:00:00Z"), "not_available");
});

test("audio index survives restart and binds before/after through the confirmed command",async()=>{
  const db=sqliteAdapter();
  const stored=new Set();
  const storage={async storeAudio(_source,key){stored.add(key);},async deleteAudio(key){stored.delete(key);},
    async deleteTemporary(){},async audioExists(key){return stored.has(key);},async resolveAudio(key){return`opaque:${key}`;}};
  const first=createV2AudioRepository({database:db,protectedStorage:storage,clock:fixedDayClock(iso(0))});
  await first.migrate();
  await first.selectRepresentative({sourceUri:"temporary-before",fileKey:"before.wav",userId:"user",
    correctionCycleId:"local-cycle",contentVersionId:"content",attemptRole:"before",pendingCommandId:"before-command"});
  await first.selectRepresentative({sourceUri:"temporary-after",fileKey:"after.wav",userId:"user",
    correctionCycleId:"local-cycle",contentVersionId:"content",attemptRole:"after",pendingCommandId:"after-command"});
  await first.selectRepresentative({sourceUri:"other-user-before",fileKey:"other-before.wav",userId:"other-user",
    correctionCycleId:"local-cycle",contentVersionId:"content",attemptRole:"before",pendingCommandId:"other-command"});
  const reopened=createV2AudioRepository({database:db,protectedStorage:storage,clock:fixedDayClock(iso(1))});
  await reopened.migrate();
  assert.equal(await reopened.bindCorrectionCycleForCommand("user","after-command","server-cycle"),true);
  assert.equal(await reopened.resolveRepresentative("user","server-cycle","before"),"opaque:before.wav");
  assert.equal(await reopened.resolveRepresentative("user","server-cycle","after"),"opaque:after.wav");
  assert.equal(await reopened.resolveRepresentative("other-user","local-cycle","before"),"opaque:other-before.wav");
  assert.equal((await db.getFirstAsync(
    "SELECT count(*) AS n FROM v2_audio_index WHERE user_id='user' AND pending_command_id IS NOT NULL"
  )).n,0);
});

test("audio index migration preserves rows while adding user-scoped uniqueness",async()=>{
  const db=sqliteAdapter();
  await db.execAsync(`CREATE TABLE v2_audio_index(
    file_key TEXT PRIMARY KEY NOT NULL,user_id TEXT NOT NULL,correction_cycle_id TEXT NOT NULL,
    content_version_id TEXT NOT NULL,attempt_role TEXT NOT NULL,created_at TEXT NOT NULL,
    delete_after TEXT NOT NULL,day_14_completed_at TEXT,availability TEXT NOT NULL,
    UNIQUE(correction_cycle_id,attempt_role));
    INSERT INTO v2_audio_index VALUES('before.wav','user','cycle','content','before','${iso(0)}','${iso(600)}',NULL,'available');`);
  const repository=createV2AudioRepository({database:db,protectedStorage:{},clock:fixedDayClock(iso(0))});
  await repository.migrate();
  assert.equal((await db.getFirstAsync("SELECT count(*) AS n FROM v2_audio_index WHERE user_id='user'")).n,1);
  const schema=await db.getFirstAsync("SELECT sql FROM sqlite_master WHERE type='table' AND name='v2_audio_index'");
  assert.match(schema.sql.replace(/\s+/g,""),/UNIQUE\(user_id,correction_cycle_id,attempt_role\)/);
  assert.equal((await db.getAllAsync("PRAGMA table_info(v2_audio_index)"))
    .some((column)=>column.name==="pending_command_id"),true);
});

test("a pre-enqueue failure cancels the server ticket before deleting its protected nonce",async()=>{
  const events=[];
  const pipeline=createV2AttemptPipeline({
    api:{async speechToken(){return ticket();},async cancelSpeechToken(){events.push("server-cancel");}},
    native:{async prepare(){},async start(){},async finish(){return{rawJson:{RecognitionStatus:"Success"}};},
      async cancel(){},async deleteTemporary(){}},
    normalizer(){throw Object.assign(new Error("projection rejected"),{code:"BAD_PROJECTION"});},
    outbox:{async enqueue(){throw new Error("must not enqueue");}},
    ticketJournal:{async findReusable(){return null;},async begin(){},async markReady(){},
      async markCancelled(){events.push("journal-cancelled");}},
    protectedTicketStore:{async save(){},async read(){return"local-nonce";},async delete(){events.push("nonce-deleted");}},
    ids:{materialHandle:()=>"handle",requestId:()=>"request",ticketRequestId:()=>"ticket-request",
      ticketNonce:()=>"local-nonce",commandId:()=>"command",clientAttemptId:()=>"attempt"},
    clock:{now:()=>iso(0)},triggerSync(){}
  });
  await pipeline.start({item:item(),userId:"user"});
  await assert.rejects(()=>pipeline.finish({payloadByteLimit:1000,userId:"user",sessionId:"session",
    deletionEpoch:0,onLocalResult(){}}),/projection rejected/);
  assert.deepEqual(events,["server-cancel","journal-cancelled","nonce-deleted"]);
});

test("attempt pipeline displays local result and schedules sync without awaiting server ACK", async () => {
  const events = [];
  let releaseSync;
  const sync = new Promise((resolve) => { releaseSync = resolve; });
  const pipeline = createV2AttemptPipeline({
    api: { async speechToken() { return ticket(); },async recoverSpeechToken(){return ticket();} },
    native: {
      async prepare() {}, async start() {}, async cancel() {}, async deleteTemporary() {},
      async finish() { return { rawJson: { RecognitionStatus: "Success" }, localAudioUri: "temporary-local-file" }; }
    },
    normalizer() {
      return {
        projection: { projectionVersion: "projection-v1", recognitionStatus: "success", displayText: "light", target: null },
        normalized: {
          expectedFocusRepresentation: "l", observedCandidate: "r", targetScore: 60,
          resultLabel: "measured", nextActionKey: "tongue-tip", normalizerVersion: "normalizer-v1"
        },
        metrics: { providerPayloadBytes: 800, projectionBytes: 160 }
      };
    },
    outbox: { async enqueue() { events.push("enqueue"); } },
    ticketJournal:{async findReusable(){return null;},async begin(){},async markReady(){},async markConsumed(){}},
    protectedTicketStore: { async save() {},async read(){return null;}, async delete() {} },
    ids: { materialHandle: () => "handle",requestId:()=>"request",commandId:()=>"command",clientAttemptId:()=>"attempt",ticketRequestId:()=>"ticket-request",ticketNonce:()=>"nonce" },
    clock: { now: () => iso(0) },
    triggerSync: async () => { events.push("sync-started"); await sync; }
  });
  await pipeline.start({ item: item(),userId:"user" });
  const completed = await pipeline.finish({
    payloadByteLimit: 1000, userId: "user", sessionId: "session", deletionEpoch: 0,
    onLocalResult() { events.push("local-result"); }
  });
  assert.equal(completed.commandId, "command");
  assert.deepEqual(events, ["enqueue", "local-result", "sync-started"]);
  releaseSync();
});

function sqliteAdapter() {
  const db = new DatabaseSync(":memory:");
  return {
    async execAsync(sql) { db.exec(sql); },
    async runAsync(sql, ...params) { return db.prepare(sql).run(...params); },
    async getFirstAsync(sql, ...params) { return db.prepare(sql).get(...params); },
    async getAllAsync(sql, ...params) { return db.prepare(sql).all(...params); },
    async withTransactionAsync(operation) {
      db.exec("BEGIN");
      try { const result = await operation(); db.exec("COMMIT"); return result; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    }
  };
}

function command(id, dependency) {
  return {
    commandId: id, commandKind: "attempt", userId: "user", clientAttemptId: `attempt-${id}`,
    sessionId: "session", sessionItemId: "item", contentVersionId: "content", focusGroupKey: "focus",
    assessmentLocale: "en-US", deletionEpoch: 0, referenceVersion: "reference-v1",
    normalizerVersion: "normalizer-v1", projectionVersion: "projection-v1", contractVersion: "contract-v1",
    assessmentTicketId: `ticket-${id}`, protectedMaterialHandle: `material-${id}`,
    recordingStartedAt:iso(0),capturedAt:iso(1),providerResultReceivedAt:iso(2),
    captureExpiresAt: iso(60), submissionExpiresAt: iso(600), dependencyCommandId: dependency,
    strictProjection: { projectionVersion: "projection-v1", recognitionStatus: "success" }, createdAt: iso(0)
  };
}
function control(id, kind, dependency) {
  return {
    commandId: id, commandKind: kind, userId: "user", sessionId: "session", sessionItemId: "item",
    contentVersionId: "content", focusGroupKey: "focus", assessmentLocale: "en-US", deletionEpoch: 0,
    referenceVersion: "reference-v1", normalizerVersion: "normalizer-v1", projectionVersion: "control-v1",
    contractVersion: "contract-v1", submissionExpiresAt: iso(600), dependencyCommandId: dependency,
    controlPayload: { completion_idempotency_key: `${id}-key` }, createdAt: iso(0)
  };
}
function localResult() { return { expectedFocus: "l", observedCandidate: "r", targetScore: 70, resultLabel: "measured", nextActionKey: "tongue" }; }
function syncConfig() { return { maxItems: 20, maxBytes: 20_000, submissionWindowSeconds: 600, initialBackoffSeconds: 1, maxBackoffSeconds: 30 }; }
function iso(seconds) { return new Date(seconds * 1000).toISOString(); }
function ticket() {
  return {
    token: "ephemeral", region: "region", locale: "en-US", reference_text: "light", contract_version: "contract-v1",
    assessment_ticket: { id: "ticket", nonce: "nonce", expires_at: iso(60), submission_expires_at: iso(600) }
  };
}
function item() {
  return {
    id: "item", target_locator: { wordIndex: 0, phonemeIndex: 0 }, reference_text: "light",
    content_version_id: "content", practice_item_key: "light", expected_focus_representation: "l",
    focus_group_key: "r-l", next_action_key: "tongue", reference_text_version: "reference-v1"
  };
}
