# Phase 13: 新MVP統合・ステージング準備

> 文書状態: 現役の受け入れ文書
> 上位仕様: [Otokagami仕様書体系](../specs/00_README.md)
> 注意: 本文は将来の統合確認範囲を定義する。第3段階で実装・外部接続を行う指示ではない。

## 1. 目的

新しいOtokagami MVPが、ローカルと許可済みステージング環境で一貫して動き、「App Store申請前のアプリ完成」と呼べる技術状態かを検証する。

Phase 01〜12の旧実装完了や、旧MVPのTestFlight提出記録は、新MVPの完成証拠へ自動的に引き継がない。

## 2. 前提

- [製品目標](../specs/01_PRODUCT_GOAL.md)から[テスト計画](../specs/10_TEST_PLAN.md)までが最新である。
- 第4段階以降で新仕様への移行実装が完了している。
- コード、DB、コンテンツ、外部環境の差分が明示されている。
- 有料API、Hosted DB、ステージング、RevenueCat sandboxの実行は対象と費用を含む明示承認がある。
- Production、App Store申請、一般公開は別承認である。

## 3. 完成対象

含む:

- 1日1焦点音、通常5課題、短縮、任意追加2課題。
- 対象1音の主要結果、静的コーチ、guided retry、before／after。
- 発見、即時改善、維持、転移、定着、メンテナンス。
- Program Day、Calendar Date、Review Due Date。
- 7 active learning days、Day 7レポート、Day 8前Paywall。
- 1・3・7・14日復習と休止後の復帰。
- 約104管理課題と約208音声、助言21件以上、正式図解8件以上。
- Azure直接ストリーミング、主要結果と保存の分離、idempotency。
- RevenueCat sandbox購入・復元・webhook。
- 音声非保存、端末30日保持、書き出し・削除、秘密・RLS。

含まない:

- 自由入力、AI会話、音素表練習、別建て苦手ドリル。
- 実行時OpenAI/Piper/Python中心経路。
- レベル、バッジ、称号、全41音ヒートマップ、総合点グラフ。
- オンデバイス判定。
- App Store Connect申請、一般公開、Productionデプロイ。

## 4. 統合確認

### 4.1 セッション

- 通常5つの課題役割が一貫して生成・表示される。
- 良好日の短縮が約3課題で成立する。
- 任意追加2課題なしでProgram Dayが完了する。
- 未完了セッションを日付変更後も同じDay・位置から再開する。
- 1 Calendar Dateで2 Program Daysを完了できない。
- 期限超過復習を最大1件だけ統合する。

### 4.2 判定・再挑戦

- Azure短期トークンとPCM直接streamが動く。
- 技術的無効録音を学習成果へ入れない。
- 対象1音の主要結果を長期集計より先に表示する。
- コーチは事前生成資産から即時表示する。
- guided retryとbefore／afterを結ぶ。
- 同日再録音がdurable進捗を水増ししない。
- 保存失敗後、録音なしで同じclient attemptを再送する。

### 4.3 日付・学習状態

- 休止でProgram Dayは進まず、Review Due Dateは進む。
- overdueを失敗・自動消化にしない。
- 別日の無補助証拠だけをheld候補にする。
- 別課題の無補助証拠だけをtransferred候補にする。
- 7日期限前にstableを捏造しない。

### 4.4 無料体験・課金

- 最初の有効判定でtrialを開始する。
- Day 1〜Day 7をactive learning daysとして数える。
- Day 7レポート後、8回目の学習日前にPaywallを出す。
- 自動課金・Apple Introductory Offerを前提にしない。
- 月額/年額のRevenueCat商品を取得し、購入・復元・webhookを確認する。
- 未購読でも過去閲覧、復元、書き出し・削除を許可する。

## 5. コンテンツ準備

- 8焦点群。
- 各12課題、計96。
- 診断候補8、合計約104。
- standard/slow約208音声。
- 主/代替コツ16、汎用5、助言21以上。
- 正式図解8以上。
- 発音指導者レビューとAzure実機検証。
- active versionの参照整合性。

候補数やSeed件数ではなく、レビュー済み・実機検証済みのactive資産だけを数える。

## 6. 品質確認

### 自動

- workspacesのlint/test/build。
- CoreのProgram Day、attempt、evidence、review、idempotency。
- API認証、access、assessment、completion、report、billing、export/delete。
- DB migration、Seed、RLS、protected write拒否。
- Mobile状態機械、offline、保存再送、ローカル音声削除。
- 文書リンク・固定値の整合。

### 実機

- iPhone実機の録音、Azure final result、主要結果。
- マイク・Bluetooth・route変更、background/foreground。
- 初期8焦点群のAzure挙動。
- 主要結果と次問までの区間レイテンシ。
- 通常5課題とDay 1の完了時間。
- 端末before／afterの保持・欠損・削除。
- RevenueCat sandbox購入・復元。

P95 3秒、成功率等は現時点で`実機検証目標`。正式な合格値はTBD。

## 7. セキュリティ・プライバシー

- Expo bundleにserver secretsがない。
- Azure keyはサーバーだけ、クライアントは短期tokenだけ。
- 自社API、DB、Storage、ログにユーザー音声がない。
- before／afterは端末で最大30暦日、14日完了時の早期削除と学習削除が動く。
- subscription、trial、durable evidenceをclientだけで更新できない。
- RevenueCat webhookとserver APIが認証される。
- 他ユーザーのread/writeを拒否する。
- exportに音声・秘密がない。
- 学習削除でtrialを再付与しない。

## 8. ステージング

ステージングを使う場合も、作成・更新・有料利用は別承認とする。

- 環境をProductionと明確に分ける。
- mobile、API、Supabase、RevenueCat sandboxの組み合わせを記録する。
- 旧Python/OpenAI/Piper環境が存在しても、新MVP中心経路で呼ばれないことを確認する。
- Hosted Supabaseの現状は接続確認まで未確認とする。
- Vercel Previewが自動作成されても、Production承認にはならない。

## 9. 完了条件

- [ ] 新MVPの自動テストがすべて通る。
- [ ] 1日1焦点音・5課題・短縮・任意追加が統合確認済み。
- [ ] 主要結果・コーチ・guided retry・before/afterが実機確認済み。
- [ ] Program DayとReview Due Dateの休止シナリオが確認済み。
- [ ] 同日再録音と再送によるdurable進捗水増しがない。
- [ ] 約104課題と資産がレビュー済みである。
- [ ] Azure実機品質・レイテンシの証拠がある。
- [ ] RevenueCat sandbox購入・復元・webhookが確認済み。
- [ ] 音声非保存、端末保持、export/delete、RLS、秘密境界が確認済み。
- [ ] 未達の性能値をPASSと記録していない。
- [ ] App Store申請、一般公開、Productionへ進んでいない。

## 10. 証拠の記録

結果は[Phase 13準備状況](PHASE_13_TESTFLIGHT_READINESS_CHECKLIST.md)へ、`確認済み`、`旧実装のみ確認済み`、`未実装`、`未確認`、`blocked`を分けて記録する。秘密、音声、個人データ、実キーは記録しない。
