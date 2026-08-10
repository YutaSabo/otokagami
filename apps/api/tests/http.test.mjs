import assert from "node:assert/strict";
import test from "node:test";

import { readJsonLimited } from "../lib/http.mjs";

test("limited JSON reader rejects a chunked body before reading the full stream", async () => {
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new TextEncoder().encode("12345678"));
      if (pulls >= 1_000) controller.close();
    },
    cancel() { cancelled = true; }
  });
  const request = new Request("https://example.invalid/api/v2/attempts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half"
  });
  const error = await readJsonLimited(request, 16).catch((caught) => caught);
  assert.equal(error.code, "REQUEST_TOO_LARGE");
  assert.equal(error.retryable, false);
  assert.equal(cancelled, true);
  assert.ok(pulls < 1_000);
});

test("limited JSON reader rejects compressed bodies before decoding", async () => {
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode("{}"));
      controller.close();
    }
  });
  const request = new Request("https://example.invalid/api/v2/attempts", {
    method: "POST",
    headers: { "content-encoding": "gzip", "content-type": "application/json" },
    body: stream,
    duplex: "half"
  });
  const error = await readJsonLimited(request, 128).catch((caught) => caught);
  assert.equal(error.code, "UNSUPPORTED_CONTENT_ENCODING");
  assert.equal(error.retryable, false);
});

test("limited JSON reader enforces parsed depth, array, string and root type limits", async () => {
  const cases = [
    [{ nested: { nested: { value: 1 } } }, { maxDepth: 2 }, "REQUEST_TOO_COMPLEX"],
    [{ values: [1, 2, 3] }, { maxArrayLength: 2 }, "REQUEST_TOO_COMPLEX"],
    [{ value: "abcd" }, { maxStringLength: 3 }, "REQUEST_TOO_COMPLEX"],
    [{ value: "safe\u0000value" }, {}, "BAD_REQUEST"],
    [[1, 2], { requireObject: true }, "BAD_REQUEST"]
  ];
  for (const [body, limits, code] of cases) {
    const request = new Request("https://example.invalid/api/v2/attempts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const error = await readJsonLimited(request, 1_024, limits).catch((caught) => caught);
    assert.equal(error.code, code);
    assert.equal(error.retryable, false);
  }
});

test("limited JSON reader accepts a bounded identity-encoded object", async () => {
  const request = new Request("https://example.invalid/api/v2/attempts", {
    method: "POST",
    headers: { "content-encoding": "identity", "content-type": "application/json" },
    body: JSON.stringify({ value: [1, 2] })
  });
  assert.deepEqual(await readJsonLimited(request, 128), { value: [1, 2] });
});
