import { ApiError } from "./http.mjs";

export function getApiEnv(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = env.SUPABASE_ANON_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  const values = {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    revenueCatSecretKey: env.REVENUECAT_SECRET_KEY,
    revenueCatWebhookAuthToken: env.REVENUECAT_WEBHOOK_AUTH_TOKEN,
    revenueCatProEntitlementId: env.REVENUECAT_PRO_ENTITLEMENT_ID || "pro",
    pythonServiceUrl: env.PYTHON_SERVICE_URL,
    pythonServiceApiKey: env.PYTHON_SERVICE_API_KEY,
    openAiApiKey: env.OPENAI_API_KEY,
    openAiAdviceModel: env.OPENAI_ADVICE_MODEL || "gpt-4.1-mini",
    azureSpeechKey: env.AZURE_SPEECH_KEY,
    azureSpeechRegion: env.AZURE_SPEECH_REGION,
    azureSpeechEndpoint: env.AZURE_SPEECH_ENDPOINT,
    azureAssessmentMode: env.AZURE_ASSESSMENT_MODE || "auto",
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
  if (!values.revenueCatSecretKey) missing.push("REVENUECAT_SECRET_KEY");
  if (!values.revenueCatWebhookAuthToken) missing.push("REVENUECAT_WEBHOOK_AUTH_TOKEN");

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
