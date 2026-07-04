# Architecture

## 対象アーキテクチャ

MVPは iPhone 向けの Expo React Native アプリ、Next.js API、Python推論サービス、Supabase、外部APIで構成する。

開発環境では Supabase を Docker 経由でローカル実装する。

## 全体構成

```text
apps/mobile
  Expo React Native iPhone app

apps/api
  Next.js API

services/inference
  Python service
  eSpeak NG / phonemizer / CMU dictionary
  Piper TTS

supabase
  Local Supabase via Docker
  migrations
  seed
```

実際のディレクトリ構成は実装フェーズで作成する。上記は責務境界であり、既存リポジトリにまだコードはない。

## レイヤー責務

| レイヤー | 責務 |
| --- | --- |
| Expoアプリ | UI、録音、再生、端末ローカル録音保存、RevenueCat SDK、Supabase anonymous auth。 |
| Next.js API | 認証検証、アクセス制御、Azure判定、OpenAI助言、RevenueCat webhook、集計更新、Supabase service role処理。 |
| Python推論サービス | IPA変換、テキスト正規化、OOV検出、Piper TTS生成。 |
| Supabase | Auth、Postgres、RLS、Storage、ローカルDocker開発。 |
| Azure | 発音評価。 |
| OpenAI | 未知ケースの短文助言整形。 |
| RevenueCat | IAP購読状態管理、購入復元、webhook。 |

## Expoアプリ

### 前提

- Expo + dev client/prebuild 前提。
- Managed Workflow厳守にはしない。
- iPhoneのみ。
- Android、iPad専用UI、Webは対象外。

### 主な責務

- Supabase anonymous authでログイン。
- `EXPO_PUBLIC_SUPABASE_URL` と `EXPO_PUBLIC_SUPABASE_ANON_KEY` でSupabaseに接続。
- RevenueCat public SDK keyで購読状態を取得。
- 録音する。
- 判定APIへ音声を送る。
- お手本音声とユーザー録音を再生する。
- 端末ローカルにユーザー録音を保存する。
- iOSローカル通知をスケジュールする。
- `.env` のサーバー専用キーを参照しない。

## Next.js API

### 主な責務

- Supabase JWTを検証する。
- 7日無料期間とRevenueCat購読状態を判定する。
- Azure発音評価APIへ音声を一時送信する。
- Azureレスポンスを正規化する。
- `attempts`、`attempt_phoneme_results`、`phoneme_state` などを更新する。
- Python推論サービスを呼ぶ。
- OpenAI APIを呼ぶ。
- RevenueCat webhookを受ける。
- Supabase service role keyを使う処理を閉じ込める。

### 配置

MVPではVercel等のNext.js対応ホスティングを想定する。具体ホスティング先は実行指示書で確定する。

## Python推論サービス

### 主な責務

- eSpeak NG / phonemizer / CMU辞書によるIPA変換。
- OOV検出。
- 変換確信度の算出。
- PiperによるTTS生成。

### 配置

Fly.io、Render等のコンテナ対応ホスティングを想定する。Next.js APIとは分離する。

### セキュリティ

Python推論サービスは、Next.js APIからのみ呼ぶ。`PYTHON_SERVICE_API_KEY` でサーバー間認証を行う。

## Supabase

### ローカル開発

SupabaseはDocker経由でローカルに起動する。

実装フェーズで作成するもの:

```text
supabase/
  config.toml
  migrations/
  seed.sql
```

想定コマンド:

```bash
supabase start
supabase db reset
supabase status
```

上記コマンドを実行する前に、Supabase CLI と Docker が使える状態であることを確認する。

### 本番

本番はSupabase hosted projectを想定する。ローカルと本番でURL/キーを分ける。

### Storage

Supabase Storageは、お手本音声のTTSキャッシュに使う。ユーザー音声は保存しない。

## 外部サービス

| サービス | 用途 | キー配置 |
| --- | --- | --- |
| Azure Speech | 発音評価 | サーバー専用 `.env`。 |
| OpenAI API | 未知ケース助言整形 | サーバー専用 `.env`。 |
| RevenueCat public SDK key | Expoアプリの購読取得 | `EXPO_PUBLIC_` で可。 |
| RevenueCat secret key | webhook/API検証 | サーバー専用 `.env`。 |
| Supabase anon key | クライアント接続 | `EXPO_PUBLIC_` で可。 |
| Supabase service role key | 管理操作 | サーバー専用 `.env`。 |

## 環境変数

環境変数の一覧はリポジトリ直下の `.env.example` に定義する。

### 開発フロー

初回に人間が `.env.example` をコピーして `.env` を作り、値を埋める。以降、Codexは `.env` が埋まっている前提で実装を進める。

Codexは実際のキーの値を要求・出力・コミットしない。

キーが必要な作業に着手する前に値が未設定であれば、Codexは「`.env` の `VARIABLE_NAME` をローカルで埋めてください」と依頼する。値そのものをチャットに書かせてはならない。

`.env.example` に変数を追加した場合、Codexは新しく埋める項目名をユーザーへ知らせる。

### Expo公開変数

`EXPO_PUBLIC_` で始まる変数はアプリバンドルに含まれ得る。秘密情報を入れてはならない。

許可するExpo公開変数:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_REVENUECAT_IOS_PUBLIC_SDK_KEY`

### サーバー専用変数

以下は絶対に `EXPO_PUBLIC_` にしてはならない。

- `AZURE_SPEECH_KEY`
- `OPENAI_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REVENUECAT_SECRET_KEY`
- `REVENUECAT_WEBHOOK_AUTH_TOKEN`
- `PYTHON_SERVICE_API_KEY`

## .gitignore

リポジトリ直下の `.gitignore` で `.env`、`.env.local`、`.env.*` を除外する。ただし `.env.example` はコミット対象にする。

## パッケージバージョン

設計書では具体バージョンを固定しない。実装開始時点の最新stableを確認し、実行指示書または初期セットアップPRで固定する。

対象:

- Expo。
- React Native。
- Supabase JS。
- RevenueCat SDK。
- Next.js。
- Python。
- eSpeak NG / phonemizer。
- Piper。

## 録音形式

アプリ側録音はWAV/PCM 16kHzを目標とする。端末都合で別形式になる場合は、Next.js APIまたはPython側でAzure投入前に変換する。

MediaRecorder系のwebm/opus前提にはしない。iPhoneアプリの録音実装に合わせる。

## 音声保存

ユーザー音声:

- 端末ローカルに保存してよい。
- サーバーに保存しない。
- Supabase Storageに保存しない。

お手本音声:

- Piperで生成する。
- Supabase Storage等にキャッシュしてよい。
- ユーザー音声ではない。

## デプロイ境界

MVP実装時のデプロイ候補:

| コンポーネント | 開発 | 本番候補 |
| --- | --- | --- |
| Expoアプリ | local dev client | EAS build / App Store |
| Next.js API | local dev server | Vercel等 |
| Python推論サービス | local Docker | Fly.io/Render等 |
| Supabase | Docker local | Supabase hosted |

Phase別の実行指示書では、まずローカル環境での完走を主対象にする。本番環境作成はユーザー承認後に行う。

ただし TestFlight 配布にはステージングAPIが必要であるため、最終Phaseの完了条件には、ステージング環境での主要E2E動作確認を含める。ステージング候補は Vercel + Fly.io/Render + Supabase hosted とする。

## ローカル起動の期待形

実装完了後のローカル開発は、少なくとも次の順に起動できる状態を目指す。

1. `.env.example` を `.env` にコピーし、人間が値を埋める。
2. Dockerを起動する。
3. Supabase localを起動する。
4. DB migration/seedを適用する。
5. Python推論サービスを起動する。
6. Next.js APIを起動する。
7. Expo dev clientでiPhoneアプリを起動する。

## 禁止事項

- サーバー専用キーをExpoアプリに渡さない。
- `.env` をコミットしない。
- 実際のキーをチャットに出さない。
- ユーザー音声をサーバー保存しない。
- 自由入力をデイリー集計に混ぜない。
- Appleイントロオファーを設定しない。
- StripeをiOS MVPに入れない。

## フェーズ4セルフレビュー

- マスター設計書・既作成ドキュメントとの矛盾: Expo dev client/prebuild、Next.js API、Python分離、Supabase Docker local、Piper、Azure/OpenAI/RevenueCat、音声非保存を反映済み。
- Codexが実装に着手できる具体性: レイヤー責務、環境変数ルール、ローカル起動順、デプロイ境界を明記済み。
- 用語・命名の一貫性: `EXPO_PUBLIC_`、`PYTHON_SERVICE_API_KEY`、`SUPABASE_SERVICE_ROLE_KEY` などを `.env.example` と一致させる前提で定義。
