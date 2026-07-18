import assert from "node:assert/strict";
import test from "node:test";

import { normalizePronunciationAssessment, sanitizePerformanceTiming } from "../lib/pronunciation-result.mjs";
import { capabilitiesForLocale } from "../lib/speech-token.mjs";

const raw = {
  NBest: [{
    PronunciationAssessment: { PronScore: 78, AccuracyScore: 81, FluencyScore: 74, CompletenessScore: 100, ProsodyScore: 72 },
    Words: [{
      Word: "think",
      Offset: 10,
      Duration: 20,
      PronunciationAssessment: { AccuracyScore: 46, ErrorType: "UnexpectedBreak" },
      Syllables: [{ Syllable: "θɪŋk", Offset: 10, Duration: 20, PronunciationAssessment: { AccuracyScore: 46 } }],
      Phonemes: [{
        Phoneme: "θ",
        Offset: 10,
        Duration: 5,
        PronunciationAssessment: {
          AccuracyScore: 46,
          NBestPhonemes: [{ Phoneme: "θ", Score: 46 }, { Phoneme: "s", Score: 91 }, { Phoneme: "t", Score: 20 }]
        }
      }]
    }, {
      Word: "now",
      PronunciationAssessment: { AccuracyScore: 80, ErrorType: "MissingBreak,Monotone" },
      Phonemes: []
    }]
  }]
};

test("normalizes scores, timings, issues, syllables, and sorted IPA candidates", () => {
  const result = normalizePronunciationAssessment({
    azureRawJson: raw,
    locale: "en-US",
    referenceText: "think now",
    capabilities: capabilitiesForLocale("en-US"),
    timing: { buttonToResultMs: 650 }
  });
  assert.equal(result.overall.pronunciationScore, 78);
  assert.equal(result.timing.buttonToResultMs, 650);
  assert.equal(result.words[0].phonemes[0].observedIpa, "s");
  assert.deepEqual(result.words[0].phonemes[0].candidates.map((candidate) => candidate.ipa), ["s", "θ", "t"]);
  assert.equal(result.issues.unexpectedBreaks.length, 1);
  assert.equal(result.issues.missingBreaks.length, 1);
  assert.equal(result.issues.monotoneSegments.length, 1);
  assert.equal(result.words[0].syllables[0].syllable, "θɪŋk");
});

test("missing and unsupported values remain null instead of becoming zero", () => {
  const result = normalizePronunciationAssessment({
    azureRawJson: { NBest: [{ Words: [] }] },
    locale: "fr-FR",
    referenceText: "bonjour",
    capabilities: { phonemeScores: false, ipaPhonemeNames: false, spokenPhonemeCandidates: false, syllables: false, prosody: false, miscue: false }
  });
  assert.equal(result.overall.accuracyScore, null);
  assert.equal(result.overall.prosodyScore, null);
  assert.equal(result.timing.buttonToResultMs, null);
});

test("classifies omission, insertion, and nested prosody issue types independently", () => {
  const result = normalizePronunciationAssessment({
    azureRawJson: {
      NBest: [{
        Words: [
          { Word: "left", PronunciationAssessment: { ErrorType: "Omission" } },
          { Word: "extra", PronunciationAssessment: { ErrorType: "Insertion" } },
          {
            Word: "pause",
            PronunciationAssessment: {
              Feedback: {
                Prosody: {
                  Break: { ErrorTypes: ["UnexpectedBreak", "MissingBreak"] },
                  Intonation: { ErrorTypes: ["Monotone"] }
                }
              }
            }
          }
        ]
      }]
    },
    locale: "en-US",
    referenceText: "left pause",
    capabilities: capabilitiesForLocale("en-US")
  });

  assert.equal(result.issues.omittedWords[0].word, "left");
  assert.equal(result.issues.insertedWords[0].word, "extra");
  assert.equal(result.issues.unexpectedBreaks[0].word, "pause");
  assert.equal(result.issues.missingBreaks[0].word, "pause");
  assert.equal(result.issues.monotoneSegments[0].word, "pause");
});

test("candidate lists are capped at five and invalid payloads are rejected", () => {
  const candidates = [10, 70, 50, 90, 30, 80].map((score, index) => ({ Phoneme: `p${index}`, Score: score }));
  const result = normalizePronunciationAssessment({
    azureRawJson: { NBest: [{ Words: [{ Phonemes: [{ Phoneme: "p", PronunciationAssessment: { NBestPhonemes: candidates } }] }] }] },
    locale: "en-US",
    referenceText: "p",
    capabilities: capabilitiesForLocale("en-US")
  });
  assert.deepEqual(result.words[0].phonemes[0].candidates.map((candidate) => candidate.score), [90, 80, 70, 50, 30]);
  assert.throws(() => normalizePronunciationAssessment({ azureRawJson: null }), /must be an object/);
  assert.throws(() => normalizePronunciationAssessment({ azureRawJson: [] }), /must be an object/);
});

test("normalization is locale-capability based and never applies nationality or native-language score correction", () => {
  const base = {
    azureRawJson: raw,
    locale: "en-US",
    referenceText: "think now",
    capabilities: capabilitiesForLocale("en-US")
  };
  const first = normalizePronunciationAssessment({ ...base, nativeLanguage: "ja", nationality: "JP" });
  const second = normalizePronunciationAssessment({ ...base, nativeLanguage: "es", nationality: "MX" });
  assert.deepEqual(first, second);
});

test("performance timing accepts only non-sensitive numeric allowlisted fields", () => {
  assert.deepEqual(sanitizePerformanceTiming({ tokenFetchMs: 25, buttonToUiMs: "bad", transcript: "private words", token: "secret" }), {
    tokenFetchMs: 25,
    recognizerPreparationMs: null,
    buttonToAzureResultMs: null,
    normalizationMs: null,
    buttonToUiMs: null,
    buttonToResultMs: null,
    recognitionLatencyMs: null,
    totalProcessingMs: null,
    audioDurationMs: null
  });
});
