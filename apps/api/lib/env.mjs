import { ApiError } from "./http.mjs";

export function getApiEnv(env = process.env, options = {}) {
  const supabaseUrl = env.SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = env.SUPABASE_ANON_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  const values = {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    revenueCatSecretKey: env.REVENUECAT_SECRET_KEY,
    revenueCatWebhookAuthToken: env.REVENUECAT_WEBHOOK_AUTH_TOKEN,
    revenueCatProEntitlementId: env.REVENUECAT_PRO_ENTITLEMENT_ID || "pro",
    v2RevenueCatEntitlementId: env.REVENUECAT_PRO_ENTITLEMENT_ID || null,
    pythonServiceUrl: env.PYTHON_SERVICE_URL,
    pythonServiceApiKey: env.PYTHON_SERVICE_API_KEY,
    openAiApiKey: env.OPENAI_API_KEY,
    openAiAdviceModel: env.OPENAI_ADVICE_MODEL || "gpt-4.1-mini",
    azureSpeechKey: env.AZURE_SPEECH_KEY,
    azureSpeechRegion: env.AZURE_SPEECH_REGION,
    azureSpeechLocale: env.AZURE_SPEECH_LOCALE ?? "en-US",
    azureAssessmentMode: env.AZURE_ASSESSMENT_MODE || "auto",
    v2AssessmentTicketTtlSeconds: parseOptionalPositiveInteger(env.OTOKAGAMI_V2_TICKET_TTL_SECONDS),
    v2CaptureWindowSeconds: parseOptionalPositiveInteger(env.OTOKAGAMI_V2_CAPTURE_WINDOW_SECONDS),
    v2SubmissionWindowSeconds: parseOptionalPositiveInteger(env.OTOKAGAMI_V2_SUBMISSION_WINDOW_SECONDS),
    v2SpeechTokenTtlSeconds: parseOptionalPositiveInteger(env.OTOKAGAMI_V2_SPEECH_TOKEN_TTL_SECONDS),
    v2ProviderProjectionMaxBytes: parseOptionalPositiveInteger(env.OTOKAGAMI_V2_PROVIDER_PROJECTION_MAX_BYTES),
    v2TicketRateLimitWindowSeconds: parseOptionalPositiveInteger(env.OTOKAGAMI_V2_RATE_LIMIT_WINDOW_SECONDS),
    v2TicketRateLimitMax: parseOptionalPositiveInteger(env.OTOKAGAMI_V2_RATE_LIMIT_MAX),
    v2OutboxRetentionSeconds: parseOptionalPositiveInteger(env.OTOKAGAMI_V2_OUTBOX_RETENTION_SECONDS),
    v2OutboxMaxItems: parseOptionalPositiveInteger(env.OTOKAGAMI_V2_OUTBOX_MAX_ITEMS),
    v2OutboxMaxBytes: parseOptionalPositiveInteger(env.OTOKAGAMI_V2_OUTBOX_MAX_BYTES),
    v2OutboxBackoffBaseSeconds: parseOptionalPositiveInteger(env.OTOKAGAMI_V2_OUTBOX_BACKOFF_BASE_SECONDS),
    v2OutboxBackoffMaxSeconds: parseOptionalPositiveInteger(env.OTOKAGAMI_V2_OUTBOX_BACKOFF_MAX_SECONDS),
    v2ExportMaxBytes: parseOptionalPositiveInteger(env.OTOKAGAMI_V2_EXPORT_MAX_BYTES),
    v2ValidationContentEnabled: env.OTOKAGAMI_V2_VALIDATION_CONTENT_ENABLED === "true",
    v2ValidationTesterUserIds: parseUuidSet(env.OTOKAGAMI_V2_VALIDATION_TESTER_USER_IDS),
    v2ValidationInstallationIds: parseNonEmptySet(env.OTOKAGAMI_V2_VALIDATION_INSTALLATION_IDS),
    v2ValidationDevelopmentClientMarker: env.OTOKAGAMI_V2_VALIDATION_DEVELOPMENT_CLIENT_MARKER || null,
    v2ValidationContentVersionId: parseOptionalUuid(env.OTOKAGAMI_V2_VALIDATION_CONTENT_VERSION_ID),
    deploymentEnvironment: env.VERCEL_ENV ?? env.NODE_ENV ?? "unknown",
    freeTextDailySoftCap: Number(env.FREE_TEXT_DAILY_SOFT_CAP || 20),
    ttsSignedUrlTtlSeconds: Number(env.TTS_SIGNED_URL_TTL_SECONDS || 3600)
  };

  const missing = [];
  if (!supabaseUrl) {
    missing.push(env.SUPABASE_URL === undefined ? "SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL" : "SUPABASE_URL");
  }
  if (!supabaseAnonKey) {
    missing.push(env.SUPABASE_ANON_KEY === undefined ? "SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY" : "SUPABASE_ANON_KEY");
  }
  if (!values.supabaseServiceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (options.requireRevenueCatWebhook) {
    if (!values.revenueCatSecretKey) missing.push("REVENUECAT_SECRET_KEY");
    if (!values.revenueCatWebhookAuthToken) missing.push("REVENUECAT_WEBHOOK_AUTH_TOKEN");
  }

  if (missing.length > 0) {
    throw new ApiError(
      "SERVER_ENV_MISSING",
      `サーバー環境変数が未設定です: ${missing.join(", ")}`,
      500,
      false
    );
  }

  return values;
}

function parseUuidSet(value) {
  if (!value) return new Set();
  return new Set(value.split(",").map((entry) => entry.trim()).filter((entry) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry)
  ));
}

function parseNonEmptySet(value) {
  if (!value) return new Set();
  return new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean));
}

function parseOptionalUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function parseOptionalPositiveInteger(value) {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
