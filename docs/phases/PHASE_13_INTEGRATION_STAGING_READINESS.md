# Phase 13: 統合/ステージング準備

## 運用ルール

- ユーザーが「Phase 13 の指示書をもとに作業してください」と指示したら、この指示書を根拠に開発を開始する。
- この指示書に書かれた内容がすべて完了したら、Phase 13 は完了とし、作業を終了する。勝手に本番環境作成やリリースへ進まない。
- 本番環境作成、本番リリース、App Store提出はユーザーの明示承認後に別作業として行う。
- ステージング環境での主要E2E確認は、このPhaseの完了条件に含める。
- 実際のAPIキー、トークン、秘密鍵、service role keyをチャットやコミットに出さない。

## ゴール

MVPをTestFlight配布前に確認できる品質状態へ持っていく。Phase 13 完了時点では、ローカル受け入れ基準、外部API実接続、RevenueCat sandbox、セキュリティ、音声非保存、ステージング環境での主要E2Eが確認済みで、残課題が明示されている。

## 前提条件

- Phase 1〜12が完了している。
- ローカルでMVP画面一式が動く。
- ユーザーがステージング環境作成に必要なアカウント/プロジェクトの準備を承認している。
- 参照設計書:
  - `docs/specs/02_MVP_SCOPE.md`
  - `docs/specs/07_API_SPEC.md`
  - `docs/specs/08_ARCHITECTURE.md`
  - `docs/specs/09_PRIVACY_BILLING_SECURITY.md`
  - `docs/specs/10_TEST_PLAN.md`

## スコープ

含む:

- 全テストの整理と実行。
- Azure実接続確認。
- Piper TTS確認。
- OpenAI助言フォールバック確認。
- RevenueCat sandbox購入/復元確認。
- Supabase RLS/Storage/音声非保存確認。
- ステージング候補構成でのデプロイ準備。
- ステージング環境での主要E2E確認。
- TestFlight前チェックリスト作成。

含まない:

- 本番環境の作成。
- App Store提出。
- 本番課金商品の確定/提出。
- Phase 2機能の実装。

## 作業タスクリスト

1. ローカル総合テストを実行
   - ルートのlint/testを実行する。
   - DB/RLSテストを実行する。
   - API統合テストを実行する。
   - モバイルE2Eまたは手動E2Eを実行する。
   - 失敗があれば、このPhaseの範囲で修正する。

2. 外部API実接続を確認
   - `.env` の必要変数がローカルで埋まっていることを確認する。値はチャットに書かない。
   - Azure Speech:
     - 短い音声で発音評価が成功する。
     - 音声本体を保存していない。
   - Piper:
     - normal/slowのTTS生成とキャッシュが成功する。
   - OpenAI:
     - 未知ケース助言整形のフォールバックが動く。
     - 頻出混同ペアではテンプレ助言を優先し、毎回OpenAIを呼ばない。
   - RevenueCat:
     - sandbox購入。
     - 購入復元。
     - webhookによる `subscriptions` 更新。

3. セキュリティ確認を実行
   - `.env`、`.env.local`、`.env.*` がGit管理されていない。
   - `.env.example` が最新でコミット対象。
   - Expoバンドルにサーバー専用キーが含まれていない。
   - Azure/OpenAI/Supabase service role/RevenueCat secret/Python service API keyがExpo側にない。
   - APIレスポンス、error_logs、アプリログに秘密値が出ていない。
   - RevenueCat webhookが認証されている。
   - Python推論サービスが内部APIキーで保護されている。

4. 音声非保存を確認
   - ユーザー音声がサーバーの永続ストレージに残っていない。
   - Supabase Storageにユーザー音声が保存されていない。
   - DBにユーザー音声ファイルパスや音声base64が保存されていない。
   - お手本音声だけがTTSキャッシュとして保存されている。

5. データ管理を確認
   - 学習データ削除で対象テーブルのデータが削除される。
   - 端末ローカル録音も削除される。
   - 無料期間起点と購読状態は削除されない。
   - JSON書き出しに音声ファイルや秘密情報が含まれない。

6. ステージング環境を準備
   - 本番ではなくステージングとして準備する。
   - 候補構成:
     - Next.js API: Vercel等。
     - Python推論サービス: Fly.ioまたはRender等。
     - Supabase: hosted staging project。
   - ステージング環境変数を設定する。
   - 本番キーとステージングキーを混同しない。
   - ユーザーの承認なしに本番環境作成へ進まない。

7. ステージングE2Eを実行
   - TestFlight配布前提の確認として、ステージングAPI、ステージングPython推論サービス、ステージングSupabaseで主要E2Eを通す。
   - 必須E2E:
     - 新規匿名ユーザー開始。
     - デイリー7問完走。
     - 2段IPA表示。
     - 詳細から直し方へ遷移。
     - 8日目課金ウォール。
     - RevenueCat sandbox Pro有効化。
     - 自由入力同意と判定。
     - 自由入力が進捗に混ざらない。
     - 学習データ削除。
     - JSON書き出し。

8. TestFlight前チェックリストを作成
   - 実行したテストと結果を記録する。
   - 未解決の残課題を分類する。
     - TestFlight前ブロッカー。
     - TestFlight後でもよい改善。
     - MVP対象外。
   - 追加でユーザー承認が必要な項目を明記する。

## 動作確認手順

- `docs/specs/10_TEST_PLAN.md` のリリース前チェックリストを順に確認する。
- ローカルとステージングの両方で主要E2Eを実行する。
- ステージングでデイリー完走、課金ウォール、自由入力、データ削除が成功することを確認する。
- 秘密値、音声保存、RLS、RevenueCat webhook、Python内部APIキーのセキュリティ確認を行う。
- 結果をドキュメントまたはPR本文にまとめる。

## 完了条件チェックリスト

- [ ] ローカルのlint/test/DB/API/E2E確認が完了している。
- [ ] Azure実接続確認が完了している。
- [ ] Piper TTS生成とキャッシュ確認が完了している。
- [ ] RevenueCat sandbox購入と復元が確認できている。
- [ ] RevenueCat webhookがステージングで購読状態を更新できる。
- [ ] Expo側にサーバー専用キーが含まれていない。
- [ ] ユーザー音声がサーバー保存されていない。
- [ ] データ削除とJSON書き出しが動く。
- [ ] ステージング環境で主要E2Eが通っている。
- [ ] TestFlight前ブロッカーと残課題が明示されている。
- [ ] 本番環境作成やApp Store提出へ勝手に進んでいない。

## セルフレビュー観点

- `docs/specs/10_TEST_PLAN.md` の受け入れ基準とリリース前チェックリストを満たしている。
- `docs/specs/09_PRIVACY_BILLING_SECURITY.md` のシークレット、音声非保存、課金、削除方針と矛盾していない。
- Phase 13だけでTestFlight前のステージング確認まで完結できる。
