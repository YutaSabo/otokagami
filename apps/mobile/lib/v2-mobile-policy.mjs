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
  const requiredIndexes=session.items.map((item,index)=>item.required===true?index:-1).filter((index)=>index>=0);
  const pendingRequired=requiredIndexes.find((index)=>!resultsByItem[session.items[index].id]);
  if(pendingRequired!==undefined)return pendingRequired;
  const optionalIndexes=session.items.map((item,index)=>item.required===false?index:-1).filter((index)=>index>=0);
  const attemptedOptional=optionalIndexes.filter((index)=>Boolean(resultsByItem[session.items[index].id]));
  if(attemptedOptional.length>0){
    const pendingOptional=optionalIndexes.find((index)=>!resultsByItem[session.items[index].id]);
    return pendingOptional??attemptedOptional.at(-1);
  }
  return requiredIndexes.at(-1)??0;
}

export function timeoutError(code = "REQUEST_TIMEOUT") {
  return Object.assign(new Error(code), { code, retryable: true });
}

function coded(code) { return Object.assign(new Error(code), { code }); }
