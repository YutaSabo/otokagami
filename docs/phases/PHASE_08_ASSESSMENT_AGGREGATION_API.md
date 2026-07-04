# Phase 8: 判定/集計API

## 運用ルール

- ユーザーが「Phase 8 の指示書をもとに作業してください」と指示したら、この指示書を根拠に開発を開始する。
- この指示書に書かれた内容がすべて完了したら、Phase 8 は完了とし、作業を終了する。勝手に Phase 9 へ進まない。
- 次の Phase は、ユーザーが改めて実行を依頼したときに開始する。
- 音声はAzure判定のため一時送信するだけで、サーバーやSupabase Storageに保存しない。
- 実際のAPIキー、トークン、秘密鍵、service role keyをチャットやコミットに出さない。

## ゴール

パック問題の録音を判定し、attempt保存、音素結果保存、best attempt再計算、`phoneme_state`、`phoneme_snapshots`、バッジ更新までをサーバー側で実装する。Phase 8 完了時点では、Azureモックで統合テストが通り、実キーがある環境ではAzure実接続確認ができる。

## 前提条件

- Phase 2、Phase 3、Phase 6、Phase 7が完了している。
- `.env` の `AZURE_SPEECH_KEY` と `AZURE_SPEECH_REGION` は実接続確認時のみローカルで埋める。値はチャットに書かない。
- 参照設計書:
  - `docs/specs/02_MVP_SCOPE.md`
  - `docs/specs/03_UX_SPEC.md`
  - `docs/specs/04_CORE_LOGIC.md`
  - `docs/specs/06_DATA_MODEL.md`
  - `docs/specs/07_API_SPEC.md`
  - `docs/specs/09_PRIVACY_BILLING_SECURITY.md`
  - `docs/specs/10_TEST_PLAN.md`

## スコープ

含む:

- `/api/assess`。
- Azure Pronunciation Assessment連携。
- Azureモック。
- Azureレスポンスの `phoneme_results` 正規化。
- `attempts` と `attempt_phoneme_results` 保存。
- best attempt再計算。
- `phoneme_state` と `phoneme_snapshots` 更新。
- daily session item完了更新。
- レベル/バッジ/称号判定のうち保存が必要なもの。
- error log保存。

含まない:

- 自由入力判定。これはPhase 9で行う。
- モバイル録音UI。
- 端末ローカル録音保存。
- OpenAI未知助言生成の高度化。テンプレ/汎用フォールバックを優先する。

## 作業タスクリスト

1. `/api/assess` の入力処理を実装
   - `multipart/form-data` を受け取る。
   - fields:
     - `audio`
     - `practice_item_id`
     - `practice_mode = daily | weak_drill | phoneme_select`
     - `daily_session_id`
     - `daily_session_item_id`
     - `attempt_no`
     - `timezone`
     - `practiced_date`
     - `app_version`
   - daily以外では `daily_session_id` と `daily_session_item_id` は不要。

2. アクセス制御を実装
   - 無料期間中またはPro有効なら利用可。
   - 8日目以降でPro無効なら `PAYWALL_REQUIRED`。
   - JWT不正は `UNAUTHORIZED`。

3. Azure連携を実装
   - 音声はAzureへ一時送信する。
   - サーバー、DB、Supabase Storageにユーザー音声を保存しない。
   - 保存するのは音声本体を除くAzure JSON、正規化済み音素結果、スコア、フラグのみ。
   - ローカルテストではAzureモックを使えるようにする。

4. `phoneme_results` 正規化を実装
   - 最小項目は `docs/specs/04_CORE_LOGIC.md` の定義に従う。
   - `expected_phoneme_id`、`observed_phoneme_id` は内部音素IDに正規化する。
   - 色は全画面共通しきい値で決める。
   - `confusion_pair_id` は期待音素と実測音素から付与する。未対応はnullまたは汎用フォールバック可能な状態にする。

5. attempt保存を実装
   - Azure成功時のみscored attemptとして `attempts` に保存する。
   - `attempt_phoneme_results` を保存する。
   - `overall_score`、`target_score_avg`、`is_correct`、`is_perfect` を保存する。
   - Azure失敗、通信失敗、保存失敗は練習回数、ストリーク、習熟度に入れない。

6. best attempt再計算を実装
   - 同一 `daily_session_item_id` または同一練習問題内でbestを再計算する。
   - ターゲット音素平均、overall、attempt_noの順で選ぶ。
   - bestが変わった場合、以前のbestを外し、新bestだけ `is_best = true` にする。

7. 集計更新を実装
   - パック問題のbest attemptだけを対象にする。
   - ターゲット音素だけ `phoneme_state` を更新する。
   - EWMA、practice_count、last_practiced_date、review_stage、next_review_dateを更新する。
   - `phoneme_snapshots` をupsertする。
   - `daily_session_items.best_attempt_id`、status、completed_atを更新する。
   - 7問完了時は `daily_sessions.status = completed`、`completed_at` を更新する。

8. バッジ更新を実装
   - Phase 3のロジックを使う。
   - 条件達成時に `user_badges` へ一度だけ保存する。
   - 称号は履歴保存必須ではないため、Phase 9のprogress APIで算出してもよい。

9. 直し方候補を返す
   - 赤または黄のターゲット音素から `recommended_advice_id` を返す。
   - 対応する混同ペアページがない場合は汎用ページへフォールバックする。

10. エラーログを実装
   - Azure判定失敗、Supabase保存失敗などを `error_logs` に保存する。
   - 秘密値、Authorizationヘッダー、ユーザー音声を保存しない。

11. テストを作成
   - Azureモックでattemptが保存される。
   - phoneme resultsが保存される。
   - best attemptが更新される。
   - `phoneme_state` がEWMA式で更新される。
   - `phoneme_snapshots` が保存される。
   - バッジ条件達成で `user_badges` に保存される。
   - Azure失敗時は `error_logs` のみ保存され、集計に入らない。

## 動作確認手順

- Supabase local、Next.js APIを起動する。
- Azureモックを使って `/api/assess` を呼ぶ。
- `attempts`、`attempt_phoneme_results`、`phoneme_state`、`phoneme_snapshots`、`user_badges` の更新を確認する。
- Azure失敗モックで集計が更新されないことを確認する。
- 実キーがローカルに設定されている場合のみ、短い音声でAzure実接続を確認する。
- ユーザー音声がサーバーやSupabase Storageに保存されていないことを確認する。

## 完了条件チェックリスト

- [ ] `/api/assess` がパック問題の判定を処理できる。
- [ ] Azureモックによる統合テストが通る。
- [ ] Azure成功時のみattemptと音素結果が保存される。
- [ ] best attemptだけが集計更新に使われる。
- [ ] `phoneme_state` と `phoneme_snapshots` が仕様通り更新される。
- [ ] Azure失敗時に集計が更新されない。
- [ ] ユーザー音声をサーバー保存していない。
- [ ] Phase 9に進まず、作業を終了できる。

## セルフレビュー観点

- `docs/specs/04_CORE_LOGIC.md` のbest attemptと集計ルールに矛盾していない。
- `docs/specs/09_PRIVACY_BILLING_SECURITY.md` の音声非保存ルールを守っている。
- Phase 8だけで判定保存から集計更新まで検証できる。
