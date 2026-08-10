export function createV2FixtureGate(options?: { development?: boolean; test?: boolean; enabled?: boolean }): { enabled: boolean; assertAvailable(): void };
export const releaseV2FixtureGate: ReturnType<typeof createV2FixtureGate>;
