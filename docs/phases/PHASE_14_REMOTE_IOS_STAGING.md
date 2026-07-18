# Phase 14: 外出先 iPhone テスト環境

## 目的

外出先の iPhone で、Mac、USB、同一Wi-Fi、Metroを使わずにステージング環境を確認する。

## 構成

```text
iPhone TestFlight ステージング版
  -> HTTPS -> Vercel staging API / Supabase / inference service
  <- EAS Update staging channel
```

- TestFlightビルド: ネイティブ依存、権限、課金、通知を含む検証用バイナリ。
- EAS Update `staging`: TypeScript、画面、画像、API呼び出しなど非ネイティブ変更の即時配信先。
- `development`: Macと同一ネットワーク上でのみ使うdev client用チャンネル。
- 本番用チャンネルはこのPhaseでは作成しない。

## 初回セットアップ

1. ExpoアカウントとApple Developer Programのアカウントを用意する。
2. Expoへログインする。

   ```sh
   npx eas-cli@latest login
   ```

3. EAS Updateプロジェクトを接続する。

   ```sh
   npm run eas:configure
   ```

   このコマンドは `apps/mobile/app.json` に EAS project ID、updates URL、runtimeVersion を追加する。変更を確認してコミットする。

4. Expo dashboardの `preview` Environment に、次の値を **SensitiveではなくPlain text** として登録する。

   ```text
   EXPO_PUBLIC_SUPABASE_URL
   EXPO_PUBLIC_SUPABASE_ANON_KEY
   EXPO_PUBLIC_API_BASE_URL
   EXPO_PUBLIC_REVENUECAT_IOS_PUBLIC_SDK_KEY
   ```

   値は `apps/mobile/.env` のステージング値と一致させる。サーバー専用キーはEASへ登録しない。

5. TestFlight用ステージングビルドを作る。

   ```sh
   npm run eas:build:staging
   npm run eas:submit:staging
   ```

   初回はAppleのBundle ID、署名、App Store Connectの設定を対話形式で完了する。

`version`は`apps/mobile/app.json`を正とし、現在のTestFlight検証版は`0.1.1`（提出済みbuild `8`）。EASのremote build numberを`autoIncrement`し、同じマーケティングバージョン内でもApp Store Connectへ重複しないbuild numberを提出する。

## 日常の更新

画面・ロジック・画像・公開API URLの変更だけなら、新しいiOSビルドは不要。

```sh
npm run eas:update:staging -- --message "練習画面の文言を更新"
```

TestFlightアプリを完全に終了してから再度開く。通常は1回目の起動で更新を取得し、2回目の起動で適用される。

次の変更は新しいTestFlightビルドが必要。

- `app.json`、Expo SDK、ネイティブ依存、iOS権限
- RevenueCat SDKまたはStoreKit設定
- ネイティブ設定を必要とする通知・録音機能の変更

## iPhoneでの確認

1. App StoreからTestFlightをインストールする。
2. TestFlightの招待を開き、Pronunciation Mirrorのステージング版をインストールする。
3. 初回起動時にマイクを許可する。
4. デイリー練習で、お手本再生、録音、採点、IPA表示、助言表示を確認する。
5. 更新後はアプリを完全終了し、再度2回起動して更新を反映する。

## 切り分け

- アプリが更新されない: TestFlightのビルドが `staging` channel を持つこと、更新のruntimeVersionが一致することをEAS dashboardで確認する。
- APIに接続できない: `EXPO_PUBLIC_API_BASE_URL` が `https://` の公開ステージングURLであり、`localhost` またはMacのLAN IPではないことを確認する。
- 録音だけ失敗する: iPhone設定からマイク権限を確認し、実機の音声で再試行する。
