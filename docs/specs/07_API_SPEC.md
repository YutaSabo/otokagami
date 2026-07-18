# API Spec

## 目的

この仕様は、Expoアプリ、Next.js API、Python推論サービス、Supabase、Azure、OpenAI、RevenueCat、Piper の責務境界を定義する。

## 基本方針

- Expoアプリはサーバー専用キーを持たない。
- Azure Subscription Key、OpenAI、Supabase service role、RevenueCat secret はNext.js APIまたはサーバー側処理のみで使う。
- Azure発音判定の音声は、バックエンド発行の短期トークンを使い、iPhoneからAzureへ直接ストリーミングする。
- Python推論サービスは IPA変換、phonemizer/eSpeak NG、Piper TTS を担当する。
- Supabaseのユーザー所有データは `auth.uid()` とRLSを基本にする。
- 集計更新のような不整合が困る処理はサーバーAPIで行う。

## サービス構成

```text
Expo iPhone App
  -> Supabase Auth / RLS read
  -> Next.js API
      -> Azure token issuance endpoint
      -> Supabase service role
      -> OpenAI API
      -> RevenueCat API/Webhook
      -> Python Inference Service
          -> eSpeak NG / phonemizer / CMU辞書
          -> Piper TTS
```

## 認証

### アプリからNext.js API

アプリはSupabase anonymous authのJWTを `Authorization: Bearer <access_token>` として送る。

Next.js APIはSupabaseでJWTを検証し、`user_id = auth.uid()` として処理する。

### サーバー間

Next.js APIからPython推論サービスへの通信は、サーバー間APIキーで保護する。

このキーは `PYTHON_SERVICE_API_KEY` とし、Expoアプリ側には置かない。

## 共通レスポンス

### 成功

```json
{
  "ok": true,
  "data": {}
}
```

### 失敗

```json
{
  "ok": false,
  "error": {
    "code": "AZURE_ASSESSMENT_FAILED",
    "message": "判定に失敗しました。",
    "retryable": true
  }
}
```

エラー本文に秘密情報、APIキー、外部サービスの生トークンを含めない。

## Next.js API

### POST `/api/bootstrap`

初回起動またはアプリ起動時に、プロフィールと無料期間状態を初期化/取得する。

`device_install_id` はNext.js APIでハッシュ化し、`installations.device_install_id_hash` として保存する。生の `device_install_id` はDB、ログ、レスポンスに保存しない。同じ端末識別補助IDが再送された場合は既存 `installations` 行の `last_seen_at` を更新し、無料期間を再付与しない。

Request:

```json
{
  "timezone": "Asia/Tokyo",
  "device_install_id": "keychain-generated-id",
  "app_version": "1.0.0"
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "profile": {
      "user_id": "uuid",
      "anon_public_id": "pm_...",
      "native_language": "ja",
      "target_accent": "US",
      "free_trial_started_at": "2026-07-04T00:00:00Z",
      "free_text_consent_version": null,
      "free_text_consented_at": null
    },
    "access": {
      "is_pro": false,
      "is_trial_active": true,
      "requires_paywall": false,
      "trial_day": 1
    }
  }
}
```

### POST `/api/practice-session`

デイリー以外の練習セッションをサーバー側で生成する。苦手ドリルと音素表練習の出題ロジックはクライアントに分散させず、Next.js APIに集約する。

Request:

```json
{
  "mode": "weak_drill",
  "phoneme_id": null,
  "timezone": "Asia/Tokyo",
  "session_date": "2026-07-04"
}
```

`mode = phoneme_select` の場合は `phoneme_id` を必須とする。

処理:

1. JWTを検証する。
2. アクセス権を確認する。
3. `mode = weak_drill` の場合、`phoneme_state.mastery_ewma` が低い音素、`next_review_date <= 今日`、`ja_difficulty` を優先して出題する。
4. `mode = phoneme_select` の場合、指定 `phoneme_id` をターゲットに持つ `practice_items` から出題する。
5. 出題対象は `practice_items.is_active = true` のパック問題に限定する。
6. 返却した問題は `/api/assess` の `practice_mode = weak_drill` または `phoneme_select` で判定する。

Response:

```json
{
  "ok": true,
  "data": {
    "mode": "weak_drill",
    "items": [
      {
        "practice_item_id": "word_r_001",
        "text": "right",
        "expected_ipa": "/raɪt/",
        "target_phoneme_ids": ["r"],
        "tts": {
          "normal_url": "https://...",
          "slow_url": "https://..."
        }
      }
    ]
  }
}
```

### GET `/api/access-status`

無料期間とRevenueCat購読状態から、練習可否を返す。

Response:

```json
{
  "ok": true,
  "data": {
    "is_pro": false,
    "is_trial_active": true,
    "requires_paywall": false,
    "free_trial_ends_at": "2026-07-11T00:00:00Z"
  }
}
```

### POST `/api/daily-session`

指定ローカル日付のdaily sessionを取得または生成する。

Request:

```json
{
  "session_date": "2026-07-04",
  "timezone": "Asia/Tokyo"
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "daily_session_id": "uuid",
    "session_date": "2026-07-04",
    "status": "in_progress",
    "completed_count": 0,
    "items": [
      {
        "daily_session_item_id": "uuid",
        "position": 1,
        "slot_type": "weak",
        "practice_item_id": "word_r_001",
        "text": "right",
        "expected_ipa": "/raɪt/",
        "target_phoneme_ids": ["r"],
        "tts": {
          "normal_url": "https://...",
          "slow_url": "https://..."
        }
      }
    ]
  }
}
```

### POST `/api/speech-token`

認証済みかつ練習権限のあるユーザーへAzure Speech短期トークンを返す。Subscription Keyはレスポンス、ログ、クライアントバンドルへ含めない。

Request:

```json
{ "locale": "en-US" }
```

Response:

```json
{
  "ok": true,
  "data": {
    "token": "short-lived-token",
    "region": "japaneast",
    "locale": "en-US",
    "issued_at": "2026-07-12T00:00:00.000Z",
    "expires_at": "2026-07-12T00:10:00.000Z",
    "refresh_after": "2026-07-12T00:08:00.000Z",
    "capabilities": {
      "phonemeScores": true,
      "ipaPhonemeNames": true,
      "spokenPhonemeCandidates": true,
      "syllables": true,
      "prosody": true,
      "miscue": true
    }
  }
}
```

### POST `/api/assess`

端末がAzureから受信した判定結果を検証・正規化し、attempt保存、best attempt更新、集計更新を行う。音声は受け取らない。Content-Typeは `application/json` とする。

Fields:

| フィールド | 内容 |
| --- | --- |
| `azure_result` | Speech SDKの最終JSON。 |
| `client_timing` | 音声内容を含まない性能計測値。 |
| `practice_item_id` | 問題ID。 |
| `practice_mode` | `daily`、`weak_drill`、`phoneme_select`。 |
| `daily_session_id` | デイリー時のみ。 |
| `daily_session_item_id` | デイリー時のみ。 |
| `attempt_no` | 同一問題内連番。 |
| `timezone` | IANA timezone。 |
| `practiced_date` | 端末ローカル日付。 |
| `app_version` | アプリバージョン。 |

処理:

1. JWTを検証する。
2. アクセス権を確認する。
3. Azure結果のサイズと型、問題IDから解決した参照テキスト、ロケールを検証する。
4. Azureレスポンスをアプリ共通の `pronunciation_assessment` と互換用 `phoneme_results` に正規化する。
5. `attempts` と `attempt_phoneme_results` を保存する。
6. 同一問題内のbest attemptを再計算する。
7. best attemptが変わった場合、`phoneme_state`、`phoneme_snapshots`、バッジを更新する。
8. 必要な直し方ページ候補を返す。

Response:

```json
{
  "ok": true,
  "data": {
    "attempt_id": "uuid",
    "is_best": true,
    "overall_score": 82.4,
    "target_score_avg": 78.0,
    "is_correct": false,
    "is_perfect": false,
    "pronunciation_assessment": {
      "provider": "azure",
      "locale": "en-US",
      "referenceText": "right",
      "timing": {},
      "capabilities": {},
      "overall": {},
      "issues": {},
      "words": []
    },
    "phoneme_results": [
      {
        "index": 0,
        "word_index": 0,
        "expected_phoneme_id": "r",
        "expected_ipa": "r",
        "observed_phoneme_id": "l",
        "observed_ipa": "l",
        "score": 52,
        "color": "red",
        "is_target": true,
        "confusion_pair_id": "r_to_l"
      }
    ],
    "next": {
      "recommended_advice_id": "r_to_l"
    },
    "earned_badges": []
  }
}
```

### POST `/api/free-assess`

Pro自由入力を判定し、`free_attempts` に保存する。

パック集計は更新しない。

Requestは `application/json`。音声本体は送らず、iPhoneがAzure Speech SDKから受け取った結果だけを送る。

Fields:

| フィールド | 内容 |
| --- | --- |
| `text` | 入力文。 |
| `azure_result` | Azure Speech SDKの詳細結果JSON。 |
| `client_timing` | 認識遅延などの個人情報を含まない性能計測値。 |
| `locale` | 判定ロケール。MVPは`en-US`。 |
| `timezone` | IANA timezone。 |
| `attempted_date` | 端末ローカル日付。 |
| `consent_version` | 自由入力保存同意の版。 |
| `app_version` | アプリバージョン。 |

処理:

1. Pro entitlementを確認する。
2. 日次ソフトキャップを確認する。
3. `profiles.free_text_consent_version` と `profiles.free_text_consented_at` により同意済みか確認する。未同意の場合は `FREE_TEXT_CONSENT_REQUIRED` を返す。
4. Pythonサービスで正規化とIPA変換を行う。
5. Azure判定を行う。
6. `free_attempts` に保存する。
7. `phoneme_state` 等は更新しない。

Response:

```json
{
  "ok": true,
  "data": {
    "free_attempt_id": "uuid",
    "overall_score": 75.2,
    "ipa_result": {},
    "phoneme_scores": {},
    "limit": {
      "used_today": 3,
      "soft_cap": 20
    }
  }
}
```

### POST `/api/free-text-consent`

自由入力の初回利用時に、入力文保存への同意状態を保存する。

Request:

```json
{
  "consent_version": "free_text_ja_v1"
}
```

処理:

1. JWTを検証する。
2. Pro entitlementを確認する。
3. `profiles.free_text_consent_version` と `profiles.free_text_consented_at` を更新する。

Response:

```json
{
  "ok": true,
  "data": {
    "free_text_consent_version": "free_text_ja_v1",
    "free_text_consented_at": "2026-07-04T00:00:00Z"
  }
}
```

### POST `/api/tts`

お手本音声URLを取得する。キャッシュがなければPythonサービスでPiper生成する。

Request:

```json
{
  "text": "right",
  "accent": "US",
  "speed": "normal"
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "cache_key": "tts:US:normal:...",
    "url": "https://...",
    "duration_ms": 850
  }
}
```

### GET `/api/advice/:advice_id`

直し方ページを取得する。

Response:

```json
{
  "ok": true,
  "data": {
    "advice_id": "advice_r_to_l_ja_us",
    "title": "r が l に聞こえています",
    "short_tip": "舌先をどこにもつけず、口の奥で軽く丸めます。",
    "comparison_text": "l は舌先が上の歯ぐきに触れます。r は触れません。",
    "asset_id": "pair_r_to_l",
    "coach_example_text": "right"
  }
}
```

### POST `/api/advice-feedback`

助言評価を保存する。

Request:

```json
{
  "attempt_id": "uuid",
  "free_attempt_id": null,
  "advice_id": "advice_r_to_l_ja_us",
  "rating": "up"
}
```

### GET `/api/progress`

進捗画面用データを返す。

Response:

```json
{
  "ok": true,
  "data": {
    "streak": {
      "current": 7,
      "longest": 12
    },
    "overall_mastery": 72.4,
    "phoneme_heatmap": [],
    "mastery_series": [],
    "level": {
      "level": 3,
      "name": "音素トレーナー",
      "completed_items": 28
    },
    "title": {
      "title_id": "daily_regular",
      "name": "毎日の発音習慣"
    },
    "badges": []
  }
}
```

### POST `/api/export`

学習データをJSONで書き出す。

Response:

```json
{
  "ok": true,
  "data": {
    "exported_at": "2026-07-04T00:00:00Z",
    "profile": {},
    "attempts": [],
    "phoneme_state": [],
    "free_attempts": []
  }
}
```

### POST `/api/delete-learning-data`

学習データを削除する。

Request:

```json
{
  "confirm": true
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "deleted_at": "2026-07-04T00:00:00Z"
  }
}
```

端末ローカル録音はアプリ側で削除する。サーバーAPIはサーバーデータ削除を担当する。

### POST `/api/revenuecat/webhook`

RevenueCat webhook受信用。クライアントから呼ばない。

処理:

1. RevenueCat webhook authorizationを検証する。
2. 対象ユーザーを特定する。
3. `subscriptions` を更新する。
4. 生イベントを保存する。

## Python推論サービスAPI

Python推論サービスはインターネット公開を避ける。Next.js APIからのみ呼ぶ。

### POST `/internal/ipa`

正規化とIPA変換を行う。

Request:

```json
{
  "text": "I read it again.",
  "accent": "US"
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "normalized_text": "I read it again.",
    "ipa": "...",
    "words": [],
    "oov_words": [],
    "conversion_confidence": 0.92
  }
}
```

### POST `/internal/tts`

Piperで音声生成する。

Request:

```json
{
  "text": "right",
  "accent": "US",
  "speed": "slow"
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "audio_format": "wav",
    "audio_base64": "...",
    "duration_ms": 1200
  }
}
```

## Azure連携

### 入力音声

- iOS側で16kHz、16bit、mono PCMをAzure Speech SDKへ録音中にpushする。
- `HundredMark`、`Phoneme`、`IPA`、`NBestPhonemeCount = 5`、miscue、prosodyを標準設定とする。
- `en-US`以外ではロケール別capabilitiesを参照し、取得不能値を0や空文字で補わない。

### 保存

保存する:

- 音声本体を除くAzure JSONレスポンス全文。
- 正規化済み音素結果。
- 共通形式のoverall、issues、words、timing、capabilities、target平均、正解フラグ。

保存しない:

- 音声ファイル。
- Azureへストリーミングした音声のサーバーコピー。

## RevenueCat連携

### クライアント

ExpoアプリはRevenueCat public SDK keyを使う。

MVPでは RevenueCat App User ID に Supabase `auth.users.id` を設定する。

### サーバー

Next.js APIはRevenueCat secret keyを使う。

secret keyは `.env` のサーバー専用変数に置く。`EXPO_PUBLIC_` に置かない。

RevenueCat webhookでは、イベント内の App User ID を Supabase `user_id` として扱い、`subscriptions.revenuecat_app_user_id` と `subscriptions.user_id` を同じユーザーに紐付ける。

## レート制限

MVPで必要な制限:

| 対象 | 制限 |
| --- | --- |
| `/api/assess` | 通常利用を妨げない範囲でユーザー単位制限。 |
| `/api/free-assess` | Proでも1日20回程度のソフトキャップ。 |
| `/api/tts` | テキスト+速度+アクセントでキャッシュ優先。 |
| `/api/advice` OpenAI生成 | キャッシュ優先。未知ケースのみ生成。 |

制限超過時のエラー:

```json
{
  "ok": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "今日はこれ以上利用できません。明日また試してください。",
    "retryable": false
  }
}
```

## エラーコード

| code | retryable | 内容 |
| --- | --- | --- |
| `UNAUTHORIZED` | false | JWT不正。 |
| `PAYWALL_REQUIRED` | false | Proまたは無料期間が必要。 |
| `FREE_TEXT_PRO_REQUIRED` | false | 自由入力はPro限定。 |
| `FREE_TEXT_CONSENT_REQUIRED` | false | 自由入力保存同意が必要。 |
| `RATE_LIMITED` | false | レート制限。 |
| `AZURE_ASSESSMENT_FAILED` | true | Azure判定失敗。 |
| `IPA_CONVERSION_FAILED` | true | IPA変換失敗。 |
| `TTS_FAILED` | true | TTS生成失敗。 |
| `OPENAI_ADVICE_FAILED` | true | OpenAI助言生成失敗。 |
| `SUPABASE_SAVE_FAILED` | true | DB保存失敗。 |
| `REVENUECAT_UNAVAILABLE` | true | 購読状態確認失敗。 |

## セキュリティ禁止事項

- AzureキーをExpoアプリへ渡さない。
- OpenAI APIキーをExpoアプリへ渡さない。
- Supabase service role keyをExpoアプリへ渡さない。
- RevenueCat secret keyをExpoアプリへ渡さない。
- Pythonサービス内部APIキーをExpoアプリへ渡さない。
- エラーログに秘密値を保存しない。
- APIレスポンスに秘密値を含めない。

## フェーズ4セルフレビュー

- マスター設計書・既作成ドキュメントとの矛盾: バックエンド経由Azure、Python音素処理、Piper都度生成、OpenAIテンプレ優先、RevenueCat/IAP、自由入力分離を反映済み。
- Codexが実装に着手できる具体性: 主要エンドポイント、リクエスト/レスポンス、処理順、エラーコード、サーバー間APIを定義済み。
- 用語・命名の一貫性: `daily_session_id`、`attempt_id`、`free_attempt_id`、`phoneme_results`、`advice_id` をDB仕様と一致させた。
