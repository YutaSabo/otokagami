# Content Spec

## 目的

この仕様は、Pronunciation Mirror MVPで使う音素ID、子音連結グループ、練習パック、直し方ページ、助言テンプレ、静的アセットを定義する。

音素IDはDB、API、UI、コンテンツ生成、ヒートマップ、バッジ条件の主キーとして使う。実装中に勝手に変更してはならない。

## 音素ID設計

### 原則

- 内部IDはASCIIのsnake_caseまたは短い英字IDにする。
- IPA記号は表示値として持つ。
- Azureの返却表現はAPI層で内部IDへ正規化する。
- MVPの目標アクセントは US のみ。
- UK用の拡張余地は持つが、MVPでは無効化する。

## 子音

MVPの子音IDは24個。

| phoneme_id | IPA | 例 | 日本語話者難易度 |
| --- | --- | --- | --- |
| `p` | /p/ | pen | low |
| `b` | /b/ | boy | medium |
| `t` | /t/ | tea | low |
| `d` | /d/ | day | medium |
| `k` | /k/ | key | low |
| `g` | /g/ | go | low |
| `f` | /f/ | fan | medium |
| `v` | /v/ | van | high |
| `theta` | /θ/ | think | high |
| `dh` | /ð/ | this | high |
| `s` | /s/ | see | low |
| `z` | /z/ | zoo | medium |
| `sh` | /ʃ/ | she | medium |
| `zh` | /ʒ/ | vision | medium |
| `h` | /h/ | he | low |
| `ch` | /tʃ/ | cheese | medium |
| `j` | /dʒ/ | judge | medium |
| `m` | /m/ | me | low |
| `n` | /n/ | no | low |
| `ng` | /ŋ/ | sing | medium |
| `l` | /l/ | light | high |
| `r` | /r/ | right | high |
| `w` | /w/ | we | medium |
| `y` | /j/ | yes | low |

## 単母音

MVPの単母音IDは12個。

| phoneme_id | IPA | 例 | 日本語話者難易度 |
| --- | --- | --- | --- |
| `iy` | /i/ | see | medium |
| `ih` | /ɪ/ | sit | high |
| `eh` | /ɛ/ | bed | medium |
| `ae` | /æ/ | cat | high |
| `aa` | /ɑ/ | hot | medium |
| `ao` | /ɔ/ | thought | medium |
| `uh` | /ʊ/ | book | high |
| `uw` | /u/ | food | medium |
| `ah` | /ʌ/ | cup | high |
| `ax` | /ə/ | about | medium |
| `er` | /ɝ/ | bird | high |
| `a` | /ə/ or reduced vowel | unstressed a | medium |

`ax` と `a` はMVP実装時にAzure/IPA変換の返却に合わせて正規化する。DB主キーとしては両方を持つが、UIでは必要に応じて同じ説明文を使ってよい。

## 二重母音

MVPの二重母音IDは5個。

| phoneme_id | IPA | 例 | 日本語話者難易度 |
| --- | --- | --- | --- |
| `ey` | /eɪ/ | day | medium |
| `ay` | /aɪ/ | my | medium |
| `oy` | /ɔɪ/ | boy | medium |
| `aw` | /aʊ/ | now | medium |
| `ow` | /oʊ/ | go | medium |

## 子音連結グループ

子音連結は音素そのものではなく、出題タグとして扱う。

| cluster_id | 例 | 日本語話者難易度 |
| --- | --- | --- |
| `str` | street | high |
| `spr` | spring | high |
| `spl` | split | high |
| `skr` | screen | high |
| `skw` | square | high |
| `tr` | tree | medium |
| `dr` | dream | medium |
| `br` | brown | medium |
| `gr` | green | medium |
| `pr` | price | medium |
| `fl` | fly | medium |
| `gl` | glass | medium |
| `kl` | clean | medium |
| `pl` | play | medium |
| `kt` | asked | high |
| `pt` | stopped | high |
| `ld` | world | high |
| `nd` | hand | medium |
| `nt` | want | medium |
| `mp` | jump | medium |

子音連結グループは `practice_items.target_cluster_ids` に保存する。`phoneme_state` は音素単位で更新し、cluster専用の習熟度テーブルはMVPでは作らない。

## 初期練習パック

### 最低シード量

各音素につき最低:

- 単語5件。
- 文3件。

合計目安:

- 音素41個 × 単語5 = 205単語。
- 音素41個 × 文3 = 123文。

子音連結グループは各グループにつき最低:

- 単語3件。
- 文2件。

### ローンチ最小セット

MVPローンチ時点では、少なくとも次を用意する。

- 全音素40前後に対応する練習パック。
- 日本語話者の頻出混同ペアに対する直し方ページ優先10〜15件。
- 優先直し方ページに対応する図解アセット。

優先対象は、L/R、TH、母音長、V/B、シに寄る `theta`、語末子音を中心にする。

残りの直し方ページは合計30〜50件を順次追加する。MVP完了のブロッカーにはしない。

### practice_item の要件

各問題は次の情報を持つ。

| 項目 | 内容 |
| --- | --- |
| `practice_item_id` | 安定ID。 |
| `item_type` | `word` または `sentence`。 |
| `text` | 表示する英語。 |
| `normalized_text` | 判定・IPA変換用の正規化テキスト。 |
| `target_phoneme_ids` | 練習対象音素。 |
| `target_cluster_ids` | 子音連結タグ。該当なしは空配列。 |
| `expected_ipa` | 表示用IPA。 |
| `accent` | `US`。 |
| `ja_difficulty` | `high`、`medium`、`low`。 |
| `source` | `seed_ai_generated`、`manual_reviewed` など。 |
| `is_active` | 出題対象か。 |

### 生成方針

- AIで事前生成してよい。
- 生成後、人間または検証工程でレビューする。
- 本番出題対象にするには `is_active = true` とする。
- 未レビューの練習パック、直し方ページ、図解アセットは `is_active = false` またはアプリから参照されない状態にする。
- ユーザーのレビュー通過分のみ `is_active = true` として出題・表示対象にする。
- 音声は事前同梱しない。Piperで都度生成し、キャッシュする。

## 初期パック例

以下は形式例であり、実装時のseed全量ではない。

| practice_item_id | type | text | target_phoneme_ids | expected_ipa |
| --- | --- | --- | --- | --- |
| `word_r_001` | word | right | [`r`] | /raɪt/ |
| `word_l_001` | word | light | [`l`] | /laɪt/ |
| `word_theta_001` | word | think | [`theta`] | /θɪŋk/ |
| `word_v_001` | word | van | [`v`] | /væn/ |
| `word_ae_001` | word | cat | [`ae`] | /kæt/ |
| `sent_r_001` | sentence | I read it again. | [`r`] | IPA service generated |

seed全量は別工程で生成する。生成スクリプトの仕様はこのドキュメントと `06_DATA_MODEL.md` のスキーマに従う。

## MVP混同ペア

MVPでは、頻出の日本語話者向け混同ペアとして以下を直し方ページの対象にする。

| confusion_pair_id | 期待 | 実測 | 優先度 |
| --- | --- | --- | --- |
| `r_to_l` | `r` | `l` | high |
| `l_to_r` | `l` | `r` | high |
| `theta_to_s` | `theta` | `s` | high |
| `theta_to_t` | `theta` | `t` | high |
| `dh_to_z` | `dh` | `z` | high |
| `dh_to_d` | `dh` | `d` | high |
| `v_to_b` | `v` | `b` | high |
| `b_to_v` | `b` | `v` | medium |
| `f_to_h` | `f` | `h` | medium |
| `w_to_u` | `w` | `uw` | medium |
| `ae_to_eh` | `ae` | `eh` | high |
| `ih_to_iy` | `ih` | `iy` | high |
| `iy_to_ih` | `iy` | `ih` | medium |
| `ah_to_aa` | `ah` | `aa` | medium |
| `aa_to_ah` | `aa` | `ah` | medium |
| `uh_to_uw` | `uh` | `uw` | high |
| `er_to_ah` | `er` | `ah` | high |
| `ng_to_n` | `ng` | `n` | medium |
| `z_to_s` | `z` | `s` | medium |
| `s_to_sh` | `s` | `sh` | medium |
| `sh_to_s` | `sh` | `s` | medium |
| `ch_to_sh` | `ch` | `sh` | medium |
| `j_to_ch` | `j` | `ch` | medium |
| `final_t_missing` | `t` | null | high |
| `final_d_missing` | `d` | null | high |
| `final_s_missing` | `s` | null | high |
| `final_z_missing` | `z` | null | high |
| `final_l_missing` | `l` | null | high |

## 汎用直し方ページ

混同ペアに対応するページがない場合は、汎用ページを使う。

汎用ページの種類:

| generic_advice_id | 対象 |
| --- | --- |
| `generic_consonant` | 子音全般。 |
| `generic_vowel` | 母音全般。 |
| `generic_final_consonant` | 語末子音の脱落。 |
| `generic_cluster` | 子音連結。 |
| `generic_unknown` | 分類不能。 |

## 直し方ページ構成

各直し方ページは次を持つ。

| 項目 | 内容 |
| --- | --- |
| `advice_id` | 安定ID。 |
| `confusion_pair_id` | 対応する混同ペア。汎用の場合はnull。 |
| `native_language` | `ja`。 |
| `target_accent` | `US`。 |
| `title` | 画面タイトル。 |
| `short_tip` | 1〜2行の助言。 |
| `comparison_text` | 2音の違い。 |
| `coach_example_text` | お手本再生用テキスト。 |
| `asset_id` | 図解アセットID。 |
| `is_template` | テンプレ助言か。 |

## 助言方針

### テンプレ優先

MVPの混同ペアは、テンプレ助言を優先する。OpenAI APIを毎回呼ばない。

### OpenAI利用条件

OpenAI APIは次の場合のみ使う。

- 混同ペアがテンプレ未対応。
- 汎用助言をユーザーの文脈に合わせて短く整形する必要がある。
- サーバー側でキャッシュミスした。

OpenAIの出力は、根拠のない説明を追加しないように、検証済みの直し方だけを入力して整形させる。

### キャッシュ

キャッシュキーは少なくとも次を含める。

- `native_language`。
- `target_accent`。
- `confusion_pair_id` または `generic_advice_id`。
- `expected_phoneme_id`。
- `observed_phoneme_id`。

## 静的アセット

### 方針

- 実行時にAI画像生成しない。
- 事前生成または手作りの静的画像を使う。
- 口、舌、歯、唇の位置を示す。
- アセットは音素または混同ペアに紐付ける。

### 配置案

実装時の配置例:

```text
assets/pronunciation/
  phonemes/
    r.png
    l.png
    theta.png
    v.png
  pairs/
    r_to_l.png
    theta_to_s.png
    v_to_b.png
  generic/
    final_consonant.png
    cluster.png
```

実際の配置は実装時に決めてよいが、`asset_id` とファイルパスの対応表はDBまたはアプリ内定数で管理する。

## Piper音声

### 生成

Piperはサーバー側で都度生成する。

### キャッシュキー

```text
tts:{accent}:{speed}:{sha256(normalized_text)}
```

### speed

MVPの速度:

- `normal`。
- `slow`。

### 保存先

Supabase Storage等にキャッシュする。お手本音声はサーバー生成物であり、ユーザー音声ではない。

## 自由入力コンテンツ

自由入力はPro限定であり、パックコンテンツではない。

保存対象:

- raw text。
- normalized text。
- IPA変換結果。
- OOV語。
- 変換確信度。
- 判定結果。

出題パックや `phoneme_state` に自動反映しない。将来の需要マイニング用に貯めるだけである。

## 禁止事項

- 実行時のAI画像生成をMVPに入れない。
- 自由入力を自動でデイリーパック化しない。
- 未レビューのAI生成パックを本番出題対象にしない。
- 音素IDを実装途中で変更しない。
- Azure返却値をそのままDB主キーにしない。
- シャドーイング用コンテンツを作らない。

## フェーズ4セルフレビュー

- マスター設計書・既作成ドキュメントとの矛盾: 約40音素、子音連結グループ、初期シード、混同ペア20〜30、静的アセット、テンプレ優先を反映済み。
- Codexが実装に着手できる具体性: 音素ID、cluster_id、practice_item要件、confusion_pair_id、asset配置案を明記済み。
- 用語・命名の一貫性: `theta`、`dh`、`r`、`l`、`v` などのIDを `04_CORE_LOGIC.md` のバッジ条件と整合させた。
