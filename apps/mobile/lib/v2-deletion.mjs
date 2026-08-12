export const V2_DELETION_SCHEMA = `
CREATE TABLE IF NOT EXISTS v2_deletion_control (
  user_id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('idle','local_cleanup','server_pending','server_confirmed')),
  local_epoch INTEGER NOT NULL CHECK (local_epoch >= 0),
  server_epoch INTEGER CHECK (server_epoch IS NULL OR server_epoch >= 0),
  pending_audio_keys_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(pending_audio_keys_json)),
  updated_at TEXT NOT NULL
);
`;

export async function migrateV2DeletionSchema(database) {
  const existing = await database.getAllAsync("PRAGMA table_info(v2_deletion_control)");
  if (existing.some((column)=>column.name==="singleton_id")) {
    const pending=await database.getFirstAsync("SELECT state FROM v2_deletion_control WHERE singleton_id=1 AND state!='idle'");
    if(pending) throw Object.assign(new Error("Legacy deletion must finish before account-scoped migration."),{code:"LOCAL_DELETION_MIGRATION_REQUIRED"});
    await database.execAsync("DROP TABLE v2_deletion_control;");
  }
  await database.execAsync(V2_DELETION_SCHEMA);
  const columns = await database.getAllAsync("PRAGMA table_info(v2_deletion_control)");
  if (!columns.some((column) => column.name === "pending_audio_keys_json")) {
    await database.execAsync(
      "ALTER TABLE v2_deletion_control ADD COLUMN pending_audio_keys_json TEXT NOT NULL DEFAULT '[]'"
    );
  }
}

export function nextDeletionAction(record, bootstrapEpoch) {
  if (!record || record.state === "idle") {
    return bootstrapEpoch > Number(record?.local_epoch ?? 0) ? "purge_stale_local" : "none";
  }
  if (record.state === "local_cleanup") return "finish_local_cleanup";
  if (record.state === "server_pending") return "retry_server_delete";
  if (record.state === "server_confirmed") return "commit_server_epoch";
  throw new TypeError("Unknown deletion state.");
}

export function canSendLearningCommands(record) {
  return !record || record.state === "idle";
}

export function createV2DeletionCoordinator({ database, outbox, audio, api, clock, protectedMaterialStore }) {
  return Object.freeze({
    migrate: () => database.execAsync(V2_DELETION_SCHEMA),
    async begin({ requestId, userId, localEpoch }) {
      return database.withTransactionAsync(async () => {
        const current = await database.getFirstAsync("SELECT * FROM v2_deletion_control WHERE user_id=?",userId);
        if (current && current.state !== "idle" && current.request_id !== requestId) {
          throw Object.assign(new Error("Deletion already in progress."), { code: "DELETION_IN_PROGRESS" });
        }
        await database.runAsync(
          `INSERT INTO v2_deletion_control(user_id,request_id,state,local_epoch,server_epoch,pending_audio_keys_json,updated_at)
           VALUES(?,?,'local_cleanup',?,NULL,'[]',?) ON CONFLICT(user_id) DO UPDATE SET
             request_id=excluded.request_id,state='local_cleanup',local_epoch=excluded.local_epoch,
             server_epoch=NULL,pending_audio_keys_json='[]',updated_at=excluded.updated_at`,
          userId,requestId,localEpoch,clock.now()
        );
      });
    },
    async resume(userId) {
      const record = await database.getFirstAsync("SELECT * FROM v2_deletion_control WHERE user_id=?",userId);
      if (!record || record.state === "idle") return { status: "idle" };
      if (record.state === "local_cleanup") {
        const audioRows = await audio.listFileKeysForUser(record.user_id);
        const audioKeys = audioRows.map((row) => row.file_key);
        await database.withTransactionAsync(async () => {
          await outbox.purgeAllForUser(record.user_id,true);
          await database.runAsync("DELETE FROM v2_local_snapshots WHERE user_id = ?", record.user_id);
          await audio.deleteIndexForUser(record.user_id);
          await database.runAsync(
            `UPDATE v2_deletion_control SET state = 'server_pending', pending_audio_keys_json = ?, updated_at = ?
             WHERE user_id=?`,
            JSON.stringify(audioKeys),clock.now(),record.user_id
          );
        });
        for (const cleanup of await outbox.listProtectedMaterialCleanup(record.user_id)) {
          await protectedMaterialStore?.delete(cleanup.protected_material_handle);
          await outbox.finishProtectedMaterialCleanup(record.user_id,cleanup.protected_material_handle);
        }
        return this.resume(record.user_id);
      }
      if (record.state === "server_pending") {
        const audioKeys = JSON.parse(record.pending_audio_keys_json ?? "[]");
        await audio.deleteFiles(audioKeys);
        const result = await api.deleteLearningData(record.request_id, record.local_epoch);
        await database.runAsync(
          `UPDATE v2_deletion_control SET state = 'server_confirmed', server_epoch = ?, updated_at = ?
           WHERE user_id=? AND request_id = ?`,
          result.deletion_epoch,clock.now(),record.user_id,record.request_id
        );
        return this.resume(record.user_id);
      }
      await database.withTransactionAsync(async () => {
        await database.runAsync(
          `INSERT INTO v2_local_snapshots (user_id, deletion_epoch, contract_version, snapshot_json, updated_at)
           VALUES (?, ?, 'deletion-barrier', '{}', ?)
           ON CONFLICT(user_id) DO UPDATE SET deletion_epoch = excluded.deletion_epoch,
             contract_version = excluded.contract_version, snapshot_json = excluded.snapshot_json,
             updated_at = excluded.updated_at`,
          record.user_id, record.server_epoch, clock.now()
        );
        await database.runAsync(
          `UPDATE v2_deletion_control SET request_id = NULL, state = 'idle',
             local_epoch = server_epoch, server_epoch = NULL, pending_audio_keys_json = '[]', updated_at = ?
           WHERE user_id=?`,
          clock.now(),record.user_id
        );
      });
      return { status: "completed", deletionEpoch: record.server_epoch };
    }
  });
}
