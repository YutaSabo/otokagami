# Phase 2: Supabase DB/RLS

## 運用ルール

- ユーザーが「Phase 2 の指示書をもとに作業してください」と指示したら、この指示書を根拠に開発を開始する。
- この指示書に書かれた内容がすべて完了したら、Phase 2 は完了とし、作業を終了する。勝手に Phase 3 へ進まない。
- 次の Phase は、ユーザーが改めて実行を依頼したときに開始する。
- 根拠のないテーブル、カラム、RLSポリシーを追加しない。必要性が出た場合は設計書との差分を明示して確認する。
- 実際のAPIキー、トークン、秘密鍵、service role keyをチャットやコミットに出さない。

## ゴール

Supabase localで、MVPに必要なPostgresスキーマ、RLS、マスタseedを作成する。Phase 2 完了時点で、`supabase db reset` によりDBを再現でき、RLSテストでユーザー所有データとマスタデータのアクセス制御を確認できる状態にする。

## 前提条件

- Phase 1が完了している。
- Supabase CLI と Docker が利用できる。
- 参照設計書:
  - `docs/specs/05_CONTENT_SPEC.md`
  - `docs/specs/06_DATA_MODEL.md`
  - `docs/specs/08_ARCHITECTURE.md`
  - `docs/specs/09_PRIVACY_BILLING_SECURITY.md`
  - `docs/specs/10_TEST_PLAN.md`

## スコープ

含む:

- Supabase migration作成。
- `pgcrypto` 拡張有効化。
- 全MVPテーブルの作成。
- 制約、外部キー、インデックスの作成。
- RLS有効化とポリシー作成。
- 音素、子音連結、最小マスタseed。
- RLSテスト用SQLまたはテストコード。

含まない:

- Next.js APIの実装。
- 出題ロジックや集計ロジックのアプリケーション実装。
- 練習パック全量や直し方ページ全量の作成。これはPhase 4で行う。
- Supabase hosted本番環境の作成。

## 作業タスクリスト

1. Supabase local構成を確認
   - `supabase/config.toml` が存在し、ローカル起動できる構成になっているか確認する。
   - `docs/specs/08_ARCHITECTURE.md` のSupabaseローカル開発手順を確認する。

2. migrationを作成
   - `docs/specs/06_DATA_MODEL.md` のテーブル一覧に従い、以下を作成する。
     - `profiles`
     - `installations`
     - `subscriptions`
     - `phonemes`
     - `phoneme_clusters`
     - `practice_items`
     - `practice_item_targets`
     - `daily_sessions`
     - `daily_session_items`
     - `attempts`
     - `attempt_phoneme_results`
     - `phoneme_state`
     - `phoneme_snapshots`
     - `user_badges`
     - `user_bookmarks`
     - `free_attempts`
     - `advice_pages`
     - `advice_feedback`
     - `tts_cache`
     - `ai_advice_cache`
     - `error_logs`

3. 重要な設計決定を反映
   - `profiles` に `free_text_consent_version` と `free_text_consented_at` を含める。
   - `installations` は `device_install_id_hash`、`user_id`、`first_seen_at`、`last_seen_at` を持つ。
   - RevenueCat App User ID は Supabase `auth.users.id` と同じ値に統一する前提で `subscriptions` を設計する。
   - ユーザー音声ファイルのサーバー保存用カラムを作らない。

4. 制約とインデックスを作成
   - `docs/specs/06_DATA_MODEL.md` の主キー、unique、外部キー、インデックスを反映する。
   - `attempt_phoneme_results(attempt_id)`、`phoneme_state(user_id, mastery_ewma)`、`daily_sessions(user_id, session_date)` など、指定済みインデックスを作る。

5. RLSを実装
   - ユーザー所有テーブルは `auth.uid()` を所有者判定に使う。
   - `daily_session_items`、`attempt_phoneme_results` など子テーブル自体に `user_id` がないものは、親テーブルへの `exists` または `join` 経由で所有者確認する。
   - `subscriptions` のクライアント書き込みは禁止し、読み取りのみユーザー本人に許可する。
   - `phonemes`、`phoneme_clusters`、`practice_items`、`practice_item_targets`、`advice_pages` は認証ユーザー読み取り可、書き込みはservice roleのみとする。
   - `installations`、`tts_cache`、`ai_advice_cache`、`error_logs` はクライアント直接書き込み不可とする。

6. マスタseedを作成
   - `docs/specs/05_CONTENT_SPEC.md` の音素IDをseedする。
   - 子音24個、単母音12個、二重母音5個を登録する。
   - 子音連結グループを登録する。
   - 練習パック全量はPhase 4で作るため、このPhaseではスキーマ整合確認用の最小seedに留めてよい。

7. DB/RLSテストを作成
   - `docs/specs/10_TEST_PLAN.md` のDB/RLSテスト項目を満たす。
   - 少なくとも以下を確認する。
     - ユーザーAは自分の `attempts` を読める。
     - ユーザーAはユーザーBの `attempts` を読めない。
     - ユーザーAは自分の `free_attempts` を読める。
     - 認証ユーザーは `phonemes` を読める。
     - クライアントは `practice_items` を書き換えられない。
     - クライアントは `tts_cache`、`installations` を直接書き込めない。
     - `subscriptions` の書き込みはservice roleのみ。

## 動作確認手順

- `supabase start` が成功する。
- `supabase db reset` が成功する。
- seed後に `phonemes` と `phoneme_clusters` が仕様通り入っている。
- migrationを空DBに再適用しても失敗しない。
- RLSテストが成功する。
- `.env` やservice role keyをログに出していないことを確認する。

## 完了条件チェックリスト

- [ ] `docs/specs/06_DATA_MODEL.md` のMVPテーブルがすべて作成されている。
- [ ] `profiles` の自由入力同意カラムが作成されている。
- [ ] `installations` が作成され、クライアント直接書き込み不可になっている。
- [ ] 子テーブルRLSが親テーブル経由で所有者確認している。
- [ ] マスタテーブルは認証ユーザー読み取り可、service roleのみ書き込み可である。
- [ ] ユーザー音声のサーバー保存カラムが存在しない。
- [ ] `supabase db reset` とRLSテストが通る。
- [ ] Phase 3に進まず、作業を終了できる。

## セルフレビュー観点

- `docs/specs/06_DATA_MODEL.md` とテーブル・カラム・RLS方針が一致している。
- Phase 2だけでDB作成からRLS検証まで完結できる。
- 完了条件がSQLまたはテストで客観的に確認できる。
