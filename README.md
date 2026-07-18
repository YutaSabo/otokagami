# Pronunciation Mirror

Pronunciation Mirror MVP is organized as a monorepo for an iPhone-only Expo app, a Next.js API, a Python inference service, and local Supabase assets.

## Package Management

This repository uses npm workspaces.

Reason: npm ships with Node.js, works without an extra package-manager bootstrap step, and keeps Expo/React Native dependency resolution close to the default tooling path.

## Workspace Layout

```text
apps/mobile          Expo React Native iPhone app
apps/api             Next.js API
services/inference   Python inference service
supabase             Supabase local config, migrations, seed
```

## First-Time Setup

```bash
npm install
cp .env.example .env
cd services/inference
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
cd ../..
```

Fill `.env` locally. Do not paste secret values into chat, logs, or committed files.

## Local Development

Expected startup order after environment values are set:

```bash
supabase start
supabase db reset
npm run dev:inference
npm run dev:api
npm run dev:mobile
```

The mobile app is configured for Expo dev client/prebuild and iOS only.

## Root Checks

```bash
npm run lint
npm run test
npm run build
npm run check
```

`check` runs lint, tests, and build/config checks across the workspaces.

## Workspace Commands

```bash
npm run dev:mobile      # Expo dev client Metro server
npm run dev:api         # Next.js API on port 3000
npm run dev:inference   # Python service on port 8000
```

Health checks:

```bash
curl http://localhost:3000/api/health
curl http://localhost:8000/internal/health
```

## Supabase Local

This project uses non-default local Supabase ports so it can run beside another local Supabase project:

```text
API:    http://127.0.0.1:55321
DB:     127.0.0.1:55322
Studio: http://127.0.0.1:55323
Mail:   http://127.0.0.1:55324
```

Rebuild the local database from migrations and seed:

```bash
supabase db reset
```

Run the Phase 2 RLS test SQL through the local Postgres container:

```bash
docker exec -i supabase_db_pronunciation-mirror psql -U postgres -d postgres < supabase/tests/rls.sql
```

## Environment Rules

Only `EXPO_PUBLIC_*` values are available to the mobile bundle. Server-only keys such as `AZURE_SPEECH_KEY`, `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REVENUECAT_SECRET_KEY`, `REVENUECAT_WEBHOOK_AUTH_TOKEN`, and `PYTHON_SERVICE_API_KEY` must remain outside Expo public variables.

## iOS Azure Speech streaming setup

発音判定は Expo Go では動作せず、Development Build が必要です。

1. `.env.example`を基にサーバー環境へ`AZURE_SPEECH_KEY`、`AZURE_SPEECH_REGION`、`AZURE_SPEECH_LOCALE=en-US`を設定する。秘密値を`EXPO_PUBLIC_*`へ入れない。
2. `npm install`を実行する。
3. `npm --workspace @pronunciation-mirror/mobile run ios:prebuild`を実行する。
4. `apps/mobile/ios`で`pod install`を実行し、Azure Speech iOS SDKを取得する。
5. 実機またはSimulator向けDevelopment Buildを作り、マイク権限を許可する。

実機確認では、問題表示時に判定準備が完了すること、録音停止後の初期結果が通常0.6〜1.3秒を目標に表示されること、機内モード・期限切れトークン・短すぎる音声・無音・30秒超過で再試行できることを確認します。端末ログには`token_fetch_ms`、`recognizer_preparation_ms`、`button_to_azure_result_ms`、`normalization_ms`、`button_to_ui_ms`、API保存時間だけを記録し、トークン、音声、認識本文は記録しません。

## 環境・権限・セキュリティ変更の記録

PC、OS、開発環境、外部サービスなどに対して、次の変更を行った場合は、作業完了前に [docs/environment-and-security-change-log.md](docs/environment-and-security-change-log.md) へ記録すること。

- OSやアプリの権限変更
- アプリ、CLI、パッケージ、常駐ツールのインストール
- 管理者権限を利用した設定変更
- OAuth、API、外部サービスへのアクセス承認
- ポート開放、公開URL、トンネル、リモートアクセスの有効化
- セキュリティ機能の無効化や例外追加
- 自動起動、定期実行、バックグラウンド処理の追加
- 一時的な設定で、放置するとリスクや費用が発生する可能性があるもの
- 元に戻す作業や定期的な必要性確認が必要な変更

記録には、変更内容、目的、対象、現在の状態、リスク、確認方法、解除・復旧手順、次回確認日を含める。秘密情報の値は記録せず、環境変数名や保管場所だけを記載する。変更を実施していない提案段階の内容は実施済みとして記録せず、実施状況を確認できない場合は `要確認` と記載する。

Codexを含む作業者は、記録対象の変更を実施した同じタスク内で台帳を更新し、記録を後回しにしない。実行前に解除または復旧方法を確認し、実行後は実際の状態を確認して記録する。一時変更には可能な限り解除条件または次回確認日を設定する。台帳自体の追加と通常のソースコード変更は原則として記録対象外だが、判断に迷う変更は記録する側に倒す。
