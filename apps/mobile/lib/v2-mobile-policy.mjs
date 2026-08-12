export function validateV2SessionShape(session) {
  if (!session || typeof session !== "object" || !Array.isArray(session.items)) throw coded("SESSION_INVALID");
  const required = session.items.filter((item) => item.required === true);
  const optional = session.items.filter((item) => item.required === false);
  if (required.length !== 5) throw coded("REQUIRED_ITEM_COUNT_INVALID");
  if (optional.length < 0 || optional.length > 2) throw coded("OPTIONAL_ITEM_COUNT_INVALID");
  if (session.items.some((item, index) => item.position !== index + 1)) throw coded("SESSION_POSITION_INVALID");
  return Object.freeze({ requiredCount: required.length, optionalCount: optional.length });
}

export function countValidAttempts(rows, sessionItemId) {
  return rows.filter((row) => row.session_item_id === sessionItemId && row.technical_valid === 1).length;
}

export function canRequestAnotherTicket(rows, sessionItemId) {
  return countValidAttempts(rows, sessionItemId) < 3;
}

export function nextRestoredPosition(session, resultsByItem) {
  const pendingIndex = session.items.findIndex((item) => !resultsByItem[item.id]);
  return pendingIndex < 0 ? Math.max(0, session.items.length - 1) : pendingIndex;
}

export function timeoutError(code = "REQUEST_TIMEOUT") {
  return Object.assign(new Error(code), { code, retryable: true });
}

function coded(code) { return Object.assign(new Error(code), { code }); }
