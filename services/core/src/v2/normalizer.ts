import { createHash } from "node:crypto";

export const V2_NORMALIZER_VERSION = "azure-en-us-focus-v2";

// Representative full Azure response. The ceiling is this checked-in fixture's
// measured size with a 4x envelope for managed prompts of different lengths.
export const AZURE_V2_CAPACITY_REFERENCE = Object.freeze({
  Id: "00000000000000000000000000000000",
  RecognitionStatus: "Success",
  DisplayText: "think now",
  Offset: 900000,
  Duration: 12800000,
  NBest: [{
    Confidence: 0.91,
    Lexical: "think now",
    ITN: "think now",
    MaskedITN: "think now",
    Display: "think now",
    PronunciationAssessment: {
      AccuracyScore: 81, FluencyScore: 74, CompletenessScore: 100, PronScore: 78, ProsodyScore: 72
    },
    Words: [{
      Word: "think",
      Offset: 900000,
      Duration: 6400000,
      PronunciationAssessment: { AccuracyScore: 46, ErrorType: "None" },
      Syllables: [{
        Syllable: "θɪŋk", Offset: 900000, Duration: 6400000,
        PronunciationAssessment: { AccuracyScore: 46 }
      }],
      Phonemes: [{
        Phoneme: "θ", Offset: 900000, Duration: 1200000,
        PronunciationAssessment: {
          AccuracyScore: 46,
          NBestPhonemes: [
            { Phoneme: "θ", Score: 46 }, { Phoneme: "s", Score: 91 }, { Phoneme: "t", Score: 20 }
          ]
        }
      }]
    }, {
      Word: "now", Offset: 7400000, Duration: 6300000,
      PronunciationAssessment: { AccuracyScore: 88, ErrorType: "None" },
      Syllables: [], Phonemes: []
    }]
  }]
});

const AZURE_V2_SENTENCE_CAPACITY_REFERENCE = Object.freeze({
  ...AZURE_V2_CAPACITY_REFERENCE,
  DisplayText: "I think this method works very well today.",
  Duration: 38_400_000,
  NBest: [{
    ...AZURE_V2_CAPACITY_REFERENCE.NBest[0],
    Lexical: "i think this method works very well today",
    ITN: "i think this method works very well today",
    MaskedITN: "i think this method works very well today",
    Display: "I think this method works very well today.",
    Words: Array.from({ length: 8 }, (_, index) => ({
      ...AZURE_V2_CAPACITY_REFERENCE.NBest[0].Words[index === 1 ? 0 : 1],
      Word: ["I", "think", "this", "method", "works", "very", "well", "today"][index],
      Offset: 900_000 + index * 4_000_000
    }))
  }]
});

const CAPACITY_REFERENCE_BYTES = Math.max(
  byteLength(AZURE_V2_CAPACITY_REFERENCE),
  byteLength(AZURE_V2_SENTENCE_CAPACITY_REFERENCE)
);
export const AZURE_V2_PROVIDER_PAYLOAD_MAX_BYTES = nextPowerOfTwo(CAPACITY_REFERENCE_BYTES * 4);

const FORBIDDEN_KEY_FRAGMENTS = [
  "audio", "base64", "fileuri", "accesstoken", "authorization", "secret", "password", "apikey", "credential"
] as const;
const SAFE_PROVIDER_KEYS = new Set([
  "Id", "RecognitionStatus", "DisplayText", "Offset", "Duration", "NBest", "Confidence",
  "Lexical", "ITN", "MaskedITN", "Display", "PronunciationAssessment", "AccuracyScore",
  "FluencyScore", "CompletenessScore", "PronScore", "ProsodyScore", "Words", "Word",
  "ErrorType", "Syllables", "Syllable", "Phonemes", "Phoneme", "NBestPhonemes", "Score"
]);

export interface AzureTargetLocator { wordIndex: number; phonemeIndex: number; }

export interface NormalizeAzureFocusInput {
  providerPayload: unknown;
  referenceText: string;
  contentVersionId: string;
  practiceItemKey: string;
  targetLocator: AzureTargetLocator;
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
  normalizationStatus: "server_normalized" | "rejected";
  providerAttested: false;
  capabilityFlags: { targetScore: boolean; observedCandidate: boolean; };
  normalizedDetail: { recognitionStatus: string; };
}

export function normalizeAzureFocusResult(input: NormalizeAzureFocusInput): NormalizedFocusResult {
  for (const [field, value] of [
    ["referenceText", input.referenceText], ["contentVersionId", input.contentVersionId],
    ["practiceItemKey", input.practiceItemKey], ["expectedFocusRepresentation", input.expectedFocusRepresentation],
    ["referenceTextVersion", input.referenceTextVersion]
  ] as const) assertSafeStoredString(value, field);
  if (input.nextActionKey !== undefined) assertSafeStoredString(input.nextActionKey, "nextActionKey");
  if (input.assessmentLocale !== "en-US") throw new RangeError("assessmentLocale must be en-US.");
  assertTargetLocator(input.targetLocator);
  if (!isObject(input.providerPayload)) throw new TypeError("providerPayload must be an object.");
  assertNoForbiddenProviderFields(input.providerPayload);
  assertStrictProviderShape(input.providerPayload);
  const limit = input.payloadByteLimit ?? AZURE_V2_PROVIDER_PAYLOAD_MAX_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("payloadByteLimit must be positive.");
  if (byteLength(input.providerPayload) > limit) throw new RangeError("providerPayload exceeds the measured fixture limit.");

  const payload = input.providerPayload;
  const recognitionStatus = requireString(payload.RecognitionStatus, "RecognitionStatus");
  if (recognitionStatus !== "Success") return rejectedResult(input, recognitionStatus);
  const displayText = requireString(payload.DisplayText, "DisplayText");
  if (canonicalText(displayText) !== canonicalText(input.referenceText)) {
    throw new TypeError("Provider result does not match the managed reference text.");
  }
  const hypotheses = requireArray(payload.NBest, "NBest");
  const hypothesis = requireObject(hypotheses[0], "NBest[0]");
  validateAssessment(hypothesis.PronunciationAssessment, "NBest[0].PronunciationAssessment");
  const words = requireArray(hypothesis.Words, "NBest[0].Words");
  const word = requireObject(words[input.targetLocator.wordIndex], "target word");
  requireString(word.Word, "target Word");
  validateAssessment(word.PronunciationAssessment, "target word PronunciationAssessment");
  const phonemes = requireArray(word.Phonemes, "target word Phonemes");
  const phoneme = requireObject(phonemes[input.targetLocator.phonemeIndex], "target phoneme");
  const target = requireString(phoneme.Phoneme, "target Phoneme");
  if (target !== input.expectedFocusRepresentation) {
    throw new TypeError("Provider target does not match the managed target locator and focus.");
  }
  const assessment = requireObject(phoneme.PronunciationAssessment, "target PronunciationAssessment");
  const score = requireScore(assessment.AccuracyScore, "target AccuracyScore");
  const candidates = assessment.NBestPhonemes === undefined ? [] :
    requireArray(assessment.NBestPhonemes, "target NBestPhonemes").map((candidate, index) => {
      const row = requireObject(candidate, `target NBestPhonemes[${index}]`);
      return {
        value: requireString(row.Phoneme, `target NBestPhonemes[${index}].Phoneme`),
        score: requireScore(row.Score, `target NBestPhonemes[${index}].Score`)
      };
    });
  candidates.sort((left, right) => right.score - left.score || left.value.localeCompare(right.value));
  const observedCandidate = candidates[0]?.value ?? target;
  assertSafeStoredString(observedCandidate, "observedCandidate");

  return {
    provider: "azure", assessmentLocale: "en-US", normalizerVersion: V2_NORMALIZER_VERSION,
    referenceTextVersion: input.referenceTextVersion,
    expectedFocusRepresentation: input.expectedFocusRepresentation,
    observedCandidate, targetScore: score, technicalValid: true, invalidReason: null,
    resultLabel: "measured", nextActionKey: input.nextActionKey?.trim() || null,
    normalizationStatus: "server_normalized", providerAttested: false,
    capabilityFlags: { targetScore: true, observedCandidate: true },
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
    if (isForbiddenProviderKey(key)) throw new TypeError(`Forbidden provider field at ${path}.${key}`);
    assertNoForbiddenProviderFields(nested, `${path}.${key}`);
  }
}

function assertStrictProviderShape(value: unknown, path = "providerPayload"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertStrictProviderShape(item, `${path}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (isForbiddenProviderKey(key)) throw new TypeError(`Forbidden provider field at ${path}.${key}`);
    if (!SAFE_PROVIDER_KEYS.has(key)) throw new TypeError(`Unsupported provider field at ${path}.${key}`);
    assertStrictProviderShape(nested, `${path}.${key}`);
  }
}

function rejectedResult(input: NormalizeAzureFocusInput, recognitionStatus: string): NormalizedFocusResult {
  return {
    provider: "azure", assessmentLocale: "en-US", normalizerVersion: V2_NORMALIZER_VERSION,
    referenceTextVersion: input.referenceTextVersion,
    expectedFocusRepresentation: input.expectedFocusRepresentation,
    observedCandidate: null, targetScore: null, technicalValid: false,
    invalidReason: "provider_recognition_failed", resultLabel: "technical_invalid",
    nextActionKey: input.nextActionKey?.trim() || null, normalizationStatus: "rejected",
    providerAttested: false, capabilityFlags: { targetScore: false, observedCandidate: false },
    normalizedDetail: { recognitionStatus }
  };
}

function validateAssessment(value: unknown, path: string): void {
  if (value === undefined) return;
  const assessment = requireObject(value, path);
  for (const key of ["AccuracyScore", "FluencyScore", "CompletenessScore", "PronScore", "ProsodyScore"] as const) {
    if (assessment[key] !== undefined) requireScore(assessment[key], `${path}.${key}`);
  }
}

function assertTargetLocator(value: AzureTargetLocator): void {
  if (!value || !Number.isSafeInteger(value.wordIndex) || value.wordIndex < 0 ||
      !Number.isSafeInteger(value.phonemeIndex) || value.phonemeIndex < 0) {
    throw new RangeError("targetLocator must contain non-negative integer indexes.");
  }
}

function assertSafeStoredString(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 512) {
    throw new RangeError(`${field} must be a non-blank bounded string.`);
  }
  if (/(?:[a-z]+:\/\/|bearer\s+|-----BEGIN)/i.test(value) ||
      (field === "observedCandidate" && /token|secret|password|apikey|credential/i.test(normalizeKey(value)))) {
    throw new TypeError(`${field} contains forbidden URI or secret material.`);
  }
}

function canonicalText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}
function normalizeKey(value: string): string { return value.replace(/[^a-z0-9]/gi, "").toLowerCase(); }
function isForbiddenProviderKey(value: string): boolean {
  const normalized = normalizeKey(value);
  return normalized === "uri" || normalized.endsWith("uri") || normalized.includes("token") ||
    FORBIDDEN_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function byteLength(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
function nextPowerOfTwo(value: number): number { return 2 ** Math.ceil(Math.log2(value)); }
function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!isObject(value)) throw new TypeError(`${field} must be an object.`);
  return value;
}
function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${field} must be a non-empty array.`);
  return value;
}
function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${field} must be a non-blank string.`);
  return value;
}
function requireScore(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new TypeError(`${field} must be a number from 0 through 100.`);
  }
  return value;
}
