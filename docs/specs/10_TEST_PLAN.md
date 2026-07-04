# Test Plan

## 目的

このテスト計画は、Pronunciation Mirror MVP が仕様どおりに動くことを確認するための受け入れ基準とテスト観点を定義する。

後続セッションがPhase別の実行指示書を作る場合、各Phaseの完了条件はこのテスト計画から逆算する。

## テスト方針

- コアロジックはユニットテストで固定する。
- DB/RLS/集計更新は統合テストで確認する。
- 録音から判定、詳細、直し方、次へまでの流れはE2Eで確認する。
- 課金、自由入力、データ削除、シークレット、音声非保存はMVP受け入れ前に必ず確認する。
- 外部APIは、ローカルではモックを使い、本番相当では実キーを `.env` に入れた環境で検証する。

## 受け入れ基準

MVP完了には次をすべて満たす必要がある。

### プロダクト体験

- 新規ユーザーがメール登録なしで開始できる。
- 同じ `device_install_id` 由来の再起動/再インストール相当で無料期間が再付与されない。
- ホームにストリーク、今日の進捗、スタートボタンが表示される。
- 今日の7個は当日初回生成時に固定される。
- ホームに7個の一覧が表示されない。
- 1問ずつ録音、判定、次へができる。
- 7個完了で完了状態になる。

### 判定

- 録音音声がバックエンド経由でAzureに送られる。
- Azure成功時のみ `attempts` に保存される。
- Azure失敗時は練習回数、ストリーク、習熟度に入らない。
- 期待IPAと実測IPAが2段で表示される。
- 音素色が緑80以上、黄60〜79、赤60未満で表示される。
- ターゲット音素すべて80以上なら問題正解になる。
- 全音素80以上なら間違いゼロ表示になる。

### 集計

- 同一問題内で複数attemptがある場合、ターゲット音素平均が最高のattemptだけがbestになる。
- `phoneme_state` はbest attemptでのみ更新される。
- EWMAが `new = 0.3 * score + 0.7 * old` で更新される。
- 復習間隔が1、3、7、14日の段階で更新される。
- `phoneme_snapshots` が日次で保存される。
- ストリークが `attempts.practiced_date` だけで計算される。

### 進捗

- ヒートマップが `phoneme_state.mastery_ewma` から表示される。
- 総合習熟度が評価済み音素のEWMA平均になる。
- 生スコアの日次平均が推移グラフに使われていない。
- レベルが累計完了問題数から決まる。
- バッジが条件達成時に一度だけ付与される。
- 称号が優先順位に従って表示される。

### 自由入力

- Pro未登録では自由入力を開始できない。
- 7日無料期間中でも自由入力は使えない。
- 初回利用時に保存同意が表示される。
- 同意後、`profiles.free_text_consent_version` と `profiles.free_text_consented_at` が保存される。
- 同意後、`free_attempts` に保存される。
- 自由入力が `phoneme_state`、ストリーク、ヒートマップ、レベル、バッジ、称号に影響しない。
- 1日20回程度のソフトキャップが効く。

### 課金

- 初回から7日間は、自由入力以外のMVP機能を利用できる。
- 8日目以降、Pro未登録なら練習開始前に課金ウォールが出る。
- Pro登録後、練習できる。
- 購入復元が動く。
- Appleイントロオファーを前提にしていない。
- RevenueCatのPro entitlementでアクセス制御される。

### プライバシー/セキュリティ

- ユーザー音声がサーバーやSupabase Storageに保存されていない。
- お手本音声だけがTTSキャッシュとして保存される。
- `.env` と `.env.local` がGit管理されない。
- `.env.example` がGit管理される。
- Azure/OpenAI/Supabase service role/RevenueCat secretがExpoアプリに含まれない。
- RLSによりユーザーは自分のデータだけ読める。
- RevenueCat webhookが認証される。
- Python推論サービスが内部APIキーで保護される。

### データ管理

- 学習データ削除で対象テーブルのデータが削除される。
- 端末ローカル録音も削除される。
- JSON書き出しができる。
- JSON書き出しに音声ファイルや秘密情報が含まれない。

## ユニットテスト

### コアロジック

対象:

- 色判定。
- 正解判定。
- 間違いゼロ判定。
- EWMA更新。
- review_stage更新。
- best attempt選定。
- 総合習熟度計算。
- ストリーク計算。
- レベル判定。
- バッジ付与判定。
- 称号判定。

必須ケース:

| ケース | 期待 |
| --- | --- |
| score 80 | 緑。 |
| score 79.9 | 黄。 |
| score 60 | 黄。 |
| score 59.9 | 赤。 |
| 初回EWMA | スコアそのまま。 |
| 2回目EWMA | `0.3 * score + 0.7 * old`。 |
| ターゲット全80以上 | 正解。 |
| 非ターゲット赤あり | 正解判定には影響しない。 |
| 全音素緑 | 間違いゼロ。 |
| ターゲット平均が最高 | best attempt。 |

### 出題

対象:

- 苦手枠。
- 新規枠。
- 復習枠。
- フォールバック。
- 同日セッション固定。

必須ケース:

- 新規音素がある場合、新規枠に入る。
- `next_review_date <= 今日` が復習枠に入る。
- `mastery_ewma` が低い音素が苦手枠に入る。
- 新規不足時、復習で埋まる。
- 同じ `session_date` では同じdaily_sessionが返る。

## DB/RLSテスト

### ローカルSupabase

Docker経由のローカルSupabaseでテストする。

確認:

- migrationが通る。
- seedが通る。
- `phonemes` に定義済み音素IDが入る。
- `practice_items` と `practice_item_targets` が整合する。
- RLSが有効。

### RLS

必須ケース:

- ユーザーAはユーザーAの `attempts` を読める。
- ユーザーAはユーザーBの `attempts` を読めない。
- ユーザーAは自分の `free_attempts` を読める。
- ユーザーAは他人の `free_attempts` を読めない。
- 認証ユーザーは `phonemes` を読める。
- クライアントは `practice_items` を書き換えられない。
- クライアントは `tts_cache` を直接書き込めない。
- `subscriptions` の書き込みはservice roleのみ。

## API統合テスト

### `/api/bootstrap`

- 初回でprofileが作られる。
- 2回目で同じprofileが返る。
- `free_trial_started_at` がサーバー時刻で保存される。

### `/api/daily-session`

- 7件のitemsが返る。
- 単語5、文2になる。
- slot_type配分が苦手3、新規2、復習2になる。
- 同日再呼び出しで同じitemsが返る。

### `/api/practice-session`

- `mode = weak_drill` で `phoneme_state.mastery_ewma` が低い音素を優先したitemsが返る。
- `mode = phoneme_select` で指定 `phoneme_id` をターゲットに持つitemsが返る。
- `phoneme_select` で `phoneme_id` 未指定の場合は拒否される。
- `practice_items.is_active = false` の問題は返らない。
- 未Proかつ無料期間外の場合は `PAYWALL_REQUIRED` になる。

### `/api/assess`

Azureモックを使って確認する。

- attemptが保存される。
- phoneme resultsが保存される。
- best attemptが更新される。
- phoneme_stateが更新される。
- badge条件が満たされたらuser_badgesに保存される。
- Azure失敗時はerror_logsのみ保存される。

### `/api/free-assess`

- Proでない場合拒否される。
- 同意なしの場合拒否される。
- 日次上限超過で拒否される。
- 成功時に `free_attempts` だけ保存される。
- `phoneme_state` が変わらない。

### `/api/free-text-consent`

- Proでない場合拒否される。
- Pro有効ユーザーで `profiles.free_text_consent_version` が保存される。
- `free_text_consented_at` がサーバー時刻で保存される。

### `/api/tts`

- キャッシュなしでPythonサービスが呼ばれる。
- キャッシュありで再生成されない。
- `normal` と `slow` が別キャッシュになる。

### RevenueCat webhook

- 認証なしは拒否される。
- RevenueCat App User ID を Supabase `user_id` として扱う。
- 有効イベントで `subscriptions` が更新される。
- Pro entitlementが `access-status` に反映される。

## E2Eテスト

### デイリー完走

1. 新規ユーザーで起動。
2. ホームでスタート。
3. 1問目を録音。
4. 判定後、2段IPAとスコアを確認。
5. 詳細を見る。
6. 赤/黄の音から直し方へ進む。
7. もう一度録音する。
8. 次へ進む。
9. 7問完了する。
10. ホームで `7 / 7` と完了状態を確認。
11. 進捗でストリーク、ヒートマップ、グラフが更新される。

### 間違いゼロ

1. Azureモックで全音素80以上を返す。
2. 判定後に「素晴らしい！」が出る。
3. 詳細が強制表示されない。

### 課金ウォール

1. `free_trial_started_at` を8日前にする。
2. RevenueCat Proなしにする。
3. 練習開始で課金ウォールが出る。
4. 閉じると練習が始まらない。
5. Pro有効にすると練習できる。

### 自由入力

1. 無料期間中ユーザーで自由入力を開く。
2. 課金ウォールが出る。
3. Pro有効ユーザーで自由入力を開く。
4. 初回同意を完了する。
5. 判定する。
6. `free_attempts` に保存され、進捗が変わらないことを確認する。

## 手動確認

自動テストで拾いにくい項目。

- 録音ボタンの押しやすさ。
- 録音中の中断確認。
- お手本と自分の聞き比べ。
- 直し方の文章が2〜3行以内に収まる。
- 色だけでなくラベル/記号で意味が分かる。
- オフライン時に練習不可であることが分かる。
- 通知許可拒否時に設定が破綻しない。
- データ削除の確認文が明確である。

## シークレット確認

実装フェーズでは、キーが必要な作業の前に `.env` の該当項目が埋まっていることを確認する。

確認対象:

- `AZURE_SPEECH_KEY`
- `AZURE_SPEECH_REGION`
- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_REVENUECAT_IOS_PUBLIC_SDK_KEY`
- `REVENUECAT_SECRET_KEY`
- `REVENUECAT_WEBHOOK_AUTH_TOKEN`
- `PYTHON_SERVICE_URL`
- `PYTHON_SERVICE_API_KEY`
- `PIPER_VOICE_US`
- `PIPER_VOICE_DIR`

値そのものはチャットに書かせない。

## リリース前チェックリスト

- `.env` がコミットされていない。
- `.env.example` が最新。
- 追加した環境変数をユーザーに通知済み。
- Supabase migrationがローカルで通る。
- seedがローカルで通る。
- RLSテストが通る。
- Azure実接続テストが成功する。
- Piper TTSが生成とキャッシュに成功する。
- RevenueCat sandbox購入と復元が成功する。
- 8日目課金ウォールが動く。
- データ削除が動く。
- JSON書き出しが動く。
- サーバーにユーザー音声が保存されていない。
- ステージングAPI、ステージングPython推論サービス、ステージングSupabaseで主要E2Eが通る。
- TestFlight配布前に、ステージング環境でデイリー完走、課金ウォール、自由入力、データ削除のE2E動作確認が完了している。

## フェーズ4セルフレビュー

- マスター設計書・既作成ドキュメントとの矛盾: デイリー7個、判定3画面、EWMA、自由入力分離、RevenueCat、音声非保存、ローカルSupabaseを検証項目に反映済み。
- Codexが実装に着手できる具体性: ユニット/DB/API/E2E/手動/リリース前の確認観点を具体化済み。
- 用語・命名の一貫性: `attempts`、`free_attempts`、`phoneme_state`、`daily_session`、Pro entitlementを既存仕様と一致させた。
