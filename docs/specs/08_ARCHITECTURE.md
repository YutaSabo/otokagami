# Otokagami アーキテクチャ

> 文書状態: 現役
> 目的: 現在実装と新MVP目標構成を混同しない

## 1. 現在実装

リポジトリには次が実装済みである。

```text
Expo React Native iPhone app
  ├─ Supabase anonymous auth
  ├─ RevenueCat SDK
  ├─ Azure Speech iOS native module
  └─ Next.js API
      ├─ Supabase/Postgres
      ├─ Azure短期トークン
      ├─ 判定結果保存・旧集計
      ├─ RevenueCat webhook
      ├─ OpenAI助言
      └─ Python inference service
          ├─ phonemizer / eSpeak / CMUdict
          └─ Piper TTS
```

旧称`Pronunciation Mirror`がworkspace、パッケージ、Bundle ID、表示名、API識別子等に残る。自由入力、詳細スコア、ゲーミフィケーション、実行時OpenAI/Piper/Pythonも残る。これらは現在実装の事実であり、新MVPの採用仕様ではない。

第3段階では名称、コード、DB、環境、外部サービスを変更しない。

## 2. 新MVP目標構成

```text
iPhone Otokagami app
  ├─ static reviewed content / audio / advice / diagrams
  ├─ local representative before/after (max 30 calendar days)
  ├─ Supabase anonymous auth
  ├─ RevenueCat public SDK
  ├─ Next.js trusted API
  │   ├─ auth / access / 7 active learning days
  │   ├─ daily plan / content entitlement
  │   ├─ Azure short-lived token issuance
  │   ├─ assessment validation / normalization
  │   ├─ idempotent persistence / durable evidence
  │   ├─ reports / export / deletion
  │   └─ RevenueCat webhook
  ├─ Azure Speech
  │   └─ direct PCM streaming from iPhone
  └─ Supabase/Postgres
      └─ protected progress, content metadata, billing state
```

毎日の中心経路に、実行時OpenAI、Piper、Python推論を含めない。問題文、IPA、標準/スロー音声、助言、図解は事前生成・レビューする。

## 3. 音声経路

1. 問題表示時にアプリがAPIからAzure短期トークンを取得する。
2. iOSネイティブモジュールがRecognizerを準備する。
3. 録音中に16kHz/16bit/mono PCMを端末からAzureへ直接送る。
4. 録音停止時にstreamを閉じ、Azure最終結果を受け取る。
5. 音声本体ではなく結果JSONだけを自社APIへ送る。
6. アプリは代表before/afterだけをローカルWAV等で保持する。

禁止:

- 自社APIへの音声アップロード
- DBまたはSupabase Storageへのユーザー音声保存
- Azure Subscription Keyのクライアント配置
- M4A変換やサーバー音声変換を中心待ち時間へ追加

## 4. 主要結果の高速経路

```text
Azure final result
  → local/server pure normalization
  → target-one-sound primary result
  → UI display

                         ↘ idempotent persistence
                           → durable evidence
                           → review/report aggregation
```

主要結果は、長期集計、週次レポート、通知更新、複数テーブル更新の完了を待たない。

保存方式はTBDだが、次を満たす。

- client attempt IDで重複排除。
- 保存失敗時にAzure結果を端末で保持して再送。
- 録音のやり直し不要。
- durable進捗は信頼境界で検証後に確定。
- UIは保存保留を非妨害的に示す。

## 5. レイヤー責務

| レイヤー | 目標責務 |
| --- | --- |
| Mobile UI | 日次UX、録音状態、主要結果、ローカル音声、再送待ち、RevenueCat購入 |
| iOS native | PCM capture、Azure stream、取消・NoMatch・音声品質メタデータ |
| Static content | 課題、IPA、標準/スロー音声、助言、図解、version |
| Trusted API | 認証、trial/購読、session、token、正規化検証、idempotency、durable進捗 |
| Supabase | Auth、Postgres、RLS/data policy、protected state |
| Azure | `en-US`のscripted pronunciation assessment |
| RevenueCat | iOS IAP、entitlement、購入復元、webhook |

## 6. 認証・認可

- Supabase anonymous authで開始する。
- APIはJWTを検証しuser IDを確定する。
- trial、subscription、durable evidence、active contentの更新をクライアントだけに許可しない。
- ユーザー所有データはRLSとサーバー検証で分離する。
- RLSの存在だけでなく、他ユーザー拒否・protected write拒否をテストする。

## 7. コンテンツ配信

管理課題だけに限定することで、実行時の文正規化、IPA変換、TTS生成、助言生成を削減できる。

選択肢:

- 初回7日分をアプリへ同梱。
- 静的ストレージ/CDNからversion付きで先読み。
- 両者の組み合わせ。

最終配置はTBD。いずれも、active content versionとaudio/advice/diagram versionの不一致を防ぐ。

## 8. ローカル音声

- 代表before/afterのみ。
- 端末で最大30暦日。
- 14日復習完了後に早期削除可。
- 学習データ削除時に即時削除。
- ファイル欠損を画面全体の失敗にしない。
- バックアップや端末移行での扱いはTBD。長期録音ライブラリは作らない。

## 9. 環境変数と秘密

### クライアントへ置ける公開前提値

- Supabase URL / anon key
- API base URL
- RevenueCat iOS public SDK key

### サーバー専用

- Azure Speech key / region
- Supabase service role
- RevenueCat secret / webhook authorization
- 現在実装が移行完了するまで必要なOpenAI/Python等の秘密

サーバー専用値を`EXPO_PUBLIC_`へ置かない。`.env`をGit管理しない。READMEの現在セットアップから旧サービス変数を事実に反して消さず、目標構成と分ける。

## 10. 多地域・多言語

- 初期UI/coaching: `ja-JP`
- 初期assessment: `en-US`
- coaching locale、target language、assessment locale、accent、market tagを分離する。
- 別assessment localeはAzure capabilitiesとコンテンツを個別検証する。
- 国籍・母語によるスコア補正はしない。

## 11. 性能

有利な既存要素:

- 問題表示中のRecognizer準備
- 短期トークン再利用
- 録音中の直接ストリーミング
- 短い管理課題
- 静的音声・助言・図解の先読み

主要結果P95 3秒等は`実機検証目標`であり、達成済みではない。計測区間は問題表示、録音開始、Azure final、正規化、主要表示、保存確定を分ける。

## 12. 開発・デプロイ境界

現在のmonorepo、ローカルSupabase、Next.js、Expo dev client、Pythonサービスの起動手順は既存実装の保守に必要である。新目標から外れるサービスもコード移行完了までは削除しない。

- ローカル変更・検証は各段階の承認範囲で行う。
- Previewはプロジェクト規則の範囲でのみ利用する。
- Production、Hosted DB変更、外部環境変更は個別承認が必要。
- App Store申請・一般公開は今回のアプリ完成範囲外。

## 13. 再利用候補

- iOS Azure Speech SDKモジュールとPCM直接stream
- 短期トークン、token cache
- 音声品質検査、取消・古い応答の無視
- Supabase anonymous auth
- RevenueCat基盤
- management content / active reviewの基礎
- attempt、音素結果、書き出し・削除の基礎
- RLS・秘密情報境界のテスト

再利用には新しいattempt役割、Program Day、保存分離、durable evidenceへの適合確認が必要である。

## 14. 移行対象

- 旧称を含む表示・package/Bundle/workspace/API識別子
- 従来の日次構成と3画面詳細フロー
- 自由入力、音素選択、別建て苦手ドリル
- 総合点中心表示、全音素詳細、ゲーミフィケーション
- 実行時OpenAI/Piper/Python
- 同日best attemptをdurable集計へ加算する旧ロジック

具体的な移行順、削除、DB migrationは第4段階以降で決める。

## 15. 未確認

- Hosted Supabaseのスキーマ・Seed
- 実機Azureレイテンシと焦点群別安定性
- RevenueCat sandbox商品・復元・webhook
- Vercel/Fly.io/Expo/App Store Connectの現在状態
- static contentの最終配信方式
- 保存方式と正式SLO
