import * as SecureStore from "expo-secure-store";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import ProtectedStorage from "otokagami-protected-storage";

import { V2_AUDIO_INDEX_SCHEMA } from "../../lib/v2-audio-lifecycle.mjs";
import { migrateV2DeletionSchema } from "../../lib/v2-deletion.mjs";
import { migrateV2OutboxSchema } from "../../lib/v2-outbox.mjs";
import { V2_TICKET_JOURNAL_SCHEMA } from "../../lib/v2-ticket-journal.mjs";

const TICKET_KEY_PREFIX = "otokagami.v2.ticket.";

export async function openV2Database(userId: string): Promise<SQLiteDatabase> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new TypeError("A valid user identifier is required.");
  const databaseName = `otokagami-v2-${userId.toLowerCase()}.sqlite`;
  const prepared = await ProtectedStorage.prepare();
  const database = await openDatabaseAsync(databaseName, {}, prepared.databaseDirectoryUri);
  await migrateV2DeletionSchema(database);
  await database.execAsync(V2_AUDIO_INDEX_SCHEMA);
  await migrateV2OutboxSchema(database);
  await database.execAsync(V2_TICKET_JOURNAL_SCHEMA);
  await ProtectedStorage.protectDatabase(databaseName);
  return database;
}

export const protectedTicketStore = Object.freeze({
  async save(handle: string, nonce: string) {
    await SecureStore.setItemAsync(`${TICKET_KEY_PREFIX}${handle}`, nonce, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
    });
  },
  read(handle: string | null) {
    return handle ? SecureStore.getItemAsync(`${TICKET_KEY_PREFIX}${handle}`) : Promise.resolve(null);
  },
  async delete(handle: string | null) {
    if (handle) await SecureStore.deleteItemAsync(`${TICKET_KEY_PREFIX}${handle}`);
  }
});

export const protectedAudioStorage = Object.freeze({
  storeAudio: (sourceUri: string, fileKey: string) => ProtectedStorage.storeAudio(sourceUri, fileKey),
  deleteAudio: (fileKey: string) => ProtectedStorage.deleteAudio(fileKey),
  audioExists: (fileKey: string) => ProtectedStorage.audioExists(fileKey),
  resolveAudio: (fileKey: string) => ProtectedStorage.resolveAudio(fileKey),
  async deleteTemporary(sourceUri: string) {
    const { File } = await import("expo-file-system");
    const file = new File(sourceUri);
    if (file.exists) file.delete();
  }
});
