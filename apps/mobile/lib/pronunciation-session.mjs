export class PronunciationSessionTracker {
  #requestId = null;
  #preparedText = null;

  get requestId() {
    return this.#requestId;
  }

  get preparedText() {
    return this.#preparedText;
  }

  setPrepared(requestId, preparedText) {
    this.#requestId = requestId;
    this.#preparedText = preparedText.trim();
  }

  canReuse(preparedText) {
    return Boolean(this.#requestId && this.#preparedText === preparedText.trim());
  }

  consume() {
    const requestId = this.#requestId;
    this.clear();
    return requestId;
  }

  clear() {
    this.#requestId = null;
    this.#preparedText = null;
  }
}

export function shouldRetrySavedAzureResult(pendingResult) {
  return Boolean(pendingResult?.rawJson && pendingResult?.requestId);
}
