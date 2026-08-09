export class ApiError extends Error {
  constructor(code, message, status = 500, retryable = false, details = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

export function ok(data, init = {}) {
  return Response.json({ ok: true, data }, { status: init.status ?? 200, headers: init.headers });
}

export function fail(error) {
  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError("INTERNAL_ERROR", "処理に失敗しました。", 500, false);

  return Response.json(
    {
      ok: false,
      error: {
        code: apiError.code,
        message: apiError.message,
        retryable: apiError.retryable
      }
    },
    {
      status: apiError.status,
      headers: {
        "Cache-Control": "no-store, private",
        Pragma: "no-cache"
      }
    }
  );
}

export async function route(handler) {
  try {
    return await handler();
  } catch (error) {
    return fail(error);
  }
}

export function getBearerToken(request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new ApiError("UNAUTHORIZED", "認証が必要です。", 401, false);
  }
  return match[1];
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new ApiError("BAD_REQUEST", "JSON本文が不正です。", 400, false);
  }
}

export async function readJsonLimited(request, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 2) {
    throw new ApiError("SERVER_CONFIGURATION_INVALID", "リクエスト上限が不正です。", 500, false);
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError("REQUEST_TOO_LARGE", "リクエストが大きすぎます。", 413, false);
  }
  let text;
  try {
    text = await request.text();
  } catch {
    throw new ApiError("BAD_REQUEST", "JSON本文が不正です。", 400, false);
  }
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new ApiError("REQUEST_TOO_LARGE", "リクエストが大きすぎます。", 413, false);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("BAD_REQUEST", "JSON本文が不正です。", 400, false);
  }
}
