# Phase 9: 自由入力/データ管理API

## 運用ルール

- ユーザーが「Phase 9 の指示書をもとに作業してください」と指示したら、この指示書を根拠に開発を開始する。
- この指示書に書かれた内容がすべて完了したら、Phase 9 は完了とし、作業を終了する。勝手に Phase 10 へ進まない。
- 次の Phase は、ユーザーが改めて実行を依頼したときに開始する。
- 自由入力はPro限定であり、無料期間中でも利用不可とする。
- 実際のAPIキー、トークン、秘密鍵、service role keyをチャットやコミットに出さない。

## ゴール

Pro限定の自由入力判定、自由入力同意、進捗取得、学習データ書き出し、学習データ削除を実装する。Phase 9 完了時点では、自由入力が `free_attempts` にだけ保存され、`phoneme_state`、ストリーク、ヒートマップ、レベル、バッジ、称号に影響しないことをAPIテストで確認できる。

## 前提条件

- Phase 2、Phase 3、Phase 5、Phase 6、Phase 8が完了している。
- Python推論サービスが起動できる。
- Azure判定のモックまたは実接続が利用できる。
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

- `/api/free-text-consent`。
- `/api/free-assess`。
- `/api/progress`。
- `/api/advice-feedback`。
- `/api/export`。
- `/api/delete-learning-data`。
- 自由入力の日次ソフトキャップ。
- `free_attempts` と集計系の分離確認。
- データ削除/書き出し対象の実装。

含まない:

- モバイル自由入力UI。
- RevenueCat購入UI。
- 本番データ削除運用。
- 高度なPII匿名化。MVPでは簡易ルールまたは常にfalseの初期実装でよい。

## 作業タスクリスト

1. `/api/free-text-consent` を実装
   - Pro entitlementが有効なユーザーだけ許可する。
   - `consent_version` を受け取る。
   - `profiles.free_text_consent_version` と `profiles.free_text_consented_at` を更新する。
   - 無料期間中でもProでなければ拒否する。

2. `/api/free-assess` を実装
   - `multipart/form-data` を受け取る。
   - fields:
     - `text`
     - `audio`
     - `timezone`
     - `attempted_date`
     - `consent_version`
     - `app_version`
   - Pro entitlementを確認する。
   - `profiles.free_text_consent_version` と `free_text_consented_at` で同意済みか確認する。
   - 1日20回程度のソフトキャップを適用する。

3. 自由入力の判定処理を実装
   - Python推論サービス `/internal/ipa` で正規化とIPA変換を行う。
   - Azure判定を行う。
   - `free_attempts` に保存する。
   - 保存項目は `docs/specs/06_DATA_MODEL.md` の `free_attempts` に従う。
   - ユーザー音声をサーバー保存しない。

4. 集計分離を保証
   - 自由入力から以下を更新しない。
     - `phoneme_state`
     - `phoneme_snapshots`
     - ストリーク
     - ヒートマップ
     - レベル
     - バッジ
     - 称号
     - 復習日
   - この分離をテストで固定する。

5. `/api/progress` を実装
   - `attempts`、`phoneme_state`、`phoneme_snapshots`、`user_badges` から進捗を返す。
   - `free_attempts` は使わない。
   - 返却項目:
     - current/longest streak
     - overall mastery
     - phoneme heatmap
     - mastery series
     - level
     - title
     - badges
   - 総合習熟度は評価済み音素EWMA平均。生スコア日次平均は使わない。

6. `/api/advice-feedback` を実装
   - 表示した助言への評価を `advice_feedback` に保存する。
   - Requestは `docs/specs/07_API_SPEC.md` に従い、`attempt_id`、`free_attempt_id`、`advice_id`、`rating` を受け取る。
   - `rating` は `up` または `down`。
   - パック問題由来は `attempt_id` を保存し、`free_attempt_id` はnullにする。
   - 自由入力由来に対応する場合は `free_attempt_id` を保存し、`attempt_id` はnullにする。
   - ユーザー本人のattempt/free_attemptにしか紐付けられないよう所有者確認する。

7. `/api/export` を実装
   - JSON書き出し対象は設計書に従う。
   - 含める:
     - profile設定
     - attemptsとattempt_phoneme_results
     - daily_sessionsとdaily_session_items
     - phoneme_state
     - phoneme_snapshots
     - user_badges
     - user_bookmarks
     - free_attempts
     - advice_feedback
   - 含めない:
     - 音声ファイル
     - APIキー
     - サーバー内部ログ

8. `/api/delete-learning-data` を実装
   - `confirm: true` を要求する。
   - 削除対象:
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
   - `profiles.free_trial_started_at` と購読状態は削除しない。
   - 端末ローカル録音はPhase 12でアプリ側が削除する。APIレスポンスでアプリ側削除が必要なことを扱いやすくする。

9. テストを作成
   - Proでない場合 `/api/free-text-consent` と `/api/free-assess` が拒否される。
   - 同意なしの場合 `/api/free-assess` が拒否される。
   - 日次上限超過で拒否される。
   - 成功時に `free_attempts` だけ保存される。
   - `phoneme_state` が変わらない。
   - `/api/progress` が `free_attempts` を使わない。
   - `/api/advice-feedback` が本人のattempt/free_attemptにだけ評価を保存できる。
   - `/api/export` に音声ファイルや秘密情報が含まれない。
   - `/api/delete-learning-data` で対象データが削除され、無料期間と購読状態は残る。

## 動作確認手順

- Supabase local、Python推論サービス、Next.js APIを起動する。
- Pro無効ユーザーで自由入力APIが拒否されることを確認する。
- Pro有効ユーザーで同意保存後、自由入力判定を行う。
- 判定後に `free_attempts` は増え、`phoneme_state` は変わらないことを確認する。
- `/api/progress` を呼び、進捗がパック練習だけから作られていることを確認する。
- `/api/advice-feedback` を呼び、助言評価が保存されることを確認する。
- `/api/export` と `/api/delete-learning-data` を実行し、対象範囲を確認する。
- テストを実行し全件成功することを確認する。

## 完了条件チェックリスト

- [ ] `/api/free-text-consent` がPro限定で動く。
- [ ] `/api/free-assess` がPro、同意、日次ソフトキャップを確認している。
- [ ] 自由入力は `free_attempts` にだけ保存される。
- [ ] 自由入力が集計系へ影響しないテストがある。
- [ ] `/api/progress` が仕様通り進捗を返す。
- [ ] `/api/advice-feedback` が助言評価を保存できる。
- [ ] `/api/export` が音声と秘密情報を含めずJSONを返す。
- [ ] `/api/delete-learning-data` が学習データを削除し、無料期間と購読状態を残す。
- [ ] Phase 10に進まず、作業を終了できる。

## セルフレビュー観点

- `docs/specs/04_CORE_LOGIC.md` の自由入力分離ルールと矛盾していない。
- `docs/specs/09_PRIVACY_BILLING_SECURITY.md` の同意、削除、書き出しルールを満たしている。
- Phase 9だけで自由入力とデータ管理APIの検証まで完結できる。
