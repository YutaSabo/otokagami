import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const phonemes = [
  ["p", "/p/", "consonant", "pen", "low"],
  ["b", "/b/", "consonant", "boy", "medium"],
  ["t", "/t/", "consonant", "tea", "low"],
  ["d", "/d/", "consonant", "day", "medium"],
  ["k", "/k/", "consonant", "key", "low"],
  ["g", "/g/", "consonant", "go", "low"],
  ["f", "/f/", "consonant", "fan", "medium"],
  ["v", "/v/", "consonant", "van", "high"],
  ["theta", "/θ/", "consonant", "think", "high"],
  ["dh", "/ð/", "consonant", "this", "high"],
  ["s", "/s/", "consonant", "see", "low"],
  ["z", "/z/", "consonant", "zoo", "medium"],
  ["sh", "/ʃ/", "consonant", "she", "medium"],
  ["zh", "/ʒ/", "consonant", "vision", "medium"],
  ["h", "/h/", "consonant", "he", "low"],
  ["ch", "/tʃ/", "consonant", "cheese", "medium"],
  ["j", "/dʒ/", "consonant", "judge", "medium"],
  ["m", "/m/", "consonant", "me", "low"],
  ["n", "/n/", "consonant", "no", "low"],
  ["ng", "/ŋ/", "consonant", "sing", "medium"],
  ["l", "/l/", "consonant", "light", "high"],
  ["r", "/r/", "consonant", "right", "high"],
  ["w", "/w/", "consonant", "we", "medium"],
  ["y", "/j/", "consonant", "yes", "low"],
  ["iy", "/i/", "monophthong", "see", "medium"],
  ["ih", "/ɪ/", "monophthong", "sit", "high"],
  ["eh", "/ɛ/", "monophthong", "bed", "medium"],
  ["ae", "/æ/", "monophthong", "cat", "high"],
  ["aa", "/ɑ/", "monophthong", "hot", "medium"],
  ["ao", "/ɔ/", "monophthong", "thought", "medium"],
  ["uh", "/ʊ/", "monophthong", "book", "high"],
  ["uw", "/u/", "monophthong", "food", "medium"],
  ["ah", "/ʌ/", "monophthong", "cup", "high"],
  ["ax", "/ə/", "monophthong", "about", "medium"],
  ["er", "/ɝ/", "monophthong", "bird", "high"],
  ["a", "/ə/", "monophthong", "unstressed a", "medium"],
  ["ey", "/eɪ/", "diphthong", "day", "medium"],
  ["ay", "/aɪ/", "diphthong", "my", "medium"],
  ["oy", "/ɔɪ/", "diphthong", "boy", "medium"],
  ["aw", "/aʊ/", "diphthong", "now", "medium"],
  ["ow", "/oʊ/", "diphthong", "go", "medium"],
].map(([phoneme_id, ipa, category, example_word, ja_difficulty], index) => ({
  phoneme_id,
  ipa,
  category,
  example_word,
  ja_difficulty,
  sort_order: (index + 1) * 10,
}));

const clusters = [
  ["str", "street", "high"],
  ["spr", "spring", "high"],
  ["spl", "split", "high"],
  ["skr", "screen", "high"],
  ["skw", "square", "high"],
  ["tr", "tree", "medium"],
  ["dr", "dream", "medium"],
  ["br", "brown", "medium"],
  ["gr", "green", "medium"],
  ["pr", "price", "medium"],
  ["fl", "fly", "medium"],
  ["gl", "glass", "medium"],
  ["kl", "clean", "medium"],
  ["pl", "play", "medium"],
  ["kt", "asked", "high"],
  ["pt", "stopped", "high"],
  ["ld", "world", "high"],
  ["nd", "hand", "medium"],
  ["nt", "want", "medium"],
  ["mp", "jump", "medium"],
].map(([cluster_id, example_word, ja_difficulty], index) => ({
  cluster_id,
  example_word,
  ja_difficulty,
  sort_order: (index + 1) * 10,
}));

const wordBank = {
  p: ["pen", "paper", "people", "happy", "cup"],
  b: ["boy", "baby", "bubble", "table", "job"],
  t: ["tea", "time", "table", "water", "night"],
  d: ["day", "dinner", "middle", "ready", "road"],
  k: ["key", "cake", "coffee", "ticket", "book"],
  g: ["go", "green", "garden", "again", "bag"],
  f: ["fan", "coffee", "family", "office", "laugh"],
  v: ["van", "very", "voice", "seven", "move"],
  theta: ["think", "three", "thank", "birthday", "mouth"],
  dh: ["this", "that", "these", "mother", "breathe"],
  s: ["see", "sun", "city", "lesson", "rice"],
  z: ["zoo", "zero", "busy", "music", "rose"],
  sh: ["she", "shoe", "English", "washing", "wish"],
  zh: ["vision", "measure", "usual", "garage", "beige"],
  h: ["he", "home", "happy", "behind", "ahead"],
  ch: ["cheese", "chair", "teacher", "kitchen", "watch"],
  j: ["judge", "jump", "orange", "major", "page"],
  m: ["me", "moon", "summer", "lemon", "team"],
  n: ["no", "name", "dinner", "banana", "green"],
  ng: ["sing", "long", "morning", "bringing", "strong"],
  l: ["light", "late", "yellow", "really", "school"],
  r: ["right", "red", "around", "carry", "far"],
  w: ["we", "water", "window", "away", "quick"],
  y: ["yes", "yellow", "young", "beyond", "use"],
  iy: ["see", "green", "teacher", "evening", "machine"],
  ih: ["sit", "ship", "middle", "busy", "minute"],
  eh: ["bed", "red", "friend", "ready", "many"],
  ae: ["cat", "apple", "happy", "family", "map"],
  aa: ["hot", "father", "office", "watch", "stop"],
  ao: ["thought", "coffee", "daughter", "walk", "small"],
  uh: ["book", "good", "push", "could", "woman"],
  uw: ["food", "blue", "music", "school", "new"],
  ah: ["cup", "sun", "money", "above", "love"],
  ax: ["about", "again", "support", "sofa", "today"],
  er: ["bird", "early", "learn", "world", "work"],
  a: ["ago", "away", "around", "banana", "sofa"],
  ey: ["day", "make", "station", "rain", "late"],
  ay: ["my", "time", "light", "price", "smile"],
  oy: ["boy", "voice", "choice", "enjoy", "toy"],
  aw: ["now", "house", "around", "brown", "flower"],
  ow: ["go", "home", "open", "road", "slow"],
};

const clusterWordBank = {
  str: ["street", "strong", "student"],
  spr: ["spring", "spread", "spray"],
  spl: ["split", "splash", "spleen"],
  skr: ["screen", "scratch", "script"],
  skw: ["square", "squeeze", "squid"],
  tr: ["tree", "train", "try"],
  dr: ["dream", "drive", "drink"],
  br: ["brown", "bring", "bright"],
  gr: ["green", "great", "grow"],
  pr: ["price", "practice", "pretty"],
  fl: ["fly", "flower", "floor"],
  gl: ["glass", "glow", "global"],
  kl: ["clean", "class", "close"],
  pl: ["play", "please", "place"],
  kt: ["asked", "worked", "liked"],
  pt: ["stopped", "helped", "kept"],
  ld: ["world", "cold", "old"],
  nd: ["hand", "friend", "sound"],
  nt: ["want", "point", "paint"],
  mp: ["jump", "camp", "simple"],
};

const activeReviewed = new Map([
  ["word_r_001", "/raɪt/"],
  ["word_l_001", "/laɪt/"],
  ["word_theta_001", "/θɪŋk/"],
  ["word_v_001", "/væn/"],
  ["word_ae_001", "/kæt/"],
  ["sent_r_001", "/aɪ rid ɪt əˈɡɛn/"],
]);

const reviewedTextOverrides = new Map([
  ["sent_r_001", "I read it again."],
]);

const advicePages = [
  ["r_to_l", "r_to_l", null, "RがLに聞こえる", "舌先を上あごに付けず、舌の奥を少し引いて声を出します。唇を軽く丸めて、短く /r/ を始めましょう。", "Rは舌先を付けない音、Lは舌先を上あごに付ける音です。", "right light", "asset_pair_r_to_l"],
  ["l_to_r", "l_to_r", null, "LがRに聞こえる", "舌先を上の歯ぐきに一度当ててから声を出します。音の始まりをはっきり作るとLに近づきます。", "Lは舌先の接触が必要で、Rは接触しません。", "light right", "asset_pair_l_to_r"],
  ["theta_to_s", "theta_to_s", null, "THがSに聞こえる", "舌先を上下の歯の間に軽く出して、細く息を流します。歯の裏だけで作るとSに寄りやすくなります。", "THは舌と歯の間の摩擦、Sは歯の裏の摩擦です。", "think sink", "asset_pair_theta_to_s"],
  ["theta_to_t", "theta_to_t", null, "THがTに聞こえる", "舌を強く弾かず、歯の間で息を長めに出します。破裂させないことを意識します。", "THは連続する摩擦音、Tは一瞬止めて破裂する音です。", "three tree", "asset_pair_theta_to_t"],
  ["dh_to_z", "dh_to_z", null, "有声THがZに聞こえる", "声を出しながら舌先を歯の間に置きます。舌を引くとZに近づくので、前に保ちます。", "有声THは舌が歯に触れ、Zは舌を歯の裏に置きます。", "this zis", "asset_pair_dh_to_z"],
  ["dh_to_d", "dh_to_d", null, "有声THがDに聞こえる", "舌で息を完全に止めず、歯の間で声を流します。短くても摩擦を残します。", "有声THは摩擦音、Dは破裂音です。", "that dat", "asset_pair_dh_to_d"],
  ["v_to_b", "v_to_b", null, "VがBに聞こえる", "下唇を上の歯に軽く当て、声を出しながら息を流します。両唇を閉じるとBになります。", "Vは歯と唇の摩擦、Bは両唇の破裂です。", "van ban", "asset_pair_v_to_b"],
  ["ae_to_eh", "ae_to_eh", null, "AEがEHに聞こえる", "口を横だけでなく縦にも開き、あごを少し下げます。短い「エ」より明るく広い音にします。", "AEは口が広く、EHは少し狭い母音です。", "cat ket", "asset_pair_ae_to_eh"],
  ["ih_to_iy", "ih_to_iy", null, "IHがIYに聞こえる", "唇を引きすぎず、短くゆるい母音にします。長く伸ばすとIYに寄ります。", "IHは短くゆるい音、IYは長く張った音です。", "sit seat", "asset_pair_ih_to_iy"],
  ["uh_to_uw", "uh_to_uw", null, "UHがUWに聞こえる", "唇を丸めすぎず、短く中央寄りに出します。長く強くするとUWに近づきます。", "UHは短く浅い丸め、UWは長く強い丸めです。", "book boot", "asset_pair_uh_to_uw"],
  ["final_t_missing", "final_t_missing", null, "語末Tが消える", "最後に息を止めるだけで終えず、軽くTの閉鎖を作ります。大きく破裂させなくても輪郭を残します。", "語末Tは小さくても閉鎖の気配が必要です。", "right", "asset_generic_final_consonant"],
  ["final_d_missing", "final_d_missing", null, "語末Dが消える", "語末で声を急に落とさず、舌先でDの終わりを作ります。母音を足さず短く閉じます。", "語末Dは母音を追加せず、短い有声の閉鎖で終えます。", "road", "asset_generic_final_consonant"],
  ["final_s_missing", "final_s_missing", null, "語末Sが消える", "最後まで細い息を残してSを出します。日本語の母音を足さず、息だけで終えます。", "語末Sは母音なしで摩擦を残す音です。", "rice", "asset_generic_final_consonant"],
  ["generic_consonant_ja_us", null, "generic_consonant", "子音をはっきり作る", "口の形、舌の位置、息の出し方を一つずつ分けて確認します。まず音の始まりをゆっくり作りましょう。", null, "right light", "asset_generic_consonant"],
  ["generic_vowel_ja_us", null, "generic_vowel", "母音の形を整える", "口の開き、舌の高さ、長さをそろえます。日本語の母音に置き換えず、短く録音して差を聞きます。", null, "sit seat", "asset_generic_vowel"],
  ["generic_final_consonant_ja_us", null, "generic_final_consonant", "語末子音を残す", "最後に母音を足さず、子音だけで短く終えます。小さくても閉鎖や摩擦の輪郭を残します。", null, "right road rice", "asset_generic_final_consonant"],
  ["generic_cluster_ja_us", null, "generic_cluster", "子音連結を分けて作る", "子音を一つずつ遅くつなぎ、間に母音を入れない練習をします。慣れたら速度を戻します。", null, "street spring play", "asset_generic_cluster"],
  ["generic_unknown_ja_us", null, "generic_unknown", "音の差を確認する", "お手本をゆっくり聞き、違っている音の口の形から確認します。短い単語で録音を比べましょう。", null, "practice again", "asset_generic_unknown"],
];

function sqlString(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function normalized(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function json(value) {
  return sqlString(JSON.stringify(value));
}

function rows(values) {
  return values.map((row) => `  (${row.join(", ")})`).join(",\n");
}

const practiceItems = [];
const targets = [];

for (const phoneme of phonemes) {
  const words = wordBank[phoneme.phoneme_id];
  for (const [index, word] of words.entries()) {
    const id = `word_${phoneme.phoneme_id}_${String(index + 1).padStart(3, "0")}`;
    const activeIpa = activeReviewed.get(id);
    practiceItems.push({
      id,
      type: "word",
      text: word,
      normalizedText: normalized(word),
      expectedIpa: activeIpa ?? null,
      difficulty: phoneme.ja_difficulty,
      source: activeReviewed.has(id) ? "manual_reviewed" : "seed_ai_generated",
      active: activeReviewed.has(id),
    });
    targets.push({
      practiceItemId: id,
      targetType: "phoneme",
      targetId: phoneme.phoneme_id,
      positionHint: { focus: phoneme.phoneme_id, item_kind: "word_candidate" },
    });
  }

  for (const [index, word] of words.slice(0, 3).entries()) {
    const id = `sent_${phoneme.phoneme_id}_${String(index + 1).padStart(3, "0")}`;
    const text = reviewedTextOverrides.get(id) ?? `Say ${word} again.`;
    practiceItems.push({
      id,
      type: "sentence",
      text,
      normalizedText: normalized(text),
      expectedIpa: activeReviewed.get(id) ?? null,
      difficulty: phoneme.ja_difficulty,
      source: activeReviewed.has(id) ? "manual_reviewed" : "seed_ai_generated",
      active: activeReviewed.has(id),
    });
    targets.push({
      practiceItemId: id,
      targetType: "phoneme",
      targetId: phoneme.phoneme_id,
      positionHint: { focus: phoneme.phoneme_id, word },
    });
  }
}

for (const cluster of clusters) {
  const words = clusterWordBank[cluster.cluster_id];
  for (const [index, word] of words.entries()) {
    const id = `word_cluster_${cluster.cluster_id}_${String(index + 1).padStart(3, "0")}`;
    practiceItems.push({
      id,
      type: "word",
      text: word,
      normalizedText: normalized(word),
      expectedIpa: null,
      difficulty: cluster.ja_difficulty,
      source: "seed_ai_generated",
      active: false,
    });
    targets.push({
      practiceItemId: id,
      targetType: "cluster",
      targetId: cluster.cluster_id,
      positionHint: { focus: cluster.cluster_id, item_kind: "cluster_word_candidate" },
    });
  }

  for (const [index, word] of words.slice(0, 2).entries()) {
    const id = `sent_cluster_${cluster.cluster_id}_${String(index + 1).padStart(3, "0")}`;
    const text = `Practice ${word} slowly.`;
    practiceItems.push({
      id,
      type: "sentence",
      text,
      normalizedText: normalized(text),
      expectedIpa: null,
      difficulty: cluster.ja_difficulty,
      source: "seed_ai_generated",
      active: false,
    });
    targets.push({
      practiceItemId: id,
      targetType: "cluster",
      targetId: cluster.cluster_id,
      positionHint: { focus: cluster.cluster_id, word },
    });
  }
}

function makeSeedSql() {
  return `-- Generated by scripts/generate-phase4-content.mjs.
-- Phase 4 content uses the review gate: newly generated candidates are inactive
-- until a human review promotes them to manual_reviewed/is_active = true.

insert into public.phonemes (phoneme_id, ipa, category, example_word, ja_difficulty, sort_order, is_active)
values
${rows(
  phonemes.map((p) => [
    sqlString(p.phoneme_id),
    sqlString(p.ipa),
    sqlString(p.category),
    sqlString(p.example_word),
    sqlString(p.ja_difficulty),
    p.sort_order,
    "true",
  ]),
)}
on conflict (phoneme_id) do update set
  ipa = excluded.ipa,
  category = excluded.category,
  example_word = excluded.example_word,
  ja_difficulty = excluded.ja_difficulty,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

insert into public.phoneme_clusters (cluster_id, example_word, ja_difficulty, sort_order, is_active)
values
${rows(
  clusters.map((c) => [
    sqlString(c.cluster_id),
    sqlString(c.example_word),
    sqlString(c.ja_difficulty),
    c.sort_order,
    "true",
  ]),
)}
on conflict (cluster_id) do update set
  example_word = excluded.example_word,
  ja_difficulty = excluded.ja_difficulty,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

delete from public.practice_item_targets
where practice_item_id like 'word_%'
   or practice_item_id like 'sent_%';

delete from public.practice_items
where practice_item_id like 'word_%'
   or practice_item_id like 'sent_%';

insert into public.practice_items (
  practice_item_id,
  item_type,
  text,
  normalized_text,
  expected_ipa,
  accent,
  ja_difficulty,
  source,
  is_active
)
values
${rows(
  practiceItems.map((item) => [
    sqlString(item.id),
    sqlString(item.type),
    sqlString(item.text),
    sqlString(item.normalizedText),
    sqlString(item.expectedIpa),
    sqlString("US"),
    sqlString(item.difficulty),
    sqlString(item.source),
    item.active ? "true" : "false",
  ]),
)}
on conflict (practice_item_id) do update set
  item_type = excluded.item_type,
  text = excluded.text,
  normalized_text = excluded.normalized_text,
  expected_ipa = excluded.expected_ipa,
  accent = excluded.accent,
  ja_difficulty = excluded.ja_difficulty,
  source = excluded.source,
  is_active = excluded.is_active;

insert into public.practice_item_targets (practice_item_id, target_type, target_id, position_hint)
values
${rows(
  targets.map((target) => [
    sqlString(target.practiceItemId),
    sqlString(target.targetType),
    sqlString(target.targetId),
    json(target.positionHint),
  ]),
)}
on conflict (practice_item_id, target_type, target_id) do update set
  position_hint = excluded.position_hint;

delete from public.advice_pages
where advice_id in (${advicePages.map(([adviceId]) => sqlString(adviceId)).join(", ")});

insert into public.advice_pages (
  advice_id,
  confusion_pair_id,
  generic_advice_id,
  native_language,
  target_accent,
  title,
  short_tip,
  comparison_text,
  coach_example_text,
  asset_id,
  is_template,
  is_active
)
values
${rows(
  advicePages.map(([adviceId, confusionPairId, genericAdviceId, title, shortTip, comparisonText, coachExampleText, assetId]) => [
    sqlString(adviceId),
    sqlString(confusionPairId),
    sqlString(genericAdviceId),
    sqlString("ja"),
    sqlString("US"),
    sqlString(title),
    sqlString(shortTip),
    sqlString(comparisonText),
    sqlString(coachExampleText),
    sqlString(assetId),
    "true",
    "false",
  ]),
)}
on conflict (advice_id) do update set
  confusion_pair_id = excluded.confusion_pair_id,
  generic_advice_id = excluded.generic_advice_id,
  native_language = excluded.native_language,
  target_accent = excluded.target_accent,
  title = excluded.title,
  short_tip = excluded.short_tip,
  comparison_text = excluded.comparison_text,
  coach_example_text = excluded.coach_example_text,
  asset_id = excluded.asset_id,
  is_template = excluded.is_template,
  is_active = excluded.is_active;
`;
}

function assetPath(assetId) {
  if (assetId.startsWith("asset_pair_")) {
    return `assets/pronunciation/pairs/${assetId.replace("asset_pair_", "")}.svg`;
  }
  return `assets/pronunciation/generic/${assetId.replace("asset_generic_", "")}.svg`;
}

function makeSvg(assetId, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img" aria-labelledby="title desc">
  <title id="title">${label}</title>
  <desc id="desc">Static pronunciation placement diagram placeholder for ${assetId}.</desc>
  <rect width="640" height="360" fill="#f7f7f2"/>
  <path d="M110 210 C180 130 310 120 420 160 C500 190 540 240 530 285" fill="none" stroke="#1d3557" stroke-width="10" stroke-linecap="round"/>
  <path d="M180 235 C250 215 335 220 420 255" fill="none" stroke="#e76f51" stroke-width="12" stroke-linecap="round"/>
  <circle cx="240" cy="154" r="18" fill="#2a9d8f"/>
  <line x1="240" y1="154" x2="320" y2="105" stroke="#2a9d8f" stroke-width="6" stroke-linecap="round"/>
  <text x="320" y="58" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#111827">${label}</text>
  <text x="320" y="326" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="#374151">review before enabling in app</text>
</svg>
`;
}

async function main() {
  await writeFile(join(root, "supabase", "seed.sql"), makeSeedSql());
  await mkdir(join(root, "assets", "pronunciation"), { recursive: true });

  const manifest = {
    generated_by: "scripts/generate-phase4-content.mjs",
    assets: Object.fromEntries(
      [...new Set(advicePages.map((page) => page[7]))].map((assetId) => [
        assetId,
        {
          path: assetPath(assetId),
          status: "static_placeholder",
          review_required: true,
        },
      ]),
    ),
  };

  await writeFile(join(root, "assets", "pronunciation", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  for (const [assetId, meta] of Object.entries(manifest.assets)) {
    const fullPath = join(root, meta.path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, makeSvg(assetId, assetId.replace(/^asset_/, "").replaceAll("_", " ")));
  }
}

await main();
