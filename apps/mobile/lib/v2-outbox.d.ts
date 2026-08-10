export const V2_OUTBOX_STATES: readonly string[];
export const V2_OUTBOX_SCHEMA: string;
export function migrateV2OutboxSchema(database: any): Promise<void>;
export function assertV2SyncConfig(config: Record<string, number>): Readonly<Record<string, number>>;
export function createV2OutboxRepository(database: any): any;
export function createV2OutboxWorker(options: any): { readonly running: boolean; runOnce(): Promise<any> };
