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

export function createV2ApiClient({ baseUrl,getAccessToken,fetchImpl=fetch,validationHeaders={},requestTimeoutMs,responseMaxBytes }) {
  if (!isHttpUrl(baseUrl)) throw new TypeError("A valid v2 API base URL is required.");
  if (typeof getAccessToken !== "function") throw new TypeError("getAccessToken is required.");

  async function request(path, { method = "GET", body, signal } = {}) {
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new V2ApiError("V2_CLIENT_TIMEOUT_CONFIG_REQUIRED","通信設定が未確定です。",503,false);
    }
    if (!Number.isSafeInteger(responseMaxBytes) || responseMaxBytes <= 0) {
      throw new V2ApiError("V2_CLIENT_RESPONSE_LIMIT_CONFIG_REQUIRED","応答サイズ設定が未確定です。",503,false);
    }
    const accessToken = await getAccessToken();
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      throw new V2ApiError("UNAUTHORIZED", "認証が必要です。", 401, false);
    }
    let response;
    let payload;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort("timeout"),requestTimeoutMs);
    const forwardAbort=()=>controller.abort(signal?.reason);
    signal?.addEventListener?.("abort",forwardAbort,{once:true});
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...validationHeaders,
          ...(body === undefined ? {} : { "Content-Type": "application/json" })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal:controller.signal
      });
      payload = await readBoundedJsonResponse(response,responseMaxBytes,controller.signal);
    } catch (error) {
      if (error instanceof V2ApiError) throw error;
      if (controller.signal.aborted && !signal?.aborted) {
        throw new V2ApiError("REQUEST_TIMEOUT","通信がタイムアウトしました。",408,true);
      }
      if (error?.name === "AbortError") throw error;
      throw new V2ApiError("NETWORK_UNAVAILABLE", "通信できませんでした。", 0, true);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort",forwardAbort);
    }
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
    speechToken: (sessionItemId, attemptPurpose, ticketRequestId, assessmentTicketNonce) => request("/api/v2/speech-token", {
      method: "POST",
      body: { operation:"issue",session_item_id: sessionItemId,attempt_purpose: attemptPurpose,
        ticket_request_id: ticketRequestId,assessment_ticket_nonce:assessmentTicketNonce }
    }),
    recoverSpeechToken:(ticketRequestId,assessmentTicketNonce)=>request("/api/v2/speech-token",{
      method:"POST",body:{operation:"recover",ticket_request_id:ticketRequestId,assessment_ticket_nonce:assessmentTicketNonce}
    }),
    cancelSpeechToken:(ticketRequestId,assessmentTicketNonce)=>request("/api/v2/speech-token",{
      method:"POST",body:{operation:"cancel",ticket_request_id:ticketRequestId,assessment_ticket_nonce:assessmentTicketNonce}
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

async function readBoundedJsonResponse(response,maxBytes,signal) {
  const declared=Number(response.headers?.get?.("content-length"));
  if(Number.isFinite(declared)&&declared>maxBytes){
    throw new V2ApiError("RESPONSE_TOO_LARGE","応答が大きすぎます。",502,false);
  }
  const reader=response.body?.getReader?.();
  if(reader){
    const chunks=[];let total=0;
    try{
      while(true){
        const {done,value}=await readResponseChunk(reader,signal);
        if(done)break;
        total+=value.byteLength;
        if(total>maxBytes){await reader.cancel?.();throw new V2ApiError("RESPONSE_TOO_LARGE","応答が大きすぎます。",502,false);}
        chunks.push(value);
      }
    }finally{reader.releaseLock?.();}
    const joined=new Uint8Array(total);let offset=0;
    for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}
    try{return JSON.parse(new TextDecoder().decode(joined));}catch{return null;}
  }
  const text=await response.text();
  if(new TextEncoder().encode(text).byteLength>maxBytes){
    throw new V2ApiError("RESPONSE_TOO_LARGE","応答が大きすぎます。",502,false);
  }
  try{return JSON.parse(text);}catch{return null;}
}

async function readResponseChunk(reader,signal){
  if(!signal)return reader.read();
  if(signal.aborted)throw Object.assign(new Error("response aborted"),{name:"AbortError"});
  return new Promise((resolve,reject)=>{
    const abort=()=>{
      reader.cancel?.("response timeout").catch?.(()=>undefined);
      reject(Object.assign(new Error("response aborted"),{name:"AbortError"}));
    };
    signal.addEventListener("abort",abort,{once:true});
    reader.read().then(resolve,reject).finally(()=>signal.removeEventListener("abort",abort));
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
