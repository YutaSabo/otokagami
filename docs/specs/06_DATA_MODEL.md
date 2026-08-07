# Otokagami データ概念仕様

> 文書状態: 現役
> 注意: 目標概念を定義する。具体的なDB migration、SQL、RPC/outbox/queueの選択は第4段階以降。

## 1. データ原則

1. 学習証拠と、表示用の即時変化を分ける。
2. Program Day、Calendar Date、Review Due Dateを別フィールド・別意味で保持する。
3. 再送可能なすべての書き込みにidempotencyを持たせる。
4. durable進捗は信頼できるサーバーまたはデータポリシー境界で確定する。
5. ユーザー音声をサーバーDBやStorageへ保存しない。
6. 多地域化のため、判定ロケールと助言ロケールを分離する。
7. 現行テーブルの存在を新仕様の採用根拠にしない。

## 2. 概念モデル

```text
User / Installation / Subscription
  └─ Program Enrollment
      ├─ Program Day Session
      │   ├─ Session Item
      │   │   ├─ Attempt
      │   │   └─ Correction Cycle
      │   └─ Completion
      ├─ Focus State / Evidence
      ├─ Review Schedule
      └─ Reports

Content Version
  ├─ Focus Group
  ├─ Practice Item
  ├─ Reference Audio
  ├─ Advice
  └─ Diagram
```

## 3. ユーザー・無料体験・購読

### User profile

- Supabase anonymous auth user ID
- timezone
- coaching locale（初期`ja-JP`）
- assessment locale（初期`en-US`）
- target accent
- 通知設定
- 作成・更新・削除状態

母語または国籍を保存する場合も、スコア補正や共通教材の採点条件に使わない。

### Installation

- 再インストールによる無料体験再付与を抑える補助識別子のハッシュ
- userとの関連
- first/last seen

生の端末識別値を永続ログやレスポンスへ残さない。端末情報だけを唯一の権限根拠にしない。

### Program enrollment

無料体験と購読を分離する。

- trial started flag / started at
- current Program Day number
- completed Program Days
- first valid learning attempt ID
- last completed Calendar Date
- trial exhausted / Day 7 report state
- entitlementに依存しない試用履歴

学習データ削除で、無料体験履歴を再付与可能な初期状態へ戻さない。

### Subscription

- RevenueCat App User ID
- entitlement ID
- product ID
- status / active period
- latest verified event

商品ID、Offering、Package、実価格はTBD。クライアント表示だけを購読権限の正本にしない。

## 4. Program Day session

必要な概念:

- session ID
- user ID
- Program Day number
- originating Calendar Date / timezone
- focus group ID
- status: planned / in_progress / completed
- required item count: 通常5、短縮時は約3
- optional item count: 最大2
- current position
- started/completed timestamps
- completion idempotency key

同一user・Program Dayを一意にする。Calendar Dateが変わっても未完了セッションは同じIDを継続できる。1 Calendar Dateで複数Program Dayを完了できない制約をサーバー側で確認する。

## 5. Session item

- item ID / session ID / position
- practice item IDとcontent version
- prompt role: `anchor`、`contrast`、`transfer_word`、`sentence`、`practical_sentence`、`review`、`optional_extension`
- focus group ID
- required / optional
- review source evidence IDまたはReview Due Date
- status
- selected before/after attempt IDs
- completion reason: completed / shortened / substituted / skipped_after_technical_failures

必須と任意を混同せず、追加課題がProgram Day完了条件へ入らないようにする。

## 6. Attempt

### 必須概念

- server attempt ID
- `client_attempt_id`: クライアント生成の冪等キー
- user / session / item / practice item / content version
- focus groupとprompt role
- attempt role: `cold`、`guided_retry`、`transfer`、`review`、`optional_extension`
- `retry_of_attempt_id`
- sequence number
- attempted at UTC、Calendar Date、timezone
- coaching shown before attemptか
- technical validityとinvalid reason
- Azure provider/locale/capabilities
- 対象音の正規化結果
- 必要に応じた詳細結果。音声本体を含めない
- persistence state / created timestamps

### 無効attempt

無音、短すぎ、クリッピング、NoMatch、取消、課題不一致、対象音欠損、必須結果欠損等を区別する。無効attemptは有効回数や学習状態へ含めないが、個人情報を最小化した技術診断イベントとして記録できる。

### 再送

同一userと`client_attempt_id`の再送は同じ結果を返し、新規attempt、Program Day、durable証拠を作らない。payloadが異なる場合は競合として拒否する。

## 7. 正規化された判定結果

中心表示に必要な最小概念:

- provider / assessment locale
- practice item / reference text version
- focus sound expected representation
- observed candidate（取得できる場合）
- target score（取得できる場合）
- technical validity
- result labelとnext action key
- optional details / capabilities

Azureの値がない場合、0や空文字で捏造せずnullとcapabilityで表す。総合点、Fluency、Completeness、Prosodyは保存できても主要結果モデルの必須にはしない。

## 8. Correction cycle

- correction cycle ID
- user / session item / focus group
- before attempt ID
- advice ID / version / coaching locale
- after attempt ID（最大で代表1件）
- candidate change type
- immediate change status
- representative local audio availability metadata

サーバーへローカル音声URIやファイルを送らない。端末内でcorrection cycle IDとローカルファイルを対応付ける。

## 9. Focus evidenceと状態

生のattemptから、次の証拠を別概念として保持する。

- evidence ID
- focus group
- evidence kind: discovered / immediate_change / held / transferred / stable / maintenance
- source attemptまたはcorrection cycle
- Calendar Date
- prompt role / context
- assistedか
- content/advice version
- server-verified status

durable証拠には一意制約相当の重複防止が必要である。

```text
user + calendar_date + focus_group + prompt_role + evidence_kind
```

具体的なDB制約・集計方式はTBD。

Focus stateは、現在段階、最後の無補助成功日、次の課題役割、Review Due Date、メンテナンス状態を表す。逐次EWMAの単独値だけを定着の正本にしない。

## 10. Review schedule

- focus group ID
- interval kind: 1 / 3 / 7 / 14 day
- based-on evidence IDとCalendar Date
- Review Due Date
- status: due / overdue / scheduled / completed / superseded
- completion evidence ID

休止中にoverdueとなってもfailedやcompletedへ自動変更しない。日次計画に入れたかどうかを別に記録し、一度に最大1件というUXルールを支える。

## 11. Reports

日次、Day 7、週次のレポートは、再現可能な証拠IDを参照する。

- reporting period / Program Day range / Calendar Date range
- discovered / immediate / held / transferred / stable / maintenance summaries
- next reviews / next focus
- representative correction cycles
- generated content version

購入しなくても過去レポートを読めるアクセス区分を持つ。

## 12. コンテンツ

### Focus group

- stable ID
- target language / assessment locale / accent
- active version
- review status
- market tags

### Practice item

- stable ID / version
- text / normalized text / IPA
- focus positions / prompt role / context
- standard/slow audio IDs
- advice/diagram references
- recording constraints
- review status / active

### Advice / diagram / audio

- stable ID / version
- coaching locale
- focus group
- review status
- asset integrity metadata

コンテンツ書き込みは管理境界だけに許可し、クライアントがactive化できないようにする。

## 13. 端末ローカル音声

サーバーではなく端末だけに保持する。

- 代表before／afterのみ
- correction cycle IDとの対応
- created Calendar Date
- deletion due date（最大30暦日）
- 14日復習完了による早期削除対象
- file availability

学習データ削除時は即時削除する。URI切れ、ファイル欠損、端末変更後もサーバー上の状態・レポートを表示できるようにする。長期録音ライブラリ用の索引は作らない。

## 14. データ削除と書き出し

### 学習データ削除

削除対象:

- session、item、attempt、normalized result
- correction cycle、focus evidence/state、review schedule、reports
- advice feedback等のユーザー学習データ
- 端末ローカルのbefore／after

無料体験履歴、購読状態、不正再付与防止に必要な最小データは別責務として扱い、学習削除だけで再付与しない。保持の法的根拠と期間はTBD。

### 書き出し

ユーザー設定、学習セッション、判定結果、改善状態、復習、レポートを含める。音声ファイル、秘密、内部認証情報、他ユーザーデータを含めない。

## 15. 権限境界

- ユーザー所有データは本人だけが読める。
- protected dataの更新とdurable進捗の確定をクライアント側フラグだけに依存させない。
- subscriptions、trial履歴、active content、サーバー検証済みevidenceは信頼境界からのみ更新する。
- RLSだけでなく、負の権限テストを持つ。
- service role等の秘密をクライアントへ置かない。

## 16. 現在DBとの境界

現在DBには`daily_sessions`、`attempts`、`phoneme_state`、自由入力、ゲーミフィケーション、Piper/OpenAIキャッシュ等の旧概念がある。再利用・変換・無効化・削除の判断は第4段階以降で行う。

Hosted Supabaseの適用状態は未確認。第3段階ではmigration、Seed、RLSを変更しない。

## 17. TBD

- 具体的なテーブル・カラム名
- migration SQL
- RPC、outbox、キュー、再計算の選択
- 保持データの法的期間
- 判定しきい値
- Hosted Supabaseの現状
- 旧データの移行・削除方針
