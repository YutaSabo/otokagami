# 環境・権限・セキュリティ変更台帳

## 1. このファイルの目的

PC、OS、開発環境、外部サービスに対して行った変更のうち、解除、失効、停止または定期的な見直しが必要になり得るものを記録する。
後から変更理由、影響範囲、確認方法、復旧方法を追跡できるようにし、秘密情報の値は記録しない。

## 2. 記録対象

- OS・アプリの権限、セキュリティ設定、仮想デバイス、常駐ソフトウェア
- CLI、パッケージ、サービス連携、認証・CLIログイン、環境変数の取得先
- 外部公開 URL、配布チャネル、ポート待受、トンネル、Webhook、デプロイ設定
- 一時的なデバッグ設定、テスト用アカウント、バックグラウンド処理、費用が継続し得る設定
- 解除または定期点検が必要な外部サービスの設定

## 3. 記録対象外

- この台帳自体の追加・編集と、通常のアプリケーションソースコード変更
- 秘密情報の値、パスワード、トークン、Cookie、秘密鍵、音声内容、認識テキスト
- 実施されず、将来のリスクや解除方法も伴わない単なるアイデア

## 4. 運用ルール

1. 記録対象の変更は、同じタスク内で実行後すぐに本ファイルへ追記する。
2. 実行前に、可能な範囲で解除・復旧方法を確認する。実行後は実際の状態を確認して記録する。
3. 実施証拠がない操作は実施済みと書かず、`要確認` または `提案のみ・未実施` とする。
4. 一時変更には解除条件または次回確認日を設定する。判断に迷う場合は記録する。
5. 秘密情報の値は書かず、必要なら名称と保管場所だけを記録する。
6. 解除・失効・停止は、この台帳への記録だけで実行しない。別途、必要な承認を得る。

## 5. ステータスの定義

| ステータス | 意味 |
| --- | --- |
| `有効・必要` | 現在も必要であり維持する変更。 |
| `有効・要見直し` | 有効だが、必要性または安全性を点検すべき変更。 |
| `一時的` | 一定期間または特定作業の間だけ必要な変更。 |
| `解除予定` | 不要と判断済みで、解除作業が残っている変更。 |
| `解除済み` | 元に戻した、削除した、または失効させた変更。 |
| `要確認` | 実施状況または現在の状態を確認できていない変更。 |
| `提案のみ・未実施` | 提案されたが、実施した証拠がない変更。 |

## 6. 定期点検の方法

- ステージング公開設定、EAS/TestFlight の配布範囲、外部サービスの認証・請求状態は、少なくとも月次またはリリース完了時に管理画面で確認する。
- ローカルの仮想オーディオデバイス、既定入出力、Metro などの一時プロセスは、音声テスト・開発サーバー利用が終わった時点で確認する。
- `.env*`、`.vercel`、EAS 設定は、追跡対象外であることと、秘密値をコミットしていないことをリリース前に確認する。
- 点検実施時は「10. 点検履歴」へ日付、対象 ID、確認結果、実施者を追記する。

## 7. 変更履歴一覧

| ID | 分類 | 変更内容 | 対象 | 現在の状態 | リスク | 次回対応 | 最終確認日 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ESC-001 | 外部公開・アクセス制御 | Vercel ステージングのログイン保護を解除 | `otokagami-api-staging` | 有効・要見直し | 高 | テスト完了後に保護を再有効化するか判断 | 2026-08-07 |
| ESC-002 | 外部デプロイ | Vercel ステージング API を公開デプロイ | `otokagami-api-staging` | 有効・要見直し | 中 | 公開要否と接続先分離を点検 | 2026-08-07 |
| ESC-003 | 認証・ローカル設定 | Vercel CLI のプロジェクト連携と環境変数取得 | ローカル作業ディレクトリ / Vercel | 有効・要見直し | 中 | `.vercel` と `.env.local` の追跡除外・不要時削除を確認 | 2026-08-07 |
| ESC-004 | 配布・外部連携 | EAS Update の staging チャネルと TestFlight ステージング配布 | Expo / App Store Connect | 有効・必要 | 中 | 次回 staging buildでも接続先を再確認 | 2026-08-08 |
| ESC-005 | OS・常駐ドライバ | BlackHole 仮想オーディオドライバを導入 | macOS | 有効・要見直し | 中 | 自動テスト用途が不要になれば削除可否を判断 | 2026-07-12 |
| ESC-006 | OS・シミュレーター設定 | 仮想オーディオを既定入出力・Simulator マイク入力に設定 | macOS / iOS Simulator | 一時的 | 中 | 音声テスト終了後に既定入力・出力を復元 | 2026-07-12 |
| ESC-007 | 開発サーバー | Metro を LAN から到達可能な 8081 番ポートで待受 | ローカル PC / iOS Simulator | 一時的 | 低 | 開発終了時に停止し、不要な待受がないか確認 | 2026-07-12 |
| ESC-008 | 提案・未実施 | 音声切替 CLI の追加導入 | macOS / Homebrew | 提案のみ・未実施 | 低 | 必要時のみ導入を再検討 | 2026-07-12 |
| ESC-009 | プロジェクト依存 | Azure Speech iOS SDK 1.43をCocoaPodsで導入 | `apps/mobile/ios` | 有効・必要 | 低 | SDK更新時に互換性と公式サポート状況を再確認 | 2026-07-12 |
| ESC-010 | ローカル開発ツール | fastlane 2.237.0をHomebrewで導入 | macOS | 有効・必要 | 低 | TestFlightローカルビルド運用終了時に削除可否を判断 | 2026-07-13 |
| ESC-011 | ローカルDB検証・外部棚卸し | Supabase CLI導入、使い捨てlocal stack、Hosted read-only inventory | macOS / Docker / Supabase | 一時的 | 中 | 保持資源の停止状態と削除要否を再確認 | 2026-08-07 |
| ESC-012 | 暗号化バックアップ・ローカル復元 | S6-02 Hosted論理バックアップと独立local restore | macOS / Docker / Supabase | 一時的・COMPLETE | 中 | 保持期限、第二backup、管理schema差とcredential rotation要否を個別判断 | 2026-08-09 |
| ESC-015 | ローカルDB・API境界検証 | S6-05〜07 Core/API v2・transactional RPCのFresh／clone検証 | Docker / Supabase local / API workspace | 一時的・Hosted承認待ち | 中 | 確定migrationのHosted適用は直前承認後に行う | 2026-08-09 |

## 8. 個別変更記録

## ESC-009：Azure Speech iOS SDKの導入

- **分類**：プロジェクト依存
- **対象**：`apps/mobile`のDevelopment Build / CocoaPods
- **実施日時・最終確認日**：2026-07-12
- **現在の状態**：`MicrosoftCognitiveServicesSpeech-iOS` 1.43をPod依存として導入し、ネイティブモジュール単体のiOS Simulatorビルド成功を確認。
- **目的**：16kHz/16bit/mono PCMを録音中にAzureへ直接push streamし、Pronunciation Assessment結果を低遅延で取得するため。
- **リスク**：SDK更新によるAPI互換性、Azure利用料、短期トークン取り扱い。Subscription Keyはサーバー環境変数だけに置く。
- **確認方法**：`pod install`後にiOSビルドし、Development Buildで実機判定する。
- **解除・復旧手順**：モジュールのpodspec依存とpackage依存を削除し、iOSを再prebuildして`pod install`する。
- **次回確認日**：次回iOS SDK更新時または2026-08-12。

## ESC-010：fastlaneの導入

- **分類**：ローカル開発ツール
- **対象**：macOS / Homebrew
- **実施日時・最終確認日**：2026-07-13
- **現在の状態**：fastlane 2.237.0を導入済み。依存としてHomebrew管理のRuby 4.0.5、OpenSSL 3.6.3、terminal-notifier 2.0.0も導入・更新された。macOS 26のローカル署名検証用にRuby 3.4.10も並行導入した。
- **目的**：ソースコードをEASクラウドへ送信せず、署名済みTestFlight用IPAをMac上で生成するため。
- **リスク**：Apple署名処理とApp Store Connect APIを扱う。認証情報はEAS credentials serviceと一時ビルド領域で扱い、リポジトリへ保存しない。
- **確認方法**：`fastlane --version`とEAS local buildを確認し、0.1.1 (8) の署名済みIPA生成完了を確認した。
- **解除・復旧手順**：不要時に`brew uninstall fastlane terminal-notifier`を実行する。Ruby/OpenSSLは他formulaの依存状況を`brew uses --installed`で確認してから扱う。
- **次回確認日**：TestFlight検証完了時または2026-08-13。

## ESC-001：Vercel ステージングのログイン保護解除

- **分類**：外部公開・アクセス制御
- **対象端末・サービス**：Vercel プロジェクト `otokagami-api-staging`
- **実施日時**：2026-07-12（この Codex セッション内）
- **実施者**：ユーザー承認のもと Codex が Vercel 管理画面で実施
- **実施状況**：実施済み
- **現在の状態**：2026-08-07にステージング API へログイン不要で到達可能な状態を再確認した。再有効化は未実施。
- **ステータス**：有効・要見直し
- **変更内容**：Deployment Protection の Require Log In を無効化した。
- **実施理由**：TestFlight と iOS Simulator からステージング API を検証するため。
- **確認できた根拠**：このセッション内で Vercel 管理画面の設定変更後、ステージング API への到達を確認した。
- **関連ファイル・設定場所**：Vercel Dashboard の当該プロジェクト Deployment Protection。
- **付与した権限・公開範囲**：ステージング API への未認証アクセスを許可する範囲。
- **使用している認証情報の名称**：Vercel アカウント認証（値は記録しない）。
- **秘密情報の保存場所**：Vercel 側の環境変数およびローカル `.env.local`。値は記録しない。
- **想定されるリスク**：ステージング URL を知る第三者が API に到達できる。環境変数や API 実装の不備がある場合、攻撃対象が増える。
- **リスクレベル**：高
- **不要になったと判断する条件**：外部端末から未認証でステージング API を呼ぶ検証が完了したとき。
- **確認方法**：Vercel Dashboard で Require Log In の状態を確認し、未認証リクエストの応答を確認する。
- **解除・削除・復旧手順**：Vercel Dashboard の Deployment Protection で Require Log In を有効化する。変更後、TestFlight の到達要件を再確認する。
- **次回確認日**：2026-07-19 または TestFlight 検証完了直後
- **最終確認日**：2026-08-07
- **対応結果・補足**：緊急性の高い未解消リスク。公開を継続する理由と期限を人間が判断すること。

## ESC-002：Vercel ステージング API の公開デプロイ

- **分類**：外部デプロイ
- **対象端末・サービス**：Vercel プロジェクト `otokagami-api-staging`
- **実施日時**：2026-07-12（この Codex セッション内、ユーザーが完了を報告）
- **実施者**：ユーザー
- **実施状況**：実施済み
- **現在の状態**：VercelのProduction deploymentは`main`の確認済みcommitからReadyで稼働している。固定の無効tokenを用いたread-only routing probeと、直後の両Supabase Auth logの差分から、現在のAPI接続先が`otokagami-staging`であることをalias単位で確認した。Sensitive指定の`SUPABASE_URL`はVercel仕様上再表示できないため、値自体は取得・記録していない。
- **ステータス**：有効・要見直し
- **変更内容**：Vercel CLI を用いてステージング名の API プロジェクトへ公開デプロイした。
- **実施理由**：TestFlight から公開 HTTPS API を利用するため。
- **確認できた根拠**：このセッションのユーザー報告、およびステージング API の性能ログ・Simulator からの API 呼出し結果。
- **関連ファイル・設定場所**：`apps/api`、Vercel プロジェクト設定、Vercel 環境変数。
- **付与した権限・公開範囲**：公開 HTTPS のステージング API。
- **使用している認証情報の名称**：Vercel CLI ログイン、Vercel 環境変数（名称・値とも本項では記録しない）。
- **秘密情報の保存場所**：Vercel 環境変数およびローカル `.env.local`。値は記録しない。
- **想定されるリスク**：意図しない環境へのデプロイ、ステージング公開、外部 API 利用料金、設定不整合。
- **リスクレベル**：中
- **不要になったと判断する条件**：ステージング検証を終了し、当該デプロイを維持しないと判断したとき。
- **確認方法**：Vercel Dashboard で対象プロジェクト、Production/Preview の紐付け、デプロイ履歴、環境変数名、Protection を確認する。
- **解除・削除・復旧手順**：本台帳では実施しない。Vercel Dashboard で対象デプロイまたはプロジェクトの運用方針を確認し、必要な承認後にロールバック・保護再設定を行う。
- **次回確認日**：次回 TestFlight 更新前
- **最終確認日**：2026-08-07
- **対応結果・補足**：CLI の初回実行はアップロード件数上限により失敗し、ユーザーが別手順でデプロイ完了を報告した。失敗した初回操作は公開変更として数えない。

## ESC-003：Vercel CLI のプロジェクト連携とローカル環境ファイル

- **分類**：認証・ローカル設定
- **対象端末・サービス**：ローカル作業ディレクトリ、Vercel CLI
- **実施日時**：2026-07-12（この Codex セッション内）
- **実施者**：ユーザー
- **実施状況**：実施済み
- **現在の状態**：ルートと`apps/api`に`.vercel`と`.env.local`が残り、`.gitignore`で追跡対象外である。2026-08-07の確認ではVercel CLIの既存ログイン資格情報は見つからず、管理画面のログイン状態とは分離されていた。値は読み出していない。
- **ステータス**：有効・要見直し
- **変更内容**：Vercel CLI が `otokagami-api-staging` へリンクし、development 環境変数をローカル `.env.local` へ取得した。
- **実施理由**：ステージング API のデプロイ・検証を行うため。
- **確認できた根拠**：このセッションの Vercel CLI 出力、および `.gitignore` の差分。
- **関連ファイル・設定場所**：`.vercel/`、`.env.local`、`.gitignore`、Vercel CLI 設定。
- **付与した権限・公開範囲**：ローカル CLI から当該 Vercel プロジェクトへアクセスできる認証状態。
- **使用している認証情報の名称**：Vercel CLI 認証、Vercel development 環境変数。
- **秘密情報の保存場所**：ローカル `.env.local` および Vercel。値は記録しない。
- **想定されるリスク**：ローカル環境変数の漏えい、意図しないプロジェクトへの操作、認証状態の放置。
- **リスクレベル**：中
- **不要になったと判断する条件**：この PC から Vercel CLI で当該プロジェクトを操作する必要がなくなったとき。
- **確認方法**：`.gitignore`、`git status --ignored`、Vercel CLI のリンク先、ローカルファイルの権限を確認する。
- **解除・削除・復旧手順**：必要な承認後にローカル `.vercel` と `.env.local` を削除し、Vercel CLI からログアウトする。削除前に必要な設定を Vercel 側に残していることを確認する。
- **次回確認日**：ステージング作業完了時
- **最終確認日**：2026-08-07
- **対応結果・補足**：秘密値は本台帳に含めない。

## ESC-004：EAS staging チャネルと TestFlight ステージング配布

- **分類**：配布・外部連携
- **対象端末・サービス**：Expo EAS、Apple TestFlight、iOS アプリ
- **実施日時**：不明（このセッション内で staging への EAS Update 公開と TestFlight 検証を確認）
- **実施者**：ユーザーおよび Codex
- **実施状況**：実施済み
- **現在の状態**：Expo DashboardではEAS cloud build 0.1.0 (1) が完了済みで、`staging` profile、`preview` environment、`staging` channel、runtime 0.1.0、source commit `afe4717`として確認できる。App Store Connectでは内部テストグループ`Team (Expo)`に0.1.0 (1)、0.1.1 (8)、0.1.1 (9)があり、いずれも`Ready to Submit`かつ期限内だった。0.1.1の外部テストグループは確認されなかった。ユーザーが0.1.1 (9)を実機起動した直後は`otokagami-staging`に新規Auth log 6件、`Otokagami`に0件、0.1.1 (8)の起動直後は同2件対0件という差分を確認し、Build 8と9の実接続先をいずれも`otokagami-staging`と確定した。
- **ステータス**：有効・必要
- **変更内容**：EAS Update プロジェクトを接続し、`staging` チャネルを TestFlight 用ビルドに設定した。0.1.1 (8) の署名済みIPAを提出し、再提出用のApp Store ConnectアプリIDを設定した。
- **実施理由**：非ネイティブ変更を TestFlight 検証端末へ配信するため。
- **確認できた根拠**：`apps/mobile/app.json`、`apps/mobile/eas.json`、`docs/phases/PHASE_14_REMOTE_IOS_STAGING.md`、Expo Dashboard、App Store Connect。ユーザー所有の0.1.0 (1)配布物を新しい一時ディレクトリへ保存し、署名変更・実行・再配布をせずに埋め込み設定を確認した結果、Bundle IDは既存の`com.yutahemmi.otokagami`、公開Supabase接続先は`otokagami-staging`、サーバー専用変数名とservice-role token literalの検出は0件だった。0.1.1 (8)/(9)はユーザーの実機起動と両projectのread-only Auth log差分で接続先を確認した。
- **関連ファイル・設定場所**：`apps/mobile/app.json`、`apps/mobile/eas.json`、Expo Dashboard、App Store Connect。
- **付与した権限・公開範囲**：Expo アカウントの当該プロジェクト操作権限、TestFlight テスターへのステージングアプリ配布。
- **使用している認証情報の名称**：Expo/EAS ログイン、Apple Developer/App Store Connect 認証。
- **秘密情報の保存場所**：各サービスの認証情報。値は記録しない。
- **想定されるリスク**：意図しない更新チャネルへの配信、テスト配布範囲の過大化、公開変数設定の誤り。
- **リスクレベル**：中
- **不要になったと判断する条件**：TestFlight 検証と EAS Update の運用を終了したとき。
- **確認方法**：Expo Dashboardでprofile、environment、channel、runtimeVersion、source commitを確認し、App Store Connectで内部・外部テスター、build状態、有効期限を確認する。接続先は履歴文書から推測せず、保全済み配布物内の公開URLをaliasへ照合するか、対象buildの実行時通信を両Supabase projectのread-only logで相関確認する。
- **解除・削除・復旧手順**：本台帳では実施しない。承認後に配布対象・チャネル運用を変更し、必要なら新ビルドで設定を置換する。
- **次回確認日**：次回 staging 更新前
- **最終確認日**：2026-08-08
- **対応結果・補足**：解析用配布物は`/private/tmp/otokagami-s601-mobile-jNYFIr`に保持し、IPAは16,322,571 bytes、一時ディレクトリ全体は約75MB。自動削除していない。`EXPO_PUBLIC_*`は公開バンドルに入る前提の値だけを使用し、サーバー専用キーは登録しない。S6-01で対象とした現行対応buildの接続先確認は完了した。

## ESC-005：BlackHole 仮想オーディオドライバの導入

- **分類**：OS・常駐ドライバ
- **対象端末・サービス**：開発用 macOS PC
- **実施日時**：2026-07-12（この Codex セッション内、ユーザーが導入を完了）
- **実施者**：ユーザー
- **実施状況**：実施済み
- **現在の状態**：BlackHole 2ch と BlackHole 16ch のドライバ存在を確認した。
- **ステータス**：有効・要見直し
- **変更内容**：iOS Simulator へのテスト音声入力用に BlackHole 仮想オーディオドライバを導入した。
- **実施理由**：Codex が生成・再生するテスト音声を Simulator の録音入力へ流すため。
- **確認できた根拠**：このセッション内で Audio MIDI 設定とドライバの存在を確認した。
- **関連ファイル・設定場所**：macOS の Audio MIDI 設定、`/Library/Audio/Plug-Ins/HAL/`。
- **付与した権限・公開範囲**：macOS の音声入出力デバイスとして利用可能になる。
- **使用している認証情報の名称**：なし。
- **秘密情報の保存場所**：該当なし。
- **想定されるリスク**：既定音声デバイスの誤設定による会議・録音の無音化、不要なドライバの継続導入。
- **リスクレベル**：中
- **不要になったと判断する条件**：Simulator への仮想音声入力を使う自動化テストが不要になったとき。
- **確認方法**：Audio MIDI 設定とサウンド設定で BlackHole の一覧・既定デバイスを確認する。
- **解除・削除・復旧手順**：承認後に BlackHole の公式アンインストール手順を確認して削除する。削除前に既定入出力を内蔵デバイスへ戻す。
- **次回確認日**：Simulator 音声テスト完了時
- **最終確認日**：2026-07-12
- **対応結果・補足**：導入済みであることは確認済みだが、将来も必要かは未確定。

## ESC-006：仮想オーディオの既定入出力と Simulator マイク入力

- **分類**：OS・シミュレーター設定
- **対象端末・サービス**：開発用 macOS PC、iPhone 16e Simulator
- **実施日時**：2026-07-12（この Codex セッション内）
- **実施者**：ユーザー承認のもと Codex
- **実施状況**：実施済み
- **現在の状態**：macOS の出力は BlackHole 2ch と確認した。macOS の既定入力は BlackHole 16ch と表示され、Simulator の Audio Input は BlackHole 2ch を選択した。入力設定に不整合があるため再確認が必要。
- **ステータス**：一時的
- **変更内容**：BlackHole を利用するため macOS の既定オーディオ設定と Simulator の Audio Input を変更した。
- **実施理由**：生成テスト音声を録音フローへ注入するため。
- **確認できた根拠**：このセッション内のシステム設定、Audio MIDI 設定、Simulator の I/O メニュー。
- **関連ファイル・設定場所**：macOS「システム設定 > サウンド」、Audio MIDI 設定、Simulator「I/O > Audio Input」。
- **付与した権限・公開範囲**：外部公開なし。ローカル音声経路のみ変更。
- **使用している認証情報の名称**：なし。
- **秘密情報の保存場所**：該当なし。
- **想定されるリスク**：通常のマイク・スピーカーが利用できない、意図しない音声経路、テスト失敗をアプリ不具合と誤認すること。
- **リスクレベル**：中
- **不要になったと判断する条件**：Simulator の音声注入テストが完了したとき。
- **確認方法**：サウンド設定、Audio MIDI 設定、Simulator I/O メニューを開き、内蔵マイク・スピーカーへ戻す前後を確認する。
- **解除・削除・復旧手順**：macOS の入力を「MacBook Airのマイク」、出力を「MacBook Airのスピーカー」へ戻し、Simulator の Audio Input も内蔵マイクまたは System へ戻す。
- **次回確認日**：次回の Simulator 録音テスト終了直後
- **最終確認日**：2026-07-12
- **対応結果・補足**：BlackHole への再生時に、隔離環境で生成した 0 バイト音声を用いた無音テストが発生した。アプリの評価結果ではなく、テスト入力の不備として切り分けた。

## ESC-007：LAN 到達可能な Metro 開発サーバー

- **分類**：開発サーバー
- **対象端末・サービス**：開発用 macOS PC、iOS Simulator、Expo dev client
- **実施日時**：2026-07-12（この Codex セッション内）
- **実施者**：既存プロセスを確認。開始者・開始日時は不明。
- **実施状況**：要確認
- **現在の状態**：Expo/Metro が LAN を含む 8081 番ポートで待受し、Simulator の dev client が同一 LAN の URL からアプリを読み込めることを確認した。停止要否は要確認。
- **ステータス**：一時的
- **変更内容**：Expo dev client 用の Metro サーバーが LAN 到達可能な状態で稼働している。
- **実施理由**：iOS Simulator の開発ビルドをローカルバンドルへ接続するため。
- **確認できた根拠**：このセッション内のポート待受確認、HTTP health 応答、Simulator でのアプリ起動。
- **関連ファイル・設定場所**：`apps/mobile/package.json` の `start` スクリプト、Expo Metro プロセス。
- **付与した権限・公開範囲**：同一ネットワークから到達し得る開発用 HTTP ポート。
- **使用している認証情報の名称**：なし。
- **秘密情報の保存場所**：`.env` 系ローカルファイルを Expo が読み込む可能性があるため、値は記録しない。
- **想定されるリスク**：同一ネットワーク上の第三者から開発サーバーへ到達される可能性、不要プロセスの継続。
- **リスクレベル**：低
- **不要になったと判断する条件**：Simulator/dev client の検証が完了したとき。
- **確認方法**：ポート待受、Expo CLI、Simulator の接続先を確認する。
- **解除・削除・復旧手順**：Metro を起動したターミナルで停止する。必要なら Simulator の dev client を終了または接続先をリセットする。
- **次回確認日**：本日の開発作業終了時
- **最終確認日**：2026-07-12
- **対応結果・補足**：LAN 接続ではなく Simulator 専用にする場合の最小公開範囲は要検討。

## ESC-008：音声切替 CLI の追加導入案

- **分類**：提案・未実施
- **対象端末・サービス**：macOS / Homebrew
- **実施日時**：2026-07-12（提案・試行）
- **実施者**：Codex
- **実施状況**：提案のみ・未実施
- **現在の状態**：音声デバイス切替を補助する CLI の導入を試みたが、権限・利用制限によりインストール完了の証拠はない。
- **ステータス**：提案のみ・未実施
- **変更内容**：BlackHole の入出力切替を補助する Homebrew CLI の導入案。
- **実施理由**：Simulator 音声テストの再現性を高めるため。
- **確認できた根拠**：このセッション内の導入試行は失敗し、導入成功を示す証拠は得られなかった。
- **関連ファイル・設定場所**：Homebrew（導入済みかは要確認）。
- **付与した権限・公開範囲**：該当なし。
- **使用している認証情報の名称**：なし。
- **秘密情報の保存場所**：該当なし。
- **想定されるリスク**：不要なグローバル CLI の導入、保守対象の増加。
- **リスクレベル**：低
- **不要になったと判断する条件**：OS 標準機能または別の自動化手段で十分なとき。
- **確認方法**：Homebrew のインストール済みパッケージ一覧を確認する。
- **解除・削除・復旧手順**：導入していないため不要。将来導入する場合は、導入後に別 ID として実施済み記録を追加する。
- **次回確認日**：必要になった時点
- **最終確認日**：2026-07-12
- **対応結果・補足**：実施済みの変更として扱わない。

## ESC-011：S6-01 Supabase local検証とHosted read-only inventory

- **分類**：ローカルDB検証・外部棚卸し
- **対象端末・サービス**：macOS、Homebrew、Colima/Docker、使い捨てlocal Supabase、Supabase Dashboardの`Otokagami`と`otokagami-staging`
- **実施日時・最終確認日**：2026-08-07
- **実施者**：ユーザー承認のもとCodex
- **実施状況**：実施済み。削除は未実施。
- **ステータス**：一時的
- **変更内容**：Homebrewの`supabase/tap`からSupabase CLI 2.112.0を導入した。導入時にHomebrew tapの自動更新が実行された。使い捨てlocal stack用のDocker imageを取得し、専用port `56320`〜`56329`と一時ディレクトリ`/private/tmp/otokagami-s601-8nhKel`を使ってmigration、Seed、RLSを検証した。
- **目的**：Hosted DBへ書き込まず、リポジトリのmigration、Seed、RLSを再現可能なlocal環境で確認したうえで、両Hosted projectのschemaと集計状態をread-onlyで棚卸しするため。
- **接続境界**：local検証ではremote linkを作成せず、Hosted credentialを使用しなかった。Hosted側はSQL Editorで`BEGIN READ ONLY`、5秒のstatement timeout、read-only guard、`ROLLBACK`を含む固定queryだけを実行した。
- **local検証結果**：3本のrepository migrationとSeedの適用、content Seedテスト、RLSテストが成功した。localではpublic table 21、RLS policy 50、function 2、trigger 8、index 45を確認した。Seedはphoneme 41、cluster 20、practice item 428、target 428、active practice item 6、advice 18（active 0）で、最新migrationにより`ja_difficulty`が削除された状態を確認した。
- **初回stackの処置**：必要な設定ファイルだけを複製した最初のstackはEdge runtime起動に失敗し、Supabase CLIがその試行で作成したcontainerとvolumeを自動cleanupした。次の試行では使い捨て設定でEdge runtimeを無効化し、DB検証を完走した。
- **cleanup識別子**：`otokagami-s601-8nhkel`
- **現在のローカル状態**：ColimaはmacOS Virtualization.framework上のDocker runtimeとして稼働中。S6-01用container 11個はすべて停止済みで、専用volume 2個は保持している。関連containerの論理使用量は約27.54MB、volumeは約82.66MB、関連image 11個の非重複を考慮しない論理合計は約1.72GB。imageは他のlocal stackと共有される可能性がある。
- **一時CLI cache**：EASとVercelのread-only接続確認で`npx`を使用し、`eas-cli`と`vercel`が既存のnpm一時cache配下へ追加された。グローバル導入や外部設定変更は行っていない。npm `_npx`全体は約379MBだが、既存cacheを含むため今回分だけの容量は未確定。
- **Hosted棚卸しの保存状態**：両projectのSQL Editorに、秘密・個人情報・音声・個別識別子・個別データを返さないprivateのread-only inventory queryがautosaveされている。queryは削除していない。Dashboard閲覧とquery実行以外に、Hosted設定、DB、backup、PITR、planを変更していない。
- **asset参照検証**：repository Seedのadvice asset参照18件（重複除外15件）はmanifestの15件と全て対応し、manifest記載の15ファイルは全て存在した。15件はいずれも`static_placeholder`かつreview必須であり、公開用の正式図解としては扱わない。
- **Backup状態**：両projectはFree Planでscheduled backupを利用できず、PITRは未契約。restore-to-new-projectはPro Planとphysical backupが必要なため、今回の復元経路としては未検証・利用不可。
- **想定されるリスク**：CLIとDocker imageによるディスク消費、Colima常駐中のCPU・メモリ消費、停止containerとvolumeの放置、別projectで同じportや識別子を使うことによる誤接続、SQL Editorにautosaveされたqueryの長期残存。
- **リスクレベル**：中
- **状態確認方法**：`supabase --version`、`brew info supabase`、`colima status`、cleanup識別子で絞った`docker ps -a`と`docker volume ls`、および`docker system df`を使用する。local検証時はremote linkがないこと、専用portであること、Hosted credentialが未設定であることを再確認する。
- **停止手順**：検証を再開した場合は、対象project IDとcontainer一覧を確認してからlocal stackだけを停止し、11個すべてが`Exited`であることを確認する。Colima自体の停止は他projectの利用有無を確認してから別途判断する。
- **削除手順**：別承認後にcleanup識別子で対象を再列挙し、S6-01専用container 11個とvolume 2個を明示的に削除する。imageは共有参照を確認し、S6-01専用と証明できるものだけを個別承認後に削除する。一時ディレクトリとSQL Editor queryの削除も別承認とする。
- **解除・復旧手順**：削除前にlocal検証証拠が台帳へ記録済みであることを確認する。volume削除後の復元は前提にせず、必要な場合はrepository migrationとSeedから新しい使い捨てlocal DBを再作成する。Hosted DBのrestoreとは別操作として扱う。
- **次回確認日**：要確認
- **対応結果・補足**：Hosted DB write、migration、Seed、RLS変更、backup作成、restore、Production操作は行っていない。SQL Editorのquery autosaveは事前承認済みの外部メタデータ保存として本項へ記録した。

## ESC-012：S6-02暗号化論理バックアップと独立local restore

- **分類**：暗号化バックアップ・ローカル復元
- **対象端末・サービス**：macOS、Colima/Docker、Supabase CLI 2.112.0、Hosted Supabaseの`otokagami-staging`と旧`Otokagami`
- **実施日時**：2026-08-08〜2026-08-09
- **実施者**：ユーザー承認のもとCodex
- **実施状況**：`COMPLETE`。`otokagami-staging`と旧`Otokagami`の両方で、暗号化論理バックアップ、独立local restore、read-only reconciliationまで完了した。旧projectの初回再開試行は認証失敗したが、正しい既存Database passwordを人間が安全入力した再試行で完了した。入力値は保存・表示していない。
- **将来の正本と接続境界**：将来の正本を`otokagami-staging`とする判断を記録したが、S6-01で確定したsplit topology、アプリ、API、CLI、Vercel、Mobileの接続先は変更していない。旧`Otokagami`も照合元として変更・削除していない。
- **暗号化保存先**：`/Users/hemmiminami/.otokagami-backups/s6-02/otokagami-s6-02-backups.sparsebundle`。APFS sparsebundle、AES暗号化`YES`、passphrase slot 1、論理上限1GiB、両project格納・unmount後の物理使用量27,128KiB。親ディレクトリとsparsebundleディレクトリはmode `700`、暗号化領域内の正規artifactはmode `600`。
- **暗号化状態**：作成時にAES-256を指定し、マウント中のimage metadataで`image-encrypted=true`、unmount後の`hdiutil isencrypted`で`encrypted: YES`を確認した。passphrase、接続文字列、credentialは台帳・Git・Todoistへ記録していない。
- **保存artifact**：両projectごとに`roles.sql`、`schema.sql`、`data.sql`、`supabase_migrations`のschema/data、AuthとStorageの個別schema/dataおよび結合schema/data、pre/post/local inventory、manifest、SHA-256一覧、checksum検証log、reconciliation、秘密除去済みexecution/restore logを暗号化領域内へ保存した。stagingには補足manifestも保持した。失敗試行の証跡も削除せず同じ暗号化領域内で隔離した。
- **主要artifactのサイズとSHA-256**：

  | artifact | bytes | SHA-256 |
  | --- | ---: | --- |
  | `otokagami-staging/roles.sql` | 358 | `4350a72b5ec109888e740c17f3eb4da2fcd95ab73af26499538ed0bf615db543` |
  | `otokagami-staging/schema.sql` | 49,141 | `bd9b945d6071908bd463bfc4148b866362c92d4aa062bcce0a96bbd4528ffebe` |
  | `otokagami-staging/data.sql` | 316,367 | `5fadc32d9d833575f3b633d3bd8a3de0a27248807ad929a2a6dc0d7ddb3e1e24` |
  | `otokagami-staging/migrations_schema.sql` | 1,195 | `dcb3e0cf0a2720c65e6211b0b63f93f68202bdf119af12c85782afb3e244cf24` |
  | `otokagami-staging/migrations_data.sql` | 29,715 | `92e1aa6132b366ab5a7ac2550c839453f0224a71b841a062b01810d2aa44671d` |
  | `otokagami-staging/auth_storage_schema.sql` | 94,828 | `7cc4c39aeb259c375bd14cf36bf5856ff475dbc06cf0e06bca922d5835db17bd` |
  | `otokagami-staging/auth_storage_data.sql` | 36,414 | `682b6e5fcb5eb8501237a613199d8a72f547cd3de02534edab1ff9806f0cc03e` |
  | `otokagami/roles.sql` | 358 | 暗号化領域内のSHA-256一覧で管理 |
  | `otokagami/schema.sql` | 48,263 | 暗号化領域内のSHA-256一覧で管理 |
  | `otokagami/data.sql` | 27,236 | 暗号化領域内のSHA-256一覧で管理 |
  | `otokagami/migrations_schema.sql` | 887 | 暗号化領域内のSHA-256一覧で管理 |
  | `otokagami/migrations_data.sql` | 27,995 | 暗号化領域内のSHA-256一覧で管理 |
  | `otokagami/auth_storage_schema.sql` | 94,828 | 暗号化領域内のSHA-256一覧で管理 |
  | `otokagami/auth_storage_data.sql` | 21,527 | 暗号化領域内のSHA-256一覧で管理 |

- **checksum**：両projectの正規backupと最終照合証拠92件を含む`S6-02-SHA256SUMS`を作成し、全92件`OK`を再確認した。各project内のCLI artifact用SHA-256一覧も個別に検証済み。
- **Hosted preflight/postflight**：両projectで`BEGIN READ ONLY`、5秒のstatement timeout、`transaction_read_only=on`、`ROLLBACK`を確認した。`otokagami-staging`はPostgreSQL 17.6、DB約13.0MB、Hosted migration 2件、public table 21件。旧`Otokagami`はHosted migration 1件、public table 21件。両projectともbackup前後の全対象table件数が一致した。Hosted DBへのINSERT、UPDATE、DELETE、migration、Seed、RLS変更、restoreは実施していない。
- **repositoryとの差分**：`otokagami-staging`のHosted migrationは`20260704000000`と`20260712000000`の2件、旧`Otokagami`は`20260704000000`の1件。repositoryの`20260806000000_generalize_practice_difficulty.sql`は両Hostedで未適用、`20260712000000`は旧projectで未適用。適用は本作業の対象外であり実施していない。
- **restore環境**：`otokagami-staging`用project IDは`otokagami-s602-staging-20260808`、専用portは`56420`〜`56429`。旧`Otokagami`用project IDは`otokagami-s602-legacy-20260808`、専用portは`56520`〜`56529`。remote linkとHosted credential保存はなく、S6-01 stackを再利用・resetしていない。
- **restore結果**：両projectともroles、schema、migration、Auth、public全table件数、品質集計、RLS policy、triggerが一致し、public/Auth/Storageのrow countは完全一致した。local Supabase側が新しい管理schemaであるため、両projectでlocal-onlyのStorage table 2件・column 18件・index 5件・constraint 5件、Hosted/localで各1件ずつ異なるStorage function、Hosted-onlyのAuth index 4件という同型の管理schema version差を分離記録した。バックアップSQLを修正して一致扱いにはしていない。
- **主要aggregate**：`otokagami-staging`はAuth user 23、profile 21、installation 21、daily session 13、session item 91、attempt 34、phoneme result 127。auth userに対してprofile/installationがない件数は各2、逆方向は各0。主要orphanはsession item 0、attempt 0、phoneme result 0。phoneme resultがないattemptは6、正規化practice textのduplicate groupは60。旧`Otokagami`はAuth user 4、profile 1、installation 1で、その他のpublic学習データは0。auth userに対してprofile/installationがない件数は各3、逆方向は各0。すべて各local restoreで再現した。
- **legacy分類**：daily attempt 32、weak drill 2、phoneme state 6、snapshot 13、badge 4、TTS cache 13、error log 12。旧EWMAやbest attemptを新しいdurable evidenceへ変換していない。
- **Storage棚卸し**：`otokagami-staging`はbucket 0、object 0。旧`Otokagami`は非公開bucket 1、object 0。Storage object実体のdownloadは不要であり実施していない。stagingの`tts_cache` 13件は参照先Storageが存在しない状態として再現され、ユーザー録音が自社Storageに保存されている証拠はなかった。
- **秘密・個人情報保護**：暗号化コンテナの正規artifactに対し、private key marker、service role、Azure、OpenAI、RevenueCat等のsecret pattern検査を行い0件。staging credentialと両source URLの完全一致検査も先行確認済み。manifest、execution/restore log、台帳にはcredential、source URL、個人データを記録していない。初期診断で接続URL解析の不備によりcredential断片がエラー欄へ混ざる可能性を検出したため、当該証跡は暗号化領域内へ隔離し、以後は標準URL解析と多重秘匿フィルターを使用した。credential rotationの要否は別途判断する。
- **Supabase CLI実行方式**：CLI 2.112.0で各artifactの`db dump --dry-run`を先行実行した。CLI内部Dockerへ安全なprompt入力が転送されない制約と、`--schema auth,storage`生成スクリプトの引用符不備を確認したため、CLI生成スクリプトを保存せず、S6-02専用の公式Supabase Postgres container内で実行した。AuthとStorageは個別に公式生成し、個別artifactを保持したうえで結合artifactも作成した。ホストのraw `pg_dump`だけへの置換、password引数、平文credential fileは使用していない。
- **保持中resource**：2 stack合計22 containerをすべて停止し、稼働中0件。DB volume 2件は約102.7MBと122.2MB、Storage volume 2件は各0Bで、合計4 volumeを保持している。containerの削除は行っていない。専用設定ディレクトリ`/private/tmp/otokagami-s602-staging-20260808`と`/private/tmp/otokagami-s602-legacy-20260808`、各種秘密を含まないhelper、S6-01資源、IPA、SQL Editor autosave queryも削除していない。Docker imageは他stackと共有されるため今回分の専有量は未確定。
- **retention**：暗号化backup、停止container、volume、失敗証跡はStage 10完了時またはユーザーの明示的な削除承認まで保持する。オフサイト・クラウドへの転送は実施していない。
- **Backup/PITR**：S6-01で両projectがFree Plan、scheduled backup利用不可、PITR未契約と確認した状態から、plan、PITR、physical backup、restore設定を変更していない。S6-02では費用ゼロの論理backupだけを作成した。
- **残るリスク**：backupが同一端末内だけ、Hostedとlocalの管理Auth/Storage schema version差、repository migrationのHosted未適用、停止container・volume・暗号化backupによるディスク消費、初期診断に伴うstaging DB credential rotation要否。
- **状態確認方法**：`hdiutil isencrypted`、保存先mode、sparsebundle容量、cleanup識別子で絞った`docker ps -a`と`docker volume ls`、暗号化領域内のmanifestとSHA-256検証logを確認する。コンテナのmountには人間が保持するpassphraseが必要。
- **停止・再開手順**：再開前に同じ2つのproject ID、専用port、22 container、4 volume、remote linkなしを確認する。暗号化コンテナとHosted credentialはそれぞれ人間の安全入力を使い、平文保存しない。
- **削除手順**：削除操作は今回実施していない。実行時にbackup、22 container、4 volume、関連一時ディレクトリ、helper、imageを個別に再列挙し、共有参照、retention、復元不能となる影響を提示したうえで対象ごとの直前承認を確認する。
- **次回確認日**：要確認

## ESC-013：S6-03 v2基礎schemaのlocal検証・staging clone rehearsal・Hosted適用

- **分類**：ローカルDB migration・RLS検証、Hosted additive migration
- **対象端末・サービス**：macOS、Colima/Docker、Supabase CLI 2.112.0、S6-03専用Fresh stack、S6-02 `otokagami-staging` restore volumeの独立clone、Hosted `otokagami-staging`
- **実施日時・最終確認日**：2026-08-09
- **実施者**：ユーザー承認のもとCodex
- **実施状況**：local実装・検証とHosted適用を完了。v2 read/writeは未有効。
- **ステータス**：一時的
- **変更内容**：未適用だった`20260806000000_generalize_practice_difficulty.sql`を非破壊化し、`ja_difficulty` 3列、既存値、`NOT NULL`、check constraintを保持したまま互換default `medium`とlegacy metadata commentを追加した。新しいadditive migration `20260809000000_add_v2_foundation_schema.sql`で`program_enrollments`、`content_versions`、`learning_deletion_epochs`と、対応するconstraint、index、RLS、grant、policy、trusted-write guard function／triggerを追加した。既存行のINSERT、UPDATE、DELETE、backfillは含まない。
- **Fresh検証**：project ID `otokagami-s603-fresh-20260809`、専用port `56820`〜`56829`を使用した。Edge Runtimeはentrypoint不在によるlocal health check失敗を避けるため一時設定だけで無効化し、repository設定は変更していない。全migration、Seed、content Seed test、既存RLS test、新schema test、新RLS正負testが成功した。public tableは21件から24件、policyは50件から53件となり、active/inactive practice itemは6/422を維持、新3 tableは0件、`ja_difficulty` 3列は`NOT NULL`・default `medium`で残存した。
- **Upgrade rehearsal**：S6-02の停止済み`otokagami-s602-staging-20260808` DB／Storage volumeをread-only mountし、project ID `otokagami-s603-upgrade-20260809`、専用port `56920`〜`56929`の新volumeへ複製した。元のS6-02 volumeとstackは起動・reset・変更していない。Hostedと同じmigration 2件の状態から、pending migrationが上記2件だけであることを確認して順番に適用した。
- **前後照合結果**：Auth user 23件と、既存public table 21件の全件数は前後完全一致した。主要件数はprofile 21、installation 21、daily session 13、session item 91、attempt 34、phoneme result 127のまま。orphan、duplicate、status、legacy分類等の品質集計も一致し、既存policy、function、trigger、index、constraintは、追加対象と`ja_difficulty`の互換defaultを除いて完全一致した。新3 tableはすべて0件。既存RLS test、新RLS正負test、content Seed testも成功した。
- **Hosted適用**：ユーザーの直前承認後、`otokagami-staging`へ`20260806000000_generalize_practice_difficulty.sql`（SHA-256 `fdaf1a90e643870b3ad5407611b7e708e04e0011ba220f409c4476efaba78232`）、続いて`20260809000000_add_v2_foundation_schema.sql`（SHA-256 `e431a5993cb2a803070911d5290626b2e8df66a01594b0177dc5e244a9174e85`）だけを、既存migration履歴・v2 table未作成・互換列存在のguardを含む単一transactionで適用した。Seed、reset、backfill、既存行の更新・削除、既存policyの変更は行っていない。migration履歴は公式CLIのlocal適用結果と同じversion、name、statement配列で記録した。
- **Hosted適用後照合**：Hosted migrationは4件となり、Auth user 23件、既存public table 21件の全件数、主要品質集計は適用前と一致した。public tableは24件、policyは53件、新3 tableはすべて0件。`ja_difficulty` 3列は`NOT NULL`、default `medium`、legacy comment付きで保持された。新3 tableのRLS、authenticatedのread-only grant、anon権限なし、service role境界、3 policy、2 guard function、5 trigger、7 index、20 constraintを確認した。既存policyだけのdefinition digestは検証済みupgrade cloneと一致した。Vercel staging APIの`/api/health`は`status=ok`を返した。
- **権限境界**：新3 tableはRLS有効。authenticatedは本人のenrollment／deletion epochとactive contentだけをreadでき、直接INSERT、UPDATE、DELETEできない。anonには権限を付与しない。protected stateのwriteはservice role境界だけに付与し、contentのactive後の意味変更とdeletion epochの巻き戻しをtriggerで拒否する。service role secretやHosted credentialはlocal設定、Git、台帳へ保存していない。
- **コード回帰**：API lintと39 test、Core lint・13 test・build、Mobile lint・26 test・public config buildは成功した。repositoryの通常API buildはmacOS quarantine付きnative addonの`dlopen`待機でbounded中断した。repositoryと元の`node_modules`を変更せず、`/private/tmp/otokagami-s603-api-build-20260809`のAPFS clone内だけで対象native addonのquarantine属性を外した同一source buildは成功し、18 routeを生成した。Stage 5の「quarantine workaroundなしの通常API build」確認は別残件のまま。
- **保持中resource**：Fresh／upgrade各11件のstack containerと、read-only複製用container 2件の計24件を停止状態で保持する。DB／Storage volumeは4件で、Fresh DB約83.51MB、upgrade DB約122.4MB、Storage各0B。関連一時ディレクトリは`/private/tmp/otokagami-s603-fresh-20260809`、`/private/tmp/otokagami-s603-upgrade-20260809`、`/private/tmp/otokagami-s603-api-build-20260809`。S6-01／S6-02のcontainer、volume、backup、IPA、SQL Editor queryは変更・削除していない。
- **接続境界**：承認済み2 migrationだけをHosted `otokagami-staging`へ適用した。Hosted Seed、reset、backfill、既存行の更新・削除、v2 read/write、capability、feature flagは実施・有効化していない。旧`Otokagami` Hosted projectは読み取りも変更も行っていない。
- **想定されるリスク**：停止container・volume・一時API build cloneによるディスク消費、通常API buildのquarantine問題、v2 APIと学習状態schemaが未実装であること。Fresh stackは現在CLI 2.112.0が選択したlocal imageを使用し、S6-02 clone元のDB volumeとは独立している。
- **リスクレベル**：中
- **状態確認方法**：cleanup識別子で絞った`docker ps -a`、`docker volume ls`、`docker system df`、Supabase migration list、DB test、migration SHA-256、Git diffを使用する。Hosted適用前にはtarget alias、pending migration 2件、hash、前後read-only inventoryを再確認する。
- **停止・削除・復旧手順**：24 containerは停止済み。削除は今回実施していない。削除する場合はS6-03識別子、4 volume、3一時ディレクトリを再列挙し、S6-01／S6-02資源との共有がないことを確認して別承認を得る。migration適用後のrollbackは新tableを未使用のまま保持し、v2 writeを有効化せずv1を継続する。新tableを即dropしない。
- **次回確認日**：S6-04開始時

## ESC-014：S6-04 v2学習schemaのlocal検証とstaging clone rehearsal

- **分類**：ローカルDB migration・RLS・所有者整合性検証
- **対象端末・サービス**：macOS、Colima/Docker、Supabase CLI 2.112.0、S6-04専用Fresh stack、S6-03 staging相当DB volumeの独立clone
- **実施日時・最終確認日**：2026-08-09
- **実施者**：ユーザー承認のもとCodex
- **実施状況**：local実装・Fresh検証・最終staging clone rehearsal・承認済みHosted適用まで完了。v2 read/writeは未有効。
- **ステータス**：一時的
- **変更内容**：forward-only migration `20260809010000_add_v2_learning_schema.sql`（SHA-256 `90f6f594748e46b0911602e5d9b21f62f96aef561ea1a968f16a43efc5c64f51`）で、9つのv2学習概念と、reportの根拠を再現する最小2関連tableを追加した。既存S6-03 migrationは編集していない。既存行のINSERT、UPDATE、DELETE、backfill、drop、truncate、rename、Seed変更は含まない。
- **追加対象**：`program_day_sessions`、`program_session_items`、`learning_attempts`、`learning_attempt_results`、`correction_cycles`、`focus_evidence`、`focus_states_v2`、`review_schedules`、`learning_reports`、`learning_report_evidence`、`learning_report_correction_cycles`。`program_enrollments`にはnullableな`first_valid_learning_attempt_id`、trial専用Program Day comment、所有者・有効attempt guardだけをforward追加した。
- **権限境界**：全11 tableでRLSを有効化し、anon権限なし、authenticatedは本人rowのSELECTのみ、直接INSERT／UPDATE／DELETE不可、service roleだけがwrite可能とした。複合foreign keyとguardによりuser／session／item／attempt／evidenceの所有者不一致、無効attemptをretry元またはtrial開始根拠にする操作、guided retryのdurable evidence化を拒否する。
- **Fresh検証**：project ID `otokagami-s604-fresh-20260809`、専用port `58320`〜`58329`で全migration、Seed、content Seed test、既存v1 RLS、S6-03 foundation、S6-04 schema／RLS testを実行した。public tableは24件から35件、policyは53件から64件となり、既存Seed件数を維持し、新11 tableとS6-03の3 tableは0件。Supabase DB lintはerror 0件。
- **Upgrade rehearsal**：停止済みS6-03 staging相当DB volumeをread-only mountし、最終project ID `otokagami-s604-upgrade-final-20260809`、専用port `59420`〜`59429`の独立volumeへ複製した。pendingがS6-04 migration 1件だけであることを確認して適用した。元のS6-03 volume、S6-02証拠環境、Hosted DBは変更していない。
- **Hosted適用**：ユーザーの直前承認後、SHA-256 `90f6f594748e46b0911602e5d9b21f62f96aef561ea1a968f16a43efc5c64f51`の`20260809010000_add_v2_learning_schema.sql`だけを、baseline guard・migration履歴・postconditionを含む単一transactionでHosted `otokagami-staging`へ適用した。最初のread-only preflight入力1回はSQL Editorの長文途中置換による構文解析エラーとなり、transaction開始前でDB変更はなかった。内容全体とhashを照合した後の適用は成功した。
- **Hosted適用後照合**：read-only transactionでAuth user 23件、既存24 tableの全件数、既存53 policyのdefinition digest `8fb4bff0491f27031767504bd990f513`が適用前と一致した。public tableは35件、policyは64件となり、新11 tableはすべて0件。新11 tableのRLS、authenticatedのread-only grant、authenticated write grant 0件、anon grant 0件、service-role write境界、11 policy、4 guard function、9 trigger、15 explicit index、nullableな初回有効attempt参照を確認した。migration履歴には`20260809010000`だけが追加された。
- **v1確認**：Vercel Production APIの`/api/health`は200かつ`status=ok`。未認証の`/api/access-status`とPOST `/api/bootstrap`は401を維持した。認証済み実機経路はStage 7の受入へ統合し、解決済みとは扱わない。
- **Local clone前後照合結果**：Auth user 23件、既存public 24 tableの全件数、既存53 policy digest、S6-04追加対象を除く既存column／constraint digest、orphan／duplicate／status品質集計が前後一致した。既存policy digestは`2e1df26d599809e7029aafeaef2b10f7`、既存column digestは`abecf0992ff92493a1feafab1247d3d3`、既存constraint digestは`d989666303d997ba177f997bdd5f35b2`で不変。新11 tableは0件で、migration履歴へ`20260809010000`だけが増えた。
- **回帰結果**：API lint・39 test、Core lint・13 test・build、Mobile lint・26 test・public config buildに成功。repository通常API buildは既知のmacOS quarantine付きnative addon待機でbounded中断し、S6-03の同一API sourceである隔離clone（source差分0件）では18 routeのbuildに成功した。通常API buildの問題は解決済みとは扱わない。
- **Docker復旧**：3つのS6-04 stackが同時起動した際、4GiBのColima VMでDocker daemonが無応答となった。container／volumeを削除せずColimaをforce stop後に同じinstanceで再起動し、検証済みFresh／中間upgrade stackを停止して最終cloneだけで照合を完了した。ColimaのCPU／memory／disk設定、image、volume、外部設定は変更していない。
- **保持中resource**：S6-04識別子のcontainer 33件はすべて停止。DB volumeはFresh約86.49MB、中間upgrade約124.7MB、最終upgrade約124.3MB、Storage volume 3件は各0Bで、合計6 volumeを保持している。関連一時ディレクトリは`/private/tmp/otokagami-s604-fresh-20260809.O4iirZ`、`/private/tmp/otokagami-s604-upgrade-20260809.rycVDy`、`/private/tmp/otokagami-s604-upgrade-final-20260809.8CKUFt`。初回copy containerのentrypoint不備による失敗1件と、中間rehearsal資源も削除せず保持した。
- **接続境界**：承認済みS6-04 migrationだけをHosted `otokagami-staging`へ適用した。v2 API、Mobile、planner、状態遷移計算、capability、read/write有効化は未実装・未有効。旧`Otokagami` Hosted projectへ接続・変更していない。Hosted Seed、reset、backfill、既存行更新、既存policy変更、RevenueCat、Azure、EAS、TestFlight、App Store、Production deploymentは行っていない。SQL Editorのprivate autosave queryは秘密を含まないpreflight／migration／postflight内容へ更新され、削除していない。
- **想定されるリスク**：停止container／volume／一時ディレクトリによるディスク消費、複数Supabase stack同時起動によるColima 4GiB環境の過負荷、通常API buildのquarantine問題、S6-03残件、Hosted上の新schemaが後続実装まで未使用であること。
- **リスクレベル**：中
- **状態確認方法**：cleanup識別子で絞った`docker ps -a`、`docker volume ls`、`docker system df -v`、migration SHA-256、Supabase migration list、DB test、Git diffを使用する。複数stackを同時起動せず、対象project IDと専用portを事前確認する。
- **停止・削除・復旧手順**：全S6-04 containerは停止済み。削除は今回実施していない。削除する場合は33 container、6 volume、3一時ディレクトリを再列挙し、S6-01〜S6-03資源との共有がないことを確認して別承認を得る。Hosted適用後のrollbackは新schemaを未使用のまま保持し、v2をoff、v1を継続する。新tableを即dropしない。
- **次回確認日**：S6-05開始前

## ESC-015：S6-05〜07 Core/API v2とtrusted transaction境界のlocal検証

- **分類**：ローカルDB migration・RPC・RLS・API統合検証
- **対象端末・サービス**：macOS、Colima/Docker、Supabase CLI 2.112.0、S6-05〜07専用Fresh stack、S6-04 staging相当DB volumeの独立clone、通常npm workspace
- **実施日時・最終確認日**：2026-08-09
- **実施者**：ユーザー承認のもとCodex
- **実施状況**：local実装、Fresh検証、最終staging clone rehearsal、承認済みHosted migration適用と前後照合まで完了。v2 modeは既定`off`のまま。
- **変更内容**：forward-only migration `20260809020000_add_v2_runtime_boundary.sql`（SHA-256 `ed7502b71617c1afbd3a10460eba55761ba69ba697b9800158d62197dc970244`）でv2 managed item snapshot、server-verified attempt、immutable／JSON allowlist guard、service-role専用の日次session作成・review枠更新・attempt保存・Program Day完了RPCを追加した。既存行のDML、drop、truncate、rename、backfill、Seed変更は含まない。Core v2は正式なESM runtime packageとしてemitし、新規`/api/v2`はserver-only `OTOKAGAMI_V2_MODE`未設定時にfail closedする。
- **Fresh検証**：project ID `otokagami-s607-fresh-20260809`、専用port `59320`〜`59329`で全migration、Seed、content Seed、既存v1 RLS、S6-03／04、S6-05〜07 schema／RLS／RPC testを実行した。attempt同時再送2件はcanonical attempt／result各1件へ収束し、Supabase DB lintはerror 0件。
- **Upgrade rehearsal**：停止済みS6-04 staging相当DB volumeをread-only sourceとして、承認候補の最終clone `supabase_db_otokagami-s607-upgrade-approval-20260809`（port `59542`）へ複製し、対象migration 1件だけを単一transactionで適用した。Auth 23件、既存public 35 tableの全件数、64 policyのdefinition digest、orphan集計は前後一致し、新v2 rowは0件、migration ledgerのlatestは`20260809020000`となった。中間clone `supabase_db_otokagami-s607-upgrade-20260809`と先行最終clone`supabase_db_otokagami-s607-upgrade-final-20260809`も証拠として保持する。
- **回帰結果**：Core lint・44 test・build・Node ESM import、API lint・50 test・通常workspaceでのNext.js production build、Mobile lint・26 test・public config buildに成功した。Next.jsは公式WASM fallbackを使用する`--webpack` buildで、隔離cloneやquarantine属性変更を必要としなかった。root checkは同じCore/API/Mobile成功後、既知のPython inference unittest停止をboundedに終了したため全体成功とは扱わない。inference lint／buildは成功した。
- **保持中resource**：S6-07識別子のcontainer 15件をすべて停止状態で保持する。volumeはFresh DB約80.72MB、Storage 0B、中間clone DB約124.3MB、先行最終clone DB約124.3MB、承認候補clone DB約124.3MBの5件。Fresh stackの主要container論理書込はRealtime約10.4MB、その他は小容量。最終clone作成時に`alpine:3.22` imageを取得した。関連資源は削除していない。
- **Hosted適用**：ユーザーの直前承認後、SHA-256 `ed7502b71617c1afbd3a10460eba55761ba69ba697b9800158d62197dc970244`の`20260809020000_add_v2_runtime_boundary.sql`だけを、baseline guard、migration ledger更新、postconditionを含む単一transactionでHosted `otokagami-staging`へ適用した。既存行へのDML、Seed、reset、backfill、drop、truncate、renameは行っていない。
- **Hosted適用後照合**：read-only transactionでAuth user 23件、public 35 tableの全exact件数、64 policyと同一queryによるdefinition digest `c104521050debfae2d43eda4563b92a1`が適用前後で一致した。新v2 rowは0件。追加10 column、11 trigger、4 RPCを確認し、4 RPCの`anon`／`authenticated`実行権限は0件、`service_role`実行権限は4件。migration ledgerのlatestは`20260809020000`、nameは`add_v2_runtime_boundary`となった。
- **v1確認**：Vercel Production APIの`/api/health`は200かつ`status=ok`、未認証の`/api/access-status`は401を維持した。認証済み実機経路はStage 7の受入へ統合し、解決済みとは扱わない。
- **接続境界**：変更したHosted Supabaseは`otokagami-staging`の上記additive schemaだけ。旧`Otokagami`、Vercel環境変数、v2 mode、Azure、RevenueCat、EAS、TestFlight、App Store、Productionは変更していない。
- **想定されるリスク**：停止container／volume／imageによるディスク消費、Python旧inference test停止、v2公開教材と製品policyが未設定のため学習経路をまだ有効化できないこと。複数Supabase stackの同時起動はColima 4GiB環境の過負荷につながる。
- **リスクレベル**：中
- **状態確認方法**：`docker ps -a`、`docker volume ls`、`docker system df -v`をS6-07識別子で絞り、migration SHA-256、Fresh／clone DB test、Core/API/Mobile check、Git diffを確認する。
- **停止・削除・復旧手順**：S6-07 containerは停止済み。削除は実施していない。削除時は15 container、5 volume、関連一時ディレクトリとimage共有関係を再列挙し、別承認を得る。Hosted適用後のrollbackはv2 modeを`off`に保ち、新objectを未使用のまま残してv1を継続し、即dropしない。
- **次回確認日**：S6-08開始前

## ESC-016：S6-07 Azure判定trust boundaryのlocal検証とstaging clone rehearsal

- **分類**：ローカルDB migration・RPC・RLS・APIセキュリティ検証
- **対象端末・サービス**：macOS、Colima/Docker、Supabase CLI 2.112.0、S6-07専用Fresh stack、S6-05〜07 staging相当DB volumeの独立clone、通常npm workspace
- **実施日時・最終確認日**：2026-08-10
- **実施者**：ユーザー承認のもとCodex
- **実施状況**：local実装、Fresh検証、staging clone rehearsal、承認済みHosted適用と前後照合まで完了。Vercel Productionへv2コードは未配布で、v2 learningは未有効。
- **変更内容**：forward-only migration `20260810000000_harden_v2_assessment_boundary.sql`（SHA-256 `32b160f744bb7e7cc3fa0c59d3ddd7abd8e3ea70e04281f45de824601ddad225`）で、管理課題と正規化条件を束縛する一回限りのassessment ticket、厳格なsubscription確認、保護対象の直接変更を拒否するguard、service-role専用secure RPC、deletion epochの単調増加、trial／Program Dayの単調更新を追加した。Azure provider payloadはrequest処理中だけallowlist normalizerへ渡し、音声、端末URI、token、生JSONは保存しない。`server_normalized`とprovider attestationを区別し、provider attestationは未実装のためfalseのままとする。
- **Fresh検証**：project ID `oto-s607-final`、専用port `59920`〜`59929`で全migration、Seed、content Seed、既存v1 RLS、S6-03／04、runtime、S6-07 schema／RLS／RPC security testを実行した。public table 36件、policy 64件、新`assessment_tickets` 0件。並行attempt再送2件はcanonical attempt／result各1件、消費済みticket 1件へ収束し、一方が新規・他方がidempotent replayとなった。Supabase DB lintはerror 0件。
- **Upgrade rehearsal**：停止済みstaging相当source volumeを変更せず、独立container `supabase_db_oto-s607-hardening-upgrade-20260810`（port `60022`）へ複製し、対象migration 1件だけを単一transactionで適用した。Auth user 23件、既存35 tableの全exact件数、policy 64件とdefinition digest `6c5a84fadbb5064a22d56ad0da1f3efc`、主要orphan／duplicate／status集計、新v2 row 0件が前後一致した。public tableだけ35件から36件へ増え、`assessment_tickets`は0件。元volumeとHosted DBは変更していない。
- **Hosted適用**：ユーザーの直前承認後、SHA-256 `32b160f744bb7e7cc3fa0c59d3ddd7abd8e3ea70e04281f45de824601ddad225`の`20260810000000_harden_v2_assessment_boundary.sql`だけを、baseline guard、migration ledger、postconditionを含む単一transactionでHosted `otokagami-staging`へ適用した。既存行へのDML、Seed、reset、backfill、drop、truncate、renameは行っていない。適用直後のpostflight入力1回はSQL Editorが直前の長文guardを一部残したため、既適用baselineを検知して変更前に停止した。その後、editor全体をread-only queryへ置換して照合した。追加のmetadata queryは初回に構文エラーとなったが、transaction開始前でDB変更はなく、修正したread-only queryで完了した。
- **Hosted適用後照合**：read-only transactionでAuth user 23件、既存35 tableの全exact件数、policy 64件と同一queryによるdefinition digest `6771c7e158b6d2a4c780a9ae836f597f`が適用前後一致した。public tableは36件、migration latestは`20260810000000`、新`assessment_tickets`は0件、v2 runtime row合計0件。追加10 column、RLS有効、client table privilege 0件、secure RPC 5件へのclient execute 0件・service-role execute 5件、旧RPCへのservice-role execute 0件、guard trigger名15件、明示index 2件を確認した。
- **v1／v2確認**：Vercel Production APIの`/api/health`は200かつ`status=ok`、未認証の`/api/access-status`は401を維持した。現在のProduction deploymentにはv2 routeがまだ含まれず`/api/v2/bootstrap`は404であるため、v2 learningは利用不能・未有効。Vercel環境変数とdeploymentは変更していない。
- **回帰結果**：Core lint・46 test・build・Node ESM import、API lint・56 test・通常workspace Next.js build、Mobile lint・26 test・public config build、root lint・root buildに成功した。Python inference lint／buildは成功したが、既存unittestは境界時間を超えて停止したため成功扱いにしていない。S6-07の新v2経路はruntime Python／OpenAI／Piperを使用しない。
- **Colima容量変更**：Fresh reset中にColima VMの20GiB diskが100%となり`No space left on device`で停止した。ホスト側に約497GiBの空きがあることを確認し、container／volume／imageを削除せずColimaを停止後、disk上限だけを20GiBから40GiBへ非破壊拡張した。再起動後はVM内で約19GiBの空きを確認し、同じmigrationとtestを再実行して完走した。CPU／memory設定と外部サービス設定は変更していない。
- **保持中resource**：今回のFresh stack 11 containerとclone DB container 1件はすべて停止済み。専用volumeはFresh DB約87.92MB、Storage 0B、clone DB約124.8MBの3件を保持している。途中の失敗／先行検証stack、S6-01〜S6-06資源、backup、image、一時ファイルは削除していない。
- **接続境界**：変更したHosted Supabaseは`otokagami-staging`の上記additive schemaだけ。旧`Otokagami`、Vercel環境変数、Azure、RevenueCat、EAS、TestFlight、App Store、Productionは変更していない。v2 code／modeは未配布・未有効。
- **想定されるリスク**：provider attestation未実装、製品policyとactive教材未設定、既存Python inference unittest停止、停止container／volume／imageによるディスク消費、Colima disk上限拡張による将来の最大使用量増加、Hosted上の新schemaが後続実装まで未使用であること。
- **リスクレベル**：中
- **状態確認方法**：migration SHA-256、Fresh／clone DB test、`docker ps -a`、`docker volume ls`、`docker system df -v`、`colima status`、Core/API/Mobile check、Git diffを確認する。
- **停止・削除・復旧手順**：今回の12 containerは停止済み。削除は実施していない。削除時は対象container、3 volume、関連一時ディレクトリ、共有imageを再列挙し、別承認を得る。Hosted適用後のrollbackはv2 modeを`off`に保ち、新objectを未使用のまま残してv1を継続し、即dropしない。
- **次回確認日**：S6-08開始前

## ESC-017：S6-07.1／S6-08／Stage 7 local実装とstaging clone rehearsal

- **分類**：ローカルDB migration・atomic data lifecycle・Mobile端末保存境界の検証
- **対象端末・サービス**：macOS、Colima/Docker、Supabase CLI 2.112.0、専用Fresh local Supabase、S6-07 staging復元volumeの独立clone、npm workspace
- **実施日時・最終確認日**：2026-08-10
- **実施者**：ユーザー承認のもとCodex
- **実施状況**：local実装、Fresh検証、staging復元clone upgrade rehearsal、承認済みHosted migration適用と前後照合まで完了。Azure有料実機fixture、EAS/TestFlight、v2 mode有効化は未実施。
- **DB変更**：forward-only migration `20260810010000_harden_v2_data_lifecycle.sql`（SHA-256 `3310666a60c8cc6587d38c2ad2dda625f731ce7b692ec3c4f48dec17f090d855`）を作成・適用した。capture/submission期限、review snapshot binding、correction cycle整合、user共通lock、service-role専用ticket/attempt/review/session/export/delete RPC、legacy delayed write barrier、`review_completion_receipts`、`learning_deletion_requests`を追加した。top-levelの既存行DML、drop、truncate、rename、backfill、Seed変更は含まない。
- **Fresh検証**：project ID `otokagami-stage7-fresh-20260810`、専用port `60320`〜`60329`で全migrationとSeedをfresh resetし、content Seed、既存/new RLS・schema・RPC・assessment・lifecycle SQL test、同一attempt並行再送、同一delete request並行再送、DB lintを完走した。初回起動は不要なEdge Runtimeのhealthで停止したため、使い捨て設定だけでEdge Runtimeを無効化して再開した。失敗を成功扱いにせず、最終DB検証は再起動後に実施した。
- **Upgrade rehearsal**：read-only source volume `supabase_db_oto-s607-hardening-upgrade-20260810`を変更せず、独立volume/container `supabase_db_oto-stage7-upgrade-r2-20260810`（port `60432`）へ複製した。migrationをledger更新と同じtransactionで1件だけ適用し、Auth user 23件と既存public 36 table全件数が前後一致した。public tableは38件、policyは64件から65件、新2 tableは適用直後0件。既存table件数の差分は0件で、全SQL testとattempt/delete並行testも成功した。初回clone `supabase_db_oto-stage7-upgrade-20260810`は最終照合証拠に採用せず、再試行用`r2`と区別して停止保持している。
- **Mobile／API境界**：SDK 57互換の`expo-sqlite`を導入し、Application SupportのSQLite outbox、SecureStore nonce handle、single-lease worker、ACK消失再送、deletion barrier、代表before/after音声indexを実装した。専用iOS moduleはApplication Support、backup除外、file protection、opaque file keyを設定する。これらのiOS属性、マイク、background、network復帰は実機未確認。音声、URI、token、Authorization、raw Azure JSONはSQLite/API/DB/exportへ保存しない設計と自動検査を追加した。
- **コード検証**：Core 49 test、API 64 test、Mobile 44 testが成功。Core/API/Mobile/inference lint、Core ESM import、通常Next.js build、Mobile public config build、root lint/buildが成功した。root testはCore/API/Mobile成功後、既知のPython inference unittest停止をboundedに中断したため全体成功とは扱わない。Supabase SQL testは10ファイルをFresh/clone双方で実行し、並行attempt/deleteも双方で成功した。
- **保持中resource**：Fresh stack container 8件、upgrade DB container 2件、volume-copy container 2件の計12件を停止状態で保持する。専用volumeはFresh DB約81.41MB、Fresh Storage 0B、初回upgrade clone DB約125.3MB、採用した`r2` clone DB約125.2MBの4件。設定・検証ディレクトリとsanitized logは`/private/tmp`配下へ保持し、既存S6-01〜S6-07資源、backup、imageを含め削除していない。
- **Hosted適用と照合**：ユーザーの直前承認後、上記hashのmigration 1件だけをHosted `otokagami-staging`へ単一transactionで適用した。read-onlyの前後照合でAuth user 23件、既存public 36 tableの全exact件数、既存64 policyのdefinition digest `6771c7e158b6d2a4c780a9ae836f597f`が一致した。public tableは38件、policyは65件となり、新2 tableは0件。追加7 column、11 trigger、14 function名、保護RPCへのclient execute grant 0件・service-role grant 7件、migration ledger 1件を確認した。Hosted Seed、reset、backfill、実ユーザーへの削除RPCは実行していない。
- **接続・外部境界**：変更した外部状態は、承認済みHosted `otokagami-staging` schemaと、branch pushに付随した許可済み非Production Previewだけである。旧`Otokagami`、Vercel code／環境変数、Azure、RevenueCat、EAS、TestFlight、App Storeは変更していない。v2 modeは`off`のまま。
- **想定されるリスク**：実機Azure fixtureに基づくprojection上限/capture/submission/outbox設定未確定、iOS file protection/backup除外と音声lifecycleの実機未確認、正式教材・policy未準備、停止container/volume/imageによるディスク消費、Python inference unittest停止。S6-08.1／Stage 7.1は補修・validation-only統合準備中であり、実機証拠が揃うまで`COMPLETE`または`code-complete`と扱わない。
- **リスクレベル**：中
- **状態確認方法**：migration SHA-256、Fresh/clone SQL test結果、`docker ps -a`、`docker volume ls`、`docker system df -v`、Core/API/Mobile check、Git diff、実機受入記録を確認する。
- **停止・削除・復旧手順**：今回の12 containerは停止済み。削除は実施していない。削除時は対象container、4 volume、関連一時ディレクトリ、共有imageを再列挙し、別承認を得る。Hosted適用後のrollbackはv2 modeを`off`に保ち、新objectを未使用のまま残してv1を継続し、即dropしない。
- **次回確認日**：Stage 7実機Azure／Mobile受入前

## ESC-018：S6-08.1／Stage 7.1実機前統合補修とvalidation-only受入準備

- **分類**：ローカルDB forward migration・validation-only教材・Mobile実機前保存境界の検証
- **対象端末・サービス**：macOS、Colima/Docker、Supabase CLI 2.112.0、専用Fresh local Supabase、S6-07 staging復元volumeの独立clone、npm workspace
- **実施日時・最終確認日**：2026-08-12
- **実施者**：ユーザー承認のもとCodex
- **実施状況**：local補修、Fresh検証、最終staging clone upgrade rehearsal、自動コード検証、承認済みHosted migrationとvalidation-only教材1行の適用・照合まで完了。Preview環境保存、EAS Development Build、Azure実機fixture、iPhone受入は未実施であり、Stage 7.1は完成扱いしない。
- **DB変更**：forward-only migration `20260812000000_harden_v2_device_validation.sql`（SHA-256 `ca9b815ea45a592918b029fa3b69e82f3fb00919a3a43445ee62564c564a19a1`）をHosted `otokagami-staging`へ単一transactionで適用した。ticket request冪等発行・回復・取消、録音開始／provider結果受信／送信時刻、review完了、delete epoch単調応答、append-only ledger、validation-only content／tester／installation隔離、validation session作成・完了RPCを追加した。既存適用済みmigrationは編集していない。
- **Validation教材**：既存Seedの`light`、`right`、`I read it again.`だけから、`r-l`焦点の必須5・任意2課題を構成した。macOS組込み`Samantha`音声をofflineでstandard／slow各3件、合計6 WAVへ生成し、非無音、16-bit mono 16kHz、個別checksum、固定manifestを検査した。`development_validation`専用で、正式human review／Azure validation／active教材、公開104課題・208音声の完成数には含めない。runtime OpenAI／Piper／Pythonは使用しない。
- **Fresh検証**：project ID `otokagami-s6081-fresh-final-20260812`、専用port `60620`〜`60629`で全migrationとSeedを適用した。Edge Runtimeのentrypoint不在によるhealth failureを記録したうえで、使い捨てstackだけ同serviceを除外して再開し、content Seed、既存・新RLS／schema／RPC／assessment／lifecycleのSQL 12件、attempt/deleteの両lock順、DB lintを成功させた。
- **Upgrade rehearsal**：停止済みsource volume `supabase_db_oto-stage7-upgrade-r2-20260810`をread-only copy元とし、独立volume／container `supabase_db_oto-s6081-upgrade-r2-20260812`（port `60533`）へ複製した。最終migrationを単一transactionで適用し、Auth user 25件、既存38 public tableの全件数、既存65 policyのdefinition digest、legacy品質集計が不変であることを確認した。public tableはvalidation access tableの追加だけで39件、新tableは0件。新DB正負testも成功した。
- **Hosted適用後照合**：ユーザーの直前承認後、上記hashのmigration 1件と、固定manifest SHA-256 `84a11917749840d0aca4fb8d096e1f4126d6f56aeca9d2aa0d7f67a713a3d26c`を持つ`development-validation-r-l` version 1の`content_versions`行1件だけをHosted `otokagami-staging`へ適用した。preflight／postflightは`BEGIN READ ONLY`、5秒timeout、`transaction_read_only=on`で実施し、Auth user 23件、既存38 tableのexact件数、policy 65件とdigest `2cac0fbcddfbb9f0d6300b6428912637`が不変だった。public tableはvalidation access tableの追加だけで39件となった。教材行は`draft`／`development_validation`／`validation_only=true`で、正式review／Azure validation／activation timestampはNULL、tester access 0件、validation session 0件である。保護RPC 8本はanon／authenticated実行権限0件、service-role実行権限8件を確認した。Hosted Seed、reset、backfill、実ユーザーデータ削除、v2 mode変更は行っていない。
- **コード検証**：Core 51 test、API 69 test、Mobile 50 test、各lint／build、Core ESM import、通常Next.js build、Expo public config、root lint／build、validation asset検査が成功した。Python inference unittestは既存Python 3.14環境の`pydantic_core` native module欠損で1件ImportErrorとなり、成功扱いにしていない。新v2中心経路はPython runtimeへ依存しない。
- **Mobile境界**：ticket request journal、current-user scope、最大3 valid attempt、必須5／任意0〜2、SQLite ACK後のprotected-material cleanup、再起動復元、offline read-only、atomic deletion barrier、export一時ファイルcleanup、reference／before／after音声lifecycleを実装した。iOS native compileはfull Xcodeがないため未完了で、file protection、backup除外、マイク、background、network復帰、実SQLite lockingはDevelopment Build実機確認待ち。
- **保持中resource**：Fresh stackのDB／API関連containerとvolume、copy container `oto-s6081-volume-copy-r2-20260812`、upgrade clone DB container／volumeを削除せず停止状態で保持する。先行S6-01〜S6-08のcontainer、volume、backup、IPA、SQL Editor query、imageも削除していない。
- **接続・外部境界**：Production code／environment deploymentは行っていないが、稼働中DB `otokagami-staging`のschemaとvalidation-only教材1行には上記の承認済み変更がある。旧`Otokagami`、Vercel環境変数、EAS、Azure、TestFlight、App Store、RevenueCatは変更していない。v2 modeは`off`のままである。
- **想定されるリスク**：validation tester accessが0件でPreview E2Eを開始できない、Development Build user／installation識別未確定、Production用payload／期限／timeout値未確定、iOS実機証拠未取得、停止container／volumeによるディスク消費、Python inference test環境不整合。
- **リスクレベル**：中
- **状態確認方法**：migration／manifest checksum、Fresh／clone SQL test、`docker ps -a`、`docker volume ls`、Core/API/Mobile check、Git diff、Preview/EAS/Azure/実機受入証拠を確認する。
- **停止・削除・復旧手順**：今回の検証containerは停止済みで、削除は未実施。削除時は`otokagami-s6081`／`oto-s6081`識別子のcontainer、volume、一時ディレクトリを再列挙し、先行証拠資源と共有がないことを確認して別承認を得る。Hosted適用後のrollbackはv2／validation flagsを無効のまま保持し、新objectを未使用にしてv1を継続し、即dropしない。
- **次回確認日**：Preview環境保存／EAS／Azureの個別承認前

## 9. 要確認事項

1. **ESC-001（高）**：Vercel ステージング API の Require Log In を再有効化する日時と、外部端末テストを継続する必要性を決める。
2. **ESC-002 / ESC-003**：Vercel プロジェクトの公開範囲、環境変数名、ローカル CLI ログインと `.env.local` の保管要否を確認する。
3. **ESC-004**：次回 staging buildを追加した際も、配布履歴だけで推測せず、配布物または実機log相関で接続先を再確認する。
4. **ESC-006**：macOS の既定入力が BlackHole 16ch、Simulator 入力が BlackHole 2ch である不整合を確認し、テスト完了後に内蔵デバイスへ戻す。
5. **ESC-007**：本日の開発終了時に Metro の LAN 待受を停止するか確認する。
6. **ESC-011**：S6-01用の停止container 11個、保持volume 2個、関連image、一時ディレクトリ、SQL Editor autosave queryをいつ削除するか判断する。削除はすべて別承認とする。
7. **ESC-012**：S6-03の高速化方針により、現時点ではstaging DB password rotation、第二backup、Hosted有料backup/PITRを行わない。停止container 22件・volume 4件・暗号化backupは既定のretentionに従って保持し、削除は別承認とする。
8. **ESC-013**：`otokagami-staging`への承認済み2 migration適用と前後照合は完了した。v2 read/writeは未有効。S6-03の停止container 24件・volume 4件・一時ディレクトリ3件の削除は別承認とする。
9. **ESC-014**：S6-04 local／staging clone検証と承認済みHosted適用は完了し、v2 read/writeは未有効。S6-04の停止container 33件・volume 6件・一時ディレクトリ3件の削除は別承認とする。複数stackの同時起動はColima過負荷を避ける。
10. **ESC-015**：S6-05〜07のlocal／staging clone検証と承認済みHosted migration適用は完了し、v2 modeは`off`のまま。停止container 15件、volume 5件、関連image・一時ディレクトリは保持し、削除は別承認とする。
11. **ESC-016**：S6-07 hardeningはlocal／staging clone検証と承認済みHosted適用まで完了し、v2 code／learningは未配布・未有効。provider attestation、製品policy、active教材は未実装・未設定。停止container 12件、volume 3件とColima 40GiB disk上限を保持し、削除・縮小は別承認とする。
12. **ESC-017**：S6-07.1／S6-08はlocal／staging cloneで検証済みで、承認済みS6-08 Hosted schemaも適用・照合済み。Stage 7は実機Azure fixture、実機Mobile受入、v2 live設定が未完了であり、fixture・自動検証だけで完成扱いしない。停止container 12件、volume 4件、一時ディレクトリの削除は別承認とする。
13. **ESC-018**：S6-08.1／Stage 7.1のlocal補修、validation-only教材、Fresh／clone検証、承認済みHosted schemaと教材1行の適用・照合は完了。tester accessは0件、v2 modeは`off`で、Preview環境、EAS、Azure、iPhone実機証拠は未実施。停止container／volumeの削除は別承認とする。

### 調査範囲と制限

- 本台帳は、リポジトリ内の README・設計書・設定ファイル、現在のワークツリー、ならびにこの Codex セッションで参照できた会話・実行結果を対象にした。
- 過去の全チャット、macOS の完全な操作履歴、外部サービスの監査ログ、OS 権限一覧、各サービスの現在の管理画面状態は完全には参照できない。そのため、確認できない事項は `要確認` とし、推測で実施済みとは記録していない。
- この調査のために権限解除、アンインストール、キー失効、外部連携解除、サービス停止、OS 設定変更は行っていない。

## 10. 点検履歴

| 点検日 | 対象 ID | 実施者 | 結果 |
| --- | --- | --- | --- |
| 2026-07-12 | ESC-001〜ESC-008 | Codex | 初回台帳作成。リポジトリ、現在のセッション、設定ファイルを調査。外部管理画面の現況確認が必要な項目を要確認として登録。 |
| 2026-08-07 | ESC-011 | Codex | Supabase CLI 2.112.0、local migration/Seed/RLS、停止container 11個、保持volume 2個、Colima稼働、両Hosted projectのread-only inventoryとbackup/PITR未契約を確認。削除・Hosted変更は未実施。 |
| 2026-08-07 | ESC-001〜ESC-003 | Codex | Vercel APIの公開到達、ReadyなProduction deployment、`otokagami-staging`へのrouting、ローカルVercel CLIが未ログインであることを確認。Sensitive値と秘密は取得・記録していない。 |
| 2026-08-08 | ESC-004 | Codex | TestFlight 0.1.1 (8)の実機起動直後、`otokagami-staging`に新規Auth log 2件、`Otokagami`に0件を確認。Build 1・8・9の接続先をすべて`otokagami-staging`と確定した。 |
| 2026-08-09 | ESC-012 | Codex | `otokagami-staging`のAES暗号化論理backup、独立local restore、Hosted前後件数、Auth/public data、RLS、checksum 48件を検証。旧`Otokagami`は既存DB password認証失敗で未完了のためS6-02全体を`PARTIAL`とした。22 container停止、4 volume保持、sparsebundle unmountを確認。Hosted write・外部設定変更・削除はなし。 |
| 2026-08-09 | ESC-012 | Codex | 旧`Otokagami`の既存DB passwordを人間が安全入力して再開。read-only backup、独立local restore、Hosted前後件数、Auth/public data、RLS、管理schema差を検証し、両project合計checksum 92件を再確認してS6-02を`COMPLETE`へ更新した。22 container停止、4 volume保持、sparsebundle unmount、Hosted write・外部設定変更・削除なしを再確認。 |
| 2026-08-09 | ESC-013 | Codex | `ja_difficulty`互換migrationとv2基礎schemaを実装。Fresh reset／Seed／既存・新RLS testと、S6-02 staging restoreの独立clone upgradeを完了し、Auth・既存行・既存policy等の不変、新3 table 0件、24 container停止・4 volume保持、Hosted未変更を確認。 |
| 2026-08-09 | ESC-013 | Codex | 明示承認後、確定hashの2 migrationだけをHosted `otokagami-staging`へ適用。Auth 23件と既存21 table件数不変、新3 table 0件、既存policy digest一致、v1 health正常、v2 read/write未有効、旧`Otokagami`未操作を確認。 |
| 2026-08-09 | ESC-014 | Codex | S6-04 v2学習schemaをforward-only実装。Fresh reset／Seed／既存・新RLS testとS6-03 staging相当DBの独立clone upgradeを完了し、Auth 23件、既存24 table件数、既存53 policy・column・constraint digest、品質集計の不変、新11 table 0件、Hosted未変更を確認。 |
| 2026-08-09 | ESC-014 | Codex | 明示承認後、確定hashのS6-04 migrationだけをHosted `otokagami-staging`へ単一transactionで適用。Auth 23件、既存24 table全件数、既存53 policy digestの不変、新11 table 0件、RLS・grant・guard、v1 healthと未認証拒否、v2 read/write未有効、旧`Otokagami`未操作を確認。 |
| 2026-08-09 | ESC-015 | Codex | S6-05安全修正、Core ESM runtime、8本の`/api/v2`、service-role専用RPCを実装。Fresh reset／Seed／既存・新RLS・RPC・並行再送と、S6-04 staging相当DBの独立clone upgradeを完了し、Auth 23件、既存35 table全件数、64 policy digestの不変、新v2 row 0件、container停止・volume保持、Hosted未変更を確認。 |
| 2026-08-09 | ESC-015 | Codex | 明示承認後、確定hashのS6-05〜07 migrationだけをHosted `otokagami-staging`へ単一transactionで適用。Auth 23件、public 35 table全exact件数、64 policy digestの不変、新v2 row 0件、10 column・11 trigger・4 RPCとclient実行拒否、v1 healthと未認証拒否、v2 mode未変更、旧`Otokagami`未操作を確認。 |
| 2026-08-10 | ESC-016 | Codex | S6-07の一回限りassessment ticket、厳格normalizer、secure RPC、immutable guardをforward-only実装。Fresh reset／Seed／RLS／RPC／並行再送とstaging相当の独立clone upgradeを完了し、Auth 23件、既存35 table全件数、64 policy digest、品質集計の不変、新table 0件、Hosted未変更を確認。Colima diskは資源削除なしで20GiBから40GiBへ拡張し、検証後の12 containerを停止、3 volumeを保持した。 |
| 2026-08-10 | ESC-016 | Codex | 明示承認後、確定hashのS6-07 migrationだけをHosted `otokagami-staging`へ単一transactionで適用。Auth 23件、既存35 table全件数、64 policy digestの不変、新table／v2 runtime row 0件、RLS・client拒否・secure RPC・guard、v1 healthと未認証拒否を確認した。Vercel Productionはv2 route未配布で404のためv2 learning未有効、旧`Otokagami`未操作。 |
| 2026-08-10 | ESC-017 | Codex | S6-07.1 normalizer/HTTP hardening、S6-08 atomic export/delete、Stage 7 Mobile/SQLite/audio基盤を実装。Fresh/clone双方で全SQL、RLS/RPC、attempt/delete並行収束を検証し、Auth 23件・既存36 table件数不変、新2 table 0件、Hosted未変更を確認した。12 container停止、4 volume保持、v2 mode `off`。 |
| 2026-08-10 | ESC-017 | Codex | 直前承認後、確定hashのS6-08 migration 1件だけをHosted `otokagami-staging`へ適用。Auth 23件、既存36 table全件数、既存64 policy digestが不変、新2 table 0件、clientの保護RPC grant 0件を確認。実データ削除、v2有効化、Production code/env配信、旧project操作は未実施。 |
| 2026-08-12 | ESC-018 | Codex | S6-08.1／Stage 7.1のticket/review/delete/epoch、validation-only教材、Mobile SQLite/outbox/audioを補修。最終Fresh migration・Seed・SQL 12件・DB lint・attempt/delete両lock順と独立clone upgradeを完了し、Auth 25件、既存38 table件数、65 policy digestの不変を確認。Hosted・Preview環境・EAS・Azure・実機受入は未実施。 |
| 2026-08-12 | ESC-018 | Codex | 直前承認後、確定hashのS6-08.1 migration 1件とvalidation-only教材1行だけをHosted `otokagami-staging`へ単一transactionで適用。Auth 23件、既存38 table全exact件数、policy 65件/digest不変、tester access 0件、validation session 0件、保護RPCのclient実行0件を確認。実ユーザーデータ削除、v2有効化、Production code/env配信、旧project操作は未実施。 |
