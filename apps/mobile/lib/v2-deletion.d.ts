export const V2_DELETION_SCHEMA: string;
export function nextDeletionAction(record: any, bootstrapEpoch: number): string;
export function canSendLearningCommands(record: any): boolean;
export function createV2DeletionCoordinator(options: any): any;
