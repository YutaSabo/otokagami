export const V2_DELETION_SCHEMA = `
CREATE TABLE IF NOT EXISTS v2_deletion_control (
  singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
  request_id TEXT,
  user_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('idle','local_cleanup','server_pending','server_confirmed')),
  local_epoch INTEGER NOT NULL CHECK (local_epoch >= 0),
  server_epoch INTEGER CHECK (server_epoch IS NULL OR server_epoch >= 0),
  pending_audio_keys_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(pending_audio_keys_json)),
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO v2_deletion_control (
  singleton_id, state, local_epoch, updated_at
) VALUES (1, 'idle', 0, '1970-01-01T00:00:00.000Z');
`;

export async function migrateV2DeletionSchema(database) {
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

export function createV2DeletionCoordinator({ database, outbox, audio, api, clock }) {
  return Object.freeze({
    migrate: () => database.execAsync(V2_DELETION_SCHEMA),
    async begin({ requestId, userId, localEpoch }) {
      return database.withTransactionAsync(async () => {
        const current = await database.getFirstAsync("SELECT * FROM v2_deletion_control WHERE singleton_id = 1");
        if (current.state !== "idle" && current.request_id !== requestId) {
          throw Object.assign(new Error("Deletion already in progress."), { code: "DELETION_IN_PROGRESS" });
        }
        await database.runAsync(
          `UPDATE v2_deletion_control SET request_id = ?, user_id = ?, state = 'local_cleanup',
             local_epoch = ?, server_epoch = NULL, updated_at = ? WHERE singleton_id = 1`,
          requestId, userId, localEpoch, clock.now()
        );
      });
    },
    async resume() {
      const record = await database.getFirstAsync("SELECT * FROM v2_deletion_control WHERE singleton_id = 1");
      if (!record || record.state === "idle") return { status: "idle" };
      if (record.state === "local_cleanup") {
        const audioRows = await audio.listFileKeysForUser(record.user_id);
        const audioKeys = audioRows.map((row) => row.file_key);
        await database.withTransactionAsync(async () => {
          await outbox.purgeAllForUser(record.user_id);
          await database.runAsync("DELETE FROM v2_local_snapshots WHERE user_id = ?", record.user_id);
          await audio.deleteIndexForUser(record.user_id);
          await database.runAsync(
            `UPDATE v2_deletion_control SET state = 'server_pending', pending_audio_keys_json = ?, updated_at = ?
             WHERE singleton_id = 1`,
            JSON.stringify(audioKeys), clock.now()
          );
        });
        return this.resume();
      }
      if (record.state === "server_pending") {
        const audioKeys = JSON.parse(record.pending_audio_keys_json ?? "[]");
        await audio.deleteFiles(audioKeys);
        const result = await api.deleteLearningData(record.request_id, record.local_epoch);
        await database.runAsync(
          `UPDATE v2_deletion_control SET state = 'server_confirmed', server_epoch = ?, updated_at = ?
           WHERE singleton_id = 1 AND request_id = ?`,
          result.deletion_epoch, clock.now(), record.request_id
        );
        return this.resume();
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
          `UPDATE v2_deletion_control SET request_id = NULL, user_id = NULL, state = 'idle',
             local_epoch = server_epoch, server_epoch = NULL, pending_audio_keys_json = '[]', updated_at = ?
           WHERE singleton_id = 1`,
          clock.now()
        );
      });
      return { status: "completed", deletionEpoch: record.server_epoch };
    }
  });
}
