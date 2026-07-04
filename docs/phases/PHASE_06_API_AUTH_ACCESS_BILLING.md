# Phase 6: API基盤/認証/課金状態

## 運用ルール

- ユーザーが「Phase 6 の指示書をもとに作業してください」と指示したら、この指示書を根拠に開発を開始する。
- この指示書に書かれた内容がすべて完了したら、Phase 6 は完了とし、作業を終了する。勝手に Phase 7 へ進まない。
- 次の Phase は、ユーザーが改めて実行を依頼したときに開始する。
- サーバー専用キーはNext.js API内に閉じ込め、Expoアプリへ渡さない。
- 実際のAPIキー、トークン、秘密鍵、service role keyをチャットやコミットに出さない。

## ゴール

Next.js APIの認証、ユーザー初期化、無料期間、RevenueCat購読状態、webhook骨格を実装する。Phase 6 完了時点では、Supabase anonymous authのJWTを検証し、`/api/bootstrap` と `/api/access-status` が動き、RevenueCat App User ID = Supabase `user_id` の方針で購読状態を扱える。

## 前提条件

- Phase 1とPhase 2が完了している。
- Supabase localが起動し、migration/seedが適用済みである。
- 参照設計書:
  - `docs/specs/03_UX_SPEC.md`
  - `docs/specs/06_DATA_MODEL.md`
  - `docs/specs/07_API_SPEC.md`
  - `docs/specs/08_ARCHITECTURE.md`
  - `docs/specs/09_PRIVACY_BILLING_SECURITY.md`
  - `docs/specs/10_TEST_PLAN.md`

## スコープ

含む:

- Next.js API共通レスポンス形式。
- Supabase JWT検証。
- service role clientのサーバー限定利用。
- `/api/bootstrap`。
- `/api/access-status`。
- RevenueCat webhook骨格。
- `subscriptions` 更新処理の基礎。
- エラーハンドリングと秘密値非露出。

含まない:

- `/api/daily-session`、`/api/practice-session`。
- `/api/assess`。
- `/api/free-assess`。
- Expoアプリ画面。
- RevenueCat sandbox購入のE2E。

## 作業タスクリスト

1. API共通基盤を作る
   - 成功レスポンスは `{"ok": true, "data": ...}`。
   - 失敗レスポンスは `{"ok": false, "error": {"code": "...", "message": "...", "retryable": false}}`。
   - エラー本文に秘密値、Authorizationヘッダー、外部サービスの生トークンを含めない。

2. 環境変数を確認
   - サーバー専用:
     - `SUPABASE_SERVICE_ROLE_KEY`
     - `REVENUECAT_SECRET_KEY`
     - `REVENUECAT_WEBHOOK_AUTH_TOKEN`
   - 公開可能:
     - `EXPO_PUBLIC_SUPABASE_URL`
     - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - 未設定なら、変数名だけを伝え、値はチャットに書かせない。

3. Supabase JWT検証を実装
   - アプリから `Authorization: Bearer <access_token>` を受け取る。
   - JWTから `user_id = auth.uid()` 相当を取得する。
   - 不正JWTは `UNAUTHORIZED` を返す。

4. `/api/bootstrap` を実装
   - 初回起動またはアプリ起動時に呼ぶ。
   - `profiles` がなければ作成する。
   - `native_language = ja`、`target_accent = US` を保存する。
   - `free_trial_started_at` はサーバー時刻で保存する。
   - `free_text_consent_version` と `free_text_consented_at` は未同意ならnull。
   - `device_install_id` は生値を保存せず、Next.js APIでハッシュ化して `installations.device_install_id_hash` に保存する。
   - 同じ `device_install_id_hash` が再送された場合は `last_seen_at` を更新し、無料期間を再付与しない。

5. `/api/access-status` を実装
   - `profiles.free_trial_started_at` と `subscriptions.is_active` から返す。
   - 初回から7日間は `is_trial_active = true`。
   - 8日目以降でPro無効なら `requires_paywall = true`。
   - 自由入力は無料期間中でも利用不可である点を呼び出し側が判断できるよう、Pro状態を返す。

6. RevenueCat連携方針を実装
   - RevenueCat App User ID は Supabase `auth.users.id` と同じ値にする。
   - webhookイベントのApp User IDを `subscriptions.user_id` に紐付ける。
   - webhookは `REVENUECAT_WEBHOOK_AUTH_TOKEN` で認証する。
   - 認証なし/不正トークンは拒否する。
   - 生イベントは `subscriptions.raw_event` に保存してよいが、秘密値は保存しない。

7. テストを作成
   - `/api/bootstrap` 初回でprofileとinstallationが作られる。
   - `/api/bootstrap` 2回目で同じprofileが返る。
   - 同じ `device_install_id` で無料期間が再付与されない。
   - `/api/access-status` が無料期間中/8日目以降/Pro有効で正しく返る。
   - RevenueCat webhookの認証なしは拒否される。
   - 有効webhookで `subscriptions` が更新される。

## 動作確認手順

- Supabase localを起動し、migration/seedを適用する。
- Next.js APIを起動する。
- テスト用匿名ユーザーJWTで `/api/bootstrap` を呼ぶ。
- `/api/access-status` の無料期間とPro状態を確認する。
- RevenueCat webhook認証の成功/失敗をテストする。
- APIログに秘密値が出ていないことを確認する。

## 完了条件チェックリスト

- [ ] JWT検証が実装されている。
- [ ] `/api/bootstrap` がprofileとinstallationを作成/取得できる。
- [ ] `device_install_id` の生値を保存していない。
- [ ] `/api/access-status` が無料期間とPro状態を返す。
- [ ] RevenueCat App User ID = Supabase `user_id` の方針でwebhookを処理している。
- [ ] webhookが認証されている。
- [ ] テストが通る。
- [ ] Phase 7に進まず、作業を終了できる。

## セルフレビュー観点

- `docs/specs/07_API_SPEC.md`、`docs/specs/09_PRIVACY_BILLING_SECURITY.md` の認証・課金方針と矛盾していない。
- Phase 6だけでAPI基盤とアクセス状態確認まで完結できる。
- 完了条件がAPIテストで客観的に確認できる。
