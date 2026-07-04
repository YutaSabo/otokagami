export type ScoreColor = "green" | "yellow" | "red";
export type ItemType = "word" | "sentence";
export type SlotType = "weak" | "new" | "review";
export type Difficulty = "high" | "medium" | "low";

export interface PhonemeResult {
  index: number;
  wordIndex: number | null;
  expectedPhonemeId: string;
  expectedIpa: string;
  observedPhonemeId: string | null;
  observedIpa: string | null;
  score: number;
  color: ScoreColor;
  isTarget: boolean;
  confusionPairId: string | null;
}

export interface RawPhonemeResult extends Omit<PhonemeResult, "color"> {
  color?: ScoreColor;
}

export interface AttemptForBestSelection {
  id: string;
  attemptNo: number;
  overallScore: number;
  phonemeResults: PhonemeResult[];
}

export interface PhonemeState {
  phonemeId: string;
  masteryEwma: number | null;
  reviewStage: number;
  nextReviewDate: string | null;
  practiceCount: number;
  lastPracticedDate: string | null;
  jaDifficulty: Difficulty;
}

export interface PracticeItem {
  practiceItemId: string;
  itemType: ItemType;
  targetPhonemeIds: string[];
  jaDifficulty: Difficulty;
  isActive: boolean;
}

export interface SelectedPracticeItem {
  position: number;
  slotType: SlotType;
  practiceItemId: string;
  itemType: ItemType;
  targetPhonemeIds: string[];
  selectionReason: {
    source: SlotType | "phoneme_select";
    phonemeId: string;
    duplicateAllowed: boolean;
    fallbackFrom?: SlotType;
  };
}

export interface DailySession<TItem = SelectedPracticeItem> {
  sessionDate: string;
  timezone: string;
  items: TItem[];
}

export interface BadgeContext {
  existingBadgeIds: string[];
  completedDailyCount: number;
  currentStreak: number;
  hasPerfectItem: boolean;
  phonemeStates: PhonemeState[];
  completedItemCount: number;
}

export interface BadgeAward {
  badgeId: string;
  name: string;
}

export interface TitleContext {
  today: string;
  currentStreak: number;
  phonemeStates: PhonemeState[];
  recentPracticeDatesByPhoneme: Record<string, string[]>;
  completedItemCount: number;
}

export interface UserTitle {
  titleId: string;
  name: string;
}

export const LEVELS = [
  { level: 1, requiredCompletedItems: 0, name: "はじめの一音" },
  { level: 2, requiredCompletedItems: 10, name: "発音ウォーカー" },
  { level: 3, requiredCompletedItems: 25, name: "音素トレーナー" },
  { level: 4, requiredCompletedItems: 50, name: "苦手音ハンター" },
  { level: 5, requiredCompletedItems: 100, name: "発音ミラー常連" },
  { level: 6, requiredCompletedItems: 200, name: "通じる音の職人" },
  { level: 7, requiredCompletedItems: 350, name: "音素マスター" },
  { level: 8, requiredCompletedItems: 500, name: "発音ミラー名人" }
] as const;

const REVIEW_INTERVAL_DAYS: Record<number, number> = {
  0: 1,
  1: 3,
  2: 7,
  3: 14
};

const DIFFICULTY_RANK: Record<Difficulty, number> = {
  high: 3,
  medium: 2,
  low: 1
};

const BADGES: BadgeAward[] = [
  { badgeId: "first_daily_complete", name: "はじめての完走" },
  { badgeId: "streak_3", name: "3日連続" },
  { badgeId: "streak_7", name: "7日連続" },
  { badgeId: "streak_14", name: "14日連続" },
  { badgeId: "first_perfect_item", name: "初パーフェクト" },
  { badgeId: "th_green", name: "THが見えてきた" },
  { badgeId: "r_l_green", name: "R/L突破" },
  { badgeId: "v_b_green", name: "V/B突破" },
  { badgeId: "daily_30_items", name: "30問達成" },
  { badgeId: "daily_100_items", name: "100問達成" }
];

export function getScoreColor(score: number): ScoreColor {
  if (score >= 80) return "green";
  if (score >= 60) return "yellow";
  return "red";
}

export function normalizePhonemeResult(result: RawPhonemeResult): PhonemeResult {
  return {
    ...result,
    color: getScoreColor(result.score)
  };
}

export function isQuestionCorrect(results: PhonemeResult[]): boolean {
  const targetResults = results.filter((result) => result.isTarget);
  return targetResults.length > 0 && targetResults.every((result) => result.score >= 80);
}

export function isPerfectAttempt(results: PhonemeResult[]): boolean {
  return results.length > 0 && results.every((result) => result.score >= 80);
}

export function updateEwma(oldValue: number | null, score: number): number {
  return oldValue === null ? score : 0.3 * score + 0.7 * oldValue;
}

export function getReviewIntervalDays(reviewStage: number): number {
  return REVIEW_INTERVAL_DAYS[clampReviewStage(reviewStage)];
}

export function updateReviewStage(oldStage: number, isCorrect: boolean): number {
  return isCorrect ? Math.min(clampReviewStage(oldStage) + 1, 3) : 0;
}

export function addDays(date: string, days: number): string {
  const parsed = parseDateOnly(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return formatDateOnly(parsed);
}

export function selectBestAttempt<TAttempt extends AttemptForBestSelection>(
  attempts: TAttempt[]
): TAttempt | null {
  return attempts.reduce<TAttempt | null>((best, attempt) => {
    if (best === null) return attempt;

    const attemptTargetAverage = getTargetScoreAverage(attempt.phonemeResults);
    const bestTargetAverage = getTargetScoreAverage(best.phonemeResults);

    if (attemptTargetAverage !== bestTargetAverage) {
      return attemptTargetAverage > bestTargetAverage ? attempt : best;
    }

    if (attempt.overallScore !== best.overallScore) {
      return attempt.overallScore > best.overallScore ? attempt : best;
    }

    return attempt.attemptNo > best.attemptNo ? attempt : best;
  }, null);
}

export function updatePhonemeStatesForBestAttempt(input: {
  states: PhonemeState[];
  bestAttempt: AttemptForBestSelection;
  practicedDate: string;
  isFreeInput?: boolean;
}): PhonemeState[] {
  if (input.isFreeInput) return input.states.map(clonePhonemeState);

  const statesByPhoneme = new Map(input.states.map((state) => [state.phonemeId, state]));

  return input.states.map((state) => {
    const targetScores = input.bestAttempt.phonemeResults
      .filter((result) => result.isTarget && result.expectedPhonemeId === state.phonemeId)
      .map((result) => result.score);

    if (targetScores.length === 0) return clonePhonemeState(state);

    const score = average(targetScores);
    const phonemeCorrect = targetScores.every((targetScore) => targetScore >= 80);
    const reviewStage = updateReviewStage(state.reviewStage, phonemeCorrect);

    return {
      ...statesByPhoneme.get(state.phonemeId)!,
      masteryEwma: updateEwma(state.masteryEwma, score),
      reviewStage,
      nextReviewDate: addDays(input.practicedDate, getReviewIntervalDays(reviewStage)),
      practiceCount: state.practiceCount + 1,
      lastPracticedDate: input.practicedDate
    };
  });
}

export function calculateOverallMastery(states: PhonemeState[]): number | null {
  const evaluated = states
    .map((state) => state.masteryEwma)
    .filter((mastery): mastery is number => mastery !== null);

  return evaluated.length === 0 ? null : average(evaluated);
}

export function calculateStreak(scoredAttemptDates: string[], today: string): {
  currentStreak: number;
  longestStreak: number;
} {
  const uniqueDates = [...new Set(scoredAttemptDates)].sort();
  const practicedDates = new Set(uniqueDates);
  const startDate = practicedDates.has(today) ? today : addDays(today, -1);
  let currentStreak = 0;

  for (let date = startDate; practicedDates.has(date); date = addDays(date, -1)) {
    currentStreak += 1;
  }

  let longestStreak = 0;
  let runLength = 0;
  let previous: string | null = null;

  for (const date of uniqueDates) {
    runLength = previous !== null && addDays(previous, 1) === date ? runLength + 1 : 1;
    longestStreak = Math.max(longestStreak, runLength);
    previous = date;
  }

  return { currentStreak, longestStreak };
}

export function getLevel(completedItemCount: number): (typeof LEVELS)[number] {
  return [...LEVELS]
    .reverse()
    .find((level) => completedItemCount >= level.requiredCompletedItems)!;
}

export function evaluateNewBadges(context: BadgeContext): BadgeAward[] {
  const existing = new Set(context.existingBadgeIds);

  return BADGES.filter((badge) => !existing.has(badge.badgeId)).filter((badge) => {
    switch (badge.badgeId) {
      case "first_daily_complete":
        return context.completedDailyCount >= 1;
      case "streak_3":
        return context.currentStreak >= 3;
      case "streak_7":
        return context.currentStreak >= 7;
      case "streak_14":
        return context.currentStreak >= 14;
      case "first_perfect_item":
        return context.hasPerfectItem;
      case "th_green":
        return isAnyMastered(context.phonemeStates, ["theta", "dh"]);
      case "r_l_green":
        return areAllMastered(context.phonemeStates, ["r", "l"]);
      case "v_b_green":
        return areAllMastered(context.phonemeStates, ["v", "b"]);
      case "daily_30_items":
        return context.completedItemCount >= 30;
      case "daily_100_items":
        return context.completedItemCount >= 100;
      default:
        return false;
    }
  });
}

export function evaluateTitle(context: TitleContext): UserTitle {
  if (context.currentStreak >= 7) {
    return { titleId: "seven_day_streak", name: "7日継続中" };
  }

  if (
    isAnyMastered(context.phonemeStates, ["theta", "dh"]) &&
    hasRecentPractice(context.recentPracticeDatesByPhoneme, ["theta", "dh"], context.today)
  ) {
    return { titleId: "th_specialist", name: "TH集中突破中" };
  }

  if (
    hasRecentPractice(context.recentPracticeDatesByPhoneme, ["r", "l"], context.today) &&
    !areAllMastered(context.phonemeStates, ["r", "l"])
  ) {
    return { titleId: "rl_specialist", name: "R/L調整中" };
  }

  if (context.completedItemCount >= 50) {
    return { titleId: "daily_regular", name: "毎日の発音習慣" };
  }

  return { titleId: "starter", name: "発音ミラー入門" };
}

export function selectDailyItems(input: {
  today: string;
  phonemeStates: PhonemeState[];
  practiceItems: PracticeItem[];
}): SelectedPracticeItem[] {
  const slots: Array<{ slotType: SlotType; itemType: ItemType }> = [
    { slotType: "weak", itemType: "word" },
    { slotType: "weak", itemType: "word" },
    { slotType: "weak", itemType: "sentence" },
    { slotType: "new", itemType: "word" },
    { slotType: "new", itemType: "word" },
    { slotType: "review", itemType: "word" },
    { slotType: "review", itemType: "sentence" }
  ];

  const selected: SelectedPracticeItem[] = [];

  for (const [index, slot] of slots.entries()) {
    selected.push(selectForSlot({
      position: index + 1,
      slotType: slot.slotType,
      itemType: slot.itemType,
      today: input.today,
      states: input.phonemeStates,
      practiceItems: input.practiceItems,
      usedItemIds: new Set(selected.map((item) => item.practiceItemId))
    }));
  }

  return selected;
}

export function selectWeakDrillItems(input: {
  today: string;
  phonemeStates: PhonemeState[];
  practiceItems: PracticeItem[];
  limit: number;
  itemType?: ItemType;
}): SelectedPracticeItem[] {
  const selected: SelectedPracticeItem[] = [];

  for (let position = 1; position <= input.limit; position += 1) {
    selected.push(
      selectForCandidateOrder({
        position,
        slotType: "weak",
        itemType: input.itemType,
        today: input.today,
        states: sortWeakDrillCandidates(input.phonemeStates),
        practiceItems: input.practiceItems,
        usedItemIds: new Set(selected.map((item) => item.practiceItemId)),
        source: "weak"
      })
    );
  }

  return selected;
}

export function selectPhonemePracticeItems(input: {
  phonemeId: string;
  practiceItems: PracticeItem[];
  limit: number;
  itemType?: ItemType;
}): SelectedPracticeItem[] {
  return input.practiceItems
    .filter((item) => isUsableItem(item, input.itemType) && item.targetPhonemeIds.includes(input.phonemeId))
    .sort(comparePracticeItems)
    .slice(0, input.limit)
    .map((item, index) => ({
      position: index + 1,
      slotType: "weak",
      practiceItemId: item.practiceItemId,
      itemType: item.itemType,
      targetPhonemeIds: item.targetPhonemeIds,
      selectionReason: {
        source: "phoneme_select",
        phonemeId: input.phonemeId,
        duplicateAllowed: false
      }
    }));
}

export function resolveDailySession<TItem>(input: {
  existingSessions: DailySession<TItem>[];
  sessionDate: string;
  timezone: string;
  createItems: () => TItem[];
}): DailySession<TItem> & { reusedExisting: boolean } {
  const existing = input.existingSessions.find((session) => session.sessionDate === input.sessionDate);

  if (existing !== undefined) {
    return { ...existing, reusedExisting: true };
  }

  return {
    sessionDate: input.sessionDate,
    timezone: input.timezone,
    items: input.createItems(),
    reusedExisting: false
  };
}

function getTargetScoreAverage(results: PhonemeResult[]): number {
  const scores = results.filter((result) => result.isTarget).map((result) => result.score);
  return scores.length === 0 ? Number.NEGATIVE_INFINITY : average(scores);
}

function selectForSlot(input: {
  position: number;
  slotType: SlotType;
  itemType: ItemType;
  today: string;
  states: PhonemeState[];
  practiceItems: PracticeItem[];
  usedItemIds: Set<string>;
}): SelectedPracticeItem {
  const fallbackOrder: Record<SlotType, SlotType[]> = {
    weak: ["weak", "review", "new"],
    new: ["new", "review", "weak"],
    review: ["review", "weak", "new"]
  };

  for (const source of fallbackOrder[input.slotType]) {
    const selected = trySelectForSource({ ...input, source });
    if (selected !== null) return selected;
  }

  return selectForCandidateOrder({
    ...input,
    states: sortNewCandidates(input.states),
    source: "new"
  });
}

function trySelectForSource(input: {
  position: number;
  slotType: SlotType;
  itemType?: ItemType;
  today: string;
  states: PhonemeState[];
  practiceItems: PracticeItem[];
  usedItemIds: Set<string>;
  source: SlotType;
}): SelectedPracticeItem | null {
  const candidates = getCandidatesForSource(input.source, input.states, input.today);
  if (candidates.length === 0) return null;

  return selectForCandidateOrder({ ...input, states: candidates, source: input.source });
}

function selectForCandidateOrder(input: {
  position: number;
  slotType: SlotType;
  itemType?: ItemType;
  today: string;
  states: PhonemeState[];
  practiceItems: PracticeItem[];
  usedItemIds: Set<string>;
  source: SlotType;
}): SelectedPracticeItem {
  const usableItems = input.practiceItems.filter((item) => isUsableItem(item, input.itemType));

  for (const state of input.states) {
    const item = usableItems
      .filter((candidate) => candidate.targetPhonemeIds.includes(state.phonemeId))
      .filter((candidate) => !input.usedItemIds.has(candidate.practiceItemId))
      .sort(comparePracticeItems)[0];

    if (item !== undefined) {
      return toSelectedPracticeItem(input, item, state.phonemeId, false);
    }
  }

  for (const state of input.states) {
    const item = usableItems
      .filter((candidate) => candidate.targetPhonemeIds.includes(state.phonemeId))
      .sort(comparePracticeItems)[0];

    if (item !== undefined) {
      return toSelectedPracticeItem(input, item, state.phonemeId, true);
    }
  }

  const fallbackItem = usableItems.sort(comparePracticeItems)[0];
  if (fallbackItem === undefined) {
    throw new Error(`No active practice item available for ${input.itemType ?? "any"} slot.`);
  }

  return toSelectedPracticeItem(input, fallbackItem, fallbackItem.targetPhonemeIds[0] ?? "", true);
}

function toSelectedPracticeItem(
  input: {
    position: number;
    slotType: SlotType;
    source: SlotType;
  },
  item: PracticeItem,
  phonemeId: string,
  duplicateAllowed: boolean
): SelectedPracticeItem {
  return {
    position: input.position,
    slotType: input.slotType,
    practiceItemId: item.practiceItemId,
    itemType: item.itemType,
    targetPhonemeIds: item.targetPhonemeIds,
    selectionReason: {
      source: input.source,
      phonemeId,
      duplicateAllowed,
      fallbackFrom: input.source === input.slotType ? undefined : input.slotType
    }
  };
}

function getCandidatesForSource(source: SlotType, states: PhonemeState[], today: string): PhonemeState[] {
  switch (source) {
    case "weak":
      return sortWeakCandidates(states);
    case "new":
      return sortNewCandidates(states);
    case "review":
      return sortReviewCandidates(states, today);
  }
}

function sortWeakCandidates(states: PhonemeState[]): PhonemeState[] {
  return [...states]
    .filter((state) => state.masteryEwma !== null)
    .sort((a, b) => {
      return (
        a.masteryEwma! - b.masteryEwma! ||
        DIFFICULTY_RANK[b.jaDifficulty] - DIFFICULTY_RANK[a.jaDifficulty] ||
        compareNullableDate(a.lastPracticedDate, b.lastPracticedDate) ||
        a.phonemeId.localeCompare(b.phonemeId)
      );
    });
}

function sortWeakDrillCandidates(states: PhonemeState[]): PhonemeState[] {
  return [...states].sort((a, b) => {
    return (
      Number(b.masteryEwma !== null && b.masteryEwma < 60) -
        Number(a.masteryEwma !== null && a.masteryEwma < 60) ||
      nullableNumber(a.masteryEwma) - nullableNumber(b.masteryEwma) ||
      compareDueDate(a.nextReviewDate, b.nextReviewDate) ||
      DIFFICULTY_RANK[b.jaDifficulty] - DIFFICULTY_RANK[a.jaDifficulty] ||
      a.phonemeId.localeCompare(b.phonemeId)
    );
  });
}

function sortNewCandidates(states: PhonemeState[]): PhonemeState[] {
  return [...states]
    .filter((state) => state.practiceCount === 0 || state.masteryEwma === null)
    .sort((a, b) => {
      return (
        Number(b.practiceCount === 0) - Number(a.practiceCount === 0) ||
        DIFFICULTY_RANK[b.jaDifficulty] - DIFFICULTY_RANK[a.jaDifficulty] ||
        a.phonemeId.localeCompare(b.phonemeId)
      );
    });
}

function sortReviewCandidates(states: PhonemeState[], today: string): PhonemeState[] {
  return [...states]
    .filter((state) => state.nextReviewDate !== null && state.nextReviewDate <= today)
    .sort((a, b) => {
      return (
        compareNullableDate(a.nextReviewDate, b.nextReviewDate) ||
        nullableNumber(a.masteryEwma) - nullableNumber(b.masteryEwma) ||
        DIFFICULTY_RANK[b.jaDifficulty] - DIFFICULTY_RANK[a.jaDifficulty] ||
        a.phonemeId.localeCompare(b.phonemeId)
      );
    });
}

function comparePracticeItems(a: PracticeItem, b: PracticeItem): number {
  return (
    DIFFICULTY_RANK[b.jaDifficulty] - DIFFICULTY_RANK[a.jaDifficulty] ||
    a.practiceItemId.localeCompare(b.practiceItemId)
  );
}

function isUsableItem(item: PracticeItem, itemType?: ItemType): boolean {
  return item.isActive && (itemType === undefined || item.itemType === itemType);
}

function isAnyMastered(states: PhonemeState[], phonemeIds: string[]): boolean {
  return phonemeIds.some((phonemeId) => getMastery(states, phonemeId) >= 80);
}

function areAllMastered(states: PhonemeState[], phonemeIds: string[]): boolean {
  return phonemeIds.every((phonemeId) => getMastery(states, phonemeId) >= 80);
}

function getMastery(states: PhonemeState[], phonemeId: string): number {
  return states.find((state) => state.phonemeId === phonemeId)?.masteryEwma ?? Number.NEGATIVE_INFINITY;
}

function hasRecentPractice(
  recentPracticeDatesByPhoneme: Record<string, string[]>,
  phonemeIds: string[],
  today: string
): boolean {
  const since = addDays(today, -6);

  return phonemeIds.some((phonemeId) =>
    (recentPracticeDatesByPhoneme[phonemeId] ?? []).some((date) => date >= since && date <= today)
  );
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampReviewStage(reviewStage: number): number {
  return Math.max(0, Math.min(3, reviewStage));
}

function parseDateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function compareNullableDate(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

function compareDueDate(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

function nullableNumber(value: number | null): number {
  return value ?? Number.POSITIVE_INFINITY;
}

function clonePhonemeState(state: PhonemeState): PhonemeState {
  return { ...state };
}
