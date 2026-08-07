/** @typedef {"home" | "progress" | "practice" | "settings"} TabKey */
/** @typedef {"daily" | "weak_drill" | "phoneme_select" | "free_input"} PracticeMode */
/** @typedef {"progress" | "weak_drill" | "phoneme_select" | "free_input"} LegacyUiFeature */

export const LEGACY_UI_DISABLED_CODE = "LEGACY_UI_DISABLED";
export const LEGACY_UI_DISABLED_MESSAGE = "この練習は現在のビルドでは利用できません。";

export const LEGACY_UI_FEATURES = Object.freeze({
  progress: "progress",
  weakDrill: "weak_drill",
  phonemeSelect: "phoneme_select",
  freeInput: "free_input"
});

/** @type {readonly TabKey[]} */
const DEFAULT_TABS = Object.freeze(["home", "practice", "settings"]);
/** @type {readonly TabKey[]} */
const LEGACY_TABS = Object.freeze(["home", "progress", "practice", "settings"]);
/** @type {readonly PracticeMode[]} */
const DEFAULT_PRACTICE_MODES = Object.freeze(["daily"]);
/** @type {readonly PracticeMode[]} */
const LEGACY_PRACTICE_MODES = Object.freeze(["daily", "weak_drill", "phoneme_select", "free_input"]);

export class LegacyUiDisabledError extends Error {
  /** @param {string} target */
  constructor(target) {
    super(LEGACY_UI_DISABLED_MESSAGE);
    this.name = "LegacyUiDisabledError";
    this.code = LEGACY_UI_DISABLED_CODE;
    this.target = target;
  }
}

/**
 * The default stays disabled for new builds. Tests and a deliberate development
 * rollback can create an enabled gate without changing API, database, or remote
 * feature-flag state.
 *
 * @param {{ legacyUiEnabled?: boolean }} [options]
 */
export function createLegacyUiGate({ legacyUiEnabled = false } = {}) {
  const enabled = legacyUiEnabled === true;

  /** @param {TabKey} tab */
  const allowsTab = (tab) => DEFAULT_TABS.includes(tab) || (enabled && tab === "progress");
  /** @param {PracticeMode} mode */
  const allowsPracticeMode = (mode) => mode === "daily" || (enabled && LEGACY_PRACTICE_MODES.includes(mode));
  /** @param {LegacyUiFeature} feature */
  const allowsFeature = (feature) => enabled && Object.values(LEGACY_UI_FEATURES).includes(feature);

  return Object.freeze({
    legacyUiEnabled: enabled,
    tabs: enabled ? LEGACY_TABS : DEFAULT_TABS,
    practiceModes: enabled ? LEGACY_PRACTICE_MODES : DEFAULT_PRACTICE_MODES,
    homeCompletionAction: enabled ? "progress" : null,
    allowsTab,
    allowsPracticeMode,
    allowsFeature,
    /** @param {TabKey} tab */
    assertTabAllowed(tab) {
      if (!allowsTab(tab)) throw new LegacyUiDisabledError(`tab:${tab}`);
    },
    /** @param {PracticeMode} mode */
    assertPracticeModeAllowed(mode) {
      if (!allowsPracticeMode(mode)) throw new LegacyUiDisabledError(`practice:${mode}`);
    },
    /** @param {LegacyUiFeature} feature */
    assertFeatureAllowed(feature) {
      if (!allowsFeature(feature)) throw new LegacyUiDisabledError(`feature:${feature}`);
    }
  });
}

export const legacyUiGate = createLegacyUiGate();
