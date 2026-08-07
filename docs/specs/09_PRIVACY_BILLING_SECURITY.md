# Otokagami プライバシー・課金・セキュリティ仕様

> 文書状態: 現役

## 1. プライバシー原則

1. ユーザー音声を自社サーバー、DB、Supabase Storageへ送信・保存しない。
2. 音声はAzure短期トークンでiPhoneからAzureへ直接ストリーミングする。
3. 代表before／afterだけを端末で短期保持する。
4. 学習に不要な個人情報を収集しない。
5. trial、subscription、学習データ削除を別責務として扱う。
6. 秘密とprotected writeをクライアントへ委ねない。

## 2. ユーザー音声

### Azureへの送信

- 初期判定は`en-US`。
- Azure Subscription Keyはサーバーだけに置く。
- アプリへ渡すのは短期トークン、region、期限、capabilitiesだけ。
- 自社APIは音声ファイル、base64音声、端末音声URIを受け取らない。
- Azureのデータ取扱いは公開前に最新の提供条件とプライバシー表示を確認する。現時点の外部設定は未確認。

### 端末保持

- 代表的なbefore／afterだけ。
- 最大30暦日。
- 対応する14日復習完了後は、30日を待たず削除対象にできる。
- 学習データ削除時は即時削除対象。
- 長期録音ライブラリを作らない。
- URI切れ、ファイル欠損、端末変更時にもレポート・状態画面を壊さない。

ローカルファイルのバックアップ除外、暗号化、端末移行時の扱いはTBDであり、実装前に確認する。

## 3. 保存する学習データ

- anonymous user ID、timezone、coaching/assessment locale
- Program DayとCalendar Date
- 管理課題ID・version・焦点音・課題役割
- 有効/無効attempt、無効理由
- 音声本体を除くAzure結果と正規化結果
- correction cycleとadvice version
- 発見、即時改善、維持、転移、定着、メンテナンス証拠
- Review Due Date、日次/Day 7/週次レポート
- 音声内容を含まない性能・エラー情報
- trial履歴、購読状態

保存しないもの:

- ユーザー音声のサーバーコピー
- 自由入力文（MVPに自由入力がないため）
- 秘密、Authorizationヘッダー、短期トークン
- 国籍・母語による採点補正データ
- ネイティブらしさの順位

## 4. 7 active learning days

### 方式

- アプリ管理。
- 自動課金なし。
- AppleのIntroductory Offerを使用しない。
- 最初の有効な学習判定で開始。
- 7暦日ではなく、完了した7回の有効学習日。

### 進行

- Program Dayは有効な日次セッション完了時だけ進む。
- 起動、ログイン、匿名認証、暦日の経過だけでは進まない。
- 学習しない日、開いただけの日、未完了日は数えない。
- 1 Calendar Dateで最大1 Program Day。
- 未完了Dayは後日も同じ位置から再開。
- Review Due Dateは実日付で進み、期限超過は失敗にも自動消化にもならない。

### 終了

Day 7完了後にレポートを表示する。次の新規判定、すなわち8回目の学習日へ進む前に購入を案内する。

購入しなくても閲覧可能:

- 過去レポート、過去の改善状態
- 選択されたbefore／after（端末ファイルが残る場合）
- 設定、購入復元
- データ書き出し・削除
- プライバシーポリシー、利用規約等

## 5. 購読

### 構造

- iOS IAPの月額・年額購読。
- RevenueCatでOffering、Package、entitlement、購入復元、webhookを管理。
- 実価格、商品ID、Offering、PackageはTBD。
- 価格は市場調査、Azure原価、Apple手数料、継続率を確認してから決める。

設計書やフォールバックUIに未検証の固定価格を表示しない。ストアまたはRevenueCatから検証できない価格で購入を開始しない。

### アクセス制御

| 機能 | trial中 | 購読中 | Day 7後・未購読 |
| --- | --- | --- | --- |
| 新規Azure判定 | 可 | 可 | 不可 |
| 管理課題の新規セッション | 可 | 可 | 不可 |
| 過去レポート・状態 | 可 | 可 | 可 |
| 選択before/after | 可 | 可 | 可（ファイルがある場合） |
| 購入復元・設定・規約 | 可 | 可 | 可 |
| 書き出し・削除 | 可 | 可 | 可 |

クライアントのPaywall表示だけをアクセス制御にしない。API・データポリシー境界でtrialとentitlementを検証する。

### RevenueCat

- クライアントはpublic SDK keyのみ。
- secretとwebhook authorizationはサーバーだけ。
- App User IDとSupabase userの対応を検証する。
- webhookを認証し、再送をidempotentに扱う。
- 購入復元を常に提供する。
- sandbox動作は未確認であり、MVP完成前の実機検証対象。

## 6. 無料体験の不正再付与防止

- 端末Keychain等の補助IDを利用できる。
- サーバーにはハッシュだけを保存する。
- 生のIDをログへ残さない。
- 学習データ削除でtrial履歴を消さない。
- 匿名アカウント再作成だけで自動再付与しない。
- 端末IDだけを本人認証やprotected dataの唯一の権限根拠にしない。

再インストール、端末変更、アカウント復元の具体挙動はTBD。過度な追跡を避け、プライバシー表示と整合させる。

## 7. データ削除

### 学習データ削除

削除対象:

- session、attempt、音素結果
- correction cycle、学習証拠、focus state、review schedule
- reports、学習設定、助言評価
- 端末ローカルbefore／after

削除しない責務:

- 購読状態
- 購入復元に必要な記録
- 無料体験再付与防止に必要な最小履歴

これらの具体保持期間と法的根拠はTBD。学習削除とアカウント退会を同一操作として曖昧にしない。

### 退会・全体削除

退会時のauth user、課金記録、法的保持、匿名化の具体仕様はTBD。RevenueCat/Apple上の購読解約と自社データ削除が別操作であることを説明する。

## 8. データ書き出し

含める:

- profile設定
- Program Day / session / attempt
- 正規化結果、改善状態、復習、レポート
- コンテンツ・助言version

含めない:

- 音声ファイル
- APIキー、token、Authorization
- 内部の不正防止ハッシュ
- 他ユーザー情報
- 外部サービスの秘密や生イベント

## 9. シークレット

### クライアントへ置いてよい公開前提値

- Supabase URL / anon key
- API base URL
- RevenueCat iOS public SDK key

### クライアントへ置かないもの

- Azure Speech key
- Supabase service role
- RevenueCat secret / webhook authorization
- OpenAI key、Python internal key等、現在実装に残るサーバー秘密

`.env`、`.env.local`、秘密を含むファイルをコミットしない。ログ、エラー、書き出し、Todoist、文書へ実値を記録しない。

## 10. 認可

- APIはSupabase JWTを検証する。
- ユーザーは本人のデータだけを読める。
- active content、subscription、trial、durable evidenceはtrusted serverまたはdata policy境界だけが確定できる。
- クライアントが他人のsession IDやattempt IDを送っても拒否する。
- delete/exportは本人所有範囲だけに限定する。
- RLSとAPIの負の経路を自動テストする。

## 11. ログ・分析

保存してよい:

- secret-free error code、operation、provider、HTTP status
- 個人音声を含まない区間レイテンシ
- technical validity reason
- app/OS/device classの必要最小限
- Azure原価推定に必要な非内容メタデータ

保存しない:

- 音声、Authorization、短期トークン、API key
- 不要な英文全文や個人情報
- RevenueCat secret、生の個人識別値

## 12. コンテンツと外部生成

MVPは管理課題だけを判定する。実行時OpenAI助言、実行時Piper音声、実行時Python変換を中心経路から外し、事前生成・レビュー済み資産を使う。これにより、実行時の外部送信、揺らぎ、追加待ち時間を減らす。

現在コードに残る旧機能は第3段階では変更しない。MVPアクセス経路からの除外は第4段階以降。

## 13. セキュリティ受け入れ条件

- ユーザー音声が自社サーバー/DB/Storageへ保存されない。
- Azure key等の秘密がクライアントbundleへ入らない。
- 短期トークンの期限と更新が安全に扱われる。
- idempotencyでattempt、Program Day、RevenueCat eventを重複処理しない。
- durable進捗をクライアントだけで偽装できない。
- trial履歴と学習削除が分離される。
- Day 7後も過去データへの権利が維持される。
- RLS/APIで他人のread/writeが拒否される。
- export/deleteが本人範囲で動く。
- secret redactionが負のテストを通る。

## 14. 未確認・TBD

- 実価格、商品、Offering、Package
- RevenueCat sandboxとwebhook実接続
- Hosted Supabase状態
- Azure外部データ保持設定
- 退会・法的保持期間
- ローカル音声暗号化・バックアップ除外
- 端末変更時のtrial復元
