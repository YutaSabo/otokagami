# Otokagami

Otokagamiは、毎日1つの焦点音を管理課題で発見し、短いコツと再録音でその場の変化を示し、別の単語・文と後日の無補助判定で定着まで確認するiPhone向け発音改善アプリです。

製品仕様の正本は[マスター設計書](マスター設計書.md)と[仕様書体系](docs/specs/00_README.md)です。

## 現在実装と目標構成

### 現在実装

このリポジトリは、方向転換前のMVPを実装済みのmonorepoです。

```text
apps/mobile          Expo React Native iPhone app
apps/api             Next.js API
services/inference   Python inference service
supabase             local config, migrations, seed, RLS tests
```

現在のworkspace、パッケージ、iOS識別子、コードには旧称`Pronunciation Mirror`が残っています。自由入力、詳細なスコア・進捗、実行時OpenAI助言、Python/Piper TTS等も残っているため、既存環境を起動・検証するには以下のセットアップと環境変数が引き続き必要です。

### 新MVPの目標

- Azure `en-US`だけを発音判定に使う。
- 自由入力を提供せず、レビュー済み管理課題だけを判定する。
- 1日1焦点音、通常5課題、良好日は3課題程度、任意追加2課題。
- 対象1音の主要結果をDB保存・長期集計より先に表示する。
- 問題文、IPA、標準/スロー音声、助言、図解を事前生成・レビューする。
- 実行時OpenAI/Piper/Pythonを中心経路から外す。
- 7暦日ではなく7 active learning daysを提供する。

第3段階では文書だけを更新しており、コード、DB、パッケージ名、Bundle ID、API名、外部環境はまだ移行していません。

## Package management

このリポジトリはnpm workspacesを使います。Node.jsに同梱され、Expo/React Nativeの標準的な依存解決に近い構成を維持するためです。

## 初回セットアップ（現在実装）

```bash
npm install
cp .env.example .env
cd services/inference
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
cd ../..
```

`.env`はローカルで設定してください。秘密値をチャット、ログ、文書、コミットへ貼り付けないでください。

## ローカル起動（現在実装）

環境値を設定後、次の順で起動します。

```bash
supabase start
supabase db reset
npm run dev:inference
npm run dev:api
npm run dev:mobile
```

現在のmobileはExpo dev client/prebuildを前提とし、iOS向けです。新MVP移行後にPythonサービスが不要になるまで、現在実装の起動手順から削除しません。

## Checks

```bash
npm run lint
npm run test
npm run build
npm run check
```

`check`はworkspacesのlint、test、build/config checksを実行します。

## Workspace commands

```bash
npm run dev:mobile      # Expo dev client Metro server
npm run dev:api         # Next.js API on port 3000
npm run dev:inference   # Python service on port 8000
```

現在実装のhealth checks:

```bash
curl http://localhost:3000/api/health
curl http://localhost:8000/internal/health
```

## Supabase local

他のlocal Supabase projectと併用できるよう、非標準portを使います。

```text
API:    http://127.0.0.1:55321
DB:     127.0.0.1:55322
Studio: http://127.0.0.1:55323
Mail:   http://127.0.0.1:55324
```

local DBをmigrationとseedから再構築:

```bash
supabase db reset
```

現在のRLS SQL test:

```bash
docker exec -i supabase_db_pronunciation-mirror psql -U postgres -d postgres < supabase/tests/rls.sql
```

container名にも旧実装名が残ります。第3段階では変更しません。

## Environment rules

`EXPO_PUBLIC_*`はmobile bundleへ含まれ得る公開前提値だけに使います。

現在実装でサーバーだけに置くもの:

- `AZURE_SPEECH_KEY`
- `OPENAI_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REVENUECAT_SECRET_KEY`
- `REVENUECAT_WEBHOOK_AUTH_TOKEN`
- `PYTHON_SERVICE_API_KEY`

OpenAI/Python/Piper関連値は新MVPの目標中心経路では不要になる予定ですが、コード移行完了までは`.env.example`から削除しません。実値を`EXPO_PUBLIC_*`へ置かないでください。

## iOS Azure Speech streaming setup

発音判定はExpo Goでは動作せず、Development Buildが必要です。

1. `.env.example`を基にサーバー環境へ`AZURE_SPEECH_KEY`、`AZURE_SPEECH_REGION`、`AZURE_SPEECH_LOCALE=en-US`を設定する。秘密値を`EXPO_PUBLIC_*`へ入れない。
2. `npm install`を実行する。
3. `npm --workspace @pronunciation-mirror/mobile run ios:prebuild`を実行する。
4. `apps/mobile/ios`で`pod install`を実行し、Azure Speech iOS SDKを取得する。
5. 実機またはSimulator向けDevelopment Buildを作り、マイク権限を許可する。

workspace名は現在実装の識別子であり、正式製品名ではありません。

実機では、問題表示中の準備、録音開始、PCM直接stream、録音停止、Azure final result、主要結果表示、保存確定を別々に計測します。P95 3秒等は[テスト計画](docs/specs/10_TEST_PLAN.md)の`実機検証目標`であり、達成済みの性能ではありません。token、音声、認識本文を端末ログへ残さないでください。

## 仕様とPhase

- [マスター設計書](マスター設計書.md): 最上位製品方針
- [仕様書体系](docs/specs/00_README.md): 読む順番、用語、固定値
- [Phase 13](docs/phases/PHASE_13_INTEGRATION_STAGING_READINESS.md): 新MVPの統合・ステージング受け入れ
- [Phase 13準備状況](docs/phases/PHASE_13_TESTFLIGHT_READINESS_CHECKLIST.md): 旧基盤と新MVP未実装を分離
- [Phase 14](docs/phases/PHASE_14_REMOTE_IOS_STAGING.md): 許可済み環境でのリモート実機確認

Phase 01〜12は方向転換前の完了済み履歴であり、現在の製品仕様ではありません。

## 環境・権限・セキュリティ変更の記録

PC、OS、開発環境、外部サービスへ次の変更を行った場合は、同じ作業内で[環境・セキュリティ変更台帳](docs/environment-and-security-change-log.md)へ記録します。

- OSやアプリの権限変更
- アプリ、CLI、パッケージ、常駐ツールのインストール
- 管理者権限を利用した設定変更
- OAuth、API、外部サービスへのアクセス承認
- ポート開放、公開URL、トンネル、リモートアクセス
- セキュリティ機能の無効化や例外追加
- 自動起動、定期実行、background処理
- 放置するとリスクや費用が発生する一時設定

変更内容、目的、対象、状態、リスク、確認方法、解除・復旧手順、次回確認日を記録します。秘密値は記録せず、実施状況を確認できない場合は`要確認`とします。提案だけの内容を実施済みとして記録しません。

## 完成範囲

今回想定する「アプリ完成」に、App Store申請、一般公開、Productionデプロイは含みません。それぞれ別の承認と検証が必要です。
