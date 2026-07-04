# Phase 1: リポジトリ基盤

## 運用ルール

- ユーザーが「Phase 1 の指示書をもとに作業してください」と指示したら、この指示書を根拠に開発を開始する。
- この指示書に書かれた内容がすべて完了したら、Phase 1 は完了とし、作業を終了する。勝手に Phase 2 へ進まない。
- 次の Phase は、ユーザーが改めて実行を依頼したときに開始する。
- 根拠のない仕様追加をしない。判断に迷う場合は、該当設計書を確認し、それでも決められない場合はユーザーへ質問する。
- 実際のAPIキー、トークン、秘密鍵、service role keyをチャットやコミットに出さない。

## ゴール

Pronunciation Mirror MVP の実装を開始できるモノレポ基盤を作る。Phase 1 完了時点では、モバイル、API、Python推論サービス、Supabase用ディレクトリが存在し、最小のlint/test/build相当の確認を実行できる状態にする。

## 前提条件

- このPhaseは最初に実行する。依存Phaseはない。
- 対象はiPhone向けMVPであり、Android、iPad専用UI、Webお試しページは作らない。
- 参照設計書:
  - `docs/specs/00_README.md`
  - `docs/specs/08_ARCHITECTURE.md`
  - `docs/specs/09_PRIVACY_BILLING_SECURITY.md`
  - `docs/specs/10_TEST_PLAN.md`

## スコープ

含む:

- モノレポ構成の作成。
- `apps/mobile`、`apps/api`、`services/inference`、`supabase` の初期ディレクトリ作成。
- ルートのパッケージ管理方針、lint/testの土台、TypeScript設定の土台。
- `.gitignore` と `.env.example` の整合確認。
- READMEまたは開発者向け起動メモの最小整備。

含まない:

- Supabase migrationの本実装。
- APIエンドポイントの本実装。
- Expo画面実装。
- Azure、OpenAI、RevenueCat、Piperの実接続。
- 本番またはステージング環境の作成。

## 作業タスクリスト

1. 現状確認
   - `git status --short` で未追跡/変更ファイルを確認する。
   - `docs/specs/08_ARCHITECTURE.md` の「全体構成」「環境変数」「ローカル起動の期待形」を確認する。

2. モノレポ構成を作成
   - 次の責務境界を維持する。
     - `apps/mobile`: Expo React Native iPhone app。
     - `apps/api`: Next.js API。
     - `services/inference`: Python推論サービス。
     - `supabase`: Supabase local、migrations、seed。
   - パッケージマネージャーは実装開始時点の安定した選択肢を使う。選定理由をREADME等に残す。

3. Expoアプリの最小初期化
   - Expo + dev client/prebuild 前提で初期化する。
   - iPhoneのみを対象にする。Android固有実装やiPad専用UIを追加しない。
   - まだ画面本実装は行わず、起動確認できる最小構成に留める。

4. Next.js APIの最小初期化
   - `apps/api` にAPI実装の土台を作る。
   - サーバー専用環境変数を `EXPO_PUBLIC_` として扱わない。
   - まだ本エンドポイントは作り込まず、ヘルスチェック程度に留める。

5. Python推論サービスの最小初期化
   - `services/inference` にPythonサービスの土台を作る。
   - 将来 `/internal/ipa` と `/internal/tts` を実装できる構成にする。
   - 依存関係管理方法を明記する。

6. Supabaseディレクトリを準備
   - `supabase/config.toml`、`supabase/migrations/`、`supabase/seed.sql` を配置できる構成にする。
   - Phase 2でDB本実装を行うため、このPhaseでは空または最小プレースホルダーでよい。

7. 環境変数とシークレット運用を確認
   - `.env.example` に必要変数が列挙されているか確認する。
   - `.env`、`.env.local`、`.env.*` がGit管理されないことを確認する。
   - サーバー専用キーをExpo公開変数にしない。

8. 開発コマンドを整備
   - ルートから最低限、lint/testまたはそれに相当する確認コマンドを実行できるようにする。
   - 各ワークスペースの起動方法をREADMEまたは開発メモに記載する。

## 動作確認手順

- `git status --short` で意図しない秘密ファイルが含まれていないことを確認する。
- ルートのlint/test相当コマンドが成功することを確認する。
- `apps/mobile`、`apps/api`、`services/inference` が最小起動またはヘルスチェック可能であることを確認する。
- `.env.example` が存在し、`.env` はGit管理されていないことを確認する。

## 完了条件チェックリスト

- [ ] `apps/mobile`、`apps/api`、`services/inference`、`supabase` が作成されている。
- [ ] Expoアプリの最小起動確認ができる。
- [ ] Next.js APIの最小起動確認ができる。
- [ ] Python推論サービスの最小起動確認ができる。
- [ ] ルートからlint/test相当の確認ができる。
- [ ] `.env.example` と `.gitignore` がシークレット運用ルールと整合している。
- [ ] 実際の秘密値がチャット、ログ、コミット対象に含まれていない。
- [ ] Phase 2に進まず、作業を終了できる。

## セルフレビュー観点

- `docs/specs/08_ARCHITECTURE.md` の責務境界と矛盾していない。
- Phase 1だけで着手から動作確認まで完結できる。
- 完了条件が客観的に確認できる。
