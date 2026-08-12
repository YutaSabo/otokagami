export const V2_TICKET_JOURNAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS v2_ticket_requests (
  ticket_request_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  session_item_id TEXT NOT NULL,
  attempt_purpose TEXT NOT NULL CHECK (attempt_purpose IN ('initial','guided_retry')),
  protected_material_handle TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('requesting','ready','consumed','expired')),
  capture_expires_at TEXT,
  submission_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS v2_ticket_user_state_idx ON v2_ticket_requests(user_id,state,created_at);
`;

export function createV2TicketJournal(database, clock) {
  return Object.freeze({
    migrate: () => database.execAsync(V2_TICKET_JOURNAL_SCHEMA),
    async begin({ ticketRequestId, userId, sessionItemId, attemptPurpose, protectedMaterialHandle }) {
      await database.runAsync(
        `INSERT INTO v2_ticket_requests(ticket_request_id,user_id,session_item_id,attempt_purpose,
           protected_material_handle,state,created_at,updated_at)
         VALUES(?,?,?,?,?,'requesting',?,?) ON CONFLICT(ticket_request_id) DO NOTHING`,
        ticketRequestId,userId,sessionItemId,attemptPurpose,protectedMaterialHandle,clock.now(),clock.now()
      );
      return this.get(userId,ticketRequestId);
    },
    get(userId,ticketRequestId) {
      return database.getFirstAsync(
        "SELECT * FROM v2_ticket_requests WHERE user_id=? AND ticket_request_id=?",userId,ticketRequestId
      );
    },
    findReusable(userId,sessionItemId,attemptPurpose){return database.getFirstAsync(
      `SELECT * FROM v2_ticket_requests WHERE user_id=? AND session_item_id=? AND attempt_purpose=?
       AND state IN ('requesting','ready') ORDER BY created_at DESC LIMIT 1`,userId,sessionItemId,attemptPurpose
    );},
    listPending(userId){return database.getAllAsync(
      "SELECT * FROM v2_ticket_requests WHERE user_id=? AND state IN ('requesting','ready') ORDER BY created_at",userId
    );},
    markReady(userId,ticketRequestId,{captureExpiresAt,submissionExpiresAt}) {
      return database.runAsync(
        `UPDATE v2_ticket_requests SET state='ready',capture_expires_at=?,submission_expires_at=?,updated_at=?
         WHERE user_id=? AND ticket_request_id=? AND state IN ('requesting','ready')`,
        captureExpiresAt,submissionExpiresAt,clock.now(),userId,ticketRequestId
      );
    },
    markConsumed(userId,ticketRequestId) {
      return database.runAsync(
        "UPDATE v2_ticket_requests SET state='consumed',updated_at=? WHERE user_id=? AND ticket_request_id=?",
        clock.now(),userId,ticketRequestId
      );
    },
    markCancelled(userId,ticketRequestId) {
      return database.runAsync(
        "UPDATE v2_ticket_requests SET state='expired',updated_at=? WHERE user_id=? AND ticket_request_id=?",
        clock.now(),userId,ticketRequestId
      );
    },
    async expire(now,protectedStore) {
      const rows=await database.getAllAsync(
        `SELECT * FROM v2_ticket_requests WHERE state IN ('requesting','ready')
         AND submission_expires_at IS NOT NULL AND submission_expires_at<=?`,now
      );
      for(const row of rows){
        await database.runAsync("UPDATE v2_ticket_requests SET state='expired',updated_at=? WHERE ticket_request_id=?",now,row.ticket_request_id);
      }
      await this.cleanupExpired(protectedStore);
      return rows.length;
    },
    async cleanupExpired(protectedStore){
      const rows=await database.getAllAsync("SELECT ticket_request_id,protected_material_handle FROM v2_ticket_requests WHERE state='expired'");
      for(const row of rows){
        await protectedStore.delete(row.protected_material_handle);
        await database.runAsync("DELETE FROM v2_ticket_requests WHERE ticket_request_id=? AND state='expired'",row.ticket_request_id);
      }
      return rows.length;
    },
    deleteForUser(userId) { return database.runAsync("DELETE FROM v2_ticket_requests WHERE user_id=?",userId); }
  });
}
