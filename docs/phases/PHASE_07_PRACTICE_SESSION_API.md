# Phase 7: 練習セッションAPI

## 運用ルール

- ユーザーが「Phase 7 の指示書をもとに作業してください」と指示したら、この指示書を根拠に開発を開始する。
- この指示書に書かれた内容がすべて完了したら、Phase 7 は完了とし、作業を終了する。勝手に Phase 8 へ進まない。
- 次の Phase は、ユーザーが改めて実行を依頼したときに開始する。
- 出題ロジックはサーバー側に集約する。クライアントへ重い選定ロジックを分散させない。
- 実際のAPIキー、トークン、秘密鍵、service role keyをチャットやコミットに出さない。

## ゴール

デイリー練習、苦手ドリル、音素表練習の出題APIと、お手本音声・直し方取得APIを実装する。Phase 7 完了時点では、モバイルUIがなくてもAPI経由で日次7問、苦手ドリル、音素指定練習を取得でき、TTS URLと助言ページを取得できる。

## 前提条件

- Phase 2、Phase 3、Phase 4、Phase 5、Phase 6が完了している。
- Supabase localにマスタseedとレビュー済みactiveコンテンツが入っている。
- Python推論サービスがローカルで起動できる。
- 参照設計書:
  - `docs/specs/02_MVP_SCOPE.md`
  - `docs/specs/04_CORE_LOGIC.md`
  - `docs/specs/05_CONTENT_SPEC.md`
  - `docs/specs/07_API_SPEC.md`
  - `docs/specs/10_TEST_PLAN.md`

## スコープ

含む:

- `/api/daily-session`。
- `/api/practice-session`。
- `/api/tts`。
- `/api/advice/:advice_id`。
- OpenAI未知助言フォールバックと `ai_advice_cache` 利用。
- 出題選定ロジックとDB保存の接続。
- TTSキャッシュ参照。
- `practice_items.is_active = true` のみ出題対象にする制御。

含まない:

- `/api/assess`。
- Azure判定。
- attempt保存。
- モバイルUI。
- 自由入力。

## 作業タスクリスト

1. アクセス制御を共通化
   - 練習開始には無料期間中またはPro entitlement有効が必要。
   - 8日目以降でPro無効なら `PAYWALL_REQUIRED` を返す。
   - `/api/tts` と `/api/advice` は練習体験に必要な範囲でアクセス制御を行う。

2. `/api/daily-session` を実装
   - Requestは `session_date` と `timezone` を受け取る。
   - 同じ `user_id` と `session_date` では既存 `daily_sessions` を返し、再生成しない。
   - 未生成なら `daily_sessions` と `daily_session_items` を作成する。
   - 7件、単語5、文2にする。
   - slot配分は苦手3、新規2、復習2。
   - ホームに一覧は出さないが、APIは実行用itemsを返す。

3. daily選定ロジックを接続
   - Phase 3の出題ロジックを使う。
   - 苦手、新規、復習の優先順は `docs/specs/04_CORE_LOGIC.md` に従う。
   - 同一日セッション内で同じ `practice_item_id` を重複させない。候補不足時のみ重複を許可し、`selection_reason` に記録する。
   - `practice_items.is_active = true` のみ使う。

4. `/api/practice-session` を実装
   - `mode = weak_drill | phoneme_select` を受け取る。
   - `mode = weak_drill` は `phoneme_state.mastery_ewma` が低い音素を優先する。
   - `mode = phoneme_select` は `phoneme_id` を必須にし、指定音素をターゲットに持つactiveパック問題を返す。
   - 苦手ドリルと音素表練習は `attempts.practice_mode = weak_drill | phoneme_select` でPhase 8に渡せる形にする。

5. `/api/tts` を実装
   - キャッシュキーは `tts:{accent}:{speed}:{sha256(normalized_text)}`。
   - `accent = US`、`speed = normal | slow`。
   - `tts_cache` に存在すれば再生成しない。
   - キャッシュがなければPython推論サービス `/internal/tts` を呼ぶ。
   - 生成したお手本音声はSupabase Storage等にキャッシュしてよい。これはユーザー音声ではない。
   - ユーザー音声を保存しない。

6. `/api/advice/:advice_id` を実装
   - `advice_pages` からactiveな助言を返す。
   - `short_tip` は1〜2行を基本とする。
   - `asset_id` と `coach_example_text` を返す。
   - 未対応混同ペアはPhase 8で汎用ページにフォールバックできるよう、汎用助言も取得可能にする。

7. OpenAI未知助言フォールバックを実装
   - 頻出混同ペアはテンプレ助言を優先し、OpenAI APIを毎回呼ばない。
   - 混同ペアがテンプレ未対応で、汎用助言をユーザー文脈に合わせて短く整形する必要がある場合のみOpenAI APIを使う。
   - OpenAIの出力は `ai_advice_cache` に保存し、同じ条件ではキャッシュを優先する。
   - キャッシュキーは `docs/specs/05_CONTENT_SPEC.md` の方針に従い、`native_language`、`target_accent`、`confusion_pair_id` または `generic_advice_id`、期待/実測音素を含める。
   - OpenAI失敗時はテンプレまたは汎用助言にフォールバックし、練習を止めない。
   - OpenAI APIキーはサーバー専用 `.env` に置き、Expoアプリに渡さない。

8. テストを作成
   - `/api/daily-session` が7件、単語5、文2、slot配分通り返す。
   - 同日再呼び出しで同じitemsが返る。
   - `/api/practice-session` の `weak_drill` が苦手音素を優先する。
   - `/api/practice-session` の `phoneme_select` が指定音素の問題を返す。
   - `phoneme_select` で `phoneme_id` 未指定の場合は拒否する。
   - inactive問題が返らない。
   - `/api/tts` はキャッシュありで再生成しない。
   - `/api/advice/:advice_id` がactive助言を返す。
   - テンプレ対応混同ペアではOpenAIを呼ばない。
   - 未知ケースでは `ai_advice_cache` が優先され、キャッシュミス時だけOpenAIフォールバックが呼ばれる。

## 動作確認手順

- Supabase local、Python推論サービス、Next.js APIを起動する。
- 無料期間中ユーザーで `/api/daily-session` を呼び、7件取得できることを確認する。
- 同じ日付で再度呼び、同じdaily sessionが返ることを確認する。
- `/api/practice-session` を `weak_drill` と `phoneme_select` で呼ぶ。
- `/api/tts` でnormal/slowのURLまたはキャッシュ情報を取得する。
- `/api/advice/:advice_id` で優先助言と汎用助言を取得する。
- 未知ケース助言でキャッシュ優先とOpenAIフォールバックを確認する。
- テストを実行し全件成功することを確認する。

## 完了条件チェックリスト

- [ ] `/api/daily-session` が仕様通り動く。
- [ ] `/api/practice-session` が苦手ドリルと音素表練習に対応している。
- [ ] 出題対象が `practice_items.is_active = true` に限定されている。
- [ ] TTSキャッシュが動く。
- [ ] 助言ページ取得が動く。
- [ ] OpenAI未知助言フォールバックと `ai_advice_cache` が動く。
- [ ] 無料期間/Proアクセス制御が適用されている。
- [ ] API統合テストが通る。
- [ ] Phase 8に進まず、作業を終了できる。

## セルフレビュー観点

- `docs/specs/04_CORE_LOGIC.md` の出題優先順と矛盾していない。
- `docs/specs/07_API_SPEC.md` のAPIレスポンスと矛盾していない。
- Phase 7だけで出題・TTS・助言取得のAPI確認まで完結できる。
