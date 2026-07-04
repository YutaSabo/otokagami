# Phase 10: モバイル基盤UI

## 運用ルール

- ユーザーが「Phase 10 の指示書をもとに作業してください」と指示したら、この指示書を根拠に開発を開始する。
- この指示書に書かれた内容がすべて完了したら、Phase 10 は完了とし、作業を終了する。勝手に Phase 11 へ進まない。
- 次の Phase は、ユーザーが改めて実行を依頼したときに開始する。
- iPhone専用MVPとして実装する。Android、iPad専用UI、Webは対象外。
- 実際のAPIキー、トークン、秘密鍵、service role keyをチャットやコミットに出さない。

## ゴール

Expo iPhoneアプリの基盤UI、匿名認証、bootstrap、下タブ、オンボーディング、ホーム、課金ウォール、設定の基本表示を実装する。Phase 10 完了時点では、iPhoneでアプリを起動し、匿名ユーザー初期化、無料期間/Pro状態の取得、主要タブ遷移、練習開始前の課金ウォール判定が確認できる。

## 前提条件

- Phase 1とPhase 6が完了している。
- Next.js APIがローカルで起動できる。
- 参照設計書:
  - `docs/specs/02_MVP_SCOPE.md`
  - `docs/specs/03_UX_SPEC.md`
  - `docs/specs/07_API_SPEC.md`
  - `docs/specs/08_ARCHITECTURE.md`
  - `docs/specs/09_PRIVACY_BILLING_SECURITY.md`

## スコープ

含む:

- Expo dev client/prebuild前提のモバイル基盤。
- Supabase anonymous auth。
- `/api/bootstrap` 呼び出し。
- RevenueCat SDK初期化の土台。
- 下タブ4画面。
- 最小オンボーディング。
- ホーム基本表示。
- 課金ウォール基本表示。
- 設定基本表示。
- オフライン/エラーの最小表示。

含まない:

- 録音/判定フロー本実装。
- 進捗グラフ本実装。
- 自由入力UI本実装。
- 通知、削除、書き出しの完成実装。
- RevenueCat sandbox購入E2E。

## 作業タスクリスト

1. Expoアプリ構成を確認
   - `apps/mobile` を対象にする。
   - Expo + dev client/prebuild前提で実装する。
   - iPhoneのみを対象にし、Android固有実装を追加しない。

2. 環境変数を接続
   - Expo公開変数だけを使う。
     - `EXPO_PUBLIC_SUPABASE_URL`
     - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
     - `EXPO_PUBLIC_API_BASE_URL`
     - `EXPO_PUBLIC_REVENUECAT_IOS_PUBLIC_SDK_KEY`
   - Azure、OpenAI、Supabase service role、RevenueCat secret、Python service API keyをExpo側に置かない。

3. Supabase anonymous authを実装
   - 初回起動時に匿名ユーザーを作成する。
   - アクセストークンをNext.js APIの `Authorization: Bearer` に使う。
   - メール登録やAppleログインは要求しない。

4. bootstrapを実装
   - `/api/bootstrap` を呼ぶ。
   - `timezone`、Keychain等に保存した `device_install_id`、`app_version` を送る。
   - `device_install_id` は再インストール耐性のある端末識別補助IDとして扱う。
   - profile、trial状態、Pro状態をアプリ状態に保存する。

5. 下タブを実装
   - ホーム。
   - 進捗。
   - 練習。
   - 設定。
   - 下タブは原則常時表示する。

6. オンボーディングを実装
   - アプリの目的を1〜2画面で示す。
   - 7日間は無料で使えることを示す。
   - 自由入力はPro限定であることを示す。
   - 8日目以降はPro登録が必要であることを示す。
   - 通知許可は初回起動直後に求めない。

7. ホーム基本表示を実装
   - アプリ名。
   - 現在のストリーク。
   - 今日の進捗 `n / 7`。
   - 大きなスタートボタン。
   - 7個完了後の完了状態。
   - 今日の7個一覧は表示しない。

8. 課金ウォール基本表示を実装
   - 8日目以降かつPro無効で、練習開始前に表示する。
   - 月額580円、年額4,980円を表示する。
   - Pro登録ボタン、購入復元ボタン、利用規約/プライバシーポリシーリンクを置く。
   - Appleイントロオファーは訴求しない。
   - 閉じた場合、練習は開始しない。

9. 設定基本表示を実装
   - プラン状態。
   - Pro登録。
   - 購入復元。
   - 母国語: 日本語。
   - 目標アクセント: US。
   - UK: 準備中または無効表示。
   - 再生速度。
   - プライバシー/利用規約リンク。
   - アプリ情報。
   - 削除、書き出し、通知はPhase 12で完成させる。

10. エラー/オフライン基本表示を実装
   - オフライン時は練習開始不可。
   - RevenueCat取得失敗時は購読状態を確認できない旨を表示する。
   - API失敗時は再試行導線を出す。

## 動作確認手順

- Expo dev clientでiPhone上またはiOS Simulator上に起動する。
- 新規匿名ユーザーで `/api/bootstrap` が成功する。
- ホーム、進捗、練習、設定タブを移動できる。
- ホームに7問一覧が表示されない。
- `free_trial_started_at` を8日前相当にした状態で練習開始時に課金ウォールが出る。
- 課金ウォールを閉じると練習が開始されない。
- Expoバンドルにサーバー専用キーが含まれていないことを確認する。

## 完了条件チェックリスト

- [ ] Expo iPhoneアプリが起動する。
- [ ] Supabase anonymous authが動く。
- [ ] `/api/bootstrap` が呼ばれてprofile/access状態を取得できる。
- [ ] 下タブ4画面が存在する。
- [ ] ホーム基本表示が仕様通りで、7問一覧を表示しない。
- [ ] 課金ウォール基本表示と閉じた時の制御が動く。
- [ ] 設定基本表示がある。
- [ ] Expo側にサーバー専用キーを置いていない。
- [ ] Phase 11に進まず、作業を終了できる。

## セルフレビュー観点

- `docs/specs/03_UX_SPEC.md` の初回起動、ホーム、課金ウォール、設定と矛盾していない。
- Phase 10だけでアプリ起動から基盤UI確認まで完結できる。
- 完了条件が実機/SimulatorとAPIレスポンスで客観的に確認できる。
