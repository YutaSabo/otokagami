# Phase 13 新MVP準備状況

> 文書状態: 現役の状態記録
> 最終棚卸し: 2026-08-12（S6-08.1 Hosted適用後／S6-08.2・Stage 7.1実機前補修はlocal／clone検証済み、Hosted承認待ち）
> 注意: 旧MVPの確認結果と、新MVPの準備状況を混同しない。

## 1. 状態ラベル

| ラベル | 意味 |
| --- | --- |
| `確認済み` | 新MVP仕様に対する証拠がある |
| `旧実装のみ確認済み` | 再利用候補はあるが、新MVP適合は未確認 |
| `未実装` | 新MVPに必要だが、現在コードにない |
| `未確認` | 実機・Hosted・外部サービスを確認していない |
| `BLOCKED` | 必要な承認、端末、認証、外部状態が不足 |

## 2. 第3段階の状態

| 項目 | 状態 | 根拠 |
| --- | --- | --- |
| 新製品方針の文書化 | 確認済み | マスター、仕様01〜10、Phase 13を新方針へ改訂 |
| コード・DBの新仕様適合 | 一部確認済み | Core/API v2とS6-08.1 Hosted schema、隔離されたvalidation-only教材1行は適用・照合済み。Stage 7.1は実機証拠がないため完成扱いしない |
| Todoist運用 | 一部確認済み | 現行Project概要とopen taskを開始時に再確認し、検証済みwork logだけを通常ルールで記録する。task作成・変更・完了は別権限 |
| Hosted環境 | 一部確認済み | `otokagami-staging`はS6-08.1まで適用・照合済み。validation tester accessは0件、v2 modeは`off`で、実データ削除RPCは未実行 |
| 実機Azure | 未確認 | 有料API・実機操作を行っていない |
| RevenueCat sandbox | 未確認 | 外部課金操作を行っていない |

## 3. 再利用可能な旧実装基盤

次は第1段階調査で存在が確認された。ただし、新MVPの完成証拠ではない。

| 基盤 | 状態 | 新MVPで必要な再確認 |
| --- | --- | --- |
| Supabase anonymous auth | 確認済み（自動） | 新Mobile shellとv2 JWT境界。実機再確認待ち |
| Azure短期トークン | 確認済み（自動） | managed item、access、ticket、3回上限をmock確認。TTL/実機待ち |
| iOS Azure直接PCM stream | 旧実装のみ確認済み | 実機8焦点群、性能、route変更 |
| Recognizer事前準備 | 旧実装のみ確認済み | 5課題フローの区間P95 |
| Azure結果正規化 | 確認済み（fixture） | shared strict projection、対象1音、unknown/invalid、privacy負テスト。実機fixture待ち |
| API再試行状態 | 確認済み（自動） | ticket nonce、client attempt id、SQLite outbox、並行再送 |
| RevenueCat SDK/webhookコード | 旧実装のみ確認済み | sandbox商品、購入、復元、再送 |
| Supabase RLS・テスト | 確認済み（local/clone/Hosted schema） | protected RPC、owner分離、並行attempt/delete。Hostedはobject・grant・既存件数を照合済み |
| export/delete | 確認済み（local/clone/Hosted schema） | atomic delete、epoch、redacted snapshot、端末barrier。Hosted定義は適用済みだが、実ユーザーへの削除RPCは未実行 |

## 4. 新MVP中心体験

| 項目 | 状態 |
| --- | --- |
| 1日1焦点音プランナー | 確認済み（Core/API fixture） |
| 通常5課題の役割構成 | 確認済み（Core/API fixture） |
| 良好日の3課題程度短縮 | 未実装 |
| 任意追加2課題を完了条件から分離 | 確認済み（Core/DB） |
| 対象1音の主要結果 | 確認済み（fixture UI） |
| 1画面文脈の静的コーチ | 一部実装。正式教材・人間レビュー待ち |
| guided retryとcorrection cycle | 確認済み（自動）。実機待ち |
| before／after比較 | ローカル保持基盤実装。再生比較の実機受入待ち |
| 保存と主要結果の分離 | 確認済み（自動） |
| 保存失敗時の録音不要再送 | 確認済み（自動）。network復帰実機待ち |

## 5. 学習・無料体験

| 項目 | 状態 |
| --- | --- |
| Program Day / Calendar Date / Review Due Date分離 | 確認済み（Core/DB/API） |
| 7 active learning days | 確認済み（DB/API基盤）。Stage 8 UI・課金未完了 |
| 1 Calendar Dateで最大1 Program Day | 確認済み（DB/Core） |
| 未完了Dayの後日再開 | 確認済み（API/Mobile fixture）。実機待ち |
| 1・3・7・14日復習 | 旧実装のみ確認済み |
| 期限超過を最大1件提示 | 未実装 |
| guided retryをdurable進捗から除外 | 確認済み（Core/DB） |
| Day 7レポート | 未実装 |
| Day 8前Paywall | 旧暦日方式のみ実装済み。新仕様は未実装 |
| 未購読の過去閲覧 | 未実装または一部実装、要確認 |

## 6. コンテンツ

第1段階のリポジトリ調査で確認された値である。Hosted schemaはS6-08.1まで確認済みで、validation-only教材1行は公開教材と分離されている。公開可能なv2教材は未準備である。

| 項目 | 現在確認 | 新MVP最低 | 状態 |
| --- | ---: | ---: | --- |
| 候補課題 | 428 | - | 旧候補のみ |
| reviewed + active課題 | 6 | 約104 | 不足 |
| active文 | 1 | 焦点群役割を満たす数 | 不足 |
| active助言 | 0 | 21以上 | 不足 |
| 図解 | placeholder 15 | 正式8以上 | 不足 |
| standard/slow音声 | 実行時生成前提 | 約208レビュー済み | 未準備 |

初期8焦点群、具体的英文、発音指導者レビュー、Azure実機検証は未確認。

## 7. 外すべき旧中心経路

コードは第3段階で変更していない。

| 項目 | 現在 | 新MVP |
| --- | --- | --- |
| 自由入力 | 実装あり | 対象外。入口・中心経路を無効化予定 |
| 実行時OpenAI助言 | 実装あり | 対象外 |
| 実行時Piper/Python | 実装あり | 中心経路対象外 |
| 音素表/別建て苦手ドリル | 実装あり | 対象外 |
| レベル/バッジ/称号 | 実装あり | 対象外 |
| 全音素詳細/総合点中心 | 実装あり | 中心表示対象外 |

削除・無効化・移行の具体判断は第4段階以降。

## 8. 品質・実機

| 項目 | 状態 |
| --- | --- |
| iPhone実機録音とAzure結果 | 未確認 |
| 初期8焦点群のAzure安定性 | 未確認 |
| 主要結果P95 | 未確認 |
| 有効録音技術成功率 | 未確認 |
| 通常5課題完了時間 | 未確認 |
| Bluetooth/route/background | 未確認 |
| local before/after 30日削除 | コード・fixture確認済み。iOS実機属性/削除待ち |
| URI欠損時UX | コード確認済み。実機待ち |

P95 3秒、技術成功率97〜98%等は実機検証目標候補であり、PASSではない。

## 9. 課金・外部環境

| 項目 | 状態 |
| --- | --- |
| RevenueCat product IDs / Offering / Package | 未確認・TBD |
| 実価格 | TBD |
| sandbox購入・復元 | 未確認 |
| webhookの新MVP統合 | 旧実装のみ確認済み |
| Hosted Supabase schema/seed | S6-08.1 schemaとvalidation-only教材1行まで適用・照合済み。Hosted Seedは実行していない |
| Vercel/Fly.io/Expo現在状態 | Vercel Productionはv2未配布。最新状態の再確認は次回外部操作前 |
| App Store Connect/TestFlight現在状態 | Build 8/9接続先確認済み。新Mobile build未作成 |

過去文書には旧ビルドの提出済み記録があったが、現在の外部状態を再確認しておらず、新MVP完成範囲にも含めない。

## 10. 新MVP完了ブロッカー

1. Stage 7実機受入と、実機Azure fixtureに基づくlive設定の確定。
2. 約104課題と全資産のレビュー。
3. 実機Azure品質・速度確認。
4. 実機Azure fixtureに基づくpayload/期限設定とv2 live設定。
5. 7 active learning daysと休止・復帰。
6. RevenueCat sandbox購入・復元・webhook。
7. 音声非保存、端末保持、データ権利、認可の確認。

## 11. 技術的完成状態

S6-08.1 Hosted schemaとvalidation-only教材1行は適用・照合済みである。tester accessは0件、v2 modeは`off`で、Stage 7.1は実機受入前である。fixtureや自動検証だけを`COMPLETE`または`code-complete`とは扱わない。branch Preview E2E、EAS Development Build、実Azure projection、iOS file protection/backup除外、microphone/background/network復帰、SQLite/audio/required・optional・invalid・ACK・export/deleteの実機証拠は未確認である。正式教材、Stage 8課金、PR review/merge、Production code/env deployment、App Store作業も未完了である。
