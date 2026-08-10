export class V2ApiError extends Error {
  constructor(code, message, status, retryable) {
    super(message);
    this.name = "V2ApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable === true;
  }
}

export function classifyV2OutboxError(error) {
  if (!(error instanceof V2ApiError)) return "retryable";
  if (error.retryable || error.status >= 500) return "retryable";
  return "permanent_failure";
}

export function createV2ApiClient({ baseUrl, getAccessToken, fetchImpl = fetch }) {
  if (!isHttpUrl(baseUrl)) throw new TypeError("A valid v2 API base URL is required.");
  if (typeof getAccessToken !== "function") throw new TypeError("getAccessToken is required.");

  async function request(path, { method = "GET", body, signal } = {}) {
    const accessToken = await getAccessToken();
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      throw new V2ApiError("UNAUTHORIZED", "認証が必要です。", 401, false);
    }
    let response;
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new V2ApiError("NETWORK_UNAVAILABLE", "通信できませんでした。", 0, true);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true || payload.data === undefined) {
      throw new V2ApiError(
        typeof payload?.error?.code === "string" ? payload.error.code : "REQUEST_FAILED",
        typeof payload?.error?.message === "string" ? payload.error.message : "処理に失敗しました。",
        response.status,
        payload?.error?.retryable === true
      );
    }
    return payload.data;
  }

  return Object.freeze({
    bootstrap: () => request("/api/v2/bootstrap", { method: "POST", body: {} }),
    accessStatus: () => request("/api/v2/access-status"),
    dailySession: (timezone) => request("/api/v2/daily-session", { method: "POST", body: { timezone } }),
    speechToken: (sessionItemId, attemptPurpose) => request("/api/v2/speech-token", {
      method: "POST",
      body: { session_item_id: sessionItemId, attempt_purpose: attemptPurpose }
    }),
    persistAttempt: (command) => request("/api/v2/attempts", { method: "POST", body: command }),
    completeReview: (command) => request("/api/v2/review-completion", { method: "POST", body: command }),
    completeSession: (sessionId, idempotencyKey) => request("/api/v2/session-completion", {
      method: "POST",
      body: { session_id: sessionId, completion_idempotency_key: idempotencyKey }
    }),
    progress: () => request("/api/v2/progress"),
    reports: () => request("/api/v2/reports"),
    exportLearningData: () => request("/api/v2/export", { method: "POST", body: {} }),
    deleteLearningData: (deletionRequestId, expectedDeletionEpoch) => request("/api/v2/delete-learning-data", {
      method: "POST",
      body: {
        confirm: true,
        deletion_request_id: deletionRequestId,
        expected_deletion_epoch: expectedDeletionEpoch
      }
    })
  });
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
