const DAY_MS = 86_400_000;

export const V2_AUDIO_INDEX_SCHEMA = `
CREATE TABLE IF NOT EXISTS v2_audio_index (
  file_key TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  correction_cycle_id TEXT NOT NULL,
  content_version_id TEXT NOT NULL,
  attempt_role TEXT NOT NULL CHECK (attempt_role IN ('before','after')),
  created_at TEXT NOT NULL,
  delete_after TEXT NOT NULL,
  day_14_completed_at TEXT,
  availability TEXT NOT NULL CHECK (availability IN ('available','missing','deleted')),
  UNIQUE(correction_cycle_id, attempt_role)
);
CREATE INDEX IF NOT EXISTS v2_audio_delete_idx ON v2_audio_index(availability, delete_after);
`;

export function audioDeletionReason(record, now) {
  if (record.availability !== "available") return "not_available";
  if (record.day14CompletedAt) return "day_14_completed";
  if (Date.parse(record.deleteAfter) <= Date.parse(now)) return "retention_expired";
  return null;
}

export function createV2AudioRepository({ database, protectedStorage, clock }) {
  return Object.freeze({
    migrate: () => database.execAsync(V2_AUDIO_INDEX_SCHEMA),
    async selectRepresentative({ sourceUri, fileKey, userId, correctionCycleId, contentVersionId, attemptRole }) {
      if (!new Set(["before", "after"]).has(attemptRole)) throw new TypeError("Invalid representative role.");
      const now = clock.now();
      const deleteAfter = clock.addDays(now, 30);
      const previous = await database.getFirstAsync(
        "SELECT file_key FROM v2_audio_index WHERE correction_cycle_id = ? AND attempt_role = ?",
        correctionCycleId, attemptRole
      );
      await protectedStorage.storeAudio(sourceUri, fileKey);
      await database.withTransactionAsync(async () => {
        await database.runAsync(
          `INSERT INTO v2_audio_index (
             file_key, user_id, correction_cycle_id, content_version_id, attempt_role,
             created_at, delete_after, availability
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'available')
           ON CONFLICT(correction_cycle_id, attempt_role) DO UPDATE SET
             file_key = excluded.file_key, content_version_id = excluded.content_version_id,
             created_at = excluded.created_at, delete_after = excluded.delete_after,
             day_14_completed_at = NULL, availability = 'available'`,
          fileKey, userId, correctionCycleId, contentVersionId, attemptRole, now, deleteAfter
        );
      });
      if (previous?.file_key && previous.file_key !== fileKey) await protectedStorage.deleteAudio(previous.file_key);
      return { fileKey, deleteAfter };
    },
    async discardTemporary(sourceUri) {
      await protectedStorage.deleteTemporary(sourceUri);
    },
    async resolve(fileKey) {
      const row = await database.getFirstAsync("SELECT availability FROM v2_audio_index WHERE file_key = ?", fileKey);
      if (!row || row.availability !== "available") return null;
      const exists = await protectedStorage.audioExists(fileKey);
      if (!exists) {
        await database.runAsync("UPDATE v2_audio_index SET availability = 'missing' WHERE file_key = ?", fileKey);
        return null;
      }
      return protectedStorage.resolveAudio(fileKey);
    },
    async resolveRepresentative(correctionCycleId,attemptRole){
      const row=await database.getFirstAsync(
        "SELECT file_key FROM v2_audio_index WHERE correction_cycle_id=? AND attempt_role=? AND availability='available'",
        correctionCycleId,attemptRole
      );
      return row?this.resolve(row.file_key):null;
    },
    async sweep() {
      const rows = await database.getAllAsync(
        `SELECT file_key FROM v2_audio_index
         WHERE availability = 'available' AND (day_14_completed_at IS NOT NULL OR delete_after <= ?)`,
        clock.now()
      );
      for (const row of rows) {
        await protectedStorage.deleteAudio(row.file_key);
        await database.runAsync("UPDATE v2_audio_index SET availability = 'deleted' WHERE file_key = ?", row.file_key);
      }
      return rows.length;
    },
    async markDay14Complete(correctionCycleId) {
      await database.runAsync(
        "UPDATE v2_audio_index SET day_14_completed_at = ? WHERE correction_cycle_id = ?",
        clock.now(), correctionCycleId
      );
      return this.sweep();
    },
    async bindCorrectionCycle(localCycleId, serverCycleId) {
      if (typeof localCycleId !== "string" || typeof serverCycleId !== "string" || !localCycleId || !serverCycleId) {
        throw new TypeError("Both local and server correction cycle identifiers are required.");
      }
      await database.runAsync(
        "UPDATE v2_audio_index SET correction_cycle_id = ? WHERE correction_cycle_id = ?",
        serverCycleId, localCycleId
      );
    },
    async listFileKeysForUser(userId) {
      return database.getAllAsync(
        "SELECT file_key FROM v2_audio_index WHERE user_id = ? AND availability = 'available' ORDER BY file_key",
        userId
      );
    },
    deleteIndexForUser(userId) {
      return database.runAsync("DELETE FROM v2_audio_index WHERE user_id = ?", userId);
    },
    async deleteFiles(fileKeys) {
      for (const fileKey of fileKeys) await protectedStorage.deleteAudio(fileKey);
    },
    async deleteAllForUser(userId) {
      const rows = await this.listFileKeysForUser(userId);
      await this.deleteIndexForUser(userId);
      await this.deleteFiles(rows.map((row) => row.file_key));
    }
  });
}

export function fixedDayClock(now) {
  return {
    now: () => now,
    addDays: (instant, days) => new Date(Date.parse(instant) + days * DAY_MS).toISOString()
  };
}
