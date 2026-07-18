# Core Logic

## 原則

1. 録音1回は必ず生ログとして保存する。
2. 習熟度、復習日、ヒートマップ、ストリークに使うのは、パック問題の best attempt だけである。
3. 自由入力は `free_attempts` に保存するが、習熟度、復習日、ヒートマップ、ストリークには入れない。
4. 正解判定はターゲット音素基準、間違いゼロ表示は全音素基準である。
5. 日付は端末ローカル日付を使う。サーバーにはUTC時刻も保存する。

## 日付

### 保存する日付

| 項目 | 内容 |
| --- | --- |
| `practiced_at` | UTC timestamp。 |
| `practiced_date` | 端末ローカル日付。例: `2026-07-04`。 |
| `timezone` | IANA timezone。例: `Asia/Tokyo`。 |

### 練習日

`practiced_date` に scored attempt が1件以上ある日を練習日とする。

対象は `attempts` のみである。`free_attempts` は練習日に含めない。

## 今日の7個

### 構成

デイリー練習は毎日7個。

- 単語5。
- 文2。

### 配分

| 枠 | 中身 | 個数 |
| --- | --- | ---: |
| 苦手 | 単語2 + 文1 | 3 |
| 新規 | 単語2 | 2 |
| 復習 | 単語1 + 文1 | 2 |

### daily_session

今日の7個は、当日初回生成時に `daily_sessions` と `daily_session_items` として固定する。

同じローカル日付では再生成しない。ただし、生成済みセッションが破損している場合はサーバー側で修復処理を行う。

### 選定対象

選定対象は、`practice_items` に登録されたパック問題のみである。

自由入力はデイリー練習に使わない。

## 出題選定

### 苦手枠

優先順:

1. `phoneme_state.mastery_ewma` が低い。
2. `ja_difficulty` が高い。
3. `last_practiced_date` が古い。
4. 音素IDの昇順。

`mastery_ewma` が null の音素は苦手枠ではなく新規枠で扱う。

### 新規枠

優先順:

1. `practice_count = 0`。
2. `ja_difficulty` が高い。
3. 音素IDの昇順。

### 復習枠

優先順:

1. `next_review_date <= 今日`。
2. `next_review_date` が古い。
3. `mastery_ewma` が低い。
4. `ja_difficulty` が高い。

### フォールバック

| 状況 | 動作 |
| --- | --- |
| 新規枠が不足 | 復習候補で埋める。 |
| 復習枠が不足 | 苦手候補で埋める。 |
| 苦手枠が不足 | 復習候補で埋める。 |
| すべて高習熟 | 復習中心のメンテナンスモードにする。 |
| パック問題が不足 | 同一音素内で未出題優先、最後は重複を許可する。 |

### 問題重複

同一日の `daily_session` 内では、同じ `practice_item_id` を重複させない。候補不足時のみ重複を許可し、`selection_reason` に記録する。

## 判定結果の正規化

API層は Azure レスポンスから、UIと集計で使う正規化済みの `phoneme_results` を生成する。

正規化の主モデルは `PronunciationAssessmentResult` とし、`provider`、`locale`、`referenceText`、`timing`、`capabilities`、`overall`、`issues`、`words` を持つ。既存の `phoneme_results` は集計・既存UI互換の派生ビューとして維持する。スコア、Offset、Duration、IPA候補、ErrorTypeが返らない場合は0や空文字ではなくnullを保持する。

`en-US`の標準capabilitiesは音素スコア、IPA名、候補音素、音節、prosody、miscueを有効とする。別ロケールは実際のAzure対応状況に基づいて個別定義し、国籍や母語によるスコア補正は行わない。

`phoneme_results` の最小項目:

| 項目 | 内容 |
| --- | --- |
| `index` | 問題内の音素位置。 |
| `word_index` | 文の場合の単語位置。 |
| `expected_phoneme_id` | 期待音素ID。 |
| `expected_ipa` | 期待IPA。 |
| `observed_phoneme_id` | 実測音素ID。取得できない場合は null。 |
| `observed_ipa` | 実測IPA。取得できない場合は null。 |
| `score` | 0〜100の音素スコア。 |
| `color` | `green`、`yellow`、`red`。 |
| `is_target` | ターゲット音素か。 |
| `confusion_pair_id` | 期待音素と実測音素のペア。例: `r_to_l`。 |

## スコア色

| 色 | 条件 |
| --- | --- |
| `green` | `score >= 80` |
| `yellow` | `60 <= score < 80` |
| `red` | `score < 60` |

## 正解判定

### 問題の正解

ターゲット音素すべてのスコアが80以上であれば、その問題は正解である。

文問題でも、正解判定はターゲット音素だけを見る。非ターゲット音素の低スコアだけで不正解にしない。

### 間違いゼロ表示

全音素のスコアが80以上であれば、間違いゼロとして「素晴らしい！」を表示する。

問題の正解と間違いゼロ表示は別概念である。

## attempt

### 保存単位

録音1回 = `attempts` 1行。

やり直しを含め、Azure判定に成功した録音はすべて保存する。

### attempt_no

同一 `daily_session_item_id` または同一練習問題内で、1から連番にする。

### scored attempt

Azure判定に成功し、正規化済み `phoneme_results` を保存できた attempt を scored attempt とする。

通信失敗、Azure失敗、保存失敗は scored attempt ではない。練習回数、ストリーク、習熟度に入れない。

## best attempt

### 定義

1問内で、ターゲット音素スコア平均が最も高い attempt を best attempt とする。

ターゲット音素平均が同点の場合:

1. overall が高い attempt。
2. attempt_no が大きい attempt。

### 使用箇所

best attempt は以下に使う。

- `phoneme_state` 更新。
- `phoneme_snapshots` 更新。
- ストリーク判定。
- レベル計算。
- バッジ判定。
- 称号判定。
- ヒートマップ。
- 総合習熟度。

生ログ表示では、best attempt 以外の attempt も履歴として参照できる。

## phoneme_state 更新

### 対象

パック問題のターゲット音素のみ更新する。

非ターゲット音素は、スコアを保存しても `phoneme_state` は更新しない。

自由入力は `phoneme_state` を更新しない。

### EWMA

初期値は null。

更新式:

```text
if old is null:
  new = score
else:
  new = 0.3 * score + 0.7 * old
```

小数は保存してよい。UI表示時に必要に応じて丸める。

### 練習回数

best attempt 確定時、ターゲット音素ごとに `practice_count += 1` する。

同一問題内で複数回録音しても、集計更新はbest attempt 1回分だけである。

### 最終練習日

best attempt 確定時、ターゲット音素ごとに `last_practiced_date = practiced_date` とする。

## 復習間隔

復習段階は4段。

| review_stage | 次回までの日数 |
| ---: | ---: |
| 0 | 1 |
| 1 | 3 |
| 2 | 7 |
| 3 | 14 |

### 正解時

ターゲット音素が正解であれば、`review_stage` を1段進める。最大は3。

`next_review_date = practiced_date + interval_days(review_stage)`

### 不正解時

ターゲット音素が不正解であれば、`review_stage = 0` に戻す。

`next_review_date = practiced_date + 1 day`

### 音素単位

複数ターゲット音素がある問題では、音素ごとに正解/不正解を判定する。

## 苦手リスト

明示的な別テーブルの苦手リストは必須ではない。MVPでは `phoneme_state.mastery_ewma` と `next_review_date` から苦手音を算出する。

ユーザーが保存した文や音素は `user_bookmarks` に保存する。

## phoneme_snapshots

### 目的

推移グラフと週次/月次集計のため、日次で音素ごとのEWMAを保存する。

### 作成タイミング

best attempt により `phoneme_state` が更新された後、対象ユーザー・対象日・対象音素の `phoneme_snapshots` を upsert する。

### 値

`mastery_ewma` は、その日の更新後の値を保存する。

## 総合習熟度

総合習熟度は、全音素のEWMA平均である。

```text
overall_mastery = average(phoneme_state.mastery_ewma for phonemes where mastery_ewma is not null)
```

未評価音素を0点扱いしない。

週/月表示では、期間内スナップショットの平均または期末値を使う。MVPでは期末値を優先する。

## ストリーク

### 練習日

`attempts.practiced_date` に scored attempt が1件以上ある日を練習日とする。

`free_attempts` は含めない。

### 当日ストリーク

今日が練習日なら、今日から過去に連続する練習日数を数える。

今日が未練習で昨日が練習日なら、表示上は昨日までのストリークを保持してよい。ただし今日の練習完了前にストリーク加算しない。

### 最長ストリーク

ユーザーごとの過去最大連続日数を保存する。

## ヒートマップ

ヒートマップは `phoneme_state.mastery_ewma` を使う。

| 表示 | 条件 |
| --- | --- |
| 緑 | `mastery_ewma >= 80` |
| 黄 | `60 <= mastery_ewma < 80` |
| 赤 | `mastery_ewma < 60` |
| 未評価 | `mastery_ewma is null` |

低いほど目立つ表示にする。

## レベル

レベルは、パック問題のbest attemptによって増える累計練習回数で決める。自由入力は含めない。

MVPのレベル定義:

| レベル | 必要累計練習数 | 表示名 |
| ---: | ---: | --- |
| 1 | 0 | はじめの一音 |
| 2 | 10 | 発音ウォーカー |
| 3 | 25 | 音素トレーナー |
| 4 | 50 | 苦手音ハンター |
| 5 | 100 | 発音ミラー常連 |
| 6 | 200 | 通じる音の職人 |
| 7 | 350 | 音素マスター |
| 8 | 500 | 発音ミラー名人 |

必要累計練習数は `attempts` の録音回数ではなく、集計対象になった問題完了数で数える。

## バッジ

MVPでは、条件が明確で追加コストのないバッジだけを実装する。

| badge_id | 名称 | 条件 |
| --- | --- | --- |
| `first_daily_complete` | はじめての完走 | デイリー7個を初めて完了。 |
| `streak_3` | 3日連続 | 3日連続で練習。 |
| `streak_7` | 7日連続 | 7日連続で練習。 |
| `streak_14` | 14日連続 | 14日連続で練習。 |
| `first_perfect_item` | 初パーフェクト | 全音素緑の問題を初めて達成。 |
| `th_green` | THが見えてきた | `theta` または `dh` のEWMAが80以上。 |
| `r_l_green` | R/L突破 | `r` と `l` のEWMAがどちらも80以上。 |
| `v_b_green` | V/B突破 | `v` と `b` のEWMAがどちらも80以上。 |
| `daily_30_items` | 30問達成 | 集計対象の完了問題数が30以上。 |
| `daily_100_items` | 100問達成 | 集計対象の完了問題数が100以上。 |

付与済みバッジは再付与しない。

## 称号

称号は1つだけ表示する。優先順位の高い条件から判定する。

| 優先 | title_id | 表示名 | 条件 |
| ---: | --- | --- | --- |
| 1 | `seven_day_streak` | 7日継続中 | 現在ストリークが7日以上。 |
| 2 | `th_specialist` | TH集中突破中 | `theta` または `dh` が80以上、かつ直近7日の対象練習あり。 |
| 3 | `rl_specialist` | R/L調整中 | `r` または `l` の直近練習があり、いずれかが80未満。 |
| 4 | `daily_regular` | 毎日の発音習慣 | 累計完了問題数が50以上。 |
| 5 | `starter` | 発音ミラー入門 | 上記に該当しない。 |

称号は履歴保存必須ではない。表示時に算出してよい。

## 自由入力

自由入力はPro限定である。

### 保存する

- 入力文。
- 正規化文。
- IPA変換結果。
- OOV語。
- 変換確信度。
- 音素ごとスコア。
- 単語ごとスコア。
- Azure JSONレスポンス。

### 更新しない

- `phoneme_state`。
- `phoneme_snapshots`。
- ストリーク。
- ヒートマップ。
- レベル。
- バッジ。
- 称号。
- 復習日。

## 苦手ドリル

苦手ドリルは、苦手枠100%の練習セッションである。

選定優先順:

1. `mastery_ewma < 60`。
2. `mastery_ewma` が低い。
3. `next_review_date <= 今日`。
4. `ja_difficulty` が高い。

パック問題を使うため、結果は `attempts` に保存し、best attempt は集計対象にする。

## 音素表練習

選択された音素をターゲットとするパック問題を出す。

結果は `attempts` に保存し、best attempt は集計対象にする。

## エラーログ

次は `error_logs` に保存する。

- Azure判定失敗。
- TTS生成失敗。
- IPA変換失敗。
- OpenAI助言生成失敗。
- RevenueCat同期失敗。
- Supabase保存失敗。

エラーログは練習回数、ストリーク、習熟度に影響しない。

## フェーズ4セルフレビュー

- マスター設計書・既作成ドキュメントとの矛盾: EWMA、しきい値、best attempt、自由入力分離、ストリーク定義、レベル/バッジ/称号MVP追加を反映済み。
- Codexが実装に着手できる具体性: 更新式、優先順、バッジ条件、称号条件、復習間隔を実装可能な粒度で定義済み。
- 用語・命名の一貫性: `daily_sessions`、`daily_session_items`、`phoneme_results`、`phoneme_state`、`phoneme_snapshots` をDB/API仕様と接続する前提で使用。
