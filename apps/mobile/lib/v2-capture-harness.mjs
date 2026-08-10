export const V2_CAPTURE_FIXTURE_VERSION = "mobile-azure-projection-fixture-v1";

export function createCaptureFixture({ gate, projection, metrics, provenance }) {
  gate.assertAvailable();
  if (!isProjection(projection)) throw new TypeError("A strict provider projection is required.");
  if (!Number.isSafeInteger(metrics?.providerPayloadBytes) || !Number.isSafeInteger(metrics?.projectionBytes)) {
    throw new TypeError("Measured byte counts are required.");
  }
  const fixture = {
    fixtureVersion: V2_CAPTURE_FIXTURE_VERSION,
    projection,
    metrics: {
      providerPayloadBytes: metrics.providerPayloadBytes,
      projectionBytes: metrics.projectionBytes
    },
    provenance: {
      managedPracticeItemKey: bounded(provenance?.managedPracticeItemKey, "managedPracticeItemKey"),
      deviceClass: bounded(provenance?.deviceClass, "deviceClass"),
      osMajor: bounded(provenance?.osMajor, "osMajor"),
      capturedAt: bounded(provenance?.capturedAt, "capturedAt")
    }
  };
  const serialized = JSON.stringify(fixture);
  if (/(?:bearer\s+|authorization|access.?token|audio|file.?uri|https?:\/\/)/i.test(serialized)) {
    throw new TypeError("Capture fixture contains forbidden material.");
  }
  return fixture;
}

function isProjection(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    typeof value.projectionVersion === "string" &&
    typeof value.recognitionStatus === "string" &&
    Object.keys(value).every((key) => ["projectionVersion", "recognitionStatus", "displayText", "target"].includes(key));
}

function bounded(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.length > 120 || /[\u0000-\u001f]/.test(value)) {
    throw new TypeError(`${field} must be a bounded anonymous value.`);
  }
  return value;
}
