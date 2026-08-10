import {
  V2_AZURE_PROJECTION_VERSION,
  V2_NORMALIZER_VERSION,
  measureJsonBytes,
  normalizeAzureFocusProjection,
  projectAzureFocusPayload,
  type AzureFocusProjection,
  type NormalizedFocusResult
} from "@pronunciation-mirror/core/v2/normalizer-pure";

export type MobileProjectionResult = {
  projection: AzureFocusProjection;
  normalized: NormalizedFocusResult;
  metrics: { providerPayloadBytes: number; projectionBytes: number };
};

export function normalizeManagedAzureResult(input: {
  providerPayload: unknown;
  payloadByteLimit: number;
  targetLocator: { wordIndex: number; phonemeIndex: number };
  referenceText: string;
  contentVersionId: string;
  practiceItemKey: string;
  expectedFocusRepresentation: string;
  nextActionKey?: string;
  referenceTextVersion: string;
}): MobileProjectionResult {
  const projected = projectAzureFocusPayload({
    providerPayload: input.providerPayload,
    targetLocator: input.targetLocator,
    payloadByteLimit: input.payloadByteLimit
  });
  const normalized = normalizeAzureFocusProjection({
    providerProjection: projected.projection,
    referenceText: input.referenceText,
    contentVersionId: input.contentVersionId,
    practiceItemKey: input.practiceItemKey,
    expectedFocusRepresentation: input.expectedFocusRepresentation,
    nextActionKey: input.nextActionKey,
    referenceTextVersion: input.referenceTextVersion,
    assessmentLocale: "en-US"
  });
  return {
    projection: projected.projection,
    normalized,
    metrics: {
      providerPayloadBytes: projected.metrics.providerPayloadBytes,
      projectionBytes: measureJsonBytes(projected.projection)
    }
  };
}

export const MOBILE_V2_NORMALIZER_VERSION = V2_NORMALIZER_VERSION;
export const MOBILE_V2_PROJECTION_VERSION = V2_AZURE_PROJECTION_VERSION;
