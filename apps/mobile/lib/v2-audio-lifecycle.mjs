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
  pending_command_id TEXT,
  availability TEXT NOT NULL CHECK (availability IN ('available','missing','deleted')),
  UNIQUE(user_id, correction_cycle_id, attempt_role)
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
    async migrate(){
      await database.execAsync(V2_AUDIO_INDEX_SCHEMA);
      const columns=await database.getAllAsync("PRAGMA table_info(v2_audio_index)");
      if(!columns.some((column)=>column.name==="pending_command_id")){
        await database.execAsync("ALTER TABLE v2_audio_index ADD COLUMN pending_command_id TEXT;");
      }
      const table=await database.getFirstAsync(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='v2_audio_index'"
      );
      if(!String(table?.sql??"").replace(/\s+/g,"").includes("UNIQUE(user_id,correction_cycle_id,attempt_role)")){
        await database.withTransactionAsync(async()=>{
          await database.execAsync(`CREATE TABLE v2_audio_index_v4 (
            file_key TEXT PRIMARY KEY NOT NULL,user_id TEXT NOT NULL,correction_cycle_id TEXT NOT NULL,
            content_version_id TEXT NOT NULL,attempt_role TEXT NOT NULL CHECK (attempt_role IN ('before','after')),
            created_at TEXT NOT NULL,delete_after TEXT NOT NULL,day_14_completed_at TEXT,
            pending_command_id TEXT,availability TEXT NOT NULL CHECK (availability IN ('available','missing','deleted')),
            UNIQUE(user_id,correction_cycle_id,attempt_role));`);
          await database.execAsync(`INSERT INTO v2_audio_index_v4
            SELECT file_key,user_id,correction_cycle_id,content_version_id,attempt_role,created_at,
              delete_after,day_14_completed_at,pending_command_id,availability FROM v2_audio_index;`);
          await database.execAsync("DROP TABLE v2_audio_index; ALTER TABLE v2_audio_index_v4 RENAME TO v2_audio_index;");
        });
      }
      await database.execAsync("CREATE INDEX IF NOT EXISTS v2_audio_delete_idx ON v2_audio_index(availability,delete_after);");
      await database.execAsync("CREATE INDEX IF NOT EXISTS v2_audio_pending_command_idx ON v2_audio_index(user_id,pending_command_id);");
    },
    async selectRepresentative({ sourceUri, fileKey, userId, correctionCycleId, contentVersionId, attemptRole, pendingCommandId }) {
      if (!new Set(["before", "after"]).has(attemptRole)) throw new TypeError("Invalid representative role.");
      const now = clock.now();
      const deleteAfter = clock.addDays(now, 30);
      const previous = await database.getFirstAsync(
        "SELECT file_key FROM v2_audio_index WHERE user_id=? AND correction_cycle_id = ? AND attempt_role = ?",
        userId,correctionCycleId,attemptRole
      );
      await protectedStorage.storeAudio(sourceUri, fileKey);
      await database.withTransactionAsync(async () => {
        await database.runAsync(
          `INSERT INTO v2_audio_index (
             file_key, user_id, correction_cycle_id, content_version_id, attempt_role,
             created_at, delete_after, pending_command_id, availability
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'available')
           ON CONFLICT(user_id,correction_cycle_id, attempt_role) DO UPDATE SET
             file_key = excluded.file_key, content_version_id = excluded.content_version_id,
             created_at = excluded.created_at, delete_after = excluded.delete_after,
             day_14_completed_at = NULL, pending_command_id=excluded.pending_command_id,
             availability = 'available'`,
          fileKey,userId,correctionCycleId,contentVersionId,attemptRole,now,deleteAfter,pendingCommandId??null
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
    async resolveRepresentative(userId,correctionCycleId,attemptRole){
      const row=await database.getFirstAsync(
        "SELECT file_key FROM v2_audio_index WHERE user_id=? AND correction_cycle_id=? AND attempt_role=? AND availability='available'",
        userId,correctionCycleId,attemptRole
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
    async bindCorrectionCycleForCommand(userId,pendingCommandId,serverCycleId){
      if(!userId||!pendingCommandId||!serverCycleId)throw new TypeError("User, command and server cycle are required.");
      const pending=await database.getFirstAsync(
        "SELECT correction_cycle_id FROM v2_audio_index WHERE user_id=? AND pending_command_id=?",userId,pendingCommandId
      );
      if(!pending)return false;
      await database.runAsync(
        "UPDATE v2_audio_index SET correction_cycle_id=?,pending_command_id=NULL WHERE user_id=? AND correction_cycle_id=?",
        serverCycleId,userId,pending.correction_cycle_id
      );
      return true;
    },
    async discardForCommand(userId,pendingCommandId){
      const rows=await database.getAllAsync(
        "SELECT file_key FROM v2_audio_index WHERE user_id=? AND pending_command_id=?",userId,pendingCommandId
      );
      for(const row of rows)await protectedStorage.deleteAudio(row.file_key);
      await database.runAsync(
        "DELETE FROM v2_audio_index WHERE user_id=? AND pending_command_id=?",userId,pendingCommandId
      );
      return rows.length;
    },
    async bindCorrectionCycle(userId,localCycleId,serverCycleId) {
      if (!userId||typeof localCycleId !== "string" || typeof serverCycleId !== "string" || !localCycleId || !serverCycleId) {
        throw new TypeError("User and both local and server correction cycle identifiers are required.");
      }
      await database.runAsync(
        "UPDATE v2_audio_index SET correction_cycle_id = ?,pending_command_id=NULL WHERE user_id=? AND correction_cycle_id = ?",
        serverCycleId,userId,localCycleId
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
