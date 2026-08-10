export const V2_OUTBOX_STATES = Object.freeze([
  "pending", "sending", "retryable", "confirmed", "permanent_failure"
]);

export const V2_OUTBOX_SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS v2_outbox_commands (
  command_id TEXT PRIMARY KEY NOT NULL,
  command_kind TEXT NOT NULL CHECK (command_kind IN ('attempt','review_completion','session_completion')),
  user_id TEXT NOT NULL,
  client_attempt_id TEXT UNIQUE,
  session_id TEXT NOT NULL,
  session_item_id TEXT,
  content_version_id TEXT NOT NULL,
  focus_group_key TEXT NOT NULL,
  assessment_locale TEXT NOT NULL CHECK (assessment_locale = 'en-US'),
  deletion_epoch INTEGER NOT NULL CHECK (deletion_epoch >= 0),
  reference_version TEXT NOT NULL,
  normalizer_version TEXT NOT NULL,
  projection_version TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  assessment_ticket_id TEXT,
  protected_material_handle TEXT,
  captured_at TEXT,
  capture_expires_at TEXT,
  submission_expires_at TEXT NOT NULL,
  dependency_command_id TEXT REFERENCES v2_outbox_commands(command_id) ON DELETE CASCADE,
  strict_projection_json TEXT,
  control_payload_json TEXT,
  server_resource_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending','sending','retryable','confirmed','permanent_failure')),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_attempt_at TEXT,
  lease_id TEXT,
  lease_expires_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((command_kind = 'attempt') = (client_attempt_id IS NOT NULL)),
  CHECK ((state = 'sending') = (lease_id IS NOT NULL)),
  CHECK (strict_projection_json IS NULL OR json_valid(strict_projection_json)),
  CHECK (control_payload_json IS NULL OR json_valid(control_payload_json))
);
CREATE INDEX IF NOT EXISTS v2_outbox_ready_idx
  ON v2_outbox_commands(state, next_attempt_at, created_at);
CREATE TABLE IF NOT EXISTS v2_local_results (
  command_id TEXT PRIMARY KEY NOT NULL REFERENCES v2_outbox_commands(command_id) ON DELETE CASCADE,
  expected_focus TEXT NOT NULL,
  observed_candidate TEXT,
  target_score REAL CHECK (target_score IS NULL OR (target_score >= 0 AND target_score <= 100)),
  result_label TEXT NOT NULL,
  next_action_key TEXT,
  sync_state TEXT NOT NULL CHECK (sync_state IN ('pending','confirmed','permanent_failure')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v2_local_snapshots (
  user_id TEXT PRIMARY KEY NOT NULL,
  deletion_epoch INTEGER NOT NULL CHECK (deletion_epoch >= 0),
  contract_version TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  updated_at TEXT NOT NULL
);
PRAGMA user_version = 2;
`;

export async function migrateV2OutboxSchema(database) {
  await database.execAsync(V2_OUTBOX_SCHEMA);
  const columns = await database.getAllAsync("PRAGMA table_info(v2_outbox_commands)");
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("captured_at")) {
    await database.execAsync("ALTER TABLE v2_outbox_commands ADD COLUMN captured_at TEXT;");
  }
  if (!names.has("control_payload_json")) {
    await database.execAsync("ALTER TABLE v2_outbox_commands ADD COLUMN control_payload_json TEXT;");
  }
  if (!names.has("server_resource_id")) {
    await database.execAsync("ALTER TABLE v2_outbox_commands ADD COLUMN server_resource_id TEXT;");
  }
  await database.execAsync("PRAGMA user_version = 2;");
}

export function assertV2SyncConfig(config) {
  const fields = ["maxItems", "maxBytes", "submissionWindowSeconds", "initialBackoffSeconds", "maxBackoffSeconds"];
  for (const field of fields) {
    if (!Number.isSafeInteger(config?.[field]) || config[field] <= 0) {
      throw Object.assign(new Error(`Missing server-configured outbox value: ${field}`), {
        code: "V2_SYNC_CONFIG_REQUIRED"
      });
    }
  }
  if (config.initialBackoffSeconds > config.maxBackoffSeconds) {
    throw new RangeError("initialBackoffSeconds cannot exceed maxBackoffSeconds.");
  }
  return Object.freeze({ ...config });
}

export function createV2OutboxRepository(database) {
  assertDatabase(database);
  let limits = null;
  return Object.freeze({
    migrate: () => migrateV2OutboxSchema(database),
    setLimits(next) { limits = assertV2SyncConfig(next); },

    async enqueue(command, localResult) {
      validateCommand(command);
      validateLocalResult(localResult);
      return database.withTransactionAsync(async () => {
        await assertCapacity(database, limits, utf8Bytes(JSON.stringify(command.strictProjection ?? {})));
        const barrier = await database.getFirstAsync(
          "SELECT request_id FROM v2_deletion_control WHERE singleton_id = 1 AND state != 'idle'"
        ).catch(() => null);
        if (barrier) throw codedError("DELETION_IN_PROGRESS");
        const epoch = await database.getFirstAsync(
          "SELECT deletion_epoch FROM v2_local_snapshots WHERE user_id = ?",
          command.userId
        );
        if (epoch && Number(epoch.deletion_epoch) !== command.deletionEpoch) {
          throw codedError("DELETION_EPOCH_CONFLICT");
        }
        await database.runAsync(
          `INSERT INTO v2_outbox_commands (
            command_id, command_kind, user_id, client_attempt_id, session_id, session_item_id,
            content_version_id, focus_group_key, assessment_locale, deletion_epoch, reference_version,
            normalizer_version, projection_version, contract_version, assessment_ticket_id,
            protected_material_handle, captured_at, capture_expires_at, submission_expires_at, dependency_command_id,
            strict_projection_json, control_payload_json, state, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
          command.commandId, command.commandKind, command.userId, command.clientAttemptId ?? null,
          command.sessionId, command.sessionItemId ?? null, command.contentVersionId, command.focusGroupKey,
          command.assessmentLocale, command.deletionEpoch, command.referenceVersion,
          command.normalizerVersion, command.projectionVersion, command.contractVersion,
          command.assessmentTicketId ?? null, command.protectedMaterialHandle ?? null,
          command.capturedAt ?? null, command.captureExpiresAt ?? null, command.submissionExpiresAt,
          command.dependencyCommandId ?? null,
          command.strictProjection === undefined ? null : JSON.stringify(command.strictProjection),
          null,
          command.createdAt, command.createdAt
        );
        await database.runAsync(
          `INSERT INTO v2_local_results (
            command_id, expected_focus, observed_candidate, target_score, result_label,
            next_action_key, sync_state, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
          command.commandId, localResult.expectedFocus, localResult.observedCandidate ?? null,
          localResult.targetScore ?? null, localResult.resultLabel, localResult.nextActionKey ?? null,
          command.createdAt, command.createdAt
        );
        return this.get(command.commandId);
      });
    },

    async enqueueControl(command) {
      validateCommand(command);
      if (command.commandKind === "attempt") throw new TypeError("Attempt commands require a local result.");
      const controlPayload = command.controlPayload ?? {};
      const serialized = JSON.stringify(controlPayload);
      if (forbiddenMaterial(serialized)) throw new TypeError("Control command contains forbidden material.");
      return database.withTransactionAsync(async () => {
        await assertCapacity(database, limits, utf8Bytes(serialized));
        const barrier = await database.getFirstAsync(
          "SELECT request_id FROM v2_deletion_control WHERE singleton_id = 1 AND state != 'idle'"
        ).catch(() => null);
        if (barrier) throw codedError("DELETION_IN_PROGRESS");
        await database.runAsync(
          `INSERT INTO v2_outbox_commands (
            command_id, command_kind, user_id, session_id, session_item_id, content_version_id,
            focus_group_key, assessment_locale, deletion_epoch, reference_version, normalizer_version,
            projection_version, contract_version, submission_expires_at, dependency_command_id,
            control_payload_json, state, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
          command.commandId, command.commandKind, command.userId, command.sessionId,
          command.sessionItemId ?? null, command.contentVersionId, command.focusGroupKey,
          command.assessmentLocale, command.deletionEpoch, command.referenceVersion,
          command.normalizerVersion, command.projectionVersion, command.contractVersion,
          command.submissionExpiresAt, command.dependencyCommandId ?? null, serialized,
          command.createdAt, command.createdAt
        );
        return this.get(command.commandId);
      });
    },

    get(commandId) {
      return database.getFirstAsync(
        `SELECT c.*, r.expected_focus, r.observed_candidate, r.target_score,
                r.result_label, r.next_action_key, r.sync_state
         FROM v2_outbox_commands c
         LEFT JOIN v2_local_results r ON r.command_id = c.command_id
         WHERE c.command_id = ?`,
        commandId
      );
    },

    async leaseNext({ leaseId, now, leaseExpiresAt }) {
      return database.getFirstAsync(
        `UPDATE v2_outbox_commands
         SET state = 'sending', lease_id = ?, lease_expires_at = ?, updated_at = ?
         WHERE command_id = (
           SELECT c.command_id FROM v2_outbox_commands c
           LEFT JOIN v2_outbox_commands dependency ON dependency.command_id = c.dependency_command_id
           WHERE c.state IN ('pending','retryable')
             AND (c.next_attempt_at IS NULL OR c.next_attempt_at <= ?)
             AND (c.dependency_command_id IS NULL OR dependency.state = 'confirmed')
           ORDER BY c.created_at ASC LIMIT 1
         ) AND state IN ('pending','retryable')
         RETURNING *, (
           SELECT d.server_resource_id FROM v2_outbox_commands d
           WHERE d.command_id = v2_outbox_commands.dependency_command_id
         ) AS dependency_server_resource_id`,
        leaseId, leaseExpiresAt, now, now
      );
    },

    async acknowledge(commandId, leaseId, now, serverResourceId = null) {
      await database.withTransactionAsync(async () => {
        const result = await database.runAsync(
          `UPDATE v2_outbox_commands
           SET state = 'confirmed', strict_projection_json = NULL,
               protected_material_handle = NULL, lease_id = NULL, lease_expires_at = NULL,
               server_resource_id = ?, error_code = NULL, updated_at = ?
           WHERE command_id = ? AND state = 'sending' AND lease_id = ?`,
          serverResourceId, now, commandId, leaseId
        );
        if (result.changes !== 1) throw codedError("OUTBOX_LEASE_LOST");
        await database.runAsync(
          "UPDATE v2_local_results SET sync_state = 'confirmed', updated_at = ? WHERE command_id = ?",
          now, commandId
        );
      });
    },

    async markRetryable(commandId, leaseId, { errorCode, nextAttemptAt, now }) {
      const result = await database.runAsync(
        `UPDATE v2_outbox_commands SET state = 'retryable', retry_count = retry_count + 1,
           next_attempt_at = ?, lease_id = NULL, lease_expires_at = NULL, error_code = ?, updated_at = ?
         WHERE command_id = ? AND state = 'sending' AND lease_id = ?`,
        nextAttemptAt, boundedCode(errorCode), now, commandId, leaseId
      );
      if (result.changes !== 1) throw codedError("OUTBOX_LEASE_LOST");
    },

    async markPermanentFailure(commandId, leaseId, { errorCode, now }) {
      await database.withTransactionAsync(async () => {
        const result = await database.runAsync(
          `UPDATE v2_outbox_commands SET state = 'permanent_failure', strict_projection_json = NULL,
             protected_material_handle = NULL, lease_id = NULL, lease_expires_at = NULL,
             error_code = ?, updated_at = ?
           WHERE command_id = ? AND state = 'sending' AND lease_id = ?`,
          boundedCode(errorCode), now, commandId, leaseId
        );
        if (result.changes !== 1) throw codedError("OUTBOX_LEASE_LOST");
        await database.runAsync(
          "UPDATE v2_local_results SET sync_state = 'permanent_failure', updated_at = ? WHERE command_id = ?",
          now, commandId
        );
      });
    },

    recoverExpiredLeases(now) {
      return database.runAsync(
        `UPDATE v2_outbox_commands SET state = 'retryable', lease_id = NULL, lease_expires_at = NULL,
           error_code = 'WORKER_INTERRUPTED', updated_at = ?
         WHERE state = 'sending' AND lease_expires_at <= ?`,
        now, now
      );
    },

    purgeBeforeEpoch(userId, epoch) {
      return database.runAsync(
        "DELETE FROM v2_outbox_commands WHERE user_id = ? AND deletion_epoch < ?",
        userId, epoch
      );
    },

    purgeAllForUser(userId) {
      return database.runAsync(
        "DELETE FROM v2_outbox_commands WHERE user_id = ?",
        userId
      );
    }
  });
}

export function createV2OutboxWorker({ repository, api, protectedMaterialStore, clock, config, onConfirmed, onPermanentFailure }) {
  const checked = assertV2SyncConfig(config);
  let running = false;
  return Object.freeze({
    get running() { return running; },
    async runOnce() {
      if (running) return { status: "busy" };
      running = true;
      const now = clock.now();
      const leaseId = clock.id();
      try {
        const command = await repository.leaseNext({
          leaseId,
          now,
          leaseExpiresAt: clock.addSeconds(now, checked.maxBackoffSeconds)
        });
        if (!command) return { status: "idle" };
        if (command.submission_expires_at <= now) {
          await protectedMaterialStore.delete(command.protected_material_handle);
          await repository.markPermanentFailure(command.command_id, leaseId, {
            errorCode: "SUBMISSION_EXPIRED", now
          });
          await onPermanentFailure?.(command, "SUBMISSION_EXPIRED");
          return { status: "permanent_failure", code: "SUBMISSION_EXPIRED" };
        }
        try {
          const response = await api.send(command, await protectedMaterialStore.read(command.protected_material_handle));
          await protectedMaterialStore.delete(command.protected_material_handle);
          await repository.acknowledge(command.command_id, leaseId, now, api.resourceId?.(command, response) ?? null);
          await onConfirmed?.(command, response);
          return { status: "confirmed", commandId: command.command_id };
        } catch (error) {
          if (api.classify(error) === "retryable") {
            const delay = Math.min(
              checked.maxBackoffSeconds,
              checked.initialBackoffSeconds * (2 ** Number(command.retry_count ?? 0))
            );
            await repository.markRetryable(command.command_id, leaseId, {
              errorCode: error?.code ?? "NETWORK_UNAVAILABLE",
              nextAttemptAt: clock.addSeconds(now, delay),
              now
            });
            return { status: "retryable" };
          }
          await protectedMaterialStore.delete(command.protected_material_handle);
          await repository.markPermanentFailure(command.command_id, leaseId, {
            errorCode: error?.code ?? "PERMANENT_FAILURE", now
          });
          await onPermanentFailure?.(command, error?.code ?? "PERMANENT_FAILURE");
          return { status: "permanent_failure", code: error?.code ?? "PERMANENT_FAILURE" };
        }
      } finally {
        running = false;
      }
    }
  });
}

function validateCommand(command) {
  const required = ["commandId", "commandKind", "userId", "sessionId", "contentVersionId", "focusGroupKey",
    "assessmentLocale", "referenceVersion", "normalizerVersion", "projectionVersion", "contractVersion",
    "submissionExpiresAt", "createdAt"];
  for (const field of required) if (typeof command?.[field] !== "string" || command[field].length === 0) {
    throw new TypeError(`${field} is required.`);
  }
  if (!Number.isSafeInteger(command.deletionEpoch) || command.deletionEpoch < 0) {
    throw new RangeError("deletionEpoch is invalid.");
  }
  const serialized = command.strictProjection === undefined ? "" : JSON.stringify(command.strictProjection);
  if (forbiddenMaterial(serialized)) throw new TypeError("Outbox projection contains forbidden material.");
  if (command.commandKind === "attempt" && typeof command.capturedAt !== "string") {
    throw new TypeError("capturedAt is required for an attempt command.");
  }
}

function validateLocalResult(result) {
  if (typeof result?.expectedFocus !== "string" || typeof result?.resultLabel !== "string") {
    throw new TypeError("A bounded local result is required.");
  }
  if (forbiddenMaterial(JSON.stringify(result))) throw new TypeError("Local result contains forbidden material.");
}

function forbiddenMaterial(value) {
  return /(?:[a-z]+:\/\/|bearer\s+|authorization|access.?token|audio.?base64|file.?uri|raw.?json)/i.test(value);
}

function boundedCode(value) {
  const code = typeof value === "string" ? value : "UNKNOWN";
  return /^[A-Z0-9_]{1,80}$/.test(code) ? code : "UNKNOWN";
}

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

async function assertCapacity(database, limits, incomingBytes) {
  if (!limits) throw codedError("V2_SYNC_CONFIG_REQUIRED");
  const usage = await database.getFirstAsync(
    `SELECT count(*) AS item_count,
       coalesce(sum(length(CAST(coalesce(strict_projection_json,'') AS BLOB)) +
                    length(CAST(coalesce(control_payload_json,'') AS BLOB))),0) AS payload_bytes
     FROM v2_outbox_commands WHERE state NOT IN ('confirmed','permanent_failure')`
  );
  if (Number(usage?.item_count ?? 0) >= limits.maxItems || Number(usage?.payload_bytes ?? 0) + incomingBytes > limits.maxBytes) {
    throw codedError("OUTBOX_CAPACITY_REACHED");
  }
}

function utf8Bytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

function assertDatabase(database) {
  for (const method of ["execAsync", "runAsync", "getFirstAsync", "getAllAsync", "withTransactionAsync"]) {
    if (typeof database?.[method] !== "function") throw new TypeError(`Database adapter requires ${method}.`);
  }
}
