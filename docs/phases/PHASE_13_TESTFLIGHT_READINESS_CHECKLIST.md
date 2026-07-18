# Phase 13 TestFlight前チェックリスト

## 実行済みローカル確認

| 項目 | 結果 | メモ |
| --- | --- | --- |
| `npm run lint --workspaces --if-present` | PASS | API、mobile、core、inferenceの型チェック/compileallが成功。 |
| `npm run test --workspaces --if-present` | PASS | API 38件、mobile 14件、core 13件、inference 6件が成功。 |
| `npm run build --workspaces --if-present` | PASS | Next.js build、Expo public config、core typecheck、inference compileallが成功。 |
| `supabase db reset` | PASS | 全migrationとseedを再適用し、`normalized_result`、`performance_metrics`、母語タグ制約を実DBで確認。 |
| `supabase/tests/rls.sql` | PASS | `supabase_db_pronunciation-mirror` に対してRLS SQLが成功。 |
| `.env` Git管理確認 | PASS | `git ls-files '.env' '.env.*'` は `.env.example` のみ。 |
| `.gitignore` 確認 | PASS | `.env`、`.env.*` を除外し、`.env.example` のみ許可。 |
| Expo公開変数確認 | PASS | mobileテストでExpo側は `EXPO_PUBLIC_*` のみ参照し、サーバー専用キー名を参照しないことを確認。 |
| API secret/error redaction確認 | PASS | `apps/api/lib/assess.mjs` の error log sanitization と `apps/api/lib/security.mjs` 経由のRevenueCat raw event redactionを確認。 |
| Python内部APIキー保護 | PASS | `/internal/*` が `X-Internal-API-Key` 必須で、未設定時500、不一致時401。inferenceテストでも確認済み。 |
| RevenueCat webhook認証 | PASS | webhook処理が専用env必須かつAuthorization検証を行う。APIテストで未認証拒否と購読更新を確認済み。 |
| 音声非保存のコード確認 | PASS | iPhoneからAzureへ直接ストリーミングし、`/api/assess` は結果JSONだけを受信する。TTSキャッシュはお手本音声のみ。 |
| データ削除/JSON書き出し | PASS | APIテストで削除対象行の削除、profile/subscription維持、exportに音声本体/secretが含まれないことを確認。 |
| Azure Speech実接続 | 要再確認 | 現行方式はiOS SDK push streamである。Development Build実機で短期トークン、PCMストリーム、最終結果、性能値を確認する。 |
| Piper TTS実接続 | PASS | inference service `/internal/tts` で normal/slow ともHTTP 200、音声base64ありを確認。 |
| OpenAI実接続 | PASS | Responses APIでHTTP 200、output content textありを確認。生成本文は記録しない。 |
| RevenueCat env確認 | PASS | `.env` の `REVENUECAT_SECRET_KEY`、`REVENUECAT_WEBHOOK_AUTH_TOKEN`、`EXPO_PUBLIC_REVENUECAT_IOS_PUBLIC_SDK_KEY` が設定済み。API側のwebhook必須env読み込みも成功。 |
| ステージングSupabase migration/seed | PASS | `STAGING_SUPABASE_DB_URL` に対して `supabase db push --include-seed` が成功。dry-runでremote database is up to dateを確認。 |
| ステージングSupabase seed件数 | PASS | REST確認で `phonemes=41`、`phoneme_clusters=20`、`practice_items=428`、`practice_item_targets=428`、`advice_pages=18`。 |
| ステージングSupabase匿名ログイン | PASS | Supabase Authでanonymous sign-inを有効化後、ステージング匿名セッション作成、`/api/bootstrap`、`/api/access-status` が成功。 |
| ステージングNext.js API | PASS | Vercel stagingの `/api/health`、`/api/bootstrap`、`/api/daily-session`、`/api/progress`、`/api/export`、`/api/delete-learning-data` を確認。 |
| ステージングPython inference | PASS | Fly.io stagingの `/internal/health`、`/internal/ipa`、`/internal/tts` normal/slow が内部APIキー付きで成功。 |
| ステージングTTS配信 | PASS | Vercel stagingで `/api/daily-session` がTTS URLを返し、`/api/tts/audio/*` が `audio/wav` を返すことを確認。Vercel `/tmp` 消失時はDBキャッシュ行から再生成する修正を追加済み。 |
| mobileステージングenv | PASS | `.env` の `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` が `STAGING_SUPABASE_*` と一致し、`EXPO_PUBLIC_API_BASE_URL` がVercel stagingを向くことを値非表示で確認。 |
| mobileローカル確認 | PASS | mobileのtest、build、lintに加え、Azureネイティブモジュール単体とiOSアプリ全体のSimulator向け統合ビルドが成功。 |
| TestFlightバイナリ提出 | PASS | 0.1.1 (8) の署名済みIPAを生成し、2026-07-13にApp Store Connectへ提出済み。Appleの処理完了後にTestFlightで実機確認する。 |

## 未完了またはブロック中

| 項目 | 状態 | 理由/次アクション |
| --- | --- | --- |
| RevenueCat sandbox購入/復元 | BLOCKED | envは設定済み。sandbox購入、復元、webhookによる `subscriptions` 更新は、iOS sandbox/TestFlight相当の実機フローまたはステージングwebhook公開URLが必要なため未実施。 |
| ステージング実機E2E | 未実施 | ステージングAPI/Supabaseを向くmobile設定は確認済み。iPhone実機またはDevelopment Buildで、録音、音声再生、採点、画面遷移、データ管理を手動確認する。 |

## TestFlight前ブロッカー

1. iPhone実機またはdev clientでステージングE2Eを完走する。
2. RevenueCat sandboxで購入、復元、webhook更新、`access-status` 反映を確認する。
3. TestFlight前提の録音/採点/音声再生の端末差分を確認する。

## ステージング必須E2E

- 新規匿名ユーザー開始。
- デイリー7問完走。
- 期待IPA/実測IPAの2段表示。
- 詳細から直し方へ遷移。
- 8日目課金ウォール。
- RevenueCat sandbox Pro有効化。
- 自由入力同意と判定。
- 自由入力が進捗に混ざらないこと。
- 学習データ削除。
- JSON書き出し。

## 実機手動確認手順

1. iPhoneのTestFlightでPronunciation Mirror 0.1.1 (8)へ更新して起動する。
2. 初回起動で匿名ユーザー作成と初期化が成功し、ホーム画面が表示されることを確認する。
3. 今日の練習を開き、7問が表示されることを確認する。
4. 各問題でnormal/slowのお手本音声が再生できることを確認する。
5. 1問以上録音し、採点結果、期待IPA、実測IPA、音素別フィードバックが表示されることを確認する。
6. 詳細または助言導線から直し方ページへ遷移できることを確認する。
7. 7問完走後、進捗画面の練習回数/習熟度/バッジ等が更新されることを確認する。
8. 自由入力で同意、判定、助言表示ができ、通常練習の進捗集計に混ざらないことを確認する。
9. JSON書き出しが成功し、音声本体やsecretが含まれないことを確認する。
10. 学習データ削除後、練習履歴/進捗が消え、profile/subscription相当の状態は維持されることを確認する。
11. RevenueCat sandboxで購入、復元、Paywall解除、`access-status` のPro反映を確認する。

### Development Buildで再現確認する場合の起動コマンド

```sh
npm --workspace @pronunciation-mirror/mobile run ios
```

実機で接続する場合は、iPhoneとMacを同じネットワークに置き、Expo dev clientから表示されたMetro URLへ接続する。

## TestFlight後でもよい改善

- 実機録音の端末差分に応じた録音フォーマット調整。
- TTSキャッシュの保存先をローカルファイルからSupabase Storage等へ切り替える運用設計。
- OpenAI未知ケース助言の品質評価ケース追加。
- ステージングE2E自動化。

## MVP対象外

- 本番環境作成。
- App Store提出。
- 本番課金商品の確定/提出。
- Phase 2機能。
