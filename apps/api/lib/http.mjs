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

export async function readJsonLimited(request, maxBytes, limits = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 2) {
    throw new ApiError("SERVER_CONFIGURATION_INVALID", "リクエスト上限が不正です。", 500, false);
  }
  const encoding = (request.headers.get("content-encoding") ?? "identity").trim().toLowerCase();
  if (encoding !== "" && encoding !== "identity") {
    throw new ApiError("UNSUPPORTED_CONTENT_ENCODING", "圧縮されたリクエスト本文は利用できません。", 415, false);
  }
  const declaredHeader = request.headers.get("content-length");
  const declared = declaredHeader === null ? null : Number(declaredHeader);
  if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0)) {
    throw new ApiError("BAD_REQUEST", "Content-Lengthが不正です。", 400, false);
  }
  if (declared !== null && declared > maxBytes) {
    throw new ApiError("REQUEST_TOO_LARGE", "リクエストが大きすぎます。", 413, false);
  }
  const body = request.body;
  if (body === null) throw new ApiError("BAD_REQUEST", "JSON本文が不正です。", 400, false);
  const reader = body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new TypeError("Request body chunk is not bytes.");
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("request body limit exceeded").catch(() => undefined);
        throw new ApiError("REQUEST_TOO_LARGE", "リクエストが大きすぎます。", 413, false);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("BAD_REQUEST", "JSON本文が不正です。", 400, false);
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ApiError("BAD_REQUEST", "JSON本文が不正です。", 400, false);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError("BAD_REQUEST", "JSON本文が不正です。", 400, false);
  }
  assertJsonBodyComplexity(parsed, limits);
  if (limits.requireObject !== false && (!parsed || typeof parsed !== "object" || Array.isArray(parsed))) {
    throw new ApiError("BAD_REQUEST", "JSON本文はobjectである必要があります。", 400, false);
  }
  const parsedBytes = new TextEncoder().encode(JSON.stringify(parsed)).byteLength;
  if (parsedBytes > maxBytes) {
    throw new ApiError("REQUEST_TOO_LARGE", "JSON本文が大きすぎます。", 413, false);
  }
  return parsed;
}

function assertJsonBodyComplexity(value, limits) {
  const maxDepth = positiveLimit(limits.maxDepth, 12);
  const maxNodes = positiveLimit(limits.maxNodes, 2_048);
  const maxArrayLength = positiveLimit(limits.maxArrayLength, 256);
  const maxStringLength = positiveLimit(limits.maxStringLength, 512);
  let nodes = 0;
  const visit = (nested, depth) => {
    nodes += 1;
    if (nodes > maxNodes) throw new ApiError("REQUEST_TOO_COMPLEX", "JSON本文が複雑すぎます。", 413, false);
    if (depth > maxDepth) throw new ApiError("REQUEST_TOO_COMPLEX", "JSON本文が深すぎます。", 413, false);
    if (typeof nested === "string") {
      if (nested.length > maxStringLength) throw new ApiError("REQUEST_TOO_COMPLEX", "JSON文字列が長すぎます。", 413, false);
      if (/[\u0000-\u001f\u007f-\u009f]/u.test(nested)) {
        throw new ApiError("BAD_REQUEST", "JSON文字列に制御文字を含められません。", 400, false);
      }
      return;
    }
    if (Array.isArray(nested)) {
      if (nested.length > maxArrayLength) throw new ApiError("REQUEST_TOO_COMPLEX", "JSON配列が長すぎます。", 413, false);
      for (const item of nested) visit(item, depth + 1);
      return;
    }
    if (nested && typeof nested === "object") {
      for (const item of Object.values(nested)) visit(item, depth + 1);
    }
  };
  visit(value, 0);
}

function positiveLimit(value, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ApiError("SERVER_CONFIGURATION_INVALID", "JSON構造上限が不正です。", 500, false);
  }
  return value;
}
