import { ApiError, ok, readJson } from "./http.mjs";
import { getPracticeContext } from "./practice-access.mjs";
import { getOrCreateTtsReference } from "./tts.mjs";

const DIFFICULTY_RANK = { high: 3, medium: 2, low: 1 };
const DAILY_SLOTS = [
  { slotType: "weak", itemType: "word" },
  { slotType: "weak", itemType: "word" },
  { slotType: "weak", itemType: "sentence" },
  { slotType: "new", itemType: "word" },
  { slotType: "new", itemType: "word" },
  { slotType: "review", itemType: "word" },
  { slotType: "review", itemType: "sentence" }
];

function assertDateOnly(value, fieldName) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError("BAD_REQUEST", `${fieldName} が不正です。`, 400, false);
  }
  return value;
}

function assertTimezone(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "Asia/Tokyo";
}

function compareNullableDate(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

function nullableNumber(value) {
  return value === null || value === undefined ? Number.POSITIVE_INFINITY : Number(value);
}

function compareDueDate(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

function comparePracticeItems(a, b) {
  return DIFFICULTY_RANK[b.jaDifficulty] - DIFFICULTY_RANK[a.jaDifficulty] ||
    a.practiceItemId.localeCompare(b.practiceItemId);
}

function isUsableItem(item, itemType) {
  return item.isActive && (itemType === undefined || item.itemType === itemType);
}

function sortWeakCandidates(states) {
  return [...states]
    .filter((state) => state.masteryEwma !== null)
    .sort((a, b) => {
      return (
        Number(a.masteryEwma) - Number(b.masteryEwma) ||
        DIFFICULTY_RANK[b.jaDifficulty] - DIFFICULTY_RANK[a.jaDifficulty] ||
        compareNullableDate(a.lastPracticedDate, b.lastPracticedDate) ||
        a.phonemeId.localeCompare(b.phonemeId)
      );
    });
}

function sortWeakDrillCandidates(states) {
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

function sortNewCandidates(states) {
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

function sortReviewCandidates(states, today) {
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

function candidatesForSource(source, states, today) {
  if (source === "weak") return sortWeakCandidates(states);
  if (source === "new") return sortNewCandidates(states);
  return sortReviewCandidates(states, today);
}

function toSelectedPracticeItem(input, item, phonemeId, duplicateAllowed) {
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

function selectForCandidateOrder(input) {
  const usableItems = input.practiceItems.filter((item) => isUsableItem(item, input.itemType));

  for (const state of input.states) {
    const item = usableItems
      .filter((candidate) => candidate.targetPhonemeIds.includes(state.phonemeId))
      .filter((candidate) => !input.usedItemIds.has(candidate.practiceItemId))
      .sort(comparePracticeItems)[0];
    if (item) return toSelectedPracticeItem(input, item, state.phonemeId, false);
  }

  for (const state of input.states) {
    const item = usableItems
      .filter((candidate) => candidate.targetPhonemeIds.includes(state.phonemeId))
      .sort(comparePracticeItems)[0];
    if (item) return toSelectedPracticeItem(input, item, state.phonemeId, true);
  }

  const fallbackItem = usableItems.sort(comparePracticeItems)[0];
  if (!fallbackItem) {
    throw new ApiError("NO_PRACTICE_ITEMS", "出題可能な問題がありません。", 409, false);
  }
  return toSelectedPracticeItem(input, fallbackItem, fallbackItem.targetPhonemeIds[0] ?? "", true);
}

function trySelectForSource(input) {
  const candidates = candidatesForSource(input.source, input.states, input.today);
  if (candidates.length === 0) return null;
  return selectForCandidateOrder({ ...input, states: candidates });
}

function selectForSlot(input) {
  const fallbackOrder = {
    weak: ["weak", "review", "new"],
    new: ["new", "review", "weak"],
    review: ["review", "weak", "new"]
  };

  for (const source of fallbackOrder[input.slotType]) {
    const selected = trySelectForSource({ ...input, source });
    if (selected) return selected;
  }

  return selectForCandidateOrder({ ...input, states: sortNewCandidates(input.states), source: "new" });
}

export function selectDailyItems({ today, phonemeStates, practiceItems }) {
  const selected = [];
  for (const [index, slot] of DAILY_SLOTS.entries()) {
    selected.push(
      selectForSlot({
        position: index + 1,
        slotType: slot.slotType,
        itemType: slot.itemType,
        today,
        states: phonemeStates,
        practiceItems,
        usedItemIds: new Set(selected.map((item) => item.practiceItemId))
      })
    );
  }
  return selected;
}

export function selectWeakDrillItems({ today, phonemeStates, practiceItems, limit }) {
  const selected = [];
  for (let position = 1; position <= limit; position += 1) {
    selected.push(
      selectForCandidateOrder({
        position,
        slotType: "weak",
        today,
        states: sortWeakDrillCandidates(phonemeStates),
        practiceItems,
        usedItemIds: new Set(selected.map((item) => item.practiceItemId)),
        source: "weak"
      })
    );
  }
  return selected;
}

export function selectPhonemePracticeItems({ phonemeId, practiceItems, limit }) {
  return practiceItems
    .filter((item) => isUsableItem(item) && item.targetPhonemeIds.includes(phonemeId))
    .sort(comparePracticeItems)
    .slice(0, limit)
    .map((item, index) => ({
      position: index + 1,
      slotType: "weak",
      practiceItemId: item.practiceItemId,
      itemType: item.itemType,
      targetPhonemeIds: item.targetPhonemeIds,
      selectionReason: {
        source: "phoneme_select",
        phonemeId,
        duplicateAllowed: false
      }
    }));
}

async function loadSelectionData(supabase, userId) {
  const [phonemes, stateRows, itemRows] = await Promise.all([
    supabase.listActivePhonemes(),
    supabase.listPhonemeStates(userId),
    supabase.listActivePracticeItems()
  ]);
  const targets = await supabase.listPracticeItemTargets(itemRows.map((item) => item.practice_item_id));
  const targetsByItem = new Map();
  for (const target of targets) {
    const list = targetsByItem.get(target.practice_item_id) ?? [];
    list.push(target.target_id);
    targetsByItem.set(target.practice_item_id, list);
  }

  const statesByPhoneme = new Map(stateRows.map((state) => [state.phoneme_id, state]));
  const phonemeStates = phonemes.map((phoneme) => {
    const state = statesByPhoneme.get(phoneme.phoneme_id);
    return {
      phonemeId: phoneme.phoneme_id,
      masteryEwma: state?.mastery_ewma === undefined || state?.mastery_ewma === null ? null : Number(state.mastery_ewma),
      reviewStage: state?.review_stage ?? 0,
      nextReviewDate: state?.next_review_date ?? null,
      practiceCount: state?.practice_count ?? 0,
      lastPracticedDate: state?.last_practiced_date ?? null,
      jaDifficulty: phoneme.ja_difficulty
    };
  });

  const practiceItems = itemRows
    .map((item) => ({
      practiceItemId: item.practice_item_id,
      itemType: item.item_type,
      text: item.text,
      normalizedText: item.normalized_text,
      expectedIpa: item.expected_ipa,
      targetPhonemeIds: targetsByItem.get(item.practice_item_id) ?? [],
      jaDifficulty: item.ja_difficulty,
      isActive: item.is_active
    }))
    .filter((item) => item.targetPhonemeIds.length > 0);

  return { phonemeStates, practiceItems };
}

function itemDetailsById(practiceItems) {
  return new Map(practiceItems.map((item) => [item.practiceItemId, item]));
}

async function ttsForItem({ item, supabase, config, fetchImpl, now }) {
  const [normal, slow] = await Promise.all([
    getOrCreateTtsReference({ supabase, text: item.normalizedText, accent: "US", speed: "normal", now }),
    getOrCreateTtsReference({ supabase, text: item.normalizedText, accent: "US", speed: "slow", now })
  ]);

  return {
    normal_url: normal.audio_url,
    slow_url: slow.audio_url
  };
}

async function formatSessionItem({ row, selected, practiceItem, supabase, config, fetchImpl, now }) {
  const item = practiceItem ?? selected;
  return {
    daily_session_item_id: row?.id,
    position: row?.position ?? selected.position,
    slot_type: row?.slot_type ?? selected.slotType,
    practice_item_id: item.practiceItemId,
    text: item.text,
    expected_ipa: item.expectedIpa,
    target_phoneme_ids: row?.target_phoneme_ids ?? item.targetPhonemeIds,
    tts: await ttsForItem({ item, supabase, config, fetchImpl, now })
  };
}

async function formatPracticeItem({ selected, practiceItem, supabase, config, fetchImpl, now }) {
  return {
    practice_item_id: practiceItem.practiceItemId,
    text: practiceItem.text,
    expected_ipa: practiceItem.expectedIpa,
    target_phoneme_ids: practiceItem.targetPhonemeIds,
    tts: await ttsForItem({ item: practiceItem, supabase, config, fetchImpl, now }),
    selection_reason: selected.selectionReason
  };
}

async function formatDailySession({ session, rows, selectedItems, practiceItems, supabase, config, fetchImpl, now }) {
  const byId = itemDetailsById(practiceItems);
  const byPosition = new Map(rows.map((row) => [row.position, row]));
  const items = await Promise.all(
    selectedItems.map((selected) =>
      formatSessionItem({
        row: byPosition.get(selected.position),
        selected,
        practiceItem: byId.get(selected.practiceItemId),
        supabase,
        config,
        fetchImpl,
        now
      })
    )
  );

  return {
    daily_session_id: session.id,
    session_date: session.session_date,
    status: session.status,
    completed_count: session.completed_count,
    items
  };
}

export async function getOrCreateDailySession({
  request,
  env = process.env,
  fetchImpl = fetch,
  now = new Date()
}) {
  const body = await readJson(request);
  const sessionDate = assertDateOnly(body?.session_date, "session_date");
  const timezone = assertTimezone(body?.timezone);
  const { config, supabase, user } = await getPracticeContext({ request, env, fetchImpl, now });
  const { phonemeStates, practiceItems } = await loadSelectionData(supabase, user.id);
  let session = await supabase.getDailySession(user.id, sessionDate);
  const selectedItems = selectDailyItems({ today: sessionDate, phonemeStates, practiceItems });

  if (!session) {
    session = await supabase.createDailySession({
      user_id: user.id,
      session_date: sessionDate,
      timezone,
      status: "in_progress",
      completed_count: 0
    });
  }

  let rows = await supabase.listDailySessionItems(session.id);
  if (rows.length < 7) {
    const existingPositions = new Set(rows.map((row) => row.position));
    const inserts = selectedItems
      .filter((item) => !existingPositions.has(item.position))
      .map((item) => ({
        daily_session_id: session.id,
        position: item.position,
        slot_type: item.slotType,
        practice_item_id: item.practiceItemId,
        target_phoneme_ids: item.targetPhonemeIds,
        selection_reason: item.selectionReason,
        status: "pending"
      }));
    if (inserts.length > 0) {
      await supabase.createDailySessionItems(inserts);
      rows = await supabase.listDailySessionItems(session.id);
    }
  }

  const rowSelectedItems = rows.length === 7
    ? rows.map((row) => ({
        position: row.position,
        slotType: row.slot_type,
        practiceItemId: row.practice_item_id,
        targetPhonemeIds: row.target_phoneme_ids,
        selectionReason: row.selection_reason ?? { source: row.slot_type, phonemeId: row.target_phoneme_ids?.[0] ?? "", duplicateAllowed: false }
      }))
    : selectedItems;

  return formatDailySession({
    session,
    rows,
    selectedItems: rowSelectedItems,
    practiceItems,
    supabase,
    config,
    fetchImpl,
    now
  });
}

export async function createPracticeSession({
  request,
  env = process.env,
  fetchImpl = fetch,
  now = new Date()
}) {
  const body = await readJson(request);
  const mode = body?.mode;
  const sessionDate = assertDateOnly(body?.session_date, "session_date");
  const limit = Math.max(1, Math.min(Number(body?.limit ?? 7), 20));
  const { config, supabase, user } = await getPracticeContext({ request, env, fetchImpl, now });
  const { phonemeStates, practiceItems } = await loadSelectionData(supabase, user.id);

  let selectedItems;
  if (mode === "weak_drill") {
    selectedItems = selectWeakDrillItems({ today: sessionDate, phonemeStates, practiceItems, limit });
  } else if (mode === "phoneme_select") {
    if (typeof body?.phoneme_id !== "string" || !body.phoneme_id) {
      throw new ApiError("BAD_REQUEST", "phoneme_id が必要です。", 400, false);
    }
    selectedItems = selectPhonemePracticeItems({ phonemeId: body.phoneme_id, practiceItems, limit });
    if (selectedItems.length === 0) {
      throw new ApiError("NO_PRACTICE_ITEMS", "指定音素の出題可能な問題がありません。", 409, false);
    }
  } else {
    throw new ApiError("BAD_REQUEST", "mode が不正です。", 400, false);
  }

  const byId = itemDetailsById(practiceItems);
  const items = await Promise.all(
    selectedItems.map((selected) =>
      formatPracticeItem({
        selected,
        practiceItem: byId.get(selected.practiceItemId),
        supabase,
        config,
        fetchImpl,
        now
      })
    )
  );

  return { mode, practice_mode: mode, items };
}

export async function handleDailySession(options) {
  return ok(await getOrCreateDailySession(options));
}

export async function handlePracticeSession(options) {
  return ok(await createPracticeSession(options));
}
