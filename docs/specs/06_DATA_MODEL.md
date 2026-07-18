# Data Model

## 対象

DBは Supabase Postgres を使う。開発環境では Supabase CLI / Docker 経由のローカル Supabase を前提にする。

RLSは `auth.uid()` ベースで設計する。ユーザーは Supabase anonymous auth で作成され、メールログインはMVPに含めない。

## 命名方針

- テーブル名は複数形のsnake_case。
- 主キーは原則 `id uuid`。
- 外部公開や分析用の匿名IDは `anon_public_id`。
- ユーザー所有テーブルは `user_id uuid not null references auth.users(id)` を持つ。
- 音素IDやコンテンツIDは安定したtext IDを使う。

## 拡張

MVPで必要なPostgres拡張:

- `pgcrypto`: UUID生成。

## テーブル一覧

| テーブル | 目的 |
| --- | --- |
| `profiles` | 匿名ユーザーの基本情報、無料期間、設定。 |
| `installations` | 再インストール耐性のある端末識別補助IDとユーザーの紐付け。 |
| `subscriptions` | RevenueCat/IAP由来の購読状態。 |
| `phonemes` | 音素マスタ。 |
| `phoneme_clusters` | 子音連結グループマスタ。 |
| `practice_items` | 単語・文の練習パック。 |
| `practice_item_targets` | 練習問題とターゲット音素/clusterの紐付け。 |
| `daily_sessions` | ユーザーごとの日次7問セッション。 |
| `daily_session_items` | daily_session内の各問題。 |
| `attempts` | パック問題の録音1回ごとの生ログ。 |
| `attempt_phoneme_results` | attempt内の音素別正規化結果。 |
| `phoneme_state` | ユーザー×音素の習熟度状態。 |
| `phoneme_snapshots` | 日次の音素EWMAスナップショット。 |
| `user_badges` | 獲得済みバッジ。 |
| `user_bookmarks` | 保存した音素・問題・文。 |
| `free_attempts` | Pro自由入力の判定ログ。集計系と完全分離。 |
| `advice_pages` | 直し方ページ/テンプレ助言のマスタ。 |
| `advice_feedback` | 助言への評価。 |
| `tts_cache` | Piper生成音声のキャッシュ参照。 |
| `ai_advice_cache` | OpenAI生成助言のキャッシュ。 |
| `error_logs` | 判定、TTS、課金、保存などのエラーログ。 |

## profiles

ユーザー基本情報。

| カラム | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `user_id` | uuid | yes | `auth.users.id`。主キー。 |
| `anon_public_id` | text | yes | ランキング等の将来表示用匿名ID。unique。 |
| `native_language` | text | yes | BCP 47系コード。既定は未指定を表す`und`。判定スコア補正には使わない。 |
| `target_accent` | text | yes | MVPは `US`。 |
| `free_trial_started_at` | timestamptz | yes | サーバー側無料期間起点。 |
| `timezone` | text | yes | 端末のIANA timezone。 |
| `reminder_enabled` | boolean | yes | 初期false。 |
| `reminder_time_local` | text | no | `HH:mm`。 |
| `playback_speed_default` | text | yes | `normal` または `slow`。 |
| `free_text_consent_version` | text | no | 自由入力保存同意の同意済み版。未同意はnull。 |
| `free_text_consented_at` | timestamptz | no | 自由入力保存同意の取得日時。未同意はnull。 |
| `created_at` | timestamptz | yes | 作成日時。 |
| `updated_at` | timestamptz | yes | 更新日時。 |
| `deleted_at` | timestamptz | no | 論理削除日時。 |

制約:

- `native_language` は`und`または妥当な言語タグを許可する。国籍は保存せず、判定スコア補正にも使わない。
- `target_accent in ('US', 'UK')` とし、MVPではアプリ側でUKを無効化する。

## installations

再インストールによる無料期間リセット対策のため、Keychain等に保存した端末識別補助IDのハッシュをサーバー側に保存する。

生の `device_install_id` はDBに保存しない。Next.js APIでハッシュ化してから保存する。

| カラム | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `id` | uuid | yes | 主キー。 |
| `device_install_id_hash` | text | yes | 端末識別補助IDのハッシュ。unique。 |
| `user_id` | uuid | yes | 紐付くSupabaseユーザー。 |
| `first_seen_at` | timestamptz | yes | 初回確認日時。 |
| `last_seen_at` | timestamptz | yes | 最終確認日時。 |
| `created_at` | timestamptz | yes | 作成日時。 |
| `updated_at` | timestamptz | yes | 更新日時。 |

制約:

- `device_install_id_hash` はunique。
- `user_id` は `auth.users(id)` を参照する。
- 同一 `device_install_id_hash` が再度 `/api/bootstrap` に送られた場合、既存行の `last_seen_at` を更新し、無料期間の再付与に使わない。

## subscriptions

RevenueCatから同期した購読状態。

| カラム | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `id` | uuid | yes | 主キー。 |
| `user_id` | uuid | yes | 所有者。 |
| `revenuecat_app_user_id` | text | yes | RevenueCat App User ID。 |
| `entitlement_id` | text | yes | 例: `pro`。 |
| `product_id` | text | yes | App Store商品ID。 |
| `status` | text | yes | `active`、`expired`、`billing_issue`等。 |
| `is_active` | boolean | yes | Pro有効判定。 |
| `current_period_started_at` | timestamptz | no | 期間開始。 |
| `current_period_ends_at` | timestamptz | no | 期間終了。 |
| `latest_event_at` | timestamptz | no | RevenueCat webhook受信時刻。 |
| `raw_event` | jsonb | no | RevenueCatイベントJSON。 |
| `created_at` | timestamptz | yes | 作成日時。 |
| `updated_at` | timestamptz | yes | 更新日時。 |

方針:

- MVPでは RevenueCat App User ID は Supabase `auth.users.id` と同じ値に統一する。
- RevenueCat webhookは `revenuecat_app_user_id` を Supabase `user_id` として扱い、`subscriptions` を更新する。

## phonemes

音素マスタ。`05_CONTENT_SPEC.md` の音素IDをseedする。

| カラム | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `phoneme_id` | text | yes | 主キー。例: `theta`。 |
| `ipa` | text | yes | 表示IPA。 |
| `category` | text | yes | `consonant`、`monophthong`、`diphthong`。 |
| `example_word` | text | yes | 例語。 |
| `ja_difficulty` | text | yes | `high`、`medium`、`low`。 |
| `sort_order` | int | yes | 表示順。 |
| `is_active` | boolean | yes | 出題対象か。 |

## phoneme_clusters

子音連結グループ。

| カラム | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `cluster_id` | text | yes | 主キー。例: `str`。 |
| `example_word` | text | yes | 例語。 |
| `ja_difficulty` | text | yes | `high`、`medium`、`low`。 |
| `sort_order` | int | yes | 表示順。 |
| `is_active` | boolean | yes | 出題対象か。 |

## practice_items

単語・文パック。

| カラム | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `practice_item_id` | text | yes | 主キー。例: `word_r_001`。 |
| `item_type` | text | yes | `word` または `sentence`。 |
| `text` | text | yes | 表示テキスト。 |
| `normalized_text` | text | yes | 判定/IPA変換用。 |
| `expected_ipa` | text | no | 表示用IPA。 |
| `accent` | text | yes | MVPは `US`。 |
| `ja_difficulty` | text | yes | 問題としての難易度。 |
| `source` | text | yes | `seed_ai_generated`、`manual_reviewed`等。 |
| `is_active` | boolean | yes | 出題対象か。 |
| `created_at` | timestamptz | yes | 作成日時。 |
| `updated_at` | timestamptz | yes | 更新日時。 |

## practice_item_targets

練習問題のターゲット。

| カラム | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `id` | uuid | yes | 主キー。 |
| `practice_item_id` | text | yes | `practice_items`。 |
| `target_type` | text | yes | `phoneme` または `cluster`。 |
| `target_id` | text | yes | `phoneme_id` または `cluster_id`。 |
| `position_hint` | jsonb | no | 単語位置、音素位置など。 |

制約:

- `(practice_item_id, target_type, target_id)` unique。

## daily_sessions

1日7問の固定セッション。

| カラム | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `id` | uuid | yes | 主キー。 |
| `user_id` | uuid | yes | 所有者。 |
| `session_date` | date | yes | 端末ローカル日付。 |
| `timezone` | text | yes | IANA timezone。 |
| `status` | text | yes | `created`、`in_progress`、`completed`。 |
| `completed_count` | int | yes | 0〜7。 |
| `created_at` | timestamptz | yes | 作成日時。 |
| `completed_at` | timestamptz | no | 完了日時。 |

制約:

- `(user_id, session_date)` unique。

## daily_session_items

daily_session内の各問題。

| カラム | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `id` | uuid | yes | 主キー。 |
| `daily_session_id` | uuid | yes | 親セッション。 |
| `position` | int | yes | 1〜7。 |
| `slot_type` | text | yes | `weak`、`new`、`review`。 |
| `practice_item_id` | text | yes | 出題問題。 |
| `target_phoneme_ids` | text[] | yes | 集計更新対象。 |
| `selection_reason` | jsonb | no | 選定理由。 |
| `status` | text | yes | `pending`、`in_progress`、`completed`、`skipped`。 |
| `best_attempt_id` | uuid | no | best attempt。 |
| `completed_at` | timestamptz | no | 完了日時。 |

制約:

- `(daily_session_id, position)` unique。

## attempts

パック問題の録音1回ごとの生ログ。

| カラム | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `id` | uuid | yes | 主キー。 |
| `user_id` | uuid | yes | 所有者。 |
| `daily_session_id` | uuid | no | デイリー由来の場合。 |
| `daily_session_item_id` | uuid | no | デイリー由来の場合。 |
| `practice_item_id` | text | yes | 練習問題。 |
| `practice_mode` | text | yes | `daily`、`weak_drill`、`phoneme_select`。 |
| `attempt_no` | int | yes | 同一問題内連番。 |
| `practiced_at` | timestamptz | yes | UTC時刻。 |
| `practiced_date` | date | yes | 端末ローカル日付。 |
| `timezone` | text | yes | IANA timezone。 |
| `target_phoneme_ids` | text[] | yes | 判定対象。 |
| `overall_score` | numeric | yes | 音素スコア平均。 |
| `target_score_avg` | numeric | yes | ターゲット音素平均。 |
| `is_correct` | boolean | yes | ターゲット音素すべて80以上。 |
| `is_perfect` | boolean | yes | 全音素80以上。 |
| `is_best` | boolean | yes | 集計対象best attemptか。 |
| `azure_raw_json` | jsonb | yes | 音声本体を除くAzure JSON。 |
| `normalized_result` | jsonb | yes | provider、locale、timing、capabilities、overall、issues、wordsを持つアプリ共通形式。未提供値はnull。 |
| `performance_metrics` | jsonb | no | tokenFetchMs、recognizerPreparationMs、buttonToAzureResultMs、normalizationMs、buttonToUiMs。 |
| `app_version` | text | no | アプリバージョン。 |
| `device_info` | jsonb | no | 端末/OS情報。 |
| `created_at` | timestamptz | yes | 作成日時。 |

音声ファイルパスはサーバー保存しない。端末ローカルの録音参照はアプリ内ストレージで管理する。

## attempt_phoneme_results

attempt内の音素別結果。

| カラム | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `id` | uuid | yes | 主キー。 |
| `attempt_id` | uuid | yes | 親attempt。 |
| `index` | int | yes | 音素位置。 |
| `word_index` | int | no | 文内単語位置。 |
| `expected_phoneme_id` | text | yes | 期待音素ID。 |
| `expected_ipa` | text | yes | 期待IPA。 |
| `observed_phoneme_id` | text | no | 実測音素ID。 |
| `observed_ipa` | text | no | 実測IPA。 |
| `score` | numeric | yes | 0〜100。 |
| `color` | text | yes | `green`、`yellow`、`red`。 |
| `is_target` | boolean | yes | ターゲットか。 |
| `confusion_pair_id` | text | no | 直し方ページID。 |

制約:

- `(attempt_id, index)` unique。

## phoneme_state

ユーザー×音素の集計状態。

| カラム | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `user_id` | uuid | yes | 所有者。 |
| `phoneme_id` | text | yes | 音素ID。 |
| `mastery_ewma` | numeric | no | 0〜100。初期null。 |
| `practice_count` | int | yes | 集計対象練習回数。 |
| `last_practiced_date` | date | no | 最終練習日。 |
| `next_review_date` | date | no | 次回復習日。 |
| `review_stage` | int | yes | 0〜3。 |
| `updated_at` | timestamptz | yes | 更新日時。 |

主キー:

- `(user_id, phoneme_id)`。

## phoneme_snapshots

日次スナップショット。

| カラム | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `user_id` | uuid | yes | 所有者。 |
| `snapshot_date` | date | yes | ローカル日付。 |
| `phoneme_id` | text | yes | 音素ID。 |
| `mastery_ewma` | numeric | yes | 更新後EWMA。 |
| `created_at` | timestamptz | yes | 作成日時。 |
| `updated_at` | timestamptz | yes | 更新日時。 |

主キー:

- `(user_id, snapshot_date, phoneme_id)`。

## user_badges

獲得済みバッジ。

| カラム | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `user_id` | uuid | yes | 所有者。 |
| `badge_id` | text | yes | `04_CORE_LOGIC.md` のID。 |
| `awarded_at` | timestamptz | yes | 獲得日時。 |
| `metadata` | jsonb | no | 獲得時の補足。 |

主キー:

- `(user_id, badge_id)`。

## user_bookmarks

保存項目。

| カラム | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `id` | uuid | yes | 主キー。 |
| `user_id` | uuid | yes | 所有者。 |
| `bookmark_type` | text | yes | `phoneme`、`practice_item`、`free_text`。 |
| `phoneme_id` | text | no | 音素保存時。 |
| `practice_item_id` | text | no | 問題保存時。 |
| `free_text` | text | no | 保存文。 |
| `created_at` | timestamptz | yes | 作成日時。 |

## free_attempts

自由入力ログ。集計テーブルとは完全分離する。

| カラム | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `id` | uuid | yes | 主キー。 |
| `user_id` | uuid | yes | 所有者。 |
| `attempted_at` | timestamptz | yes | UTC時刻。 |
| `attempted_date` | date | yes | ローカル日付。 |
| `timezone` | text | yes | IANA timezone。 |
| `input_text` | text | yes | raw text。 |
| `normalized_text` | text | yes | 正規化文。 |
| `ipa_result` | jsonb | no | IPA変換結果。 |
| `oov_words` | text[] | yes | OOV語。 |
| `conversion_confidence` | numeric | no | 0〜1。 |
| `phoneme_scores` | jsonb | yes | 音素ごとスコア。 |
| `word_scores` | jsonb | no | 単語ごとスコア。 |
| `overall_score` | numeric | no | 任意。 |
| `azure_raw_json` | jsonb | yes | 音声本体を除くAzure JSON。 |
| `normalized_result` | jsonb | yes | Azure固有構造から分離したアプリ共通形式。 |
| `performance_metrics` | jsonb | no | 個人情報・音声内容を含まない性能計測値。 |
| `native_language` | text | yes | `ja`。 |
| `target_accent` | text | yes | `US`。 |
| `pii_flag` | boolean | yes | PII疑い。 |
| `consent_version` | text | yes | 同意文バージョン。 |
| `app_version` | text | no | アプリバージョン。 |
| `device_info` | jsonb | no | 端末情報。 |

禁止:

- `free_attempts` から `phoneme_state` を更新しない。
- `free_attempts` からストリークを計算しない。
- `free_attempts` からヒートマップを計算しない。

## advice_pages

直し方ページ/テンプレ助言。

| カラム | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `advice_id` | text | yes | 主キー。 |
| `confusion_pair_id` | text | no | 混同ペアID。 |
| `generic_advice_id` | text | no | 汎用助言ID。 |
| `native_language` | text | yes | `ja`。 |
| `target_accent` | text | yes | `US`。 |
| `title` | text | yes | 表示タイトル。 |
| `short_tip` | text | yes | 1〜2行助言。 |
| `comparison_text` | text | no | 比較説明。 |
| `coach_example_text` | text | no | TTS用例文。 |
| `asset_id` | text | no | 静的アセットID。 |
| `is_template` | boolean | yes | テンプレか。 |
| `is_active` | boolean | yes | 表示対象か。 |
| `created_at` | timestamptz | yes | 作成日時。 |
| `updated_at` | timestamptz | yes | 更新日時。 |

## advice_feedback

助言評価。

| カラム | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `id` | uuid | yes | 主キー。 |
| `user_id` | uuid | yes | 所有者。 |
| `attempt_id` | uuid | no | パック問題由来。 |
| `free_attempt_id` | uuid | no | 自由入力由来。 |
| `advice_id` | text | yes | 表示した助言。 |
| `rating` | text | yes | `up` または `down`。 |
| `created_at` | timestamptz | yes | 作成日時。 |

## tts_cache

Piper生成音声キャッシュ。

| カラム | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `cache_key` | text | yes | 主キー。 |
| `text_hash` | text | yes | normalized_textのhash。 |
| `normalized_text` | text | yes | 元テキスト。 |
| `accent` | text | yes | `US`。 |
| `speed` | text | yes | `normal`、`slow`。 |
| `storage_path` | text | yes | Supabase Storage等のパス。 |
| `duration_ms` | int | no | 音声長。 |
| `created_at` | timestamptz | yes | 作成日時。 |
| `last_used_at` | timestamptz | yes | 最終利用。 |

これはお手本音声のキャッシュであり、ユーザー音声ではない。

## ai_advice_cache

OpenAI生成助言キャッシュ。

| カラム | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `cache_key` | text | yes | 主キー。 |
| `native_language` | text | yes | `ja`。 |
| `target_accent` | text | yes | `US`。 |
| `confusion_pair_id` | text | no | 混同ペア。 |
| `generic_advice_id` | text | no | 汎用助言。 |
| `prompt_version` | text | yes | プロンプト版。 |
| `output_text` | text | yes | 生成助言。 |
| `created_at` | timestamptz | yes | 作成日時。 |
| `last_used_at` | timestamptz | yes | 最終利用。 |

## error_logs

| カラム | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `id` | uuid | yes | 主キー。 |
| `user_id` | uuid | no | 不明な場合はnull。 |
| `source` | text | yes | `azure`、`piper`、`openai`、`revenuecat`、`supabase`等。 |
| `operation` | text | yes | 操作名。 |
| `message` | text | yes | エラーメッセージ。 |
| `details` | jsonb | no | 詳細。秘密値は入れない。 |
| `created_at` | timestamptz | yes | 作成日時。 |

## RLS方針

### ユーザー所有テーブル

以下は `user_id = auth.uid()` の行だけ読み書き可能にする。

- `profiles`
- `subscriptions` の読み取り。
- `daily_sessions`
- `daily_session_items`
- `attempts`
- `attempt_phoneme_results`
- `phoneme_state`
- `phoneme_snapshots`
- `user_badges`
- `user_bookmarks`
- `free_attempts`
- `advice_feedback`

ただし、`subscriptions` の書き込みはサーバー/service roleのみ。

`daily_session_items`、`attempt_phoneme_results` など、子テーブル自体に `user_id` を持たないテーブルは、親テーブルを `join` または `exists` で参照して `auth.uid()` と所有者が一致することを確認する。MVPでは子テーブルへの `user_id` 冗長保持は行わない。パフォーマンス問題が出た場合のみ再検討する。

### マスタテーブル

以下は認証ユーザーが読み取り可能、書き込みはservice roleのみ。

- `phonemes`
- `phoneme_clusters`
- `practice_items`
- `practice_item_targets`
- `advice_pages`

### キャッシュ/ログ

以下はクライアントから直接書き込まない。サーバー/service roleのみ。

- `installations`
- `tts_cache`
- `ai_advice_cache`
- `error_logs`

`installations` は課金回避対策に関わるため、作成・更新は `/api/bootstrap` 経由のサーバー処理に限定する。クライアントから直接 `device_install_id_hash` を書き込ませない。

## 削除

ユーザーが学習データ削除を実行した場合、以下を削除または匿名化する。

- `attempts`
- `attempt_phoneme_results`
- `daily_sessions`
- `daily_session_items`
- `phoneme_state`
- `phoneme_snapshots`
- `user_badges`
- `user_bookmarks`
- `free_attempts`
- `advice_feedback`
- 端末ローカル録音ファイル。

`profiles` は退会相当の場合に `deleted_at` を設定し、必要に応じて識別情報を匿名化する。

## 書き出し

JSON書き出し対象:

- `profiles` のユーザー設定。
- `attempts` と `attempt_phoneme_results`。
- `daily_sessions` と `daily_session_items`。
- `phoneme_state`。
- `phoneme_snapshots`。
- `user_badges`。
- `user_bookmarks`。
- `free_attempts`。
- `advice_feedback`。

音声ファイルは含めない。

## インデックス

MVPで最低限必要なインデックス:

- `attempts(user_id, practiced_date)`
- `attempts(user_id, practice_item_id)`
- `attempts(user_id, is_best)`
- `installations(device_install_id_hash)`
- `installations(user_id)`
- `attempt_phoneme_results(attempt_id)`
- `attempt_phoneme_results(expected_phoneme_id)`
- `phoneme_state(user_id, mastery_ewma)`
- `phoneme_state(user_id, next_review_date)`
- `phoneme_snapshots(user_id, snapshot_date)`
- `daily_sessions(user_id, session_date)`
- `free_attempts(user_id, attempted_date)`
- `user_badges(user_id, badge_id)`

## ローカル開発

SupabaseはDocker経由でローカルに立ち上げる。

実装フェーズでは、以下を用意する。

- `supabase/config.toml`
- `supabase/migrations/`
- `supabase/seed.sql`
- ローカルDB起動手順。
- RLSテスト用のSQLまたはテストコード。

具体コマンドは `08_ARCHITECTURE.md` に記載する。

## フェーズ4セルフレビュー

- マスター設計書・既作成ドキュメントとの矛盾: 音声非保存、attempt全ログ、best attempt集計、自由入力分離、Supabase anonymous auth、auth.uid() RLSを反映済み。
- Codexが実装に着手できる具体性: テーブル、カラム、主キー、制約、RLS、削除/書き出し対象、インデックスを定義済み。
- 用語・命名の一貫性: `daily_sessions`、`attempts`、`free_attempts`、`phoneme_state`、`phoneme_snapshots` を `04_CORE_LOGIC.md` と一致させた。
