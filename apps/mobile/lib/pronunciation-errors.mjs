const USER_MESSAGES = Object.freeze({
  SILENCE: "音声を検出できませんでした。マイクへ近づいて、もう一度お試しください。",
  AUDIO_TOO_SHORT: "音声が短すぎます。録音を開始してから0.25秒以上話してください。",
  AUDIO_TOO_LONG: "音声が長すぎます。30秒以内で録音してください。",
  STALE_REQUEST: "録音の準備を更新しました。もう一度お試しください。",
  AZURE_RESULT_TIMEOUT: "発音判定がタイムアウトしました。通信状態を確認して、もう一度お試しください。",
  MICROPHONE_PERMISSION: "マイク権限が必要です。設定アプリからマイクを許可してください。",
  NOT_PREPARED: "発音判定を準備し直します。もう一度お試しください。",
  NOT_RECORDING: "録音状態を確認できませんでした。もう一度お試しください。",
  AUDIO_FORMAT_UNAVAILABLE: "マイクの音声形式を準備できませんでした。Bluetoothを切り替えて、もう一度お試しください。",
  AZURE_RECOGNITION_FAILED: "音声認識を完了できませんでした。もう一度お試しください。"
});

export function pronunciationErrorCode(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  for (const known of Object.keys(USER_MESSAGES)) {
    if (code === known || code.endsWith(`_${known}`)) return known;
  }
  const message = typeof error?.message === "string" ? error.message : "";
  for (const known of Object.keys(USER_MESSAGES)) {
    if (message.includes(known)) return known;
  }
  if (/古い発音判定リクエスト/.test(message)) return "STALE_REQUEST";
  if (/音声を検出できません/.test(message)) return "SILENCE";
  if (/音声が短すぎます/.test(message)) return "AUDIO_TOO_SHORT";
  if (/タイムアウト/.test(message)) return "AZURE_RESULT_TIMEOUT";
  if (/マイク権限/.test(message)) return "MICROPHONE_PERMISSION";
  return null;
}

export function pronunciationErrorMessage(error) {
  const code = pronunciationErrorCode(error);
  if (code) return USER_MESSAGES[code];
  const raw = typeof error?.message === "string" ? error.message : "";
  const causedBy = raw.split(/(?:→|->)?\s*Caused by:\s*/i).at(-1)?.trim();
  if (causedBy && /[ぁ-んァ-ン一-龯]/.test(causedBy)) return causedBy;
  return "発音判定を完了できませんでした。もう一度お試しください。";
}

export function isRecoverableStaleRequest(error) {
  return pronunciationErrorCode(error) === "STALE_REQUEST";
}
