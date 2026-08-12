import defaultManifest from "../validation-content/manifest.json" with { type: "json" };

/**
 * Development/Preview-only adapter. It deliberately does not advertise these
 * rows as human-reviewed or Azure-validated production content. The DB content
 * version must independently exist and match the explicitly configured UUID.
 */
export function createValidationContentRepository({ config, userId, installationId, developmentClientMarker, manifest = defaultManifest }) {
  assertValidationContentAccess(config, userId, installationId, developmentClientMarker);
  assertManifest(manifest);
  const contentVersionId = config.v2ValidationContentVersionId;
  if(contentVersionId!==manifest.contentVersionId) throw new Error("VALIDATION_CONTENT_VERSION_MISMATCH");
  const audio = Object.fromEntries(manifest.assets.map((asset) => [asset.key, asset]));
  const rows = [
    row("validation-light-anchor", "anchor", "light", "seed-word-l-001", audio.light),
    row("validation-right-contrast", "contrast", "right", "seed-word-r-001", audio.right),
    row("validation-light-transfer", "transfer_word", "light", "seed-word-l-001", audio.light),
    row("validation-read-sentence", "sentence", "I read it again.", "seed-sent-r-001", audio.read),
    row("validation-right-review-substitute", "transfer_word", "right", "seed-word-r-001", audio.right),
    row("validation-light-optional", "optional_extension", "light", "seed-word-l-001", audio.light),
    row("validation-right-optional", "optional_extension", "right", "seed-word-r-001", audio.right)
  ];
  return {
    validationOnly: true,
    contentVersionId,
    manifestSha256: manifest.manifestSha256,
    async listFocusCandidates() {
      return [{
        id: "validation-r-l",
        focusGroupKey: "r-l",
        kind: "unevaluated",
        active: false,
        humanReviewed: false,
        azureValidated: false,
        developmentValidation: true
      }];
    },
    async listContentCandidates() { return rows; },
    async listReviewSchedules() { return []; }
  };

  function row(practiceItemKey, promptRole, referenceText, referenceTextVersion, asset) {
    return {
      contentVersionId,
      practiceItemKey,
      focusGroupKey: "r-l",
      promptRole,
      active: false,
      humanReviewed: false,
      azureValidated: false,
      developmentValidation: true,
      referenceText,
      referenceTextVersion,
      expectedFocusRepresentation: referenceText === "light" ? "l" : "r",
      targetLocator: { wordIndex: referenceText === "I read it again." ? 1 : 0, phonemeIndex: 0 },
      nextActionKey: null,
      referenceAudio: {
        standardUrl: asset.standard.url,
        slowUrl: asset.slow.url,
        version: manifest.audioVersion,
        manifestSha256: manifest.manifestSha256
      }
    };
  }
}

function assertManifest(manifest) {
  if (manifest?.status !== "ready" || !Array.isArray(manifest.assets) || manifest.assets.length !== 3 ||
      !/^[0-9a-f]{64}$/.test(manifest.manifestSha256 ?? "") ||
      !/^[0-9a-f-]{36}$/.test(manifest.contentVersionId ?? "") ||
      manifest.stableReleaseId!=="development-validation-r-l" || manifest.version!==1 ||
      manifest.focusGroupKey!=="r-l") {
    throw new Error("VALIDATION_CONTENT_MANIFEST_NOT_READY");
  }
  for (const asset of manifest.assets) {
    for (const variant of [asset?.standard, asset?.slow]) {
      if (typeof variant?.url !== "string" || !variant.url.startsWith("/validation-audio/") ||
          !/^[0-9a-f]{64}$/.test(variant.sha256 ?? "")) {
        throw new Error("VALIDATION_CONTENT_MANIFEST_INVALID");
      }
    }
  }
}

export function assertValidationContentAccess(config, userId, installationId, developmentClientMarker) {
  if (!config.v2ValidationContentEnabled) throw new Error("VALIDATION_CONTENT_DISABLED");
  if (config.deploymentEnvironment === "production") throw new Error("VALIDATION_CONTENT_FORBIDDEN_IN_PRODUCTION");
  if (!new Set(["preview", "development", "test"]).has(config.deploymentEnvironment)) {
    throw new Error("VALIDATION_CONTENT_ENVIRONMENT_NOT_ALLOWED");
  }
  if (!config.v2ValidationContentVersionId || !config.v2ValidationTesterUserIds.has(userId) ||
      !installationId || !config.v2ValidationInstallationIds.has(installationId) ||
      !config.v2ValidationDevelopmentClientMarker ||
      developmentClientMarker !== config.v2ValidationDevelopmentClientMarker) {
    throw new Error("VALIDATION_CONTENT_TESTER_NOT_ALLOWED");
  }
}

export { defaultManifest as VALIDATION_CONTENT_MANIFEST };
