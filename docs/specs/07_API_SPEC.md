# Otokagami API責務仕様

> 文書状態: 現役
> 注意: 責務と契約条件を定義する。URL名称、DB方式、migrationは第4段階以降。

## 1. 原則

- クライアントにサーバー専用秘密を置かない。
- 音声本体を自社APIへ送らない。
- Azure短期トークンで端末からAzureへ直接ストリーミングする。
- 主要結果表示をDB保存・長期集計から分離する。
- 再送可能な書き込みをidempotentにする。
- durable進捗、trial、購読、active contentをクライアント申告だけで確定しない。
- 実行時OpenAI、Piper、PythonをMVP中心経路から外す。

## 2. 認証

アプリはSupabase anonymous authのアクセストークンを使う。APIはトークンを検証し、ユーザー所有権をサーバー側で決定する。

公開前提のSupabase anon keyとRevenueCat public SDK key以外の秘密をアプリへ渡さない。Authorizationヘッダー、短期トークン、外部キーをログへ保存しない。

## 3. API責務

現行URLは移行まで残る可能性がある。ここでは目標責務を定義し、具体的な追加・統合・廃止URLはTBDとする。

| 責務 | 目標 |
| --- | --- |
| bootstrap | profile、timezone、trial履歴、entitlement、未完了sessionを安全に取得 |
| access status | 7 active learning daysと購読から、新規判定・過去閲覧の権限を分離 |
| daily session | 1焦点音、通常5課題、短縮候補、任意追加、期限復習最大1件を返す |
| speech token | 認証・アクセス確認後、Azure短期トークンを発行 |
| assessment normalize | Azure結果を検証・正規化し、主要結果を作る |
| result persistence | attempt、correction cycle、evidenceを冪等保存 |
| session completion | Program Dayを冪等完了し、同日二重進行を防ぐ |
| progress/report | 改善・維持・転移・定着、復習、次の計画を返す |
| billing webhook | RevenueCatイベントを検証しentitlementを確定 |
| export/delete | 学習データの書き出しと削除。trial・購読責務を分離 |

## 4. Bootstrap / access status

返すべき概念:

- profileとlocale
- trial: started、current Program Day、completed days、Day 7 report状態
- access: new assessment可否、historical read可否、paywall reason
- subscription entitlement
- unfinished session summary
- overdue review countと今日へ入る最大1件

`trial_day`を暦日差から計算しない。`free_trial_ends_at`だけで無料体験を表現しない。ログイン、起動、認証セッション作成だけでProgram Dayを進めない。

## 5. Daily session

サーバーは次を検証して返す。

- current Program Day
- Calendar Date / timezone
- focus group
- required item count: 通常5、短縮時は約3
- item roles: anchor、contrast、transfer、sentence/practical、review
- overdue reviewは最大1件
- optional extension最大2件。requiredと明確に分離
- content、audio、advice、diagram version
- 未完了位置

同じProgram Dayの再取得は同じsessionを返す。日付変更で未完了sessionを破棄・自動完了しない。未レビューコンテンツを返さない。

## 6. Speech token

- 認証済みで、新規判定権限がある場合だけ発行する。
- 初期localeは`en-US`。
- Subscription Keyをレスポンスやログへ含めない。
- token、region、expires at、refresh timing、capabilitiesを返す。
- クライアントは失効前に更新する。
- tokenの実TTLはAzure仕様と実装で確認し、文書例から発明しない。

## 7. Assessment経路

### クライアントから送るもの

- `client_attempt_id`
- session / item / practice item / content version
- attempt roleとretry relation
- Calendar Date / timezone
- Azure最終結果JSON
- 音声内容を含まない性能・品質メタデータ
- app/version情報

送らないもの:

- ユーザー音声ファイル、base64音声、端末音声URI
- Azure Subscription Key
- clientが確定したdurable状態

### サーバー検証

1. 認証とアクセス権。
2. session/itemの所有権と現在状態。
3. content version、reference text、assessment locale。
4. payloadサイズ・型・必須Azure項目。
5. 音声品質・課題一致・対象音の存在。
6. client attempt IDの重複・payload競合。
7. attempt roleとadvice提示履歴の整合。

## 8. 主要結果と保存の分離

主要結果は、Azure最終結果と純粋な正規化から生成できる次の情報である。

- 対象焦点音
- 期待音
- 近く認識された音（取得できる場合）
- 今回の結果ラベル
- 次に試す1行動または良好時の次へ
- 技術的有効性

長期集計、週次レポート、複数状態再計算、通知更新を主要結果の待ち時間へ含めない。

保存の具体方式はTBD。次の性質は確定する。

- 同じ`client_attempt_id`の再送は同じattemptを返す。
- 保存失敗でも、クライアントが保持するAzure結果から主要結果を表示できる。
- 再送時に録音をやり直させない。
- durable進捗は保存とサーバー検証が成功した後にだけ確定する。
- クライアントは`persistence_status`を把握できる。

## 9. Session completion

Program Day完了APIまたは同等責務は次を検証する。

- 必須slotが通常または短縮条件を満たす。
- 少なくとも1つの有効な学習判定がある。
- optional extensionを必須としていない。
- 同一Calendar Dateで既に別Program Dayを完了していない。
- 同じcompletion keyの再送で二重加算しない。

Day 7完了時はレポートを生成可能にし、次回新規判定で`PAYWALL_REQUIRED`相当を返す。

## 10. Progress / report

返す中心情報:

- 焦点群ごとのcurrent state
- discovered / immediate change / held / transferred / stable / maintenance evidence
- next Review Due Date、overdue state
- 日次、Day 7、週次の要約
- 次の焦点・課題役割
- selected before/afterのメタデータと端末音声利用可否

総合点、全41音ヒートマップ、レベル、バッジ、称号、日週月グラフを中心レスポンスにしない。

## 11. Trialと課金

アクセス状態を分ける。

| 権限 | trial中 | 購読中 | Day 7後・未購読 |
| --- | --- | --- | --- |
| 新規判定 | 可 | 可 | 不可 |
| 未完了Day継続 | Day 7以前は可 | 可 | Day 7完了済みなら不可 |
| 過去レポート | 可 | 可 | 可 |
| 選択before/after | 可 | 可 | 可（端末ファイルがある場合） |
| 復元・設定・規約 | 可 | 可 | 可 |
| 書き出し・削除 | 可 | 可 | 可 |

RevenueCat webhookは認証し、再送に耐える。商品ID、Offering、Package、実価格はTBD。

## 12. エラー

| 分類 | retryable | 学習結果 |
| --- | --- | --- |
| 技術的無効録音 | yes | 無効。attempt上限・状態へ含めない |
| Azure判定失敗 | yes | 無効 |
| 保存失敗 | yes | 主要結果表示可。durable進捗は保留 |
| idempotency payload conflict | no | 既存結果を保護し、競合を報告 |
| paywall required | no | 過去閲覧は維持 |
| entitlement unavailable | yes | 新規判定前に再確認 |
| invalid content/session | 状況次第 | 成果へ含めない |

エラーレスポンスへ秘密、外部生トークン、個人音声を含めない。

## 13. データ削除・書き出し

- 本人認証・所有権を検証する。
- 学習データ削除と無料体験履歴・購読状態の削除責務を分ける。
- 学習削除でtrialを再付与しない。
- 端末ローカル音声の削除はアプリが担当し、サーバー結果と両方の完了/失敗を表示する。
- 書き出しへ音声、秘密、内部ログ、他ユーザーデータを含めない。
- 削除と再送の競合を考慮する。具体方式はTBD。

## 14. 現行APIとの境界

現在実装には`/api/bootstrap`、`/api/access-status`、`/api/daily-session`、`/api/speech-token`、`/api/assess`、進捗、課金、自由入力、TTS、助言、Python内部API等がある。

新仕様でも認証、短期トークン、Azure結果正規化、RevenueCat、書き出し・削除の基礎は再利用候補である。一方、自由入力、実行時TTS/助言、旧集計はMVP中心経路の対象外。URLの維持・廃止は第4段階以降に決める。第3段階ではAPIコードを変更しない。

## 15. TBD

- 具体的なURL、request/response schema
- 正規化と保存を同一応答でどう分離するか
- RPC/outbox/queue/再計算の選択
- レート制限値
- 正式な性能SLO
- 旧API廃止時期
