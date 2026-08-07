# Otokagami MVPテスト計画

> 文書状態: 現役
> 原則: 自動テストの成功と実機受け入れを分ける

## 1. テスト方針

- 日付、attempt、状態遷移、idempotencyは単体テストで固定する。
- API、DB、RLS、購読、削除は統合テストで確認する。
- 録音、Azure、レイテンシ、マイク、Bluetooth、通知は実機で確認する。
- 約104課題、約208音声、助言、図解は機械検査と人間レビューを組み合わせる。
- 旧実装の既存テスト合格だけで新MVP完成としない。
- Production、App Store申請、一般公開をMVP受け入れに含めない。

## 2. 受け入れ区分

| 区分 | 意味 |
| --- | --- |
| 自動確認済み | local/CIで再現可能なテストが通る |
| 実機確認済み | 指定端末・ネットワークで証拠を記録した |
| 実機検証目標 | まだ合格実績のない候補値 |
| 未確認 | 外部サービス、Hosted環境、レビューが未確認 |

P95 3秒、成功率、判定しきい値は、実測前に正式PASSへしない。

## 3. 製品受け入れ

### 日次

- 1セッションが1焦点音だけを扱う。
- 通常5課題がanchor、contrast、transfer、sentence/practical、reviewの役割を持つ。
- 焦点音が良好なら3課題程度へ短縮できる。
- 完了後の追加2課題は任意で、スキップしても完了状態が変わらない。
- coached retryは原則1課題。
- 1課題は最大3有効attempt。
- 技術的無効録音はattempt上限にもProgram Dayにも入らない。

### 1問

- 録音前は課題、焦点音、標準/スロー音声、録音操作に絞る。
- 主要結果は対象1音と次の1行動を示す。
- 総合点、Fluency、Completeness、Prosodyを中心表示しない。
- コーチは1動作、1〜2文、レビュー済み図解を使う。
- guided retry後にbefore／afterを表示する。
- 同日成功を定着と表示しない。
- 保存失敗でも主要結果を表示し、録音をやり直させない。

### 継続

- 1・3・7・14日のReview Due Dateを実日付で計算する。
- 休止中の期限超過を失敗・自動完了にしない。
- 次回日次セッションへ期限超過復習を最大1件入れる。
- レポートは発見、即時改善、維持、転移、定着、メンテナンスを区別する。

## 4. Program Dayテスト

必須シナリオ:

1. インストール・起動・匿名認証だけではDay 1を開始しない。
2. 最初の有効判定でtrialが開始する。
3. 有効判定なしの未完了セッションでProgram Dayが進まない。
4. Day 1完了後に2 Calendar Dates休んでも次はDay 2。
5. 未完了Day 2を後日に同じ位置から再開する。
6. 1 Calendar DateでDay 2完了後、Day 3を完了できない。
7. timezone変更で同じ実期間に二重完了しない。
8. Day 7完了後にレポートが表示される。
9. Day 7後、8回目の学習日となる新規判定前にPaywallが出る。
10. 未購読でも過去レポート、状態、選択録音、設定、復元、export/delete、規約を読める。

## 5. Attempt・状態ロジックの単体テスト

- `cold`、`guided_retry`、`transfer`、`review`を区別する。
- 同一Calendar Date・焦点・役割の最初の有効な無補助attemptだけがdurable候補になる。
- guided retryはimmediate changeだけを更新する。
- 同日guided retryを何回成功してもheld/stableが増えない。
- 同じ`client_attempt_id`の再送が1件だけになる。
- 同じIDで異なるpayloadを拒否する。
- technical invalid reasonごとに成果へ入らない。
- 保存失敗中はdurable状態を確定しない。
- 別日の無補助成功だけがheld候補になる。
- 別課題役割の無補助成功だけがtransferred候補になる。
- 7日Review Due Date未到来なら、Program Day 7でもstableへ捏造しない。

具体的な点数境界テストは、判定しきい値が`MVP初期値`として決まってから追加する。旧80点、10点差を自動的に正本にしない。

## 6. 日次プランナーテスト

- 5つの役割がそろう。
- review枠に期限到来/期限超過を最大1件入れる。
- 同一課題を必須枠で重複させない。
- activeかつversion整合する課題だけを選ぶ。
- 国籍・母語でスコアや共通優先度を補正しない。
- 良好日の短縮条件はサーバー確認される。
- optional extensionはrequired countへ含まれない。
- 未完了sessionをCalendar Date変更で再生成しない。

## 7. API統合テスト

### 認証・アクセス

- 未認証を拒否。
- 他ユーザーのsession/attempt IDを拒否。
- trial、subscription、historical read権限を分ける。
- Day 7後の新規判定を拒否し、過去閲覧は許可。

### Speech token

- 認証済み・アクセス可能ユーザーだけに短期トークンを返す。
- Azure keyを返さない・ログしない。
- locale/capabilities/expiryを返す。

### Assessment

- 管理課題、reference text、content versionを検証する。
- 音声本体を受け取らない。
- valid/invalidを正しく分類する。
- 主要結果を長期集計待ちから分離する。
- 保存失敗時にretryable persistence stateを返せる。
- 再送でattempt、evidence、Program Dayを重複させない。
- guided retryとcoldを混同しない。

### Completion/report

- 通常・短縮の必須slotを検証する。
- optional extensionなしで完了できる。
- 1 Calendar Dateで二重Program Dayを防ぐ。
- reportがevidenceを根拠に再現できる。

### RevenueCat

- webhook認証なしを拒否。
- イベント再送を重複処理しない。
- App User IDを誤ったuserへ紐付けない。
- entitlement失効・billing issue・restoreを扱う。

### Export/delete

- 本人データだけを対象にする。
- 音声、秘密、内部不正防止値をexportへ含めない。
- 学習削除でtrialを再付与しない。
- deletionと未送信outboxの競合を安全に扱う。

## 8. DB・RLSテスト

- migrationとseedが対象環境で再現できる。
- user Aはuser Bのsession、attempt、reportをread/writeできない。
- クライアントはsubscription、trial履歴、active content、server-verified evidenceを直接更新できない。
- parent ownershipを経由する子データも他人が読めない。
- idempotencyの一意性が並行再送でも壊れない。
- same-day durable evidenceとProgram Day completionの二重作成を防ぐ。
- delete後に孤立データが残らない。

具体SQLとmigrationは本段階の対象外。

## 9. コンテンツ受け入れ

機械検査:

- focus groupが8。
- 各群12課題、計96。
- 診断候補8、合計約104。
- 各課題にstandard/slow、計約208音声参照。
- 主/代替コツ16、汎用5、合計21以上。
- 正式図解8以上。
- active資産にplaceholder、欠損参照、重複IDがない。
- assessment/coaching localeとversionが整合する。

人間/実機レビュー:

- 英文、IPA、焦点位置。
- 標準/スロー音声の自然さ。
- 助言と図解の一致。
- 発音指導者承認。
- 複数話者・複数端末のAzure挙動。
- 発見→コーチ→再録音の完走。

具体的な英文とレビュー結果は未確認。

## 10. Mobile自動テスト

- 録音状態機械、連打、取消、古いrequestの無視。
- 画面破棄後の結果を採用しない。
- 主要結果が対象1音中心。
- 保存保留でも次へ進める。
- 再送完了で重複表示しない。
- audio URI欠損で画面が壊れない。
- 30暦日・14日完了・学習削除でローカル音声を削除する。
- offlineで新規判定を止め、過去閲覧を維持する。
- Day 7後のread-only画面。
- RevenueCat priceを固定文字列で発明しない。

## 11. 実機Azureテスト

必須:

- 実iPhoneでマイク権限、録音開始、直接stream、停止、final result。
- 短期tokenの取得、更新、失効。
- 単語、短文、標準/スローお手本。
- 無音、低音量、短すぎ、クリッピング、NoMatch、取消。
- 対象音欠損、違う課題、Bluetooth/route変更。
- foreground/background、画面離脱、通信切替。
- before/afterローカル再生と削除。
- 初期8焦点群の対象音取得。

Azureや有料APIの実接続は、費用と対象環境の明示承認後に行う。

## 12. 性能・安定性

次は`実機検証目標`であり、正式な合格実績ではない。

| 区間 | 検証候補 |
| --- | ---: |
| 初回問題表示→録音可能 | P95 1.5秒 |
| 2問目以降→録音可能 | P95 0.5秒 |
| 録音ボタン→開始 | P95 0.25秒 |
| 録音停止→Azure final | P95 2.0秒 |
| Azure final→主要結果 | P95 0.8秒 |
| 録音停止→主要結果 | P95 3.0秒 |
| 次へ→次問録音可能 | P95 0.7秒 |
| 異常時打ち切り | 8秒以内 |
| 通常5課題 | 中央値4分、P90 6分以内 |

有効録音の技術成功率候補97〜98%も未検証である。正式値は実機・話者・ネットワーク別の十分なサンプルから決める。

主要表示、persistence、aggregationの時間を別々に計測する。DB保存完了をUI表示時間へ混ぜない。

## 13. 課金実機テスト

- RevenueCat sandboxで月額・年額商品を取得。
- 購入、取消、復元、entitlement反映。
- Day 7後Paywall前後のアクセス。
- 未購読のread-only権限。
- オフライン・RevenueCat障害時の安全な表示。
- Apple Introductory Offerを前提にしていないこと。

商品、価格、sandbox状態は未確認。

## 14. セキュリティ・プライバシー

- client bundleにserver secretsがない。
- 自社API、DB、Storage、ログにユーザー音声がない。
- exportに音声・秘密がない。
- ローカル音声が最大30暦日で削除される。
- 14日復習完了後の早期削除と学習削除が動く。
- RevenueCat webhookとAPI authが認証される。
- protected writeの負のテストが通る。
- secret/error redactionが通る。

## 15. 文書チェック

- マスター、00、01〜10、Phase 13の固定値が一致する。
- Markdown内部リンクが存在する。
- 旧称は現在実装・履歴・移行説明だけ。
- 旧課題数、旧価格、旧コンテンツ量が現役仕様として残らない。
- 実行時OpenAI/Piper、自由入力、オンデバイス等の一致は対象外/現在実装の説明だけ。
- TBD、MVP初期値、実機検証目標、未確認が区別される。

## 16. MVP技術的完成

次をすべて満たすまで完成としない。

- 新中心体験、自動テスト、統合テストが通る。
- 約104課題と資産のレビューが完了する。
- 実機Azureの品質・速度証拠がある。
- RevenueCat sandboxが完走する。
- trial、subscription、削除、音声、秘密境界が確認される。
- 設計書と実装差分が解消または明示承認される。

App Store申請、一般公開、Productionデプロイは技術的完成の外であり、別承認とする。
