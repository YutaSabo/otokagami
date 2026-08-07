# Phase 14: Otokagami リモートiOSステージング確認

> 文書状態: 現役の運用手順
> 注意: 新MVP実装後、許可済みの非Production環境をiPhoneから確認するための文書。App Store申請・一般公開を承認しない。

## 1. 目的

Mac、USB、同一Wi-Fi、Metroに依存せず、iPhoneで新MVPのAzure録音、日次体験、復帰、課金sandbox、データ権利を確認する。

第3段階では外部環境へ接続・変更しない。現在のEAS、TestFlight、Vercel、Supabase、RevenueCatの状態は未確認であり、過去の提出記録を現在状態として扱わない。

## 2. 想定構成

```text
iPhone staging build
  → HTTPS → non-production API / Supabase
  → Azure Speech with short-lived token
  → RevenueCat sandbox
  ← reviewed static content / EAS Update staging
```

- iOS staging build: native Azure SDK、マイク、課金、通知を含む確認用binary。
- EAS Update `staging`: 対応runtimeの非native変更用。
- `development`: local dev client用。
- Production channel、Production DB、一般公開は本Phaseで作成しない。
- 新MVP中心経路では実行時OpenAI/Piper/Pythonを使わない。

## 3. 実行前の承認境界

次はそれぞれ個別に確認する。

- Expo/Apple/RevenueCat/Supabase/Azureへのログイン・接続権限
- staging projectの正確な対象
- build、submit、外部保存、Azure利用の費用
- Preview/stagingの公開範囲と解除手順
- Productionへ影響しないこと

App Store Connectへの提出、TestFlight配布、Production変更は「アプリ完成」と別操作であり、明示承認なしに行わない。

## 4. 現在実装の識別子

現在のcommandsとworkspaceには旧実装名が残る。名称移行が完了するまでは、動作手順として事実どおり使用する。

```sh
npm run eas:configure
npm run eas:build:staging
npm run eas:submit:staging
npm run eas:update:staging -- --message "staging update"
```

`eas:submit:staging`はApp Store Connectへの外部提出を伴うため、本Phaseの通常確認では実行せず、その正確な提出について別承認がある場合だけ使う。

## 5. Environment

staging buildへ置ける公開前提値:

```text
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
EXPO_PUBLIC_API_BASE_URL
EXPO_PUBLIC_REVENUECAT_IOS_PUBLIC_SDK_KEY
```

Azure key、Supabase service role、RevenueCat secret/webhook token、現在実装に残るOpenAI/Python秘密をEAS public environmentへ置かない。staging値がProductionを指していないことを値非表示で確認する。

## 6. 新MVP実機シナリオ

### 初回・無料体験

1. anonymous authで開始する。
2. 起動だけではProgram Day 1が始まらない。
3. 最初の有効判定でtrialが開始する。
4. 1日1焦点音と通常5課題を確認する。
5. 良好日は3課題程度で短縮できる。
6. 任意追加2課題を断っても完了できる。

### 1問

1. standard/slow音声を再生する。
2. 録音開始とAzure直接streamを確認する。
3. 対象1音の主要結果を確認する。
4. 静的コーチと図解を確認する。
5. guided retryとbefore／afterを確認する。
6. 総合点、Fluency、Completeness、Prosodyが中心表示でないことを確認する。

### 中断・復帰

1. 日次途中で終了する。
2. 別Calendar Dateに同じProgram Day・位置から再開する。
3. Review Due Dateが実日付で更新される。
4. 期限超過復習が最大1件だけ入る。
5. 同じCalendar Dateで2 Program Daysを完了できない。

### 課金

1. Day 7レポートを確認する。
2. 8回目の学習日前にPaywallを確認する。
3. RevenueCat sandboxの商品、月額/年額、購入、復元、webhookを確認する。
4. 未購読でも過去レポート、選択録音、設定、復元、export/delete、規約を閲覧する。
5. Apple Introductory Offerや自動課金trialを前提にしていないことを確認する。

### 音声・データ

1. 自社API、DB、Storageに音声がないことを確認する。
2. 代表before／afterだけが端末にあることを確認する。
3. URI欠損でもレポートが壊れないことを確認する。
4. 最大30暦日、14日復習完了、学習削除の各削除経路を確認する。

## 7. 品質計測

区間を分けて記録する。

- 問題表示→録音可能
- 録音ボタン→録音開始
- 録音停止→Azure final
- Azure final→主要結果
- 主要結果→保存確定
- 次へ→次問録音可能
- 通常5課題完了時間

P95 3秒や技術成功率候補は`実機検証目標`であり、実測前にPASSとしない。token、音声、認識本文、秘密をログへ残さない。

## 8. 切り分け

- update不反映: channelとruntime versionを確認する。
- API接続不可: `EXPO_PUBLIC_API_BASE_URL`が許可済みHTTPS stagingを指すか確認する。
- 録音失敗: マイク権限、audio route、短期token、network、対象音欠損を分ける。
- 保存失敗: 主要結果を保持し、同じclient attempt IDで再送する。再録音しない。
- 課金失敗: product、Offering、Package、sandbox account、webhook、entitlementを分ける。
- 音声再生失敗: file欠損とcontent asset欠損を区別し、画面全体を落とさない。

## 9. 完了条件

- 新MVPの中心シナリオを許可済みstagingで完走する。
- Azure・RevenueCat・Supabaseの実機/外部結果を、秘密なしで記録する。
- 性能値を実測ラベルで記録する。
- Production、App Store申請、一般公開を実行していない。

このPhaseの完了は、App Store公開承認を意味しない。
