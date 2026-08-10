export function createV2FixtureGate({ development = false, test = false, enabled = false } = {}) {
  const permittedRuntime = development === true || test === true;
  return Object.freeze({
    enabled: permittedRuntime && enabled === true,
    assertAvailable() {
      if (!permittedRuntime || enabled !== true) {
        const error = new Error("Fixture mode is unavailable in release builds.");
        error.code = "V2_FIXTURE_DISABLED";
        throw error;
      }
    }
  });
}

export const releaseV2FixtureGate = createV2FixtureGate();
