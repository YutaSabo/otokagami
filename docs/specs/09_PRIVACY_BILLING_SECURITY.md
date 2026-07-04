# Privacy, Billing, Security

## 目的

この仕様は、Pronunciation Mirror MVP のプライバシー、課金、シークレット管理、セキュリティ、データ削除/書き出しのルールを定義する。

## プライバシー原則

1. ユーザー音声をサーバーに保存しない。
2. Azure判定のため音声を一時送信するが、永続保存しない。
3. 端末ローカル録音はユーザー機能として保存してよい。
4. 自由入力のraw textは、初回同意後にのみ保存する。
5. 自由入力はPIIを含みうるため、削除対象に必ず含める。
6. デイリー集計と自由入力ログを分離する。
7. APIキー、service role key、秘密トークンをクライアントに置かない。

## 保存するデータ

### ユーザー基本情報

- Supabase anonymous auth user id。
- `anon_public_id`。
- `native_language = ja`。
- `target_accent = US`。
- 無料期間開始日時。
- timezone。
- 通知設定。
- 再生速度設定。
- 自由入力保存同意の版と同意日時。
- 端末識別補助IDのハッシュとユーザー紐付け。

### パック練習ログ

- 録音日時。
- ローカル練習日。
- 問題ID。
- attempt_no。
- 音素ごとのスコア。
- 期待音素。
- 実測音素。
- overall。
- target平均。
- Azureの音声本体を除くJSONレスポンス。
- 端末/OS/アプリバージョン。

### 集計状態

- 音素ごとのEWMA。
- 練習回数。
- 最終練習日。
- 次回復習日。
- 日次スナップショット。
- ストリーク算出用ログ。
- レベル/バッジ/称号算出用ログ。

### 自由入力ログ

Proユーザーが同意した場合のみ保存する。

- 入力文。
- 正規化文。
- IPA変換結果。
- OOV語。
- 変換確信度。
- 音素ごとスコア。
- 単語ごとスコア。
- overall。
- Azureの音声本体を除くJSONレスポンス。
- PIIフラグ。
- 同意文バージョン。

## 保存しないデータ

- ユーザー音声ファイルのサーバーコピー。
- Supabase Storage上のユーザー音声。
- Azureへ送信した一時音声の永続コピー。
- 実際のAPIキーや秘密トークン。
- クライアント側ログ内の秘密値。

## 音声の扱い

### ユーザー音声

ユーザー音声は、判定時にバックエンド経由でAzureへ一時送信する。

サーバーは判定処理が終わったら音声を破棄する。永続ストレージ、DB、ログに保存しない。

端末ローカルには、ユーザーが聞き返すために保存してよい。データ削除時には端末ローカル録音も削除する。

### お手本音声

Piperで生成したお手本音声は、Supabase Storage等にキャッシュしてよい。これはユーザー音声ではない。

## 自由入力の同意

自由入力の初回利用時に、入力文が保存されることを明示し、同意を取る。

同意文で最低限伝えること:

- 入力文は発音判定と将来の教材改善のため保存される。
- 個人名、住所、電話番号、機密情報を入力しないこと。
- 音声ファイルはサーバー保存されない。
- 学習データ削除で自由入力ログも削除される。

同意の版を `consent_version` として保存する。

ユーザー単位の同意済み状態は `profiles.free_text_consent_version` と `profiles.free_text_consented_at` に保存する。`free_attempts.consent_version` には、その判定ログで使われた同意文の版を保存する。履歴専用テーブルはMVPでは作らない。

## PII

MVPでは高度なPII匿名化までは必須にしない。ただし、`free_attempts.pii_flag` を持つ。

PII疑いの判定は次のいずれかでよい。

- クライアントまたはサーバーで簡易ルール検出。
- 将来の高度検出に備えて常にfalseで初期実装し、スキーマだけ確保。

MVPでは、PII疑いの有無にかかわらずユーザー削除時に `free_attempts` を削除する。

## 課金

### プラン

| プラン | 内容 |
| --- | --- |
| 無料期間 | 初回から7日間。アプリ側で管理。自由入力を除くMVP機能を利用可。 |
| Pro | デイリー練習、判定、進捗、履歴、苦手ドリル、自由入力、広告なし。 |

価格想定:

- 月額580円。
- 年額4,980円。

### 無料期間

無料期間の起点は `profiles.free_trial_started_at` とする。サーバー側で管理する。

再インストールによる無料期間リセット対策として、端末側ではKeychainに補助IDを保存する。サーバー側では生の補助IDを保存せず、ハッシュ化した `device_install_id_hash` を `installations` に保存する。

同じ `device_install_id_hash` が再度 `/api/bootstrap` に送られた場合、既存行の `last_seen_at` を更新し、無料期間を再付与しない。7日トライアルは課金モデルの根幹であるため、MVPでこの対策を弱めない。

### 8日目以降

8日目以降、Pro entitlementが有効でない場合は課金ウォールを表示する。

この仕様は「8日目に自動でPro」ではない。ユーザーがPro登録しない限り課金しない。

### Appleイントロオファー

サブスク商品にAppleのイントロオファーは付けない。

理由:

- アプリ側7日無料期間とApple側無料トライアルが重なると、意図せず無料期間が延びるため。

### RevenueCat

RevenueCatを購読管理に使う。

- ExpoアプリはRevenueCat public SDK keyを使う。
- Next.js APIはRevenueCat secret keyを使う。
- RevenueCat App User ID は Supabase `auth.users.id` と同じ値に統一する。
- webhookで `subscriptions` を更新する。
- 購入復元を設定画面に置く。

### Stripe

iOS MVPではStripeを使わない。Stripeは将来Web版用の技術メモとして残す。

## アクセス制御

### 練習可能条件

練習開始には次のどちらかが必要。

- 無料期間中。
- RevenueCat Pro entitlementが有効。

### 自由入力可能条件

自由入力には次をすべて満たす必要がある。

- Pro entitlementが有効。
- 自由入力保存同意が済んでいる。
- 日次ソフトキャップ未満。

無料期間中でも自由入力は使えない。

## シークレット管理

### ファイル

- `.env.example` はコミットする。
- `.env` はコミットしない。
- `.env.local` はコミットしない。
- `.env.*` は原則コミットしない。

`.gitignore` で上記を除外する。

### Codex運用ルール

Codexは実際のキー値を要求・出力・コミットしない。

キーが必要な作業に着手する前に値が未設定であれば、Codexは次の形式で依頼する。

```text
.env の AZURE_SPEECH_KEY をローカルで埋めてください。値はチャットに書かないでください。
```

`.env.example` に変数を追加した場合、Codexは新しく埋める必要がある変数名をユーザーへ知らせる。

### Expo公開禁止

次は絶対に `EXPO_PUBLIC_` にしない。

- Azure Speech key。
- OpenAI API key。
- Supabase service role key。
- RevenueCat secret key。
- RevenueCat webhook auth token。
- Python service API key。

## レート制限

### 自由入力

Proでも1日20回程度のソフトキャップを設ける。

超過時は、翌日また試すよう案内する。

### TTS

Piper生成はキャッシュ優先にする。キャッシュキーはテキスト、アクセント、速度を含める。

### OpenAI

OpenAIは未知ケースのみ。頻出混同ペアはテンプレ助言を使う。

### Azure

通常のデイリー練習を妨げない範囲で、ユーザー単位の過剰利用制限を設ける。

## データ削除

設定画面から学習データ削除を実行できる。

削除対象:

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
- 端末ローカル録音。

削除後:

- 進捗、ストリーク、レベル、バッジ、称号は初期状態に戻る。
- 無料期間の起点と購読状態は削除しない。課金回避に使われないようにする。

## データ書き出し

設定画面からJSON形式の簡易書き出しを実行できる。

含める:

- ユーザー設定。
- 練習ログ。
- 音素結果。
- 音素状態。
- スナップショット。
- バッジ。
- ブックマーク。
- 自由入力ログ。
- 助言評価。

含めない:

- ユーザー音声ファイル。
- APIキー。
- サーバー内部ログ。

## ログ

エラーログに保存してよい:

- エラーコード。
- 外部サービス名。
- 操作名。
- HTTP status。
- retryableかどうか。
- ユーザーID。
- 発生日時。

保存してはいけない:

- APIキー。
- Authorizationヘッダー。
- service role key。
- RevenueCat secret。
- ユーザー音声。

## セキュリティ受け入れ条件

- `.env` がGit管理されていない。
- `.env.example` に必要変数が列挙されている。
- Expoアプリにサーバー専用キーが含まれていない。
- Azure/OpenAI/RevenueCat secret/service roleの呼び出しはサーバー側だけ。
- RLSが有効で、ユーザーは自分の行だけ読める。
- マスターデータの書き込みはservice roleだけ。
- RevenueCat webhookが認証されている。
- Python推論サービスが内部APIキーで保護されている。
- 音声ファイルがサーバー保存されていない。

## フェーズ4セルフレビュー

- マスター設計書・既作成ドキュメントとの矛盾: 音声非保存、自由入力同意、7日無料後課金ウォール、RevenueCat、IAPのみ、Stripe将来扱い、シークレット運用を反映済み。
- Codexが実装に着手できる具体性: 保存/非保存、削除/書き出し、課金条件、キー配置、ログ禁止事項を明記済み。
- 用語・命名の一貫性: `free_trial_started_at`、Pro entitlement、`free_attempts`、`EXPO_PUBLIC_` を既存仕様と一致させた。
