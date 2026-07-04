# Phase 4: コンテンツseed/アセット

## 運用ルール

- ユーザーが「Phase 4 の指示書をもとに作業してください」と指示したら、この指示書を根拠に開発を開始する。
- この指示書に書かれた内容がすべて完了したら、Phase 4 は完了とし、作業を終了する。勝手に Phase 5 へ進まない。
- 次の Phase は、ユーザーが改めて実行を依頼したときに開始する。
- コンテンツは未レビューのまま本番出題対象にしない。ユーザーのレビュー通過分のみ `is_active = true` にする。
- 実際のAPIキー、トークン、秘密鍵、service role keyをチャットやコミットに出さない。

## ゴール

MVPのローカル実装と受け入れ確認に必要な練習パック、直し方ページ、静的図解アセットをseed可能な形で用意する。Phase 4 完了時点では、全音素向け練習パックの候補、優先10〜15件の直し方ページ、対応アセットが存在し、レビュー済みだけが `is_active = true` になる。

## 前提条件

- Phase 1とPhase 2が完了している。
- Phase 3が完了していることが望ましい。出題ロジックの入力形式と整合させるため。
- 参照設計書:
  - `docs/specs/02_MVP_SCOPE.md`
  - `docs/specs/05_CONTENT_SPEC.md`
  - `docs/specs/06_DATA_MODEL.md`
  - `docs/specs/10_TEST_PLAN.md`

## スコープ

含む:

- `phonemes`、`phoneme_clusters` と整合する練習パックseed。
- 全音素40前後に対応する単語・文の候補作成。
- `practice_items` と `practice_item_targets` のseed生成。
- 日本語話者頻出混同ペアの優先10〜15件の直し方ページ作成。
- 対応する静的図解アセット、またはアセット配置と参照IDの作成。
- 未レビュー/レビュー済みのゲート管理。

含まない:

- 実行時AI画像生成。
- 自由入力を自動でパック化する処理。
- 全30〜50件の直し方ページ完全網羅。残りはMVP完了をブロックしない。
- Piper音声の事前同梱。

## 作業タスクリスト

1. コンテンツIDを固定
   - 音素IDは `docs/specs/05_CONTENT_SPEC.md` のIDを使い、実装途中で変更しない。
   - Azure返却値をそのままDB主キーにしない。
   - `practice_item_id`、`advice_id`、`asset_id` は安定したASCII IDにする。

2. 練習パック候補を作成
   - 各音素につき最低、単語5件、文3件を目標にする。
   - 子音連結グループは各グループにつき最低、単語3件、文2件を目標にする。
   - MVPローンチ最小セットとして、全音素40前後に対応する練習パック候補を用意する。
   - 各問題は以下を持つ。
     - `practice_item_id`
     - `item_type`
     - `text`
     - `normalized_text`
     - `expected_ipa`
     - `accent = US`
     - `ja_difficulty`
     - `source`
     - `is_active`

3. ターゲット紐付けを作成
   - `practice_item_targets` に `target_type = phoneme` または `cluster` を登録する。
   - `target_phoneme_ids` が集計更新対象になることを意識し、複数ターゲットの扱いを明確にする。
   - `position_hint` は実装が必要な場合のみ使う。

4. レビューゲートを実装
   - AI生成または未確認の候補は `is_active = false` にする。
   - ユーザーのレビュー通過分だけ `is_active = true` にする。
   - Phase完了時点で、active件数とinactive件数を確認できるようにする。

5. 優先直し方ページを作成
   - 優先10〜15件を作成する。
   - 優先対象はL/R、TH、母音長、V/B、シに寄る `theta`、語末子音を中心にする。
   - 例:
     - `r_to_l`
     - `l_to_r`
     - `theta_to_s`
     - `theta_to_t`
     - `dh_to_z`
     - `dh_to_d`
     - `v_to_b`
     - `ae_to_eh`
     - `ih_to_iy`
     - `uh_to_uw`
     - `final_t_missing`
     - `final_d_missing`
     - `final_s_missing`
   - 直し方本文は日本語で1〜2行、最大3行に収める。

6. 汎用直し方ページを作成
   - 少なくとも以下を用意する。
     - `generic_consonant`
     - `generic_vowel`
     - `generic_final_consonant`
     - `generic_cluster`
     - `generic_unknown`
   - 未対応混同ペアは汎用ページにフォールバックできるようにする。

7. 静的図解アセットを配置
   - 実行時AI画像生成はしない。
   - `asset_id` とファイルパスの対応をDBまたはアプリ内定数で管理できるようにする。
   - 配置例は `docs/specs/05_CONTENT_SPEC.md` の `assets/pronunciation/` 案を参考にする。
   - アセットが未完成の場合は、未完成ページを `is_active = false` にするか、汎用アセットに明示的に紐付ける。

8. seed適用を確認
   - `supabase db reset` 後にseedが通ることを確認する。
   - `practice_items.is_active = true` の問題だけがPhase 7以降のAPI出題対象になるようにする。

## 動作確認手順

- seed適用後、全音素に少なくとも候補問題が存在することを確認する。
- `is_active = true` の問題がレビュー済みだけであることを確認する。
- 優先10〜15件の直し方ページが存在することを確認する。
- 汎用直し方ページが存在することを確認する。
- `advice_pages.asset_id` と実アセットまたは対応表が矛盾していないことを確認する。

## 完了条件チェックリスト

- [ ] 全音素40前後に対応する練習パック候補が作成されている。
- [ ] `practice_items` と `practice_item_targets` のseedがスキーマと整合している。
- [ ] 未レビュー候補は `is_active = false` である。
- [ ] ユーザーレビュー通過分だけ `is_active = true` である。
- [ ] 優先10〜15件の直し方ページが作成されている。
- [ ] 汎用直し方ページが作成されている。
- [ ] 対応する図解アセットまたは明示的なアセット対応表が存在する。
- [ ] 実行時AI画像生成を使っていない。
- [ ] Phase 5に進まず、作業を終了できる。

## セルフレビュー観点

- `docs/specs/05_CONTENT_SPEC.md` の音素ID、混同ペア、レビューゲートと矛盾していない。
- Phase 4だけでseed作成から適用確認まで完結できる。
- 完了条件がDB seed結果とファイル存在で客観的に確認できる。
