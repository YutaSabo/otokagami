const ISSUE_KEYS = Object.freeze({
  Omission: "omittedWords",
  Insertion: "insertedWords",
  UnexpectedBreak: "unexpectedBreaks",
  MissingBreak: "missingBreaks",
  Monotone: "monotoneSegments"
});

const PERFORMANCE_TIMING_KEYS = Object.freeze([
  "tokenFetchMs",
  "recognizerPreparationMs",
  "buttonToAzureResultMs",
  "normalizationMs",
  "buttonToUiMs",
  "buttonToResultMs",
  "recognitionLatencyMs",
  "totalProcessingMs",
  "audioDurationMs"
]);

function finiteScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
}

function finiteTiming(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function sanitizePerformanceTiming(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(PERFORMANCE_TIMING_KEYS.map((key) => [key, finiteTiming(source[key])]));
}

function assessment(node) {
  return node?.PronunciationAssessment ?? node?.pronunciationAssessment ?? {};
}

function topHypothesis(raw) {
  return raw?.NBest?.[0] ?? raw?.nBest?.[0] ?? raw?.n_best?.[0] ?? {};
}

function candidateList(phoneme) {
  const items = assessment(phoneme).NBestPhonemes ?? phoneme?.NBestPhonemes ?? phoneme?.nBestPhonemes ?? [];
  return Array.isArray(items)
    ? items
        .map((item) => ({
          ipa: typeof (item?.Phoneme ?? item?.phoneme) === "string" ? item.Phoneme ?? item.phoneme : null,
          score: finiteScore(item?.Score ?? item?.score)
        }))
        .filter((item) => item.ipa)
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
        .slice(0, 5)
    : [];
}

function issue(errorType, word, wordIndex) {
  return {
    type: errorType,
    word: word?.Word ?? word?.word ?? null,
    wordIndex,
    offset: finiteTiming(word?.Offset ?? word?.offset),
    duration: finiteTiming(word?.Duration ?? word?.duration),
    confidence: finiteScore(assessment(word)?.Confidence ?? word?.Confidence ?? word?.confidence)
  };
}

function errorTypesForWord(word) {
  const pa = assessment(word);
  const direct = pa.ErrorType ?? pa.errorType ?? word?.ErrorType ?? word?.errorType;
  const values = Array.isArray(direct) ? direct : typeof direct === "string" ? direct.split(/[;,]/) : [];
  const feedback = pa.Feedback ?? word?.Feedback ?? {};
  const prosody = feedback?.Prosody ?? feedback?.prosody ?? {};
  const nestedValues = (value) => Array.isArray(value) ? value : typeof value === "string" ? value.split(/[;,]/) : [];
  const nested = [
    ...nestedValues(feedback?.Break?.ErrorTypes ?? feedback?.break?.errorTypes),
    ...nestedValues(feedback?.Intonation?.ErrorTypes ?? feedback?.intonation?.errorTypes),
    ...nestedValues(prosody?.Break?.ErrorTypes ?? prosody?.break?.errorTypes),
    ...nestedValues(prosody?.Intonation?.ErrorTypes ?? prosody?.intonation?.errorTypes)
  ];
  return [...new Set(values.concat(nested).map((value) => String(value).trim()).filter((value) => ISSUE_KEYS[value]))];
}

export function normalizePronunciationAssessment({
  azureRawJson,
  locale = "en-US",
  referenceText,
  capabilities,
  timing = {}
}) {
  if (!azureRawJson || typeof azureRawJson !== "object" || Array.isArray(azureRawJson)) {
    throw new TypeError("Azure pronunciation result must be an object");
  }
  const hypothesis = topHypothesis(azureRawJson);
  const rootAssessment = assessment(hypothesis);
  const words = Array.isArray(hypothesis.Words ?? hypothesis.words) ? hypothesis.Words ?? hypothesis.words : [];
  const issues = {
    omittedWords: [],
    insertedWords: [],
    unexpectedBreaks: [],
    missingBreaks: [],
    monotoneSegments: []
  };

  const normalizedWords = words.map((word, wordIndex) => {
    for (const type of errorTypesForWord(word)) issues[ISSUE_KEYS[type]].push(issue(type, word, wordIndex));
    const syllables = Array.isArray(word.Syllables ?? word.syllables) ? word.Syllables ?? word.syllables : [];
    const phonemes = Array.isArray(word.Phonemes ?? word.phonemes) ? word.Phonemes ?? word.phonemes : [];
    return {
      word: word.Word ?? word.word ?? null,
      accuracyScore: finiteScore(assessment(word).AccuracyScore ?? assessment(word).accuracyScore),
      errorType: assessment(word).ErrorType ?? assessment(word).errorType ?? null,
      offset: finiteTiming(word.Offset ?? word.offset),
      duration: finiteTiming(word.Duration ?? word.duration),
      syllables: capabilities?.syllables
        ? syllables.map((syllable) => ({
            syllable: syllable.Syllable ?? syllable.syllable ?? null,
            accuracyScore: finiteScore(assessment(syllable).AccuracyScore ?? assessment(syllable).accuracyScore),
            offset: finiteTiming(syllable.Offset ?? syllable.offset),
            duration: finiteTiming(syllable.Duration ?? syllable.duration)
          }))
        : null,
      phonemes: capabilities?.phonemeScores
        ? phonemes.map((phoneme) => {
            const candidates = capabilities?.spokenPhonemeCandidates ? candidateList(phoneme) : null;
            return {
              expectedIpa: capabilities?.ipaPhonemeNames ? phoneme.Phoneme ?? phoneme.phoneme ?? null : null,
              accuracyScore: finiteScore(assessment(phoneme).AccuracyScore ?? assessment(phoneme).accuracyScore),
              offset: finiteTiming(phoneme.Offset ?? phoneme.offset),
              duration: finiteTiming(phoneme.Duration ?? phoneme.duration),
              observedIpa: candidates?.[0]?.ipa ?? null,
              candidates
            };
          })
        : null
    };
  });

  return {
    provider: "azure",
    locale,
    referenceText,
    timing: {
      buttonToResultMs: finiteTiming(timing.buttonToResultMs),
      recognitionLatencyMs: finiteTiming(timing.recognitionLatencyMs),
      totalProcessingMs: finiteTiming(timing.totalProcessingMs)
    },
    capabilities: { ...capabilities },
    overall: {
      pronunciationScore: finiteScore(rootAssessment.PronScore ?? rootAssessment.pronScore ?? hypothesis.PronScore),
      accuracyScore: finiteScore(rootAssessment.AccuracyScore ?? rootAssessment.accuracyScore ?? hypothesis.AccuracyScore),
      fluencyScore: finiteScore(rootAssessment.FluencyScore ?? rootAssessment.fluencyScore ?? hypothesis.FluencyScore),
      completenessScore: finiteScore(rootAssessment.CompletenessScore ?? rootAssessment.completenessScore ?? hypothesis.CompletenessScore),
      prosodyScore: capabilities?.prosody
        ? finiteScore(rootAssessment.ProsodyScore ?? rootAssessment.prosodyScore ?? hypothesis.ProsodyScore)
        : null
    },
    issues,
    words: normalizedWords
  };
}
