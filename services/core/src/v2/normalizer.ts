export const V2_NORMALIZER_VERSION = "azure-en-us-focus-v2";
export const V2_AZURE_PROJECTION_VERSION = "azure-en-us-focus-projection-v1";

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
/**
 * Test-only envelope for the checked-in synthetic fixtures. A live caller must
 * inject a limit derived from verified device fixtures instead of treating this
 * value as a production limit.
 */
export const AZURE_V2_TEST_PAYLOAD_MAX_BYTES = nextPowerOfTwo(CAPACITY_REFERENCE_BYTES * 4);
/** @deprecated Use only in tests. Live code must inject payloadByteLimit. */
export const AZURE_V2_PROVIDER_PAYLOAD_MAX_BYTES = AZURE_V2_TEST_PAYLOAD_MAX_BYTES;

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

export type AzureRecognitionStatus =
  | "success"
  | "no_match"
  | "initial_silence_timeout"
  | "babble_timeout"
  | "error"
  | "unknown";

export interface AzureFocusProjection {
  projectionVersion: typeof V2_AZURE_PROJECTION_VERSION;
  recognitionStatus: AzureRecognitionStatus;
  displayText: string | null;
  target: null | {
    phoneme: string;
    accuracyScore: number;
    candidates: Array<{ phoneme: string; score: number }>;
  };
}

export interface ProjectionMetrics {
  providerPayloadBytes: number;
  projectionBytes: number;
}

export interface ProviderStructureLimits {
  maxDepth?: number;
  maxNodes?: number;
  maxArrayLength?: number;
  maxStringLength?: number;
}

export interface ProjectAzureFocusInput extends ProviderStructureLimits {
  providerPayload: unknown;
  targetLocator: AzureTargetLocator;
  payloadByteLimit: number;
}

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
  payloadByteLimit: number;
  structureLimits?: ProviderStructureLimits;
}

export interface NormalizeAzureProjectionInput {
  providerProjection: AzureFocusProjection;
  referenceText: string;
  contentVersionId: string;
  practiceItemKey: string;
  expectedFocusRepresentation: string;
  nextActionKey?: string;
  referenceTextVersion: string;
  assessmentLocale: "en-US";
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
  normalizedDetail: { recognitionStatus: AzureRecognitionStatus; };
}

export function normalizeAzureFocusResult(input: NormalizeAzureFocusInput): NormalizedFocusResult {
  const { projection } = projectAzureFocusPayload({
    providerPayload: input.providerPayload,
    targetLocator: input.targetLocator,
    payloadByteLimit: input.payloadByteLimit,
    ...input.structureLimits
  });
  return normalizeAzureFocusProjection({
    providerProjection: projection,
    referenceText: input.referenceText,
    contentVersionId: input.contentVersionId,
    practiceItemKey: input.practiceItemKey,
    expectedFocusRepresentation: input.expectedFocusRepresentation,
    nextActionKey: input.nextActionKey,
    referenceTextVersion: input.referenceTextVersion,
    assessmentLocale: input.assessmentLocale
  });
}

export function projectAzureFocusPayload(input: ProjectAzureFocusInput): {
  projection: AzureFocusProjection;
  metrics: ProjectionMetrics;
} {
  assertTargetLocator(input.targetLocator);
  assertPositiveLimit(input.payloadByteLimit, "payloadByteLimit");
  if (!isObject(input.providerPayload)) throw new TypeError("providerPayload must be an object.");
  const providerPayloadBytes = byteLength(input.providerPayload);
  if (providerPayloadBytes > input.payloadByteLimit) {
    throw new RangeError("providerPayload exceeds the injected payload limit.");
  }
  assertJsonComplexity(input.providerPayload, input);
  assertNoForbiddenProviderFields(input.providerPayload);
  assertStrictProviderShape(input.providerPayload);

  const payload = input.providerPayload;
  const recognitionStatus = normalizeRecognitionStatus(payload.RecognitionStatus);
  let projection: AzureFocusProjection;
  if (recognitionStatus !== "success") {
    projection = {
      projectionVersion: V2_AZURE_PROJECTION_VERSION,
      recognitionStatus,
      displayText: null,
      target: null
    };
  } else {
    const displayText = requireSafeString(payload.DisplayText, "DisplayText", 512);
    const hypotheses = requireArray(payload.NBest, "NBest");
    const hypothesis = requireObject(hypotheses[0], "NBest[0]");
    validateAssessment(hypothesis.PronunciationAssessment, "NBest[0].PronunciationAssessment");
    const words = requireArray(hypothesis.Words, "NBest[0].Words");
    const word = requireObject(words[input.targetLocator.wordIndex], "target word");
    requireSafeString(word.Word, "target Word", 256);
    validateAssessment(word.PronunciationAssessment, "target word PronunciationAssessment");
    const phonemes = requireArray(word.Phonemes, "target word Phonemes");
    const phoneme = requireObject(phonemes[input.targetLocator.phonemeIndex], "target phoneme");
    const target = requireCandidate(phoneme.Phoneme, "target Phoneme");
    const assessment = requireObject(phoneme.PronunciationAssessment, "target PronunciationAssessment");
    const score = requireScore(assessment.AccuracyScore, "target AccuracyScore");
    const candidates = assessment.NBestPhonemes === undefined ? [] :
      requireArray(assessment.NBestPhonemes, "target NBestPhonemes").map((candidate, index) => {
        const row = requireObject(candidate, `target NBestPhonemes[${index}]`);
        return {
          phoneme: requireCandidate(row.Phoneme, `target NBestPhonemes[${index}].Phoneme`),
          score: requireScore(row.Score, `target NBestPhonemes[${index}].Score`)
        };
      });
    projection = {
      projectionVersion: V2_AZURE_PROJECTION_VERSION,
      recognitionStatus,
      displayText,
      target: { phoneme: target, accuracyScore: score, candidates }
    };
  }
  return {
    projection,
    metrics: { providerPayloadBytes, projectionBytes: byteLength(projection) }
  };
}

// Compatibility name retained for the S6-07 API while callers migrate to the
// explicitly payload-oriented browser-safe contract.
export const projectAzureFocusResult = projectAzureFocusPayload;

export function measureJsonBytes(value: unknown): number {
  return byteLength(value);
}

export function normalizeAzureFocusProjection(input: NormalizeAzureProjectionInput): NormalizedFocusResult {
  for (const [field, value] of [
    ["referenceText", input.referenceText], ["contentVersionId", input.contentVersionId],
    ["practiceItemKey", input.practiceItemKey], ["expectedFocusRepresentation", input.expectedFocusRepresentation],
    ["referenceTextVersion", input.referenceTextVersion]
  ] as const) assertSafeStoredString(value, field);
  if (input.nextActionKey !== undefined) assertSafeStoredString(input.nextActionKey, "nextActionKey");
  if (input.assessmentLocale !== "en-US") throw new RangeError("assessmentLocale must be en-US.");
  assertStrictProjection(input.providerProjection);
  const recognitionStatus = input.providerProjection.recognitionStatus;
  if (recognitionStatus !== "success") return rejectedResult(input, recognitionStatus);
  const displayText = input.providerProjection.displayText;
  if (displayText === null) throw new TypeError("Successful projection requires displayText.");
  if (canonicalText(displayText) !== canonicalText(input.referenceText)) {
    throw new TypeError("Provider result does not match the managed reference text.");
  }
  const targetProjection = input.providerProjection.target;
  if (targetProjection === null) throw new TypeError("Successful projection requires a target.");
  const target = targetProjection.phoneme;
  if (target !== input.expectedFocusRepresentation) {
    throw new TypeError("Provider target does not match the managed target locator and focus.");
  }
  const candidates = [...targetProjection.candidates];
  candidates.sort((left, right) => right.score - left.score || left.phoneme.localeCompare(right.phoneme));
  const observedCandidate = candidates[0]?.phoneme ?? target;
  assertSafeCandidate(observedCandidate, "observedCandidate");

  return {
    provider: "azure", assessmentLocale: "en-US", normalizerVersion: V2_NORMALIZER_VERSION,
    referenceTextVersion: input.referenceTextVersion,
    expectedFocusRepresentation: input.expectedFocusRepresentation,
    observedCandidate, targetScore: targetProjection.accuracyScore, technicalValid: true, invalidReason: null,
    resultLabel: "measured", nextActionKey: input.nextActionKey?.trim() || null,
    normalizationStatus: "server_normalized", providerAttested: false,
    capabilityFlags: { targetScore: true, observedCandidate: true },
    normalizedDetail: { recognitionStatus }
  };
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

function rejectedResult(input: NormalizeAzureProjectionInput, recognitionStatus: AzureRecognitionStatus): NormalizedFocusResult {
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
  if (hasControlCharacter(value) || containsForbiddenStoredMaterial(value)) {
    throw new TypeError(`${field} contains forbidden URI or secret material.`);
  }
}

function requireSafeString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new TypeError(`${field} must be a non-blank bounded string.`);
  }
  if (hasControlCharacter(value) || containsForbiddenStoredMaterial(value)) {
    throw new TypeError(`${field} contains forbidden URI, control, or secret material.`);
  }
  return value;
}

function requireCandidate(value: unknown, field: string): string {
  const candidate = requireSafeString(value, field, 64);
  assertSafeCandidate(candidate, field);
  return candidate;
}

function assertSafeCandidate(value: string, field: string): void {
  if (/\s/u.test(value) || !/^[\p{L}\p{M}\u02B0-\u02FF\u0250-\u02AF\u1D00-\u1D7F]+$/u.test(value)) {
    throw new TypeError(`${field} must contain only a bounded phonetic candidate.`);
  }
}

function normalizeRecognitionStatus(value: unknown): AzureRecognitionStatus {
  if (typeof value !== "string") throw new TypeError("RecognitionStatus must be a string.");
  switch (value) {
    case "Success": return "success";
    case "NoMatch": return "no_match";
    case "InitialSilenceTimeout": return "initial_silence_timeout";
    case "BabbleTimeout": return "babble_timeout";
    case "Error": return "error";
    default: return "unknown";
  }
}

function assertStrictProjection(value: AzureFocusProjection): void {
  if (!isObject(value) || value.projectionVersion !== V2_AZURE_PROJECTION_VERSION ||
      !new Set<AzureRecognitionStatus>([
        "success", "no_match", "initial_silence_timeout", "babble_timeout", "error", "unknown"
      ]).has(value.recognitionStatus)) {
    throw new TypeError("providerProjection is invalid.");
  }
  const keys = Object.keys(value);
  if (keys.length !== 4 || keys.some((key) => !["projectionVersion", "recognitionStatus", "displayText", "target"].includes(key))) {
    throw new TypeError("providerProjection contains unsupported fields.");
  }
  if (value.recognitionStatus !== "success") {
    if (value.displayText !== null || value.target !== null) throw new TypeError("Rejected projection must not retain provider text.");
    return;
  }
  requireSafeString(value.displayText, "projection displayText", 512);
  if (!isObject(value.target)) throw new TypeError("projection target must be an object.");
  const targetKeys = Object.keys(value.target);
  if (targetKeys.length !== 3 || targetKeys.some((key) => !["phoneme", "accuracyScore", "candidates"].includes(key))) {
    throw new TypeError("projection target contains unsupported fields.");
  }
  requireCandidate(value.target.phoneme, "projection target phoneme");
  requireScore(value.target.accuracyScore, "projection target accuracyScore");
  if (!Array.isArray(value.target.candidates) || value.target.candidates.length > 32) {
    throw new TypeError("projection candidates must be a bounded array.");
  }
  value.target.candidates.forEach((candidate, index) => {
    if (!isObject(candidate) || Object.keys(candidate).length !== 2 || !("phoneme" in candidate) || !("score" in candidate)) {
      throw new TypeError(`projection candidate ${index} is invalid.`);
    }
    requireCandidate(candidate.phoneme, `projection candidate ${index} phoneme`);
    requireScore(candidate.score, `projection candidate ${index} score`);
  });
}

export function assertJsonComplexity(value: unknown, limits: ProviderStructureLimits = {}): void {
  const maxDepth = limits.maxDepth ?? 12;
  const maxNodes = limits.maxNodes ?? 2_048;
  const maxArrayLength = limits.maxArrayLength ?? 256;
  const maxStringLength = limits.maxStringLength ?? 512;
  for (const [name, limit] of Object.entries({ maxDepth, maxNodes, maxArrayLength, maxStringLength })) {
    assertPositiveLimit(limit, name);
  }
  let nodes = 0;
  const visit = (nested: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > maxNodes) throw new RangeError("JSON exceeds the node limit.");
    if (depth > maxDepth) throw new RangeError("JSON exceeds the depth limit.");
    if (typeof nested === "string") {
      if (nested.length > maxStringLength) throw new RangeError("JSON contains an overlong string.");
      if (hasControlCharacter(nested)) throw new TypeError("JSON contains a control character.");
      return;
    }
    if (Array.isArray(nested)) {
      if (nested.length > maxArrayLength) throw new RangeError("JSON exceeds the array length limit.");
      nested.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (isObject(nested)) Object.values(nested).forEach((item) => visit(item, depth + 1));
  };
  visit(value, 0);
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
function byteLength(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
function nextPowerOfTwo(value: number): number { return 2 ** Math.ceil(Math.log2(value)); }
function assertPositiveLimit(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${field} must be a positive integer.`);
}
function hasControlCharacter(value: string): boolean { return /[\u0000-\u001f\u007f-\u009f]/u.test(value); }
function containsForbiddenStoredMaterial(value: string): boolean {
  return /(?:\b[a-z][a-z0-9+.-]*:\/\/|\b(?:file|content|data):|\bbearer\s+|-----BEGIN|(?:token|secret|password|api[_-]?key|credential)\s*[:=])/iu.test(value);
}
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
