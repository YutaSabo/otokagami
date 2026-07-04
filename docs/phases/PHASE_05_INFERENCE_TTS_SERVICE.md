# Phase 5: Python推論/TTS

## 運用ルール

- ユーザーが「Phase 5 の指示書をもとに作業してください」と指示したら、この指示書を根拠に開発を開始する。
- この指示書に書かれた内容がすべて完了したら、Phase 5 は完了とし、作業を終了する。勝手に Phase 6 へ進まない。
- 次の Phase は、ユーザーが改めて実行を依頼したときに開始する。
- Python推論サービスはNext.js APIからのみ呼ばれる内部サービスとして実装する。Expoアプリから直接呼ばせない。
- 実際のAPIキー、トークン、秘密鍵、service role keyをチャットやコミットに出さない。

## ゴール

IPA変換とPiper TTS生成を担当するPython推論サービスをローカルで動作可能にする。Phase 5 完了時点では、`/internal/ipa` と `/internal/tts` が内部APIキーで保護され、Next.js APIから利用できるレスポンス形式で動く。

## 前提条件

- Phase 1が完了している。
- Phase 4のコンテンツseedと整合する `normalized_text`、`accent = US` を扱う。
- 参照設計書:
  - `docs/specs/05_CONTENT_SPEC.md`
  - `docs/specs/07_API_SPEC.md`
  - `docs/specs/08_ARCHITECTURE.md`
  - `docs/specs/09_PRIVACY_BILLING_SECURITY.md`
  - `docs/specs/10_TEST_PLAN.md`

## スコープ

含む:

- PythonサービスのHTTP API実装。
- `/internal/ipa` 実装。
- `/internal/tts` 実装。
- `PYTHON_SERVICE_API_KEY` による内部APIキー認証。
- eSpeak NG / phonemizer / CMU辞書を使うための依存関係整理。
- Piper TTS生成のローカル動作。
- ユニット/統合テスト。

含まない:

- Next.js APIからの実呼び出し実装。
- Supabase StorageへのTTSキャッシュ保存。
- Azure発音評価。
- OpenAI助言生成。
- 本番またはステージングへのデプロイ。

## 作業タスクリスト

1. サービス構成を確認
   - `services/inference` 配下にPythonサービスを実装する。
   - APIフレームワークはシンプルに保ち、ローカル起動とテストが容易なものを使う。
   - 依存関係と起動コマンドをREADMEまたはサービス内ドキュメントに記載する。

2. 内部APIキー認証を実装
   - すべての `/internal/*` エンドポイントで `PYTHON_SERVICE_API_KEY` を検証する。
   - キーが未設定なら起動時またはリクエスト時に明確に失敗させる。
   - エラー本文にキー値を含めない。

3. `/internal/ipa` を実装
   - Request/Responseは `docs/specs/07_API_SPEC.md` に従う。
   - 入力:
     - `text`
     - `accent = US`
   - 出力:
     - `normalized_text`
     - `ipa`
     - `words`
     - `oov_words`
     - `conversion_confidence`
   - UKはMVPで無効。必要なら明示的に拒否または未対応として扱う。

4. `/internal/tts` を実装
   - Request/Responseは `docs/specs/07_API_SPEC.md` に従う。
   - 入力:
     - `text`
     - `accent = US`
     - `speed = normal | slow`
   - 出力:
     - `audio_format = wav`
     - `audio_base64`
     - `duration_ms`
   - Piper voice設定は `.env` の `PIPER_VOICE_US`、`PIPER_VOICE_DIR` を使う。
   - ユーザー音声は扱わない。

5. エラー形式を揃える
   - 成功時は `{"ok": true, "data": ...}`。
   - 失敗時は `{"ok": false, "error": ...}`。
   - 秘密値、内部スタック、ファイルパスの過剰な露出を避ける。

6. テストを作成
   - APIキーなしで拒否される。
   - 正しいAPIキーで `/internal/ipa` が成功する。
   - 正しいAPIキーで `/internal/tts` がWAV base64を返す。
   - `normal` と `slow` が区別される。
   - 不正accentや不正speedが安全に拒否される。

## 動作確認手順

- `.env` の `PYTHON_SERVICE_API_KEY`、`PIPER_VOICE_US`、`PIPER_VOICE_DIR` がローカルで埋まっていることを確認する。値はチャットに書かない。
- Pythonサービスをローカル起動する。
- `/internal/ipa` に `right` や `I read it again.` を投げ、IPAレスポンスを確認する。
- `/internal/tts` に `right` を投げ、WAV base64とdurationを確認する。
- テストを実行し全件成功することを確認する。

## 完了条件チェックリスト

- [ ] `/internal/ipa` が仕様通りのレスポンスを返す。
- [ ] `/internal/tts` がPiperでWAV音声を生成する。
- [ ] `/internal/*` が内部APIキーで保護されている。
- [ ] Expoアプリから直接呼ぶ設計になっていない。
- [ ] ユーザー音声を保存・処理対象にしていない。
- [ ] テストが通る。
- [ ] Phase 6に進まず、作業を終了できる。

## セルフレビュー観点

- `docs/specs/07_API_SPEC.md` のPython推論サービスAPIと一致している。
- Phase 5だけでローカル推論/TTS確認まで完結できる。
- 完了条件がAPIレスポンスとテストで客観的に確認できる。
