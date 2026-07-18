import "react-native-url-polyfill/auto";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import * as Application from "expo-application";
import {
  createAudioPlayer,
  requestRecordingPermissionsAsync
} from "expo-audio";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as Network from "expo-network";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import * as Sharing from "expo-sharing";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import Purchases, { LOG_LEVEL, type LogHandler } from "react-native-purchases";
import AzurePronunciationStream, {
  type NativeAssessmentResult
} from "./modules/azure-pronunciation-stream/src";
import {
  isPronunciationBusy,
  transitionPronunciationState
} from "./lib/pronunciation-state.mjs";
import {
  pronunciationBand,
  visibleScoreMetrics
} from "./lib/pronunciation-presentation.mjs";
import {
  isRecoverableStaleRequest,
  pronunciationErrorMessage
} from "./lib/pronunciation-errors.mjs";
import {
  PronunciationSessionTracker,
  shouldRetrySavedAzureResult
} from "./lib/pronunciation-session.mjs";

declare const process: {
  env: Record<string, string | undefined>;
};

type TabKey = "home" | "progress" | "practice" | "settings";
type PlaybackSpeed = "slow" | "normal";

type Profile = {
  user_id: string;
  anon_public_id: string;
  native_language: string;
  target_accent: string;
  free_trial_started_at: string;
  free_text_consent_version?: string | null;
  free_text_consented_at?: string | null;
};

type AccessState = {
  is_pro: boolean;
  is_trial_active: boolean;
  requires_paywall: boolean;
  trial_day: number;
};

type BootstrapData = {
  profile: Profile;
  access: AccessState;
};

type AppBootstrapState =
  | { status: "loading" }
  | { status: "ready"; profile: Profile; access: AccessState; session: Session }
  | { status: "error"; message: string; retryable: boolean };

type PracticeMode = "daily" | "weak_drill" | "phoneme_select" | "free_input";
type DailyFlowStep = "idle" | "loading" | "record" | "detail" | "advice" | "complete";
type RecordingState =
  | "idle"
  | "preparing"
  | "ready"
  | "recording"
  | "finalizing"
  | "assessing"
  | "completed"
  | "failed"
  | "cancelled";
type PhonemeColor = "green" | "yellow" | "red";
type ProgressRange = "day" | "week" | "month";

type DailySessionItem = {
  daily_session_item_id?: string;
  position: number;
  slot_type?: string;
  practice_item_id: string;
  text: string;
  expected_ipa: string;
  target_phoneme_ids: string[];
  tts: {
    normal_url: string;
    slow_url: string;
  };
};

type DailySessionData = {
  daily_session_id?: string;
  session_date: string;
  status: "in_progress" | "completed";
  completed_count: number;
  mode?: PracticeMode;
  items: DailySessionItem[];
};

type PhonemeResult = {
  index: number;
  word_index: number;
  expected_phoneme_id: string;
  expected_ipa: string;
  observed_phoneme_id: string;
  observed_ipa: string;
  score: number;
  color: PhonemeColor;
  is_target: boolean;
  confusion_pair_id: string | null;
};

type AssessmentResult = {
  attempt_id: string;
  is_best: boolean;
  overall_score: number;
  target_score_avg: number;
  is_correct: boolean;
  is_perfect: boolean;
  phoneme_results: PhonemeResult[];
  pronunciation_assessment: PronunciationAssessment;
  next: {
    recommended_advice_id: string | null;
  };
  earned_badges: unknown[];
};

type PronunciationCapabilities = {
  phonemeScores: boolean;
  ipaPhonemeNames: boolean;
  spokenPhonemeCandidates: boolean;
  syllables: boolean;
  prosody: boolean;
  miscue: boolean;
};

type PronunciationAssessment = {
  provider: "azure";
  locale: string;
  referenceText: string;
  timing: {
    buttonToResultMs: number | null;
    recognitionLatencyMs: number | null;
    totalProcessingMs: number | null;
  };
  capabilities: PronunciationCapabilities;
  overall: {
    pronunciationScore: number | null;
    accuracyScore: number | null;
    fluencyScore: number | null;
    completenessScore: number | null;
    prosodyScore: number | null;
  };
  issues: Record<string, Array<{
    type: string;
    word: string | null;
    wordIndex: number;
    offset: number | null;
    duration: number | null;
    confidence: number | null;
  }>>;
  words: Array<{
    word: string | null;
    accuracyScore: number | null;
    errorType: string | null;
    offset: number | null;
    duration: number | null;
    syllables: Array<{
      syllable: string | null;
      accuracyScore: number | null;
      offset: number | null;
      duration: number | null;
    }> | null;
    phonemes: Array<{
      expectedIpa: string | null;
      observedIpa: string | null;
      accuracyScore: number | null;
      offset: number | null;
      duration: number | null;
      candidates: Array<{ ipa: string | null; score: number | null }> | null;
    }> | null;
  }>;
};

type SpeechToken = {
  token: string;
  region: string;
  locale: string;
  issued_at: string;
  refresh_after: string;
  expires_at: string;
  capabilities: PronunciationCapabilities;
};

type AssessmentPerformance = Record<string, number | string | null>;

type AdvicePage = {
  advice_id: string;
  title: string;
  short_tip: string;
  comparison_text: string;
  asset_id: string;
  coach_example_text: string;
};

type DailyAttemptState = {
  attemptNo: number;
  localAudioUri: string | null;
  azureResult: Record<string, unknown> | null;
  clientTiming: Record<string, number | null> | null;
  result: AssessmentResult | null;
};

type ProgressData = {
  streak: {
    current: number;
    longest: number;
  };
  overall_mastery: number | null;
  phoneme_heatmap: Array<{
    phoneme_id: string;
    ipa: string;
    category: string;
    mastery_ewma: number | null;
    color: PhonemeColor | "unrated";
  }>;
  mastery_series: Array<{
    date: string;
    overall_mastery: number | null;
  }>;
  level: {
    level: number;
    name: string;
    completed_items: number;
  };
  title: {
    title_id: string;
    name: string;
  };
  badges: Array<{
    badge_id: string;
    awarded_at: string;
    metadata: unknown;
  }>;
};

type ReminderSettings = {
  enabled: boolean;
  hour: number;
  minute: number;
};

type FreeAssessResult = {
  free_attempt_id: string;
  overall_score: number;
  ipa_result: {
    ipa?: string;
    normalized_text?: string;
  };
  phoneme_scores: PhonemeResult[];
  pronunciation_assessment: PronunciationAssessment;
  limit: {
    used_today: number;
    soft_cap: number;
  };
};

const DEVICE_INSTALL_ID_KEY = "pm_device_install_id_v1";
const ONBOARDING_COMPLETE_KEY = "pm_onboarding_complete_v1";
const LOCAL_RECORDINGS_KEY = "pm_local_recordings_v1";
const FREE_TEXT_CONSENT_VERSION = "free_text_ja_v1";
const REMINDER_SETTINGS_KEY = "pm_review_reminder_v1";
const TERMS_URL = "https://pronunciationmirror.app/terms";
const PRIVACY_URL = "https://pronunciationmirror.app/privacy";
const SECURE_STORE_TIMEOUT_MS = 4_000;
const NETWORK_TIMEOUT_MS = 4_000;
const AUTH_TIMEOUT_MS = 12_000;
const BOOTSTRAP_TIMEOUT_MS = 12_000;
const DAILY_SESSION_TIMEOUT_MS = 12_000;
const ASSESS_TIMEOUT_MS = 45_000;
const ADVICE_TIMEOUT_MS = 12_000;
const ADVICE_FEEDBACK_TIMEOUT_MS = 10_000;
const PROGRESS_TIMEOUT_MS = 12_000;
const FREE_ASSESS_TIMEOUT_MS = 45_000;
const DATA_MANAGEMENT_TIMEOUT_MS = 20_000;
const mobileConfig = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  apiBaseUrl: (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, ""),
  revenueCatIosPublicSdkKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_PUBLIC_SDK_KEY ?? ""
};

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const secureSupabaseStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key)
};

const supabaseClient: SupabaseClient | null =
  isHttpUrl(mobileConfig.supabaseUrl) && mobileConfig.supabaseAnonKey
    ? createClient(mobileConfig.supabaseUrl, mobileConfig.supabaseAnonKey, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: false,
          persistSession: true,
          storage: secureSupabaseStorage
        }
      })
    : null;

function getTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo";
  } catch {
    return "Asia/Tokyo";
  }
}

function getAppVersion() {
  return Application.nativeApplicationVersion ?? "0.1.1";
}

function getLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function bytesToUuid(bytes: Uint8Array) {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join("")
  ].join("-");
}

async function getOrCreateDeviceInstallId() {
  const existing = await withTimeout(
    SecureStore.getItemAsync(DEVICE_INSTALL_ID_KEY),
    SECURE_STORE_TIMEOUT_MS,
    "端末IDの確認がタイムアウトしました。"
  );
  if (existing) return existing;

  const bytes = await Crypto.getRandomBytesAsync(16);
  const id = `pm-${bytesToUuid(bytes)}`;
  await withTimeout(
    SecureStore.setItemAsync(DEVICE_INSTALL_ID_KEY, id),
    SECURE_STORE_TIMEOUT_MS,
    "端末IDの保存がタイムアウトしました。"
  );
  return id;
}

async function createStreamRequestId() {
  return `speech-${bytesToUuid(await Crypto.getRandomBytesAsync(16))}`;
}

function getApiErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "初期化に失敗しました。";
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string) {
  return Promise.race([
    operation,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]);
}

function readServerTiming(header: string | null) {
  if (!header) return {} as Record<string, number>;
  return Object.fromEntries(
    header.split(",").flatMap((entry) => {
      const [name, ...parameters] = entry.trim().split(";");
      const duration = parameters.find((parameter) => parameter.trim().startsWith("dur="));
      const value = Number(duration?.trim().slice(4));
      return name && Number.isFinite(value) ? [[`server_${name}_ms`, value]] : [];
    })
  );
}

// Performance telemetry intentionally excludes audio, recognized text, user IDs, and tokens.
function logAssessmentPerformance(values: AssessmentPerformance) {
  console.info("assessment_performance", JSON.stringify({ platform: "mobile", ...values }));
}

async function ensureOnline() {
  try {
    const state = await withTimeout(
      Network.getNetworkStateAsync(),
      NETWORK_TIMEOUT_MS,
      "ネットワーク状態の確認がタイムアウトしました。"
    );
    return Boolean(state.isConnected && state.isInternetReachable !== false);
  } catch {
    return true;
  }
}

async function getAnonymousSession(client: SupabaseClient) {
  const current = await withTimeout(
    client.auth.getSession(),
    AUTH_TIMEOUT_MS,
    "Supabaseセッション確認がタイムアウトしました。"
  );
  if (current.error) throw current.error;
  if (current.data.session) return current.data.session;

  const created = await withTimeout(
    client.auth.signInAnonymously(),
    AUTH_TIMEOUT_MS,
    "匿名ユーザー作成がタイムアウトしました。"
  );
  if (created.error) throw created.error;
  if (!created.data.session) throw new Error("匿名ユーザーを作成できませんでした。");
  return created.data.session;
}

async function getCurrentAccessToken(fallbackSession: Session) {
  if (!supabaseClient) return fallbackSession.access_token;

  const current = await withTimeout(
    supabaseClient.auth.getSession(),
    AUTH_TIMEOUT_MS,
    "Supabaseセッション更新がタイムアウトしました。"
  );
  if (current.error) throw current.error;
  return current.data.session?.access_token ?? fallbackSession.access_token;
}

async function bootstrap(session: Session): Promise<BootstrapData> {
  if (!mobileConfig.apiBaseUrl) {
    throw new Error("EXPO_PUBLIC_API_BASE_URL が未設定です。");
  }

  const accessToken = await getCurrentAccessToken(session);
  const response = await withTimeout(
    fetch(`${mobileConfig.apiBaseUrl}/api/bootstrap`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        timezone: getTimezone(),
        device_install_id: await getOrCreateDeviceInstallId(),
        app_version: getAppVersion()
      })
    }),
    BOOTSTRAP_TIMEOUT_MS,
    "/api/bootstrap がタイムアウトしました。"
  );

  const payload = (await response.json()) as {
    ok: boolean;
    data?: BootstrapData;
    error?: { message?: string; retryable?: boolean };
  };

  if (!response.ok || !payload.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "bootstrap に失敗しました。");
  }

  return payload.data;
}

async function apiJson<T>({
  session,
  path,
  method = "POST",
  body,
  timeoutMs
}: {
  session: Session;
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs: number;
}) {
  const accessToken = await getCurrentAccessToken(session);
  const response = await withTimeout(
    fetch(`${mobileConfig.apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    }),
    timeoutMs,
    `${path} がタイムアウトしました。`
  );

  const payload = (await response.json()) as {
    ok: boolean;
    data?: T;
    error?: { message?: string; retryable?: boolean };
  };

  if (!response.ok || !payload.ok || !payload.data) {
    throw new Error(payload.error?.message ?? `${path} に失敗しました。`);
  }

  return payload.data;
}

async function fetchSpeechToken(session: Session) {
  return apiJson<SpeechToken>({
    session,
    path: "/api/speech-token",
    timeoutMs: AUTH_TIMEOUT_MS,
    body: { locale: "en-US" }
  });
}

function nativeTiming(result: NativeAssessmentResult, lifecycle: Record<string, number | null> = {}) {
  return {
    tokenFetchMs: lifecycle.tokenFetchMs ?? null,
    recognizerPreparationMs: lifecycle.recognizerPreparationMs ?? null,
    buttonToAzureResultMs: result.buttonToResultMs ?? null,
    normalizationMs: lifecycle.normalizationMs ?? null,
    buttonToUiMs: lifecycle.buttonToUiMs ?? null,
    buttonToResultMs: result.buttonToResultMs ?? null,
    recognitionLatencyMs: result.recognitionLatencyMs ?? null,
    totalProcessingMs: result.buttonToResultMs ?? null,
    audioDurationMs: result.audioDurationMs
  };
}

async function fetchDailySession(session: Session) {
  return apiJson<DailySessionData>({
    session,
    path: "/api/daily-session",
    timeoutMs: DAILY_SESSION_TIMEOUT_MS,
    body: {
      session_date: getLocalDate(),
      timezone: getTimezone()
    }
  });
}

async function fetchPracticeSession(session: Session, mode: "weak_drill" | "phoneme_select", phonemeId?: string) {
  const data = await apiJson<{
    mode: PracticeMode;
    items: DailySessionItem[];
  }>({
    session,
    path: "/api/practice-session",
    timeoutMs: DAILY_SESSION_TIMEOUT_MS,
    body: {
      mode,
      phoneme_id: phonemeId ?? null,
      timezone: getTimezone(),
      session_date: getLocalDate(),
      limit: 7
    }
  });

  return {
    mode,
    session_date: getLocalDate(),
    status: "in_progress",
    completed_count: 0,
    items: data.items.map((item, index) => ({
      ...item,
      position: item.position ?? index + 1,
      daily_session_item_id: item.daily_session_item_id ?? `${mode}-${item.practice_item_id}-${index}`
    }))
  } satisfies DailySessionData;
}

async function fetchProgress(session: Session) {
  return apiJson<ProgressData>({
    session,
    path: "/api/progress",
    method: "GET",
    timeoutMs: PROGRESS_TIMEOUT_MS
  });
}

async function fetchAdvice(session: Session, adviceId: string) {
  return apiJson<AdvicePage>({
    session,
    path: `/api/advice/${encodeURIComponent(adviceId)}`,
    method: "GET",
    timeoutMs: ADVICE_TIMEOUT_MS
  });
}

async function sendAdviceFeedback({
  session,
  adviceId,
  attemptId,
  rating
}: {
  session: Session;
  adviceId: string;
  attemptId: string;
  rating: "up" | "down";
}) {
  return apiJson<{ id?: string }>({
    session,
    path: "/api/advice-feedback",
    timeoutMs: ADVICE_FEEDBACK_TIMEOUT_MS,
    body: {
      attempt_id: attemptId,
      free_attempt_id: null,
      advice_id: adviceId,
      rating
    }
  });
}

async function assessDailyItem({
  session,
  item,
  dailySessionId,
  practiceMode,
  attemptNo,
  azureResult,
  clientTiming,
  onPerformance
}: {
  session: Session;
  item: DailySessionItem;
  dailySessionId?: string;
  practiceMode: Exclude<PracticeMode, "free_input">;
  attemptNo: number;
  azureResult: Record<string, unknown>;
  clientTiming: Record<string, number | null>;
  onPerformance?: (values: AssessmentPerformance) => void;
}) {
  const startedAt = performance.now();
  const body = {
    azure_result: azureResult,
    client_timing: clientTiming,
    locale: "en-US",
    practice_item_id: item.practice_item_id,
    practice_mode: practiceMode,
    daily_session_id: practiceMode === "daily" ? dailySessionId : undefined,
    daily_session_item_id: practiceMode === "daily" ? item.daily_session_item_id : undefined,
    attempt_no: attemptNo,
    timezone: getTimezone(),
    practiced_date: getLocalDate(),
    app_version: getAppVersion()
  };

  const bodyReadyAt = performance.now();
  const accessToken = await getCurrentAccessToken(session);
  const requestStartedAt = performance.now();
  const response = await withTimeout(
    fetch(`${mobileConfig.apiBaseUrl}/api/assess`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }),
    ASSESS_TIMEOUT_MS,
    "/api/assess がタイムアウトしました。"
  );

  const responseReceivedAt = performance.now();
  const payload = (await response.json()) as {
    ok: boolean;
    data?: AssessmentResult;
    error?: { message?: string; retryable?: boolean };
  };
  const responseParsedAt = performance.now();
  onPerformance?.({
    operation: "daily_assess",
    result_body_prepare_ms: Math.round(bodyReadyAt - startedAt),
    auth_token_ms: Math.round(requestStartedAt - bodyReadyAt),
    http_round_trip_ms: Math.round(responseReceivedAt - requestStartedAt),
    response_parse_ms: Math.round(responseParsedAt - responseReceivedAt),
    client_total_ms: Math.round(responseParsedAt - startedAt),
    status: response.status,
    ...readServerTiming(response.headers.get("server-timing"))
  });

  if (!response.ok || !payload.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "判定に失敗しました。");
  }

  return payload.data;
}

async function saveFreeTextConsent(session: Session) {
  return apiJson<Pick<Profile, "free_text_consent_version" | "free_text_consented_at">>({
    session,
    path: "/api/free-text-consent",
    timeoutMs: DATA_MANAGEMENT_TIMEOUT_MS,
    body: {
      consent_version: FREE_TEXT_CONSENT_VERSION
    }
  });
}

async function assessFreeInput({
  session,
  text,
  azureResult,
  clientTiming,
  onPerformance
}: {
  session: Session;
  text: string;
  azureResult: Record<string, unknown>;
  clientTiming: Record<string, number | null>;
  onPerformance?: (values: AssessmentPerformance) => void;
}) {
  const startedAt = performance.now();
  const body = {
    azure_result: azureResult,
    client_timing: clientTiming,
    locale: "en-US",
    text,
    timezone: getTimezone(),
    attempted_date: getLocalDate(),
    consent_version: FREE_TEXT_CONSENT_VERSION,
    app_version: getAppVersion()
  };

  const bodyReadyAt = performance.now();
  const accessToken = await getCurrentAccessToken(session);
  const requestStartedAt = performance.now();
  const response = await withTimeout(
    fetch(`${mobileConfig.apiBaseUrl}/api/free-assess`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }),
    FREE_ASSESS_TIMEOUT_MS,
    "/api/free-assess がタイムアウトしました。"
  );

  const responseReceivedAt = performance.now();
  const payload = (await response.json()) as {
    ok: boolean;
    data?: FreeAssessResult;
    error?: { message?: string; retryable?: boolean };
  };
  const responseParsedAt = performance.now();
  onPerformance?.({
    operation: "free_assess",
    result_body_prepare_ms: Math.round(bodyReadyAt - startedAt),
    auth_token_ms: Math.round(requestStartedAt - bodyReadyAt),
    http_round_trip_ms: Math.round(responseReceivedAt - requestStartedAt),
    response_parse_ms: Math.round(responseParsedAt - responseReceivedAt),
    client_total_ms: Math.round(responseParsedAt - startedAt),
    status: response.status,
    ...readServerTiming(response.headers.get("server-timing"))
  });

  if (!response.ok || !payload.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "自由入力の判定に失敗しました。");
  }

  return payload.data;
}

async function rememberLocalRecording(uri: string) {
  const current = await SecureStore.getItemAsync(LOCAL_RECORDINGS_KEY);
  const uris = current ? (JSON.parse(current) as string[]) : [];
  if (!uris.includes(uri)) {
    await SecureStore.setItemAsync(LOCAL_RECORDINGS_KEY, JSON.stringify([...uris, uri]));
  }
}

async function deleteLocalRecordings() {
  const current = await SecureStore.getItemAsync(LOCAL_RECORDINGS_KEY);
  const uris = current ? (JSON.parse(current) as string[]) : [];
  await Promise.all(uris.map((uri) => FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)));
  await SecureStore.deleteItemAsync(LOCAL_RECORDINGS_KEY);
}

async function loadReminderSettings(): Promise<ReminderSettings> {
  const stored = await SecureStore.getItemAsync(REMINDER_SETTINGS_KEY);
  if (!stored) return { enabled: false, hour: 20, minute: 0 };
  try {
    const parsed = JSON.parse(stored) as ReminderSettings;
    return {
      enabled: Boolean(parsed.enabled),
      hour: Number.isInteger(parsed.hour) ? parsed.hour : 20,
      minute: Number.isInteger(parsed.minute) ? parsed.minute : 0
    };
  } catch {
    return { enabled: false, hour: 20, minute: 0 };
  }
}

async function saveReminderSettings(settings: ReminderSettings) {
  await SecureStore.setItemAsync(REMINDER_SETTINGS_KEY, JSON.stringify(settings));
}

async function scheduleReviewReminder(settings: ReminderSettings) {
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!settings.enabled) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "発音練習の時間です",
      body: "今日の7問を進めましょう。"
    },
    trigger: {
      type: "daily",
      hour: settings.hour,
      minute: settings.minute
    } as Notifications.NotificationTriggerInput
  });
}

function playAudio(uri: string, rate = 1) {
  const player = createAudioPlayer({ uri }, { downloadFirst: uri.startsWith("http") });
  player.setPlaybackRate(rate);
  player.play();
}

function colorLabel(color: PhonemeColor) {
  if (color === "green") return "OK";
  if (color === "yellow") return "要注意";
  return "直す";
}

function colorStyle(color: PhonemeColor) {
  if (color === "green") return styles.phonemeGreen;
  if (color === "yellow") return styles.phonemeYellow;
  return styles.phonemeRed;
}

function practiceModeLabel(mode: Exclude<PracticeMode, "free_input">) {
  if (mode === "daily") return "デイリー";
  if (mode === "weak_drill") return "苦手ドリル";
  return "音素表";
}

let revenueCatLogHandlerConfigured = false;

const revenueCatLogHandler: LogHandler = (logLevel, message) => {
  const isMissingOfferingProductsWarning =
    message.includes("Error fetching offerings") &&
    message.includes("no App Store products registered in the RevenueCat dashboard");

  if (isMissingOfferingProductsWarning) {
    return;
  }

  const safeMessage = message.replace(/(authorization|token|api[_ -]?key)\s*[:=]\s*\S+/gi, "$1=[REDACTED]");
  const formattedMessage = `[RevenueCat] ${safeMessage}`;

  if (logLevel === LOG_LEVEL.DEBUG) {
    if (__DEV__) console.debug(formattedMessage);
    return;
  }

  if (logLevel === LOG_LEVEL.INFO) {
    console.info(formattedMessage);
    return;
  }

  if (logLevel === LOG_LEVEL.WARN) {
    console.warn(formattedMessage);
    return;
  }

  if (logLevel === LOG_LEVEL.ERROR) {
    console.error(formattedMessage);
    return;
  }

  console.info(formattedMessage);
};

function configureRevenueCatLogging() {
  if (revenueCatLogHandlerConfigured) {
    return;
  }

  Purchases.setLogHandler(revenueCatLogHandler);
  Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN);
  revenueCatLogHandlerConfigured = true;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [bootstrapState, setBootstrapState] = useState<AppBootstrapState>({ status: "loading" });
  const streamSessionRef = useRef(new PronunciationSessionTracker());
  const speechTokenRef = useRef<SpeechToken | null>(null);
  const preparationSequenceRef = useRef(0);
  const assessmentEpochRef = useRef(0);
  const assessmentActionInFlightRef = useRef(false);
  const lifecycleTimingRef = useRef<Record<string, number | null>>({});
  const [isOnline, setIsOnline] = useState(true);
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState("初期化しています");
  const [revenueCatError, setRevenueCatError] = useState<string | null>(null);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallReason, setPaywallReason] = useState<PracticeMode>("daily");
  const [practiceNotice, setPracticeNotice] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>("normal");
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [progressData, setProgressData] = useState<ProgressData | null>(null);
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [progressRange, setProgressRange] = useState<ProgressRange>("week");
  const [dailyStep, setDailyStep] = useState<DailyFlowStep>("idle");
  const [dailySession, setDailySession] = useState<DailySessionData | null>(null);
  const [activePracticeMode, setActivePracticeMode] = useState<Exclude<PracticeMode, "free_input">>("daily");
  const [phonemePickerVisible, setPhonemePickerVisible] = useState(false);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [recordingState, setRecordingStateValue] = useState<RecordingState>("idle");
  const setRecordingState = useCallback((next: RecordingState) => {
    setRecordingStateValue((current) => transitionPronunciationState(current, next));
  }, []);
  const [dailyAttempts, setDailyAttempts] = useState<Record<string, DailyAttemptState>>({});
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [selectedAdviceId, setSelectedAdviceId] = useState<string | null>(null);
  const [advicePage, setAdvicePage] = useState<AdvicePage | null>(null);
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [freeText, setFreeText] = useState("");
  const [freeInputActive, setFreeInputActive] = useState(false);
  const [freeInputConsentVisible, setFreeInputConsentVisible] = useState(false);
  const [freeInputResult, setFreeInputResult] = useState<FreeAssessResult | null>(null);
  const [freeInputError, setFreeInputError] = useState<string | null>(null);
  const [freeInputAudioUri, setFreeInputAudioUri] = useState<string | null>(null);
  const [freeInputPendingResult, setFreeInputPendingResult] = useState<NativeAssessmentResult | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [reminderSettings, setReminderSettings] = useState<ReminderSettings>({ enabled: false, hour: 20, minute: 0 });

  const initializeRevenueCat = useCallback(async (userId: string) => {
    if (!mobileConfig.revenueCatIosPublicSdkKey) {
      setRevenueCatError("購読状態を確認できません。RevenueCat公開SDKキーが未設定です。");
      return;
    }

    try {
      configureRevenueCatLogging();
      Purchases.configure({
        apiKey: mobileConfig.revenueCatIosPublicSdkKey,
        appUserID: userId
      });
      await Purchases.getCustomerInfo();
      setRevenueCatError(null);
    } catch {
      setRevenueCatError("購読状態を確認できません。通信状態を確認して再試行してください。");
    }
  }, []);

  const loadApp = useCallback(async () => {
    setBootstrapState({ status: "loading" });
    let currentStep = "設定を確認しています";
    setLoadingMessage(currentStep);
    setPracticeNotice(null);

    try {
      if (!supabaseClient) {
        throw new Error("Supabase公開URLまたはanon keyが未設定です。");
      }

      currentStep = "ネットワーク状態を確認しています";
      setLoadingMessage(currentStep);
      const online = await ensureOnline();
      setIsOnline(online);
      if (!online) {
        throw new Error("オンライン接続が必要です。");
      }

      currentStep = "オンボーディング状態を確認しています";
      setLoadingMessage(currentStep);
      const completed = await withTimeout(
        SecureStore.getItemAsync(ONBOARDING_COMPLETE_KEY),
        SECURE_STORE_TIMEOUT_MS,
        "オンボーディング状態の確認がタイムアウトしました。"
      );
      setOnboardingComplete(completed === "true");

      currentStep = "匿名ユーザーを確認しています";
      setLoadingMessage(currentStep);
      const session = await getAnonymousSession(supabaseClient);
      currentStep = "bootstrap を取得しています";
      setLoadingMessage(currentStep);
      const data = await bootstrap(session);
      setBootstrapState({ status: "ready", profile: data.profile, access: data.access, session });
      currentStep = "購読状態を確認しています";
      setLoadingMessage(currentStep);
      await initializeRevenueCat(data.profile.user_id);
    } catch (error) {
      setBootstrapState({ status: "error", message: `${currentStep}: ${getApiErrorMessage(error)}`, retryable: true });
    }
  }, [initializeRevenueCat]);

  useEffect(() => {
    void loadApp();
  }, [loadApp]);

  useEffect(() => {
    void loadReminderSettings().then((settings) => {
      setReminderSettings(settings);
      if (settings.enabled) void scheduleReviewReminder(settings).catch(() => undefined);
    });
  }, []);

  const completeOnboarding = useCallback(async () => {
    await SecureStore.setItemAsync(ONBOARDING_COMPLETE_KEY, "true");
    setOnboardingComplete(true);
  }, []);

  const refreshBootstrap = useCallback(async () => {
    if (bootstrapState.status !== "ready") {
      await loadApp();
      return;
    }

    try {
      const online = await ensureOnline();
      setIsOnline(online);
      if (!online) throw new Error("オンライン接続が必要です。");

      const data = await bootstrap(bootstrapState.session);
      setBootstrapState({
        status: "ready",
        profile: data.profile,
        access: data.access,
        session: bootstrapState.session
      });
      await initializeRevenueCat(data.profile.user_id);
    } catch (error) {
      setBootstrapState({ status: "error", message: getApiErrorMessage(error), retryable: true });
    }
  }, [bootstrapState, initializeRevenueCat, loadApp]);

  const loadProgress = useCallback(async () => {
    if (bootstrapState.status !== "ready") return;
    setProgressLoading(true);
    setProgressError(null);
    try {
      setProgressData(await fetchProgress(bootstrapState.session));
    } catch (error) {
      setProgressError(getApiErrorMessage(error));
    } finally {
      setProgressLoading(false);
    }
  }, [bootstrapState]);

  useEffect(() => {
    if (bootstrapState.status === "ready" && activeTab === "progress") {
      void loadProgress();
    }
  }, [activeTab, bootstrapState.status, loadProgress]);

  const startDailySession = useCallback(async () => {
    setPracticeNotice(null);
    setDailyError(null);

    if (bootstrapState.status !== "ready") {
      setPracticeNotice("初期化が完了していません。再試行してください。");
      return;
    }

    const online = await ensureOnline();
    setIsOnline(online);
    if (!online) {
      setPracticeNotice("オンライン接続が必要です。");
      return;
    }

    if (bootstrapState.access.requires_paywall) {
      setPaywallReason("daily");
      setPaywallVisible(true);
      return;
    }

      setDailyStep("loading");
      setActivePracticeMode("daily");
      setActiveTab("practice");

    try {
      const data = await fetchDailySession(bootstrapState.session);
      setDailySession(data);
      setDailyAttempts({});
      setFreeInputActive(false);
      setCurrentItemIndex(Math.min(data.completed_count, Math.max(data.items.length - 1, 0)));
      setDailyStep(data.status === "completed" || data.completed_count >= data.items.length ? "complete" : "record");
    } catch (error) {
      setDailyStep("idle");
      setDailyError(getApiErrorMessage(error));
    }
  }, [bootstrapState]);

  const startPracticeSession = useCallback(
    async (mode: "weak_drill" | "phoneme_select", phonemeId?: string) => {
      if (bootstrapState.status !== "ready") return;
      setDailyStep("loading");
      setDailyError(null);
      setPracticeNotice(null);
      setFreeInputActive(false);
      setActivePracticeMode(mode);
      setActiveTab("practice");
      try {
        const data = await fetchPracticeSession(bootstrapState.session, mode, phonemeId);
        setDailySession(data);
        setDailyAttempts({});
        setCurrentItemIndex(0);
        setDailyStep(data.items.length ? "record" : "idle");
      } catch (error) {
        setDailyStep("idle");
        setDailyError(getApiErrorMessage(error));
      }
    },
    [bootstrapState]
  );

  const requestPracticeStart = useCallback(
    async (mode: PracticeMode) => {
      setPracticeNotice(null);
      const online = await ensureOnline();
      setIsOnline(online);
      if (!online) {
        setPracticeNotice("オンライン接続が必要です。");
        return;
      }

      if (bootstrapState.status !== "ready") {
        setPracticeNotice("初期化が完了していません。再試行してください。");
        return;
      }

      if (mode === "free_input" && !bootstrapState.access.is_pro) {
        setPaywallReason(mode);
        setPaywallVisible(true);
        return;
      }

      if (bootstrapState.access.requires_paywall) {
        setPaywallReason(mode);
        setPaywallVisible(true);
        return;
      }

      if (mode === "daily") {
        setFreeInputActive(false);
        await startDailySession();
        return;
      }

      if (mode === "weak_drill") {
        await startPracticeSession("weak_drill");
        return;
      }

      if (mode === "phoneme_select") {
        setPhonemePickerVisible(true);
        setActiveTab("practice");
        return;
      }

      if (mode === "free_input") {
        setDailyStep("idle");
        setFreeInputActive(true);
        setFreeInputError(null);
        setFreeInputResult(null);
        setActiveTab("practice");
        if (
          bootstrapState.profile.free_text_consent_version !== FREE_TEXT_CONSENT_VERSION ||
          !bootstrapState.profile.free_text_consented_at
        ) {
          setFreeInputConsentVisible(true);
        }
        return;
      }

      setActiveTab("practice");
      setPracticeNotice("練習を開始できます。");
    },
    [bootstrapState, startDailySession, startPracticeSession]
  );

  const buyPro = useCallback(async () => {
    if (!mobileConfig.revenueCatIosPublicSdkKey) {
      setRevenueCatError("購読状態を確認できません。RevenueCat公開SDKキーが未設定です。");
      return;
    }

    setPurchaseBusy(true);
    try {
      const offerings = await Purchases.getOfferings();
      const packageToBuy = offerings.current?.availablePackages[0];
      if (!packageToBuy) {
        Alert.alert("Pro登録", "購入商品を取得できませんでした。");
        return;
      }

      await Purchases.purchasePackage(packageToBuy);
      await refreshBootstrap();
      setPaywallVisible(false);
    } catch {
      setRevenueCatError("購入状態を確認できません。時間をおいて再試行してください。");
    } finally {
      setPurchaseBusy(false);
    }
  }, [refreshBootstrap]);

  const restorePurchases = useCallback(async () => {
    if (!mobileConfig.revenueCatIosPublicSdkKey) {
      setRevenueCatError("購読状態を確認できません。RevenueCat公開SDKキーが未設定です。");
      return;
    }

    setPurchaseBusy(true);
    try {
      await Purchases.restorePurchases();
      await refreshBootstrap();
      Alert.alert("購入復元", "購入状態を確認しました。");
    } catch {
      setRevenueCatError("購入復元に失敗しました。通信状態を確認してください。");
    } finally {
      setPurchaseBusy(false);
    }
  }, [refreshBootstrap]);

  const openLink = useCallback((url: string) => {
    void Linking.openURL(url);
  }, []);

  const progress = useMemo(
    () => ({
      completedToday:
        dailyStep === "complete"
          ? 7
          : dailySession
            ? Math.min(dailySession.items.length, Math.max(dailySession.completed_count, currentItemIndex))
            : 0,
      dailyTarget: 7,
      currentStreak: 0
    }),
    [currentItemIndex, dailySession, dailyStep]
  );

  const currentDailyItem = dailySession?.items[currentItemIndex] ?? null;
  const currentAttemptKey = currentDailyItem
    ? currentDailyItem.daily_session_item_id ?? `${activePracticeMode}-${currentDailyItem.practice_item_id}-${currentItemIndex}`
    : null;
  const currentAttempt = currentAttemptKey ? dailyAttempts[currentAttemptKey] : null;

  const preparePronunciationStream = useCallback(
    async (referenceText: string, showDailyError = true) => {
      if (bootstrapState.status !== "ready" || !referenceText.trim()) return null;
      const sequence = ++preparationSequenceRef.current;
      const preparationStartedAt = performance.now();
      lifecycleTimingRef.current = {
        ...lifecycleTimingRef.current,
        tokenFetchMs: null,
        recognizerPreparationMs: null,
        buttonToAzureResultMs: null,
        normalizationMs: null,
        buttonToUiMs: null
      };
      if (showDailyError) setDailyError(null);
      setRecordingState("preparing");
      try {
        const requestId = await createStreamRequestId();
        const cachedToken = speechTokenRef.current;
        const tokenStartedAt = performance.now();
        const tokenWasReusable = Boolean(cachedToken && Date.parse(cachedToken.expires_at) - Date.now() > 120_000);
        const token = tokenWasReusable ? cachedToken! : await fetchSpeechToken(bootstrapState.session);
        lifecycleTimingRef.current.tokenFetchMs = tokenWasReusable ? 0 : Math.round(performance.now() - tokenStartedAt);
        if (sequence !== preparationSequenceRef.current) return null;
        speechTokenRef.current = token;
        await AzurePronunciationStream.prepare({
          token: token.token,
          region: token.region,
          locale: token.locale,
          referenceText: referenceText.trim(),
          requestId
        });
        lifecycleTimingRef.current.recognizerPreparationMs = Math.round(performance.now() - preparationStartedAt);
        if (sequence !== preparationSequenceRef.current) {
          await AzurePronunciationStream.cancel(requestId).catch(() => undefined);
          return null;
        }
        streamSessionRef.current.setPrepared(requestId, referenceText);
        setRecordingState("ready");
        logAssessmentPerformance({
          operation: "pronunciation_prepare",
          token_fetch_ms: lifecycleTimingRef.current.tokenFetchMs,
          recognizer_preparation_ms: lifecycleTimingRef.current.recognizerPreparationMs,
          problem_to_ready_ms: lifecycleTimingRef.current.problemDisplayedAtMs
            ? Math.round(performance.now() - lifecycleTimingRef.current.problemDisplayedAtMs)
            : null
        });
        return requestId;
      } catch (error) {
        if (sequence !== preparationSequenceRef.current) return null;
        setRecordingState("failed");
        const message = pronunciationErrorMessage(error);
        if (showDailyError) setDailyError(message);
        else setFreeInputError(message);
        return null;
      }
    },
    [bootstrapState]
  );

  useEffect(() => {
    const text = freeInputActive ? freeText.trim() : dailyStep === "record" ? currentDailyItem?.text.trim() : "";
    if (!text || recordingState === "recording" || recordingState === "finalizing" || recordingState === "assessing") return;
    if (streamSessionRef.current.canReuse(text)) return;
    lifecycleTimingRef.current.problemDisplayedAtMs = performance.now();
    const timeout = setTimeout(() => {
      void preparePronunciationStream(text, !freeInputActive);
    }, freeInputActive ? 350 : 0);
    return () => clearTimeout(timeout);
  }, [currentDailyItem?.text, dailyStep, freeInputActive, freeText, preparePronunciationStream, recordingState]);

  const confirmDiscardRecording = useCallback(
    (next: () => void) => {
      if (!isPronunciationBusy(recordingState)) {
        assessmentEpochRef.current += 1;
        next();
        return;
      }

      Alert.alert("録音を破棄しますか", "録音中の音声は保存されません。", [
        { text: "続ける", style: "cancel" },
        {
          text: "破棄",
          style: "destructive",
          onPress: () => {
            assessmentEpochRef.current += 1;
            preparationSequenceRef.current += 1;
            const requestId = streamSessionRef.current.requestId;
            if (requestId) void AzurePronunciationStream.cancel(requestId).catch(() => undefined);
            streamSessionRef.current.clear();
            setRecordingState("cancelled");
            next();
          }
        }
      ]);
    },
    [recordingState]
  );

  const changeTab = useCallback(
    (tab: TabKey) => confirmDiscardRecording(() => setActiveTab(tab)),
    [confirmDiscardRecording]
  );

  const startRecording = useCallback(async (referenceText: string, showDailyError = true) => {
    if (bootstrapState.status !== "ready") return;
    if (assessmentActionInFlightRef.current || recordingState === "recording") return;
    assessmentActionInFlightRef.current = true;
    assessmentEpochRef.current += 1;
    if (showDailyError) setDailyError(null);
    else setFreeInputError(null);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error("マイク権限が必要です。設定アプリからマイクを許可してください。");
      let requestId: string | null = streamSessionRef.current.requestId;
      const token = speechTokenRef.current;
      const canReusePreparedSession = streamSessionRef.current.canReuse(referenceText);
      if (!canReusePreparedSession) {
        requestId = await preparePronunciationStream(referenceText, showDailyError);
      }
      if (!requestId) return;
      if (canReusePreparedSession && (!token || Date.parse(token.expires_at) - Date.now() <= 120_000)) {
        const freshToken = await fetchSpeechToken(bootstrapState.session);
        speechTokenRef.current = freshToken;
        await AzurePronunciationStream.updateToken(freshToken.token, requestId);
      }
      try {
        await AzurePronunciationStream.start(requestId);
      } catch (error) {
        if (!isRecoverableStaleRequest(error)) throw error;
        streamSessionRef.current.clear();
        const freshRequestId = await preparePronunciationStream(referenceText, showDailyError);
        if (!freshRequestId) return;
        await AzurePronunciationStream.start(freshRequestId);
      }
      setRecordingState("recording");
    } catch (error) {
      const requestId = streamSessionRef.current.requestId;
      if (requestId) void AzurePronunciationStream.cancel(requestId).catch(() => undefined);
      streamSessionRef.current.clear();
      setRecordingState("failed");
      const message = pronunciationErrorMessage(error);
      if (showDailyError) setDailyError(message);
      else setFreeInputError(message);
    } finally {
      assessmentActionInFlightRef.current = false;
    }
  }, [bootstrapState, preparePronunciationStream, recordingState]);

  const stopAndAssess = useCallback(async () => {
    if (bootstrapState.status !== "ready" || !dailySession || !currentDailyItem) return;
    if (assessmentActionInFlightRef.current || recordingState !== "recording") return;
    assessmentActionInFlightRef.current = true;
    const epoch = assessmentEpochRef.current;

    const stoppedAt = performance.now();
    const itemKey = currentDailyItem.daily_session_item_id ?? `${activePracticeMode}-${currentDailyItem.practice_item_id}-${currentItemIndex}`;
    const previous = dailyAttempts[itemKey];
    const attemptNo = (previous?.attemptNo ?? 0) + 1;
    let nativeResult: NativeAssessmentResult | null = null;
    setRecordingState("finalizing");
    setDailyError(null);

    try {
      // finish consumes the native session for success, native failure, and JS timeout alike.
      // A later API-only retry uses the separately saved Azure result, never this request id.
      const requestId = streamSessionRef.current.consume();
      if (!requestId) throw new Error("発音判定の準備が失われました。もう一度お試しください。");
      const finishedResult = await withTimeout(
        AzurePronunciationStream.finish(requestId),
        ASSESS_TIMEOUT_MS,
        "Azure Speech の判定がタイムアウトしました。"
      );
      if (epoch !== assessmentEpochRef.current) return;
      nativeResult = finishedResult;
      void rememberLocalRecording(finishedResult.localAudioUri).catch(() => undefined);
      setRecordingState("assessing");

      const result = await assessDailyItem({
        session: bootstrapState.session,
        item: currentDailyItem,
        dailySessionId: dailySession.daily_session_id,
        practiceMode: activePracticeMode,
        attemptNo,
        azureResult: finishedResult.rawJson,
        clientTiming: nativeTiming(finishedResult, lifecycleTimingRef.current),
        onPerformance: (values) => {
          lifecycleTimingRef.current.normalizationMs =
            typeof values.server_normalization_ms === "number" ? values.server_normalization_ms : null;
          logAssessmentPerformance({
            ...values,
            azure_recognition_ms: finishedResult.buttonToResultMs ?? null
          });
        }
      });
      if (epoch !== assessmentEpochRef.current) return;
      const finalizedResult = finishedResult;

      setDailyAttempts((current) => ({
        ...current,
        [itemKey]: {
          attemptNo,
          localAudioUri: finalizedResult.localAudioUri,
          azureResult: finalizedResult.rawJson,
          clientTiming: nativeTiming(finalizedResult, lifecycleTimingRef.current),
          result
        }
      }));
      setRecordingState("completed");
      requestAnimationFrame(() =>
        {
          lifecycleTimingRef.current.buttonToUiMs = Math.round(performance.now() - stoppedAt);
          logAssessmentPerformance({
          operation: "daily_assess_ui",
          token_fetch_ms: lifecycleTimingRef.current.tokenFetchMs ?? null,
          recognizer_preparation_ms: lifecycleTimingRef.current.recognizerPreparationMs ?? null,
          button_to_azure_result_ms: finishedResult.buttonToResultMs,
          normalization_ms: lifecycleTimingRef.current.normalizationMs ?? null,
          button_to_ui_ms: lifecycleTimingRef.current.buttonToUiMs
          });
        }
      );
    } catch (error) {
      if (epoch !== assessmentEpochRef.current) return;
      if (nativeResult) {
        setDailyAttempts((current) => ({
          ...current,
          [itemKey]: {
            attemptNo,
            localAudioUri: nativeResult?.localAudioUri ?? null,
            azureResult: nativeResult?.rawJson ?? null,
            clientTiming: nativeResult ? nativeTiming(nativeResult, lifecycleTimingRef.current) : null,
            result: null
          }
        }));
      }
      setRecordingState("failed");
      setDailyError(nativeResult ? getApiErrorMessage(error) : pronunciationErrorMessage(error));
    } finally {
      assessmentActionInFlightRef.current = false;
    }
  }, [activePracticeMode, bootstrapState, currentDailyItem, currentItemIndex, dailyAttempts, dailySession, recordingState]);

  const retryCurrentAssessment = useCallback(() => {
    const azureResult = currentAttempt?.azureResult;
    const clientTiming = currentAttempt?.clientTiming;
    if (!azureResult || !clientTiming || !currentDailyItem || !dailySession || bootstrapState.status !== "ready") {
      if (currentDailyItem) void startRecording(currentDailyItem.text);
      return;
    }
    if (assessmentActionInFlightRef.current) return;
    assessmentActionInFlightRef.current = true;
    const epoch = assessmentEpochRef.current;
    setRecordingState("assessing");
    setDailyError(null);
    void assessDailyItem({
      session: bootstrapState.session,
      item: currentDailyItem,
      dailySessionId: dailySession.daily_session_id,
      practiceMode: activePracticeMode,
      attemptNo: currentAttempt.attemptNo,
      azureResult,
      clientTiming
    })
      .then((result) => {
        if (epoch !== assessmentEpochRef.current) return;
        const itemKey = currentDailyItem.daily_session_item_id ?? `${activePracticeMode}-${currentDailyItem.practice_item_id}-${currentItemIndex}`;
        setDailyAttempts((current) => ({
          ...current,
          [itemKey]: { ...currentAttempt, result }
        }));
        setRecordingState("completed");
      })
      .catch((error) => {
        if (epoch !== assessmentEpochRef.current) return;
        setRecordingState("failed");
        setDailyError(getApiErrorMessage(error));
      })
      .finally(() => {
        assessmentActionInFlightRef.current = false;
      });
  }, [activePracticeMode, bootstrapState, currentAttempt, currentDailyItem, currentItemIndex, dailySession, startRecording]);

  const goNextDailyItem = useCallback(() => {
    if (!dailySession) return;
    if (currentItemIndex >= dailySession.items.length - 1) {
      setDailyStep("complete");
      setDailySession({ ...dailySession, completed_count: dailySession.items.length, status: "completed" });
      if (activePracticeMode === "daily") {
        setActiveTab("home");
        void loadProgress();
      }
      return;
    }
    setCurrentItemIndex((current) => current + 1);
    setDailyStep("record");
    setRecordingState("idle");
    setDailyError(null);
  }, [activePracticeMode, currentItemIndex, dailySession, loadProgress]);

  const openAdvice = useCallback(
    async (adviceId: string | null) => {
      if (!adviceId || bootstrapState.status !== "ready") return;
      setSelectedAdviceId(adviceId);
      setAdvicePage(null);
      setFeedbackNotice(null);
      setAdviceLoading(true);
      setDailyStep("advice");
      try {
        setAdvicePage(await fetchAdvice(bootstrapState.session, adviceId));
      } catch (error) {
        setDailyError(getApiErrorMessage(error));
      } finally {
        setAdviceLoading(false);
      }
    },
    [bootstrapState]
  );

  const rateAdvice = useCallback(
    async (rating: "up" | "down") => {
      if (!selectedAdviceId || !currentAttempt?.result || bootstrapState.status !== "ready") return;
      try {
        await sendAdviceFeedback({
          session: bootstrapState.session,
          adviceId: selectedAdviceId,
          attemptId: currentAttempt.result.attempt_id,
          rating
        });
        setFeedbackNotice(rating === "up" ? "評価を保存しました。" : "改善に使います。");
      } catch (error) {
        setFeedbackNotice(getApiErrorMessage(error));
      }
    },
    [bootstrapState, currentAttempt, selectedAdviceId]
  );

  const acceptFreeTextConsent = useCallback(async () => {
    if (bootstrapState.status !== "ready") return;
    setFreeInputError(null);
    try {
      const consent = await saveFreeTextConsent(bootstrapState.session);
      setBootstrapState({
        status: "ready",
        session: bootstrapState.session,
        access: bootstrapState.access,
        profile: {
          ...bootstrapState.profile,
          ...consent
        }
      });
      setFreeInputConsentVisible(false);
    } catch (error) {
      setFreeInputError(getApiErrorMessage(error));
    }
  }, [bootstrapState]);

  const startFreeInputRecording = useCallback(async () => {
    if (!freeText.trim()) {
      setFreeInputError("判定する英文を入力してください。");
      return;
    }
    setFreeInputError(null);
    setFreeInputResult(null);
    setFreeInputPendingResult(null);
    await startRecording(freeText.trim(), false);
  }, [freeText, startRecording]);

  const stopAndAssessFreeInput = useCallback(async () => {
    if (bootstrapState.status !== "ready") return;
    if (assessmentActionInFlightRef.current || recordingState !== "recording") return;
    assessmentActionInFlightRef.current = true;
    const epoch = assessmentEpochRef.current;
    const stoppedAt = performance.now();
    setRecordingState("finalizing");
    setFreeInputError(null);

    try {
      const requestId = streamSessionRef.current.consume();
      if (!requestId) throw new Error("発音判定の準備が失われました。もう一度お試しください。");
      const nativeResult = await withTimeout(
        AzurePronunciationStream.finish(requestId),
        FREE_ASSESS_TIMEOUT_MS,
        "Azure Speech の判定がタイムアウトしました。"
      );
      if (epoch !== assessmentEpochRef.current) return;
      setFreeInputPendingResult(nativeResult);
      void rememberLocalRecording(nativeResult.localAudioUri).catch(() => undefined);
      setFreeInputAudioUri(nativeResult.localAudioUri);
      setRecordingState("assessing");
      setFreeInputResult(
        await assessFreeInput({
          session: bootstrapState.session,
          text: freeText.trim(),
          azureResult: nativeResult.rawJson,
          clientTiming: nativeTiming(nativeResult, lifecycleTimingRef.current),
          onPerformance: (values) => {
            lifecycleTimingRef.current.normalizationMs =
              typeof values.server_normalization_ms === "number" ? values.server_normalization_ms : null;
            logAssessmentPerformance({
              ...values,
              azure_recognition_ms: nativeResult.buttonToResultMs
            });
          }
        })
      );
      if (epoch !== assessmentEpochRef.current) return;
      setFreeInputPendingResult(null);
      setRecordingState("completed");
      requestAnimationFrame(() =>
        {
          lifecycleTimingRef.current.buttonToUiMs = Math.round(performance.now() - stoppedAt);
          logAssessmentPerformance({
            operation: "free_assess_ui",
            token_fetch_ms: lifecycleTimingRef.current.tokenFetchMs ?? null,
            recognizer_preparation_ms: lifecycleTimingRef.current.recognizerPreparationMs ?? null,
            button_to_azure_result_ms: nativeResult.buttonToResultMs,
            normalization_ms: lifecycleTimingRef.current.normalizationMs ?? null,
            button_to_ui_ms: lifecycleTimingRef.current.buttonToUiMs
          });
        }
      );
    } catch (error) {
      if (epoch !== assessmentEpochRef.current) return;
      setRecordingState("failed");
      setFreeInputError(pronunciationErrorMessage(error));
    } finally {
      assessmentActionInFlightRef.current = false;
    }
  }, [bootstrapState, freeText, recordingState]);

  const retryFreeInputAssessment = useCallback(async () => {
    const pendingResult = freeInputPendingResult;
    if (bootstrapState.status !== "ready" || pendingResult === null || !shouldRetrySavedAzureResult(pendingResult)) {
      await startFreeInputRecording();
      return;
    }
    if (assessmentActionInFlightRef.current) return;
    assessmentActionInFlightRef.current = true;
    const epoch = assessmentEpochRef.current;
    setRecordingState("assessing");
    setFreeInputError(null);
    try {
      const result = await assessFreeInput({
        session: bootstrapState.session,
        text: freeText.trim(),
        azureResult: pendingResult.rawJson,
        clientTiming: nativeTiming(pendingResult, lifecycleTimingRef.current)
      });
      if (epoch !== assessmentEpochRef.current) return;
      setFreeInputResult(result);
      setFreeInputPendingResult(null);
      setRecordingState("completed");
    } catch (error) {
      if (epoch !== assessmentEpochRef.current) return;
      setRecordingState("failed");
      setFreeInputError(getApiErrorMessage(error));
    } finally {
      assessmentActionInFlightRef.current = false;
    }
  }, [bootstrapState, freeInputPendingResult, freeText, startFreeInputRecording]);

  const changeReminderEnabled = useCallback(async (enabled: boolean) => {
    setSettingsNotice(null);
    let next = { ...reminderSettings, enabled };
    try {
      if (enabled) {
        const permission = await Notifications.requestPermissionsAsync();
        if (!permission.granted) {
          next = { ...next, enabled: false };
          setSettingsNotice("通知権限が拒否されたため、復習リマインダーをOFFにしました。");
        }
      }
      await saveReminderSettings(next);
      await scheduleReviewReminder(next);
      setReminderSettings(next);
    } catch (error) {
      setSettingsNotice(getApiErrorMessage(error));
    }
  }, [reminderSettings]);

  const changeReminderHour = useCallback(async (hour: number) => {
    const next = { ...reminderSettings, hour };
    setReminderSettings(next);
    await saveReminderSettings(next);
    await scheduleReviewReminder(next).catch(() => undefined);
  }, [reminderSettings]);

  const exportLearningData = useCallback(async () => {
    if (bootstrapState.status !== "ready") return;
    setSettingsBusy(true);
    setSettingsNotice(null);
    try {
      const data = await apiJson<unknown>({
        session: bootstrapState.session,
        path: "/api/export",
        timeoutMs: DATA_MANAGEMENT_TIMEOUT_MS,
        body: {}
      });
      const fileUri = `${FileSystem.documentDirectory}pronunciation-mirror-export-${getLocalDate()}.json`;
      await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(data, null, 2), {
        encoding: FileSystem.EncodingType.UTF8
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, { mimeType: "application/json", dialogTitle: "学習データを書き出す" });
      } else {
        setSettingsNotice(`JSONを書き出しました: ${fileUri}`);
      }
    } catch (error) {
      setSettingsNotice(getApiErrorMessage(error));
    } finally {
      setSettingsBusy(false);
    }
  }, [bootstrapState]);

  const deleteLearningData = useCallback(() => {
    if (bootstrapState.status !== "ready") return;
    Alert.alert(
      "学習データを削除しますか",
      "サーバー上の進捗、ストリーク、レベル、バッジ、称号、自由入力ログと、端末ローカル録音を削除します。無料期間の起点と購読状態は削除しません。",
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setSettingsBusy(true);
              setSettingsNotice(null);
              try {
                await apiJson<{ deleted_at: string }>({
                  session: bootstrapState.session,
                  path: "/api/delete-learning-data",
                  timeoutMs: DATA_MANAGEMENT_TIMEOUT_MS,
                  body: { confirm: true }
                });
                await deleteLocalRecordings();
                setProgressData(null);
                setDailySession(null);
                setDailyAttempts({});
                setDailyStep("idle");
                setSettingsNotice("学習データを削除しました。");
                await loadProgress();
              } catch (error) {
                setSettingsNotice(getApiErrorMessage(error));
              } finally {
                setSettingsBusy(false);
              }
            })();
          }
        }
      ]
    );
  }, [bootstrapState, loadProgress]);

  if (bootstrapState.status === "error") {
    return <ErrorScreen message={bootstrapState.message} isOnline={isOnline} onRetry={loadApp} />;
  }

  if (onboardingComplete === null || bootstrapState.status === "loading") {
    return <LoadingScreen message={loadingMessage} />;
  }

  if (!onboardingComplete) {
    return (
      <OnboardingScreen
        step={onboardingStep}
        onNext={() => setOnboardingStep((current) => Math.min(current + 1, 1))}
        onDone={completeOnboarding}
      />
    );
  }

  const access = bootstrapState.access;
  const profile = bootstrapState.profile;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.appShell}>
        <StatusBanner
          isOnline={isOnline}
          revenueCatError={revenueCatError}
          onRetry={refreshBootstrap}
        />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {activeTab === "home" ? (
            <HomeScreen
              access={access}
              completedToday={progress.completedToday}
              currentStreak={progress.currentStreak}
              dailyTarget={progress.dailyTarget}
              onProgress={() => setActiveTab("progress")}
              onStart={() => void requestPracticeStart("daily")}
            />
          ) : null}
          {activeTab === "progress" ? (
            <ProgressScreen
              data={progressData}
              loading={progressLoading}
              error={progressError}
              range={progressRange}
              fallbackCurrentStreak={progress.currentStreak}
              onRangeChange={setProgressRange}
              onRefresh={() => void loadProgress()}
            />
          ) : null}
          {activeTab === "practice" ? (
            freeInputActive ? (
              <FreeInputScreen
                consentVisible={freeInputConsentVisible}
                error={freeInputError}
                recordingState={recordingState}
                result={freeInputResult}
                text={freeText}
                audioUri={freeInputAudioUri}
                onAcceptConsent={() => void acceptFreeTextConsent()}
                onCancelConsent={() => setFreeInputConsentVisible(false)}
                onPlayRecording={() => {
                  if (freeInputAudioUri) playAudio(freeInputAudioUri);
                }}
                onRetry={() => void retryFreeInputAssessment()}
                onStartRecording={() => void startFreeInputRecording()}
                onStopRecording={() => void stopAndAssessFreeInput()}
                onTextChange={setFreeText}
              />
            ) : dailyStep === "idle" ? (
              <PracticeScreen
                access={access}
                notice={practiceNotice ?? dailyError}
                phonemes={progressData?.phoneme_heatmap ?? []}
                phonemePickerVisible={phonemePickerVisible}
                onClosePhonemePicker={() => setPhonemePickerVisible(false)}
                onPickPhoneme={(phonemeId) => {
                  setPhonemePickerVisible(false);
                  void startPracticeSession("phoneme_select", phonemeId);
                }}
                onStart={(mode) => void requestPracticeStart(mode)}
              />
            ) : (
              <DailyAssessmentFlow
                adviceLoading={adviceLoading}
                advicePage={advicePage}
                attempt={currentAttempt ?? null}
                currentIndex={currentItemIndex}
                dailyError={dailyError}
                feedbackNotice={feedbackNotice}
                item={currentDailyItem}
                mode={activePracticeMode}
                recordingState={recordingState}
                session={dailySession}
                step={dailyStep}
                onBack={() =>
                  confirmDiscardRecording(() => {
                    if (dailyStep === "detail") setDailyStep("record");
                    else if (dailyStep === "advice") setDailyStep("detail");
                    else {
                      setDailyStep("idle");
                      setDailyError(null);
                    }
                  })
                }
                onDetail={() => setDailyStep("detail")}
                onFeedback={(rating) => void rateAdvice(rating)}
                onNext={goNextDailyItem}
                onOpenAdvice={(adviceId) => void openAdvice(adviceId)}
                onPlayExample={(speed) => {
                  if (!currentDailyItem) return;
                  playAudio(speed === "slow" ? currentDailyItem.tts.slow_url : currentDailyItem.tts.normal_url);
                }}
                onPlayRecording={() => {
                  if (currentAttempt?.localAudioUri) playAudio(currentAttempt.localAudioUri);
                }}
                onRecordAgain={() => {
                  setDailyStep("record");
                  setRecordingState("idle");
                  setDailyError(null);
                }}
                onRetry={retryCurrentAssessment}
                onStartRecording={() => {
                  if (currentDailyItem) void startRecording(currentDailyItem.text);
                }}
                onStopRecording={() => void stopAndAssess()}
              />
            )
          ) : null}
          {activeTab === "settings" ? (
            <SettingsScreen
              access={access}
              profile={profile}
              playbackSpeed={playbackSpeed}
              purchaseBusy={purchaseBusy}
              reminderSettings={reminderSettings}
              revenueCatError={revenueCatError}
              settingsBusy={settingsBusy}
              settingsNotice={settingsNotice}
              onBuyPro={() => void buyPro()}
              onDeleteLearningData={deleteLearningData}
              onExportLearningData={() => void exportLearningData()}
              onReminderEnabledChange={(enabled) => void changeReminderEnabled(enabled)}
              onReminderHourChange={(hour) => void changeReminderHour(hour)}
              onOpenLink={openLink}
              onRestore={() => void restorePurchases()}
              onSetPlaybackSpeed={setPlaybackSpeed}
            />
          ) : null}
        </ScrollView>
        <BottomTabs activeTab={activeTab} onChange={changeTab} />
      </View>
      <PaywallModal
        visible={paywallVisible}
        reason={paywallReason}
        purchaseBusy={purchaseBusy}
        onBuyPro={() => void buyPro()}
        onClose={() => setPaywallVisible(false)}
        onOpenLink={openLink}
        onRestore={() => void restorePurchases()}
      />
    </SafeAreaView>
  );
}

function LoadingScreen({ message }: { message: string }) {
  return (
    <SafeAreaView style={styles.centeredScreen}>
      <ActivityIndicator color="#0c6b58" size="large" />
      <Text style={styles.loadingTitle}>Pronunciation Mirror</Text>
      <Text style={styles.mutedText}>{message}</Text>
    </SafeAreaView>
  );
}

function ErrorScreen({
  message,
  isOnline,
  onRetry
}: {
  message: string;
  isOnline: boolean;
  onRetry: () => void;
}) {
  return (
    <SafeAreaView style={styles.centeredScreen}>
      <Text style={styles.errorTitle}>起動できませんでした</Text>
      <Text style={styles.errorText}>{isOnline ? message : "オンライン接続が必要です。"}</Text>
      <PrimaryButton label="再試行" onPress={onRetry} />
    </SafeAreaView>
  );
}

function OnboardingScreen({
  step,
  onNext,
  onDone
}: {
  step: number;
  onNext: () => void;
  onDone: () => void;
}) {
  const pages = [
    {
      title: "Pronunciation Mirror",
      body: "英語の発音を録音し、音ごとの結果を見ながら毎日7問だけ練習します。"
    },
    {
      title: "7日間無料",
      body: "8日目以降の練習にはPro登録が必要です。自由入力はPro限定です。"
    }
  ];
  const page = pages[step];

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.onboarding}>
        <View>
          <Text style={styles.kicker}>発音練習</Text>
          <Text style={styles.heroTitle}>{page.title}</Text>
          <Text style={styles.heroText}>{page.body}</Text>
        </View>
        <View style={styles.onboardingFooter}>
          <View style={styles.dots}>
            {pages.map((_, index) => (
              <View
                key={index}
                style={[styles.dot, index === step ? styles.dotActive : styles.dotInactive]}
              />
            ))}
          </View>
          <PrimaryButton label={step === pages.length - 1 ? "はじめる" : "次へ"} onPress={step === pages.length - 1 ? onDone : onNext} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function StatusBanner({
  isOnline,
  revenueCatError,
  onRetry
}: {
  isOnline: boolean;
  revenueCatError: string | null;
  onRetry: () => void;
}) {
  if (isOnline && !revenueCatError) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>
        {!isOnline ? "オンライン接続が必要です。" : revenueCatError}
      </Text>
      <Pressable onPress={onRetry} style={styles.bannerButton}>
        <Text style={styles.bannerButtonText}>再試行</Text>
      </Pressable>
    </View>
  );
}

function HomeScreen({
  access,
  completedToday,
  currentStreak,
  dailyTarget,
  onProgress,
  onStart
}: {
  access: AccessState;
  completedToday: number;
  currentStreak: number;
  dailyTarget: number;
  onProgress: () => void;
  onStart: () => void;
}) {
  const isComplete = completedToday >= dailyTarget;

  return (
    <View style={styles.section}>
      <Text style={styles.appName}>Pronunciation Mirror</Text>
      <Text style={styles.sectionTitle}>今日の練習</Text>
      <View style={styles.metricRow}>
        <Metric label="ストリーク" value={`${currentStreak}日`} tone="green" />
        <Metric label="今日の進捗" value={`${completedToday} / ${dailyTarget}`} tone="blue" />
      </View>
      <View style={styles.homePanel}>
        <Text style={styles.homeState}>{isComplete ? "今日の7問が完了しました" : "今日の7問を始めます"}</Text>
        <Text style={styles.homeSubtext}>
          {access.is_pro
            ? "Pro有効"
            : access.is_trial_active
              ? `無料期間 ${access.trial_day}日目`
              : "Pro登録が必要です"}
        </Text>
        <PrimaryButton
          label={isComplete ? "進捗を見る" : "スタート"}
          onPress={isComplete ? onProgress : onStart}
        />
      </View>
    </View>
  );
}

function ProgressScreen({
  data,
  loading,
  error,
  range,
  fallbackCurrentStreak,
  onRangeChange,
  onRefresh
}: {
  data: ProgressData | null;
  loading: boolean;
  error: string | null;
  range: ProgressRange;
  fallbackCurrentStreak: number;
  onRangeChange: (range: ProgressRange) => void;
  onRefresh: () => void;
}) {
  const heatmap = data?.phoneme_heatmap ?? [];
  const series = filterMasterySeries(data?.mastery_series ?? [], range);
  const currentStreak = data?.streak.current ?? fallbackCurrentStreak;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>進捗</Text>
      {loading ? <ActivityIndicator color="#0c6b58" /> : null}
      {error ? (
        <View style={styles.simplePanel}>
          <Text style={styles.warningText}>{error}</Text>
          <SecondaryButton label="再読み込み" onPress={onRefresh} />
        </View>
      ) : null}
      <View style={styles.metricRow}>
        <Metric label="現在" value={`${currentStreak}日`} tone="green" />
        <Metric label="最長" value={`${data?.streak.longest ?? 0}日`} tone="red" />
      </View>
      <View style={styles.simplePanel}>
        <Text style={styles.panelTitle}>レベル {data?.level.level ?? 1}</Text>
        <Text style={styles.panelText}>{data?.level.name ?? "はじめの一音"} / 完了 {data?.level.completed_items ?? 0}問</Text>
        <Text style={styles.panelTitle}>称号</Text>
        <Text style={styles.panelText}>{data?.title.name ?? "発音ミラー入門"}</Text>
      </View>
      <View style={styles.simplePanel}>
        <Text style={styles.panelTitle}>総合習熟度</Text>
        <Text style={styles.masteryValue}>{data?.overall_mastery == null ? "--" : `${Math.round(data.overall_mastery)}%`}</Text>
        <View style={styles.segmented}>
          <SegmentButton active={range === "day"} label="日" onPress={() => onRangeChange("day")} />
          <SegmentButton active={range === "week"} label="週" onPress={() => onRangeChange("week")} />
          <SegmentButton active={range === "month"} label="月" onPress={() => onRangeChange("month")} />
        </View>
        <View style={styles.chartRow}>
          {series.length ? series.map((point) => (
            <View key={point.date} style={styles.chartBarWrap}>
              <View style={[styles.chartBar, { height: `${Math.max(8, Math.round(point.overall_mastery ?? 0))}%` }]} />
            </View>
          )) : <Text style={styles.panelText}>習熟度の推移は練習後に表示されます。</Text>}
        </View>
      </View>
      <View style={styles.simplePanel}>
        <Text style={styles.panelTitle}>苦手音ヒートマップ</Text>
        <View style={styles.heatRow}>
          {(heatmap.length ? heatmap : fallbackPhonemes()).map((phoneme) => (
            <View key={phoneme.phoneme_id} style={[styles.heatCell, heatStyle(phoneme.color)]}>
              <Text style={styles.heatText}>{phoneme.ipa || phoneme.phoneme_id}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.simplePanel}>
        <Text style={styles.panelTitle}>獲得済みバッジ</Text>
        <Text style={styles.panelText}>
          {data?.badges.length ? data.badges.slice(0, 4).map((badge) => badge.badge_id).join(" / ") : "まだありません"}
        </Text>
      </View>
    </View>
  );
}

function filterMasterySeries(series: ProgressData["mastery_series"], range: ProgressRange) {
  const limit = range === "day" ? 7 : range === "week" ? 12 : 30;
  return series.slice(-limit);
}

function fallbackPhonemes() {
  return ["r", "l", "v", "theta", "dh", "ae", "ih", "uw"].map((id) => ({
    phoneme_id: id,
    ipa: id === "theta" ? "θ" : id === "dh" ? "ð" : id,
    category: "fallback",
    mastery_ewma: null,
    color: "unrated" as const
  }));
}

function heatStyle(color: PhonemeColor | "unrated") {
  if (color === "green") return styles.heatGood;
  if (color === "yellow") return styles.heatWarm;
  if (color === "red") return styles.heatHot;
  return styles.heatCool;
}

function DailyAssessmentFlow({
  adviceLoading,
  advicePage,
  attempt,
  currentIndex,
  dailyError,
  feedbackNotice,
  item,
  mode,
  recordingState,
  session,
  step,
  onBack,
  onDetail,
  onFeedback,
  onNext,
  onOpenAdvice,
  onPlayExample,
  onPlayRecording,
  onRecordAgain,
  onRetry,
  onStartRecording,
  onStopRecording
}: {
  adviceLoading: boolean;
  advicePage: AdvicePage | null;
  attempt: DailyAttemptState | null;
  currentIndex: number;
  dailyError: string | null;
  feedbackNotice: string | null;
  item: DailySessionItem | null;
  mode: Exclude<PracticeMode, "free_input">;
  recordingState: RecordingState;
  session: DailySessionData | null;
  step: DailyFlowStep;
  onBack: () => void;
  onDetail: () => void;
  onFeedback: (rating: "up" | "down") => void;
  onNext: () => void;
  onOpenAdvice: (adviceId: string | null) => void;
  onPlayExample: (speed: PlaybackSpeed) => void;
  onPlayRecording: () => void;
  onRecordAgain: () => void;
  onRetry: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
}) {
  if (step === "loading") {
    return (
      <View style={styles.section}>
        <ActivityIndicator color="#0c6b58" size="large" />
        <Text style={styles.sectionTitle}>デイリー練習を準備中</Text>
      </View>
    );
  }

  if (step === "complete") {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>今日の練習は完了です</Text>
        <View style={styles.homePanel}>
          <Text style={styles.homeState}>7 / 7</Text>
          <Text style={styles.homeSubtext}>デイリー練習が完走しました。</Text>
        </View>
      </View>
    );
  }

  if (!session || !item) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>デイリー練習</Text>
        <Text style={styles.warningText}>{dailyError ?? "問題を取得できませんでした。"}</Text>
      </View>
    );
  }

  const result = attempt?.result ?? null;
  const adviceId = result?.next.recommended_advice_id ?? null;
  const perfect = Boolean(result && result.phoneme_results.every((phoneme) => phoneme.color === "green"));

  if (step === "detail") {
    const needsFix = result?.phoneme_results.filter((phoneme) => phoneme.color === "red") ?? [];
    const almost = result?.phoneme_results.filter((phoneme) => phoneme.color === "yellow") ?? [];

    return (
      <View style={styles.section}>
        <Text style={styles.backText} onPress={onBack}>戻る</Text>
        <Text style={styles.kicker}>{practiceModeLabel(mode)} {currentIndex + 1} / {session.items.length}</Text>
        <Text style={styles.sectionTitle}>詳細</Text>
        <Text style={styles.promptText}>{item.text}</Text>
        <View style={styles.buttonRow}>
          <SecondaryButton label="お手本" onPress={() => onPlayExample("normal")} />
          <SecondaryButton label="録音再生" onPress={onPlayRecording} disabled={!attempt?.localAudioUri} />
        </View>
        <TwoLineIpa result={result} fallbackExpectedIpa={item.expected_ipa} />
        {result?.pronunciation_assessment ? <RichPronunciationDetail assessment={result.pronunciation_assessment} /> : null}
        <Text style={styles.panelTitle}>音素チップ</Text>
        <PhonemeGrid phonemes={result?.phoneme_results ?? []} />
        <View style={styles.simplePanel}>
          <Text style={styles.panelTitle}>要修正音</Text>
          <Text style={styles.panelText}>{needsFix.length ? needsFix.map((p) => p.expected_ipa).join(" / ") : "なし"}</Text>
          <Text style={styles.panelTitle}>もう少しの音</Text>
          <Text style={styles.panelText}>{almost.length ? almost.map((p) => p.expected_ipa).join(" / ") : "なし"}</Text>
          <Text style={styles.panelText}>文問題では音素を見て対象単語を確認します。</Text>
        </View>
        <PrimaryButton label="直し方を見る" onPress={() => onOpenAdvice(adviceId)} disabled={!adviceId} />
      </View>
    );
  }

  if (step === "advice") {
    return (
      <View style={styles.section}>
        <Text style={styles.backText} onPress={onBack}>戻る</Text>
        <Text style={styles.sectionTitle}>直し方</Text>
        {adviceLoading ? <ActivityIndicator color="#0c6b58" /> : null}
        {advicePage ? (
          <>
            <Text style={styles.promptText}>{advicePage.title}</Text>
            <View style={styles.simplePanel}>
              <Text style={styles.panelTitle}>コツ</Text>
              <Text style={styles.panelText}>{advicePage.short_tip}</Text>
              <Text style={styles.panelTitle}>比べ方</Text>
              <Text style={styles.panelText}>{advicePage.comparison_text}</Text>
            </View>
            <View style={styles.assetBox}>
              <Text style={styles.assetText}>{advicePage.asset_id}</Text>
            </View>
            <Text style={styles.panelText}>対象: {advicePage.coach_example_text}</Text>
            <SecondaryButton label="お手本再生" onPress={() => onPlayExample("normal")} />
            <PrimaryButton label="もう一度録音" onPress={onRecordAgain} />
            <View style={styles.buttonRow}>
              <SecondaryButton label="役立った" onPress={() => onFeedback("up")} />
              <SecondaryButton label="役立たなかった" onPress={() => onFeedback("down")} />
            </View>
            {feedbackNotice ? <Text style={styles.noticeText}>{feedbackNotice}</Text> : null}
          </>
        ) : (
          <Text style={styles.warningText}>{dailyError ?? "助言を取得できませんでした。"}</Text>
        )}
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.backText} onPress={onBack}>戻る</Text>
      <Text style={styles.kicker}>{practiceModeLabel(mode)} {currentIndex + 1} / {session.items.length}</Text>
      <Text style={styles.sectionTitle}>録音と判定</Text>
      <Text style={styles.promptText}>{item.text}</Text>
      <Text style={styles.ipaText}>{item.expected_ipa}</Text>
      <View style={styles.buttonRow}>
        <SecondaryButton label="お手本" onPress={() => onPlayExample("normal")} />
        <SecondaryButton label="スロー" onPress={() => onPlayExample("slow")} />
      </View>
      {recordingState === "recording" ? (
        <PrimaryButton label="停止して判定" onPress={onStopRecording} />
      ) : ["preparing", "finalizing", "assessing"].includes(recordingState) ? (
        <View style={styles.simplePanel}>
          <ActivityIndicator color="#0c6b58" />
          <Text style={styles.panelText}>
            {recordingState === "preparing" ? "発音判定を準備中です。" : recordingState === "finalizing" ? "音声を確定しています。" : "結果を保存しています。"}
          </Text>
        </View>
      ) : (
        <PrimaryButton label={result ? "もう一度録音" : "録音する"} onPress={onStartRecording} />
      )}
      {dailyError ? (
        <View style={styles.simplePanel}>
          <Text style={styles.warningText}>{dailyError}</Text>
          <SecondaryButton label="再試行" onPress={onRetry} disabled={recordingState === "assessing"} />
        </View>
      ) : null}
      {result ? (
        <>
          {(() => {
            const score = result.pronunciation_assessment?.overall.pronunciationScore ?? result.overall_score;
            const band = pronunciationBand(score);
            return <Text style={[styles.perfectText, colorStyle(band.color as PhonemeColor)]}>{band.label}</Text>;
          })()}
          <View style={styles.scorePanel}>
            <Text style={styles.scoreValue}>{Math.round(result.pronunciation_assessment?.overall.pronunciationScore ?? result.overall_score)}</Text>
            <Text style={styles.scoreLabel}>発音スコア / 100</Text>
          </View>
          {perfect ? <Text style={styles.perfectText}>素晴らしい！</Text> : null}
          <Text style={styles.mutedText}>この数値は発音の一致度であり、正解確率ではありません。</Text>
          <View style={styles.buttonRow}>
            <SecondaryButton label="録音再生" onPress={onPlayRecording} disabled={!attempt?.localAudioUri} />
            <SecondaryButton label="詳細を見る" onPress={onDetail} />
          </View>
          <PrimaryButton label={currentIndex >= session.items.length - 1 ? "完了" : "次へ"} onPress={onNext} />
        </>
      ) : null}
    </View>
  );
}

function TwoLineIpa({
  result,
  fallbackExpectedIpa
}: {
  result: AssessmentResult | null;
  fallbackExpectedIpa: string;
}) {
  if (!result) {
    return (
      <View style={styles.ipaPanel}>
        <Text style={styles.ipaRowLabel}>期待IPA</Text>
        <Text style={styles.ipaText}>{fallbackExpectedIpa}</Text>
      </View>
    );
  }

  return (
    <View style={styles.ipaPanel}>
      <Text style={styles.ipaRowLabel}>期待IPA</Text>
      <View style={styles.phonemeRow}>
        {result.phoneme_results.map((phoneme) => (
          <Text key={`expected-${phoneme.index}`} style={[styles.inlinePhoneme, colorStyle(phoneme.color)]}>
            {phoneme.expected_ipa}
          </Text>
        ))}
      </View>
      <Text style={styles.ipaRowLabel}>実測IPA</Text>
      <View style={styles.phonemeRow}>
        {result.phoneme_results.map((phoneme) => (
          <Text key={`observed-${phoneme.index}`} style={[styles.inlinePhoneme, colorStyle(phoneme.color)]}>
            {phoneme.observed_ipa || "?"}
          </Text>
        ))}
      </View>
    </View>
  );
}

function PhonemeGrid({ phonemes }: { phonemes: PhonemeResult[] }) {
  return (
    <View style={styles.phonemeGrid}>
      {phonemes.map((phoneme) => (
        <View key={phoneme.index} style={[styles.phonemeChip, colorStyle(phoneme.color)]}>
          <Text style={styles.phonemeChipText}>{phoneme.expected_ipa}</Text>
          <Text style={styles.phonemeChipMeta}>{Math.round(phoneme.score)} / {colorLabel(phoneme.color)}</Text>
        </View>
      ))}
    </View>
  );
}

function RichPronunciationDetail({ assessment }: { assessment: PronunciationAssessment }) {
  const metrics = visibleScoreMetrics(assessment.overall);
  const issues = Object.values(assessment.issues).flat();
  return (
    <View style={styles.simplePanel}>
      <Text style={styles.panelTitle}>Azure Pronunciation Assessment</Text>
      <Text style={styles.mutedText}>各スコアは 0〜100 の一致度です。正解確率ではありません。</Text>
      {metrics.map(([label, score]) => (
        <Text key={label} style={styles.panelText}>{label}: {Math.round(score)}%</Text>
      ))}
      {assessment.words.map((word, wordIndex) => (
        <View key={`${word.word ?? "word"}-${wordIndex}`} style={styles.ipaPanel}>
          <Text style={styles.panelTitle}>{word.word ?? `単語 ${wordIndex + 1}`}{word.accuracyScore === null ? "" : ` · ${Math.round(word.accuracyScore)}`}</Text>
          {word.syllables?.length ? <Text style={styles.panelText}>音節: {word.syllables.map((part) => part.syllable).filter(Boolean).join(" · ")}</Text> : null}
          {word.phonemes?.map((phoneme, phonemeIndex) => (
            <Text key={phonemeIndex} style={styles.panelText}>
              期待音 /{phoneme.expectedIpa ?? "?"}/
              {phoneme.accuracyScore === null ? "" : ` · 発音スコア ${Math.round(phoneme.accuracyScore)}%`}
              {` · 近く聞こえた音 ${phoneme.observedIpa ? `/${phoneme.observedIpa}/` : "判定なし"}`}
              {phoneme.candidates?.length ? ` 候補: ${phoneme.candidates.map((candidate) => `${candidate.ipa ?? "?"}${candidate.score === null ? "" : ` ${Math.round(candidate.score)}%`}`).join(" / ")}` : ""}
            </Text>
          ))}
        </View>
      ))}
      {issues.length ? <Text style={styles.warningText}>要確認: {issues.map((issue) => issue.word).filter(Boolean).join(" / ")}</Text> : null}
    </View>
  );
}

function PracticeScreen({
  access,
  notice,
  phonemes,
  phonemePickerVisible,
  onClosePhonemePicker,
  onPickPhoneme,
  onStart
}: {
  access: AccessState;
  notice: string | null;
  phonemes: ProgressData["phoneme_heatmap"];
  phonemePickerVisible: boolean;
  onClosePhonemePicker: () => void;
  onPickPhoneme: (phonemeId: string) => void;
  onStart: (mode: PracticeMode) => void;
}) {
  const pickerPhonemes = phonemes.length ? phonemes : fallbackPhonemes();

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>練習</Text>
      {notice ? <Text style={styles.noticeText}>{notice}</Text> : null}
      <ActionRow title="デイリー練習" caption="7問" onPress={() => onStart("daily")} />
      <ActionRow title="苦手ドリル" caption="復習" onPress={() => onStart("weak_drill")} />
      <ActionRow title="音素表から選ぶ" caption="US" onPress={() => onStart("phoneme_select")} />
      <ActionRow
        title="自由入力"
        caption={access.is_pro ? "Pro" : "Pro限定"}
        onPress={() => onStart("free_input")}
      />
      <Modal animationType="slide" transparent visible={phonemePickerVisible} onRequestClose={onClosePhonemePicker}>
        <View style={styles.modalBackdrop}>
          <View style={styles.paywall}>
            <Text style={styles.paywallTitle}>音素表</Text>
            <Text style={styles.paywallText}>練習したい音を選びます。</Text>
            <View style={styles.heatRow}>
              {pickerPhonemes.map((phoneme) => (
                <Pressable
                  key={phoneme.phoneme_id}
                  onPress={() => onPickPhoneme(phoneme.phoneme_id)}
                  style={[styles.phonemeSelectCell, heatStyle(phoneme.color)]}
                >
                  <Text style={styles.heatText}>{phoneme.ipa || phoneme.phoneme_id}</Text>
                  <Text style={styles.phonemeSelectMeta}>
                    {phoneme.mastery_ewma == null ? "--" : Math.round(phoneme.mastery_ewma)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <SecondaryButton label="閉じる" onPress={onClosePhonemePicker} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function FreeInputScreen({
  consentVisible,
  error,
  recordingState,
  result,
  text,
  audioUri,
  onAcceptConsent,
  onCancelConsent,
  onPlayRecording,
  onRetry,
  onStartRecording,
  onStopRecording,
  onTextChange
}: {
  consentVisible: boolean;
  error: string | null;
  recordingState: RecordingState;
  result: FreeAssessResult | null;
  text: string;
  audioUri: string | null;
  onAcceptConsent: () => void;
  onCancelConsent: () => void;
  onPlayRecording: () => void;
  onRetry: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onTextChange: (text: string) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.kicker}>Pro限定</Text>
      <Text style={styles.sectionTitle}>自由入力</Text>
      <TextInput
        multiline
        onChangeText={onTextChange}
        placeholder="練習したい英文を入力"
        style={styles.textArea}
        value={text}
      />
      {recordingState === "recording" ? (
        <PrimaryButton label="停止して判定" onPress={onStopRecording} />
      ) : ["preparing", "finalizing", "assessing"].includes(recordingState) ? (
        <View style={styles.simplePanel}>
          <ActivityIndicator color="#0c6b58" />
          <Text style={styles.panelText}>自由入力を判定中です。</Text>
        </View>
      ) : (
        <PrimaryButton label={result ? "もう一度録音" : "録音する"} onPress={onStartRecording} />
      )}
      {error ? (
        <View style={styles.simplePanel}>
          <Text style={styles.warningText}>{error}</Text>
          <SecondaryButton label="再試行" onPress={onRetry} disabled={recordingState === "assessing"} />
        </View>
      ) : null}
      {result ? (
        <>
          <View style={styles.scorePanel}>
            <Text style={styles.scoreValue}>{Math.round(result.overall_score)}</Text>
            <Text style={styles.scoreLabel}>free input</Text>
          </View>
          <Text style={styles.panelText}>今日 {result.limit.used_today} / {result.limit.soft_cap}</Text>
          <View style={styles.buttonRow}>
            <SecondaryButton label="録音再生" onPress={onPlayRecording} disabled={!audioUri} />
          </View>
          <TwoLineIpa
            result={{
              attempt_id: result.free_attempt_id,
              earned_badges: [],
              is_best: false,
              is_correct: false,
              is_perfect: false,
              next: { recommended_advice_id: null },
              overall_score: result.overall_score,
              target_score_avg: result.overall_score,
              phoneme_results: result.phoneme_scores,
              pronunciation_assessment: result.pronunciation_assessment
            }}
            fallbackExpectedIpa={result.ipa_result.ipa ?? ""}
          />
        </>
      ) : null}
      <Modal animationType="slide" transparent visible={consentVisible} onRequestClose={onCancelConsent}>
        <View style={styles.modalBackdrop}>
          <View style={styles.paywall}>
            <Text style={styles.paywallTitle}>自由入力の保存同意</Text>
            <Text style={styles.paywallText}>
              入力文は発音判定と教材改善のため保存されます。個人名、住所、電話番号、機密情報は入力しないでください。音声ファイルはサーバー保存されず、学習データ削除の対象です。
            </Text>
            <PrimaryButton label="同意して続ける" onPress={onAcceptConsent} />
            <SecondaryButton label="キャンセル" onPress={onCancelConsent} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SettingsScreen({
  access,
  profile,
  playbackSpeed,
  purchaseBusy,
  reminderSettings,
  revenueCatError,
  settingsBusy,
  settingsNotice,
  onBuyPro,
  onDeleteLearningData,
  onExportLearningData,
  onOpenLink,
  onReminderEnabledChange,
  onReminderHourChange,
  onRestore,
  onSetPlaybackSpeed
}: {
  access: AccessState;
  profile: Profile;
  playbackSpeed: PlaybackSpeed;
  purchaseBusy: boolean;
  reminderSettings: ReminderSettings;
  revenueCatError: string | null;
  settingsBusy: boolean;
  settingsNotice: string | null;
  onBuyPro: () => void;
  onDeleteLearningData: () => void;
  onExportLearningData: () => void;
  onOpenLink: (url: string) => void;
  onReminderEnabledChange: (enabled: boolean) => void;
  onReminderHourChange: (hour: number) => void;
  onRestore: () => void;
  onSetPlaybackSpeed: (speed: PlaybackSpeed) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>設定</Text>
      {settingsNotice ? <Text style={styles.noticeText}>{settingsNotice}</Text> : null}
      <View style={styles.simplePanel}>
        <Text style={styles.panelTitle}>プラン</Text>
        <Text style={styles.panelText}>
          {access.is_pro ? "Pro" : access.is_trial_active ? `無料期間 ${access.trial_day}日目` : "未登録"}
        </Text>
        {revenueCatError ? <Text style={styles.warningText}>{revenueCatError}</Text> : null}
        <View style={styles.buttonRow}>
          <SecondaryButton label="Pro登録" onPress={onBuyPro} disabled={purchaseBusy} />
          <SecondaryButton label="購入復元" onPress={onRestore} disabled={purchaseBusy} />
        </View>
      </View>
      <SettingLine label="母語" value={profile.native_language === "und" ? "指定なし" : profile.native_language === "ja" ? "日本語" : profile.native_language} />
      <SettingLine label="目標アクセント" value={profile.target_accent} />
      <SettingLine label="UK" value="準備中" disabled />
      <View style={styles.simplePanel}>
        <View style={styles.switchLine}>
          <View>
            <Text style={styles.panelTitle}>復習リマインダー</Text>
            <Text style={styles.panelText}>{timeLabel(reminderSettings.hour, reminderSettings.minute)}</Text>
          </View>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: reminderSettings.enabled }}
            onPress={() => onReminderEnabledChange(!reminderSettings.enabled)}
            style={[styles.switchTrack, reminderSettings.enabled ? styles.switchTrackOn : null]}
          >
            <View style={[styles.switchThumb, reminderSettings.enabled ? styles.switchThumbOn : null]} />
          </Pressable>
        </View>
        <View style={styles.buttonRow}>
          {[7, 12, 20, 22].map((hour) => (
            <SecondaryButton
              key={hour}
              label={`${hour}:00`}
              onPress={() => onReminderHourChange(hour)}
              disabled={!reminderSettings.enabled}
            />
          ))}
        </View>
      </View>
      <View style={styles.simplePanel}>
        <Text style={styles.panelTitle}>再生速度</Text>
        <View style={styles.segmented}>
          <SegmentButton
            active={playbackSpeed === "normal"}
            label="通常"
            onPress={() => onSetPlaybackSpeed("normal")}
          />
          <SegmentButton
            active={playbackSpeed === "slow"}
            label="スロー"
            onPress={() => onSetPlaybackSpeed("slow")}
          />
        </View>
      </View>
      <View style={styles.simplePanel}>
        <Text style={styles.panelTitle}>学習データ</Text>
        <Text style={styles.panelText}>JSON書き出しに音声ファイルは含まれません。</Text>
        <View style={styles.buttonRow}>
          <SecondaryButton label="JSON書き出し" onPress={onExportLearningData} disabled={settingsBusy} />
          <SecondaryButton label="学習データ削除" onPress={onDeleteLearningData} disabled={settingsBusy} />
        </View>
      </View>
      <View style={styles.linkRow}>
        <Text style={styles.linkText} onPress={() => onOpenLink(PRIVACY_URL)}>
          プライバシーポリシー
        </Text>
        <Text style={styles.linkText} onPress={() => onOpenLink(TERMS_URL)}>
          利用規約
        </Text>
      </View>
      <Text style={styles.appInfo}>Pronunciation Mirror {getAppVersion()}</Text>
    </View>
  );
}

function timeLabel(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function PaywallModal({
  visible,
  reason,
  purchaseBusy,
  onBuyPro,
  onClose,
  onOpenLink,
  onRestore
}: {
  visible: boolean;
  reason: PracticeMode;
  purchaseBusy: boolean;
  onBuyPro: () => void;
  onClose: () => void;
  onOpenLink: (url: string) => void;
  onRestore: () => void;
}) {
  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.paywall}>
          <Text style={styles.paywallTitle}>Proで練習を続ける</Text>
          <Text style={styles.paywallText}>
            {reason === "free_input"
              ? "自由入力はPro限定です。"
              : "無料期間終了後の練習にはPro登録が必要です。"}
          </Text>
          <View style={styles.priceRow}>
            <View style={styles.priceBox}>
              <Text style={styles.priceLabel}>月額</Text>
              <Text style={styles.priceValue}>580円</Text>
            </View>
            <View style={styles.priceBox}>
              <Text style={styles.priceLabel}>年額</Text>
              <Text style={styles.priceValue}>4,980円</Text>
            </View>
          </View>
          <PrimaryButton label="Pro登録" onPress={onBuyPro} disabled={purchaseBusy} />
          <SecondaryButton label="購入復元" onPress={onRestore} disabled={purchaseBusy} />
          <View style={styles.linkRow}>
            <Text style={styles.linkText} onPress={() => onOpenLink(PRIVACY_URL)}>
              プライバシーポリシー
            </Text>
            <Text style={styles.linkText} onPress={() => onOpenLink(TERMS_URL)}>
              利用規約
            </Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>閉じる</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function BottomTabs({
  activeTab,
  onChange
}: {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
}) {
  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "home", label: "ホーム" },
    { key: "progress", label: "進捗" },
    { key: "practice", label: "練習" },
    { key: "settings", label: "設定" }
  ];

  return (
    <View style={styles.tabBar}>
      {tabs.map((tab) => (
        <Pressable
          key={tab.key}
          onPress={() => onChange(tab.key)}
          style={[styles.tabItem, activeTab === tab.key ? styles.tabItemActive : null]}
        >
          <Text style={[styles.tabLabel, activeTab === tab.key ? styles.tabLabelActive : null]}>
            {tab.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "green" | "blue" | "red" }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text
        style={[
          styles.metricValue,
          tone === "green" ? styles.metricGreen : tone === "blue" ? styles.metricBlue : styles.metricRed
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function ActionRow({
  title,
  caption,
  onPress
}: {
  title: string;
  caption: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.actionRow}>
      <View>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionCaption}>{caption}</Text>
      </View>
      <Text style={styles.actionChevron}>›</Text>
    </Pressable>
  );
}

function SettingLine({
  label,
  value,
  disabled = false
}: {
  label: string;
  value: string;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.settingLine, disabled ? styles.disabledLine : null]}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Text style={styles.settingValue}>{value}</Text>
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled = false
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.primaryButton, disabled ? styles.buttonDisabled : null]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({
  label,
  onPress,
  disabled = false
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.secondaryButton, disabled ? styles.buttonDisabled : null]}
    >
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function SegmentButton({
  active,
  label,
  onPress
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.segmentButton, active ? styles.segmentActive : null]}>
      <Text style={[styles.segmentText, active ? styles.segmentTextActive : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f6f7f4"
  },
  centeredScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#f6f7f4"
  },
  appShell: {
    flex: 1
  },
  content: {
    padding: 20,
    paddingBottom: 108
  },
  loadingTitle: {
    marginTop: 18,
    color: "#14212b",
    fontSize: 26,
    fontWeight: "800"
  },
  mutedText: {
    marginTop: 8,
    color: "#61717f",
    fontSize: 15
  },
  errorTitle: {
    color: "#8f2c2a",
    fontSize: 23,
    fontWeight: "800",
    marginBottom: 8,
    textAlign: "center"
  },
  errorText: {
    color: "#2c3844",
    fontSize: 16,
    lineHeight: 23,
    marginBottom: 22,
    textAlign: "center"
  },
  onboarding: {
    flex: 1,
    justifyContent: "space-between",
    padding: 28
  },
  kicker: {
    color: "#0c6b58",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 18
  },
  heroTitle: {
    color: "#14212b",
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 40
  },
  heroText: {
    color: "#344554",
    fontSize: 18,
    lineHeight: 27,
    marginTop: 16
  },
  onboardingFooter: {
    gap: 22
  },
  dots: {
    flexDirection: "row",
    gap: 8
  },
  dot: {
    borderRadius: 5,
    height: 10,
    width: 10
  },
  dotActive: {
    backgroundColor: "#0c6b58"
  },
  dotInactive: {
    backgroundColor: "#c8d2d8"
  },
  banner: {
    alignItems: "center",
    backgroundColor: "#fff0d7",
    borderBottomColor: "#e8c37c",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  bannerText: {
    color: "#6c4608",
    flex: 1,
    fontSize: 13,
    lineHeight: 18
  },
  bannerButton: {
    minHeight: 34,
    justifyContent: "center"
  },
  bannerButtonText: {
    color: "#0c5d83",
    fontSize: 13,
    fontWeight: "800"
  },
  section: {
    gap: 16
  },
  appName: {
    color: "#0c6b58",
    fontSize: 16,
    fontWeight: "900"
  },
  sectionTitle: {
    color: "#14212b",
    fontSize: 28,
    fontWeight: "900"
  },
  metricRow: {
    flexDirection: "row",
    gap: 12
  },
  metric: {
    backgroundColor: "#ffffff",
    borderColor: "#dde5e3",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    padding: 16
  },
  metricLabel: {
    color: "#657481",
    fontSize: 13,
    fontWeight: "700"
  },
  metricValue: {
    fontSize: 25,
    fontWeight: "900",
    marginTop: 6
  },
  metricGreen: {
    color: "#0c6b58"
  },
  metricBlue: {
    color: "#0d5c8b"
  },
  metricRed: {
    color: "#b0443e"
  },
  homePanel: {
    backgroundColor: "#14212b",
    borderRadius: 8,
    padding: 22,
    gap: 14
  },
  homeState: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 31
  },
  homeSubtext: {
    color: "#dbe7e4",
    fontSize: 15
  },
  backText: {
    color: "#0d5c8b",
    fontSize: 15,
    fontWeight: "900",
    minHeight: 32
  },
  promptText: {
    color: "#14212b",
    fontSize: 30,
    fontWeight: "900",
    lineHeight: 38
  },
  ipaText: {
    color: "#52616f",
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 28
  },
  ipaPanel: {
    backgroundColor: "#ffffff",
    borderColor: "#dde5e3",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 16
  },
  ipaRowLabel: {
    color: "#657481",
    fontSize: 12,
    fontWeight: "900"
  },
  phonemeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  inlinePhoneme: {
    borderRadius: 6,
    fontSize: 18,
    fontWeight: "900",
    minWidth: 34,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 6,
    textAlign: "center"
  },
  phonemeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  phonemeChip: {
    borderRadius: 8,
    minWidth: 76,
    padding: 10
  },
  phonemeChipText: {
    color: "#14212b",
    fontSize: 18,
    fontWeight: "900"
  },
  phonemeChipMeta: {
    color: "#14212b",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4
  },
  phonemeGreen: {
    backgroundColor: "#dff3e7",
    borderColor: "#70b985",
    borderWidth: 1
  },
  phonemeYellow: {
    backgroundColor: "#fff1c7",
    borderColor: "#d9a82f",
    borderWidth: 1
  },
  phonemeRed: {
    backgroundColor: "#ffe0dc",
    borderColor: "#d66a5f",
    borderWidth: 1
  },
  scorePanel: {
    alignItems: "center",
    backgroundColor: "#14212b",
    borderRadius: 8,
    padding: 18
  },
  scoreValue: {
    color: "#ffffff",
    fontSize: 48,
    fontWeight: "900"
  },
  scoreLabel: {
    color: "#c8d2d8",
    fontSize: 14,
    fontWeight: "900"
  },
  perfectText: {
    color: "#0c6b58",
    fontSize: 24,
    fontWeight: "900"
  },
  assetBox: {
    alignItems: "center",
    backgroundColor: "#eaf1ee",
    borderColor: "#bfd5cc",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 112,
    justifyContent: "center",
    padding: 16
  },
  assetText: {
    color: "#0c6b58",
    fontSize: 18,
    fontWeight: "900"
  },
  simplePanel: {
    backgroundColor: "#ffffff",
    borderColor: "#dde5e3",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 16
  },
  panelTitle: {
    color: "#14212b",
    fontSize: 17,
    fontWeight: "900"
  },
  panelText: {
    color: "#52616f",
    fontSize: 15,
    lineHeight: 22
  },
  masteryValue: {
    color: "#0c6b58",
    fontSize: 42,
    fontWeight: "900"
  },
  chartRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 5,
    height: 96
  },
  chartBarWrap: {
    backgroundColor: "#edf2f1",
    borderRadius: 4,
    flex: 1,
    height: "100%",
    justifyContent: "flex-end",
    overflow: "hidden"
  },
  chartBar: {
    backgroundColor: "#0c6b58",
    borderRadius: 4,
    minHeight: 8
  },
  heatRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  heatCell: {
    alignItems: "center",
    borderRadius: 8,
    height: 54,
    justifyContent: "center",
    width: 54
  },
  heatWarm: {
    backgroundColor: "#f7d36b"
  },
  heatHot: {
    backgroundColor: "#f19a8f"
  },
  heatGood: {
    backgroundColor: "#9bd4ad"
  },
  heatCool: {
    backgroundColor: "#d7eee5"
  },
  heatText: {
    color: "#14212b",
    fontSize: 16,
    fontWeight: "900"
  },
  noticeText: {
    backgroundColor: "#e6f3ef",
    borderRadius: 8,
    color: "#0c6b58",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 22,
    padding: 14
  },
  actionRow: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#dde5e3",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 76,
    padding: 16
  },
  actionTitle: {
    color: "#14212b",
    fontSize: 18,
    fontWeight: "900"
  },
  actionCaption: {
    color: "#657481",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4
  },
  actionChevron: {
    color: "#0c6b58",
    fontSize: 31,
    fontWeight: "600"
  },
  phonemeSelectCell: {
    alignItems: "center",
    borderRadius: 8,
    minHeight: 64,
    justifyContent: "center",
    padding: 8,
    width: 66
  },
  phonemeSelectMeta: {
    color: "#25323e",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 3
  },
  textArea: {
    backgroundColor: "#ffffff",
    borderColor: "#dde5e3",
    borderRadius: 8,
    borderWidth: 1,
    color: "#14212b",
    fontSize: 18,
    minHeight: 130,
    padding: 14,
    textAlignVertical: "top"
  },
  warningText: {
    color: "#8f2c2a",
    fontSize: 13,
    lineHeight: 19
  },
  buttonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  settingLine: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#dde5e3",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 58,
    paddingHorizontal: 16
  },
  disabledLine: {
    opacity: 0.55
  },
  settingLabel: {
    color: "#25323e",
    fontSize: 15,
    fontWeight: "800"
  },
  settingValue: {
    color: "#566674",
    fontSize: 15,
    fontWeight: "700"
  },
  segmented: {
    backgroundColor: "#edf2f1",
    borderRadius: 8,
    flexDirection: "row",
    padding: 4
  },
  switchLine: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 14
  },
  switchTrack: {
    backgroundColor: "#c8d2d8",
    borderRadius: 16,
    height: 32,
    justifyContent: "center",
    padding: 3,
    width: 56
  },
  switchTrackOn: {
    backgroundColor: "#0c6b58"
  },
  switchThumb: {
    backgroundColor: "#ffffff",
    borderRadius: 13,
    height: 26,
    width: 26
  },
  switchThumbOn: {
    transform: [{ translateX: 24 }]
  },
  segmentButton: {
    alignItems: "center",
    borderRadius: 6,
    flex: 1,
    minHeight: 42,
    justifyContent: "center"
  },
  segmentActive: {
    backgroundColor: "#ffffff"
  },
  segmentText: {
    color: "#657481",
    fontSize: 15,
    fontWeight: "800"
  },
  segmentTextActive: {
    color: "#0c6b58"
  },
  linkRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16
  },
  linkText: {
    color: "#0d5c8b",
    fontSize: 14,
    fontWeight: "800",
    minHeight: 32
  },
  appInfo: {
    color: "#657481",
    fontSize: 13
  },
  modalBackdrop: {
    backgroundColor: "rgba(20, 33, 43, 0.44)",
    flex: 1,
    justifyContent: "flex-end"
  },
  paywall: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    gap: 14,
    padding: 22,
    paddingBottom: 30
  },
  paywallTitle: {
    color: "#14212b",
    fontSize: 27,
    fontWeight: "900",
    lineHeight: 34
  },
  paywallText: {
    color: "#52616f",
    fontSize: 16,
    lineHeight: 23
  },
  priceRow: {
    flexDirection: "row",
    gap: 12
  },
  priceBox: {
    backgroundColor: "#f6f7f4",
    borderColor: "#dde5e3",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    padding: 14
  },
  priceLabel: {
    color: "#657481",
    fontSize: 13,
    fontWeight: "800"
  },
  priceValue: {
    color: "#14212b",
    fontSize: 22,
    fontWeight: "900",
    marginTop: 4
  },
  closeButton: {
    alignItems: "center",
    minHeight: 46,
    justifyContent: "center"
  },
  closeButtonText: {
    color: "#52616f",
    fontSize: 15,
    fontWeight: "800"
  },
  tabBar: {
    backgroundColor: "#ffffff",
    borderTopColor: "#d9e2df",
    borderTopWidth: 1,
    bottom: 0,
    flexDirection: "row",
    left: 0,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 12,
    position: "absolute",
    right: 0
  },
  tabItem: {
    alignItems: "center",
    borderRadius: 8,
    flex: 1,
    minHeight: 48,
    justifyContent: "center"
  },
  tabItemActive: {
    backgroundColor: "#e6f3ef"
  },
  tabLabel: {
    color: "#657481",
    fontSize: 13,
    fontWeight: "800"
  },
  tabLabelActive: {
    color: "#0c6b58"
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#0c6b58",
    borderRadius: 8,
    minHeight: 54,
    justifyContent: "center",
    paddingHorizontal: 18
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "900"
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#0c6b58",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16
  },
  secondaryButtonText: {
    color: "#0c6b58",
    fontSize: 15,
    fontWeight: "900"
  },
  buttonDisabled: {
    opacity: 0.45
  }
});
