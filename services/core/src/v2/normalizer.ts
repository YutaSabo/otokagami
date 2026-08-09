import { createHash } from "node:crypto";

export const V2_NORMALIZER_VERSION = "azure-en-us-focus-v1";

// This is the checked-in Azure fixture used by the v2 contract tests. The request
// boundary derives its initial byte ceiling from this exact artifact rather than an
// unverified production estimate. Learning mode remains off until managed-content
// device fixtures confirm or revise this bound.
export const AZURE_V2_CAPACITY_REFERENCE = Object.freeze({
  RecognitionStatus: "Success",
  NBest: [
    {
      PronunciationAssessment: { PronScore: 78, AccuracyScore: 81 },
      Words: [
        {
          Word: "think",
          PronunciationAssessment: { AccuracyScore: 46 },
          Phonemes: [
            {
              Phoneme: "θ",
              PronunciationAssessment: {
                AccuracyScore: 46,
                NBestPhonemes: [
                  { Phoneme: "θ", Score: 46 },
                  { Phoneme: "s", Score: 91 },
                  { Phoneme: "t", Score: 20 }
                ]
              }
            }
          ]
        }
      ]
    }
  ]
});

export const AZURE_V2_PROVIDER_PAYLOAD_MAX_BYTES = byteLength(AZURE_V2_CAPACITY_REFERENCE);

const FORBIDDEN_PROVIDER_KEY = /(^|_)(audio|audio_data|base64|file_uri|uri|token|authorization|secret|password|api_key|apikey)($|_)/i;

export interface NormalizeAzureFocusInput {
  providerPayload: unknown;
  expectedFocusRepresentation: string;
  nextActionKey?: string;
  referenceTextVersion: string;
  assessmentLocale: "en-US";
  payloadByteLimit?: number;
}

export interface NormalizedFocusResult {
  provider: "azure";
  assessmentLocale: "en-US";
  normalizerVersion: typeof V2_NORMALIZER_VERSION;
  referenceTextVersion: string;
  expectedFocusRepresentation: string;
  observedCandidate: string | null;
  targetScore: number | null;
  technicalValid: boolean;
  invalidReason: string | null;
  resultLabel: "measured" | "technical_invalid";
  nextActionKey: string | null;
  capabilityFlags: {
    targetScore: boolean;
    observedCandidate: boolean;
  };
  normalizedDetail: {
    recognitionStatus: string | null;
  };
}

export function normalizeAzureFocusResult(input: NormalizeAzureFocusInput): NormalizedFocusResult {
  assertNonBlank(input.expectedFocusRepresentation, "expectedFocusRepresentation");
  assertNonBlank(input.referenceTextVersion, "referenceTextVersion");
  if (input.assessmentLocale !== "en-US") throw new RangeError("assessmentLocale must be en-US.");
  if (!isObject(input.providerPayload)) throw new TypeError("providerPayload must be an object.");
  assertNoForbiddenProviderFields(input.providerPayload);
  const limit = input.payloadByteLimit ?? AZURE_V2_PROVIDER_PAYLOAD_MAX_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("payloadByteLimit must be positive.");
  if (byteLength(input.providerPayload) > limit) throw new RangeError("providerPayload exceeds the measured fixture limit.");

  const payload = input.providerPayload;
  const recognitionStatus = stringOrNull(payload.RecognitionStatus ?? payload.recognitionStatus);
  const hypothesis = firstObject(payload.NBest ?? payload.nBest);
  const words = array(hypothesis?.Words ?? hypothesis?.words);
  const phonemes = words.flatMap((word) => array(object(word)?.Phonemes ?? object(word)?.phonemes));
  const matching = phonemes.find((phoneme) => {
    const row = object(phoneme);
    return stringOrNull(row?.Phoneme ?? row?.phoneme) === input.expectedFocusRepresentation;
  });
  const fallback = matching ?? phonemes[0];
  const phoneme = object(fallback);
  const assessment = object(phoneme?.PronunciationAssessment ?? phoneme?.pronunciationAssessment);
  const score = numberInRangeOrNull(assessment?.AccuracyScore ?? assessment?.accuracyScore, 0, 100);
  const candidates = array(assessment?.NBestPhonemes ?? assessment?.nBestPhonemes)
    .map((candidate) => object(candidate))
    .filter((candidate): candidate is Record<string, unknown> => candidate !== null)
    .map((candidate) => ({
      value: stringOrNull(candidate.Phoneme ?? candidate.phoneme),
      score: numberInRangeOrNull(candidate.Score ?? candidate.score, 0, 100)
    }))
    .filter((candidate) => candidate.value !== null)
    .sort((left, right) => (right.score ?? -1) - (left.score ?? -1) || left.value!.localeCompare(right.value!));
  const observedCandidate = candidates[0]?.value ?? stringOrNull(phoneme?.Phoneme ?? phoneme?.phoneme);
  const technicalValid = recognitionStatus === null || recognitionStatus.toLowerCase() === "success";

  return {
    provider: "azure",
    assessmentLocale: "en-US",
    normalizerVersion: V2_NORMALIZER_VERSION,
    referenceTextVersion: input.referenceTextVersion,
    expectedFocusRepresentation: input.expectedFocusRepresentation,
    observedCandidate,
    targetScore: score,
    technicalValid,
    invalidReason: technicalValid ? null : "provider_recognition_failed",
    resultLabel: technicalValid ? "measured" : "technical_invalid",
    nextActionKey: input.nextActionKey?.trim() || null,
    capabilityFlags: {
      targetScore: score !== null,
      observedCandidate: observedCandidate !== null
    },
    normalizedDetail: { recognitionStatus }
  };
}

export function canonicalPayloadSha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function assertNoForbiddenProviderFields(value: unknown, path = "providerPayload"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenProviderFields(item, `${path}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_PROVIDER_KEY.test(key)) throw new TypeError(`Forbidden provider field at ${path}.${key}`);
    assertNoForbiddenProviderFields(nested, `${path}.${key}`);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function object(value: unknown): Record<string, unknown> | null {
  return isObject(value) ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstObject(value: unknown): Record<string, unknown> | null {
  return object(array(value)[0]);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberInRangeOrNull(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function assertNonBlank(value: string, field: string): void {
  if (value.trim().length === 0) throw new RangeError(`${field} must not be blank.`);
}
