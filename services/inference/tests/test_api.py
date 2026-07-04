import asyncio
import base64
import json
import os
import sys
import unittest
import wave
from io import BytesIO
from pathlib import Path
from typing import Any


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pronunciation_mirror_inference.main import (  # noqa: E402
  TtsAudio,
  app,
  get_tts_provider,
)


def make_wav(duration_ms: int) -> bytes:
  buffer = BytesIO()
  sample_rate = 8000
  frame_count = round(sample_rate * (duration_ms / 1000))
  with wave.open(buffer, "wb") as wav_file:
    wav_file.setnchannels(1)
    wav_file.setsampwidth(2)
    wav_file.setframerate(sample_rate)
    wav_file.writeframes(b"\x00\x00" * frame_count)
  return buffer.getvalue()


class FakeTtsProvider:
  def __init__(self) -> None:
    self.speeds: list[str] = []

  def synthesize(self, _text: str, speed: str) -> TtsAudio:
    self.speeds.append(speed)
    duration_ms = 400 if speed == "normal" else 800
    return TtsAudio(wav_bytes=make_wav(duration_ms), duration_ms=duration_ms)


async def call_app(
  method: str,
  path: str,
  body: dict[str, Any] | None = None,
  headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, Any]]:
  request_body = json.dumps(body or {}).encode("utf-8") if body is not None else b""
  response_status = 0
  response_chunks: list[bytes] = []

  scope = {
    "type": "http",
    "asgi": {"version": "3.0"},
    "http_version": "1.1",
    "method": method,
    "scheme": "http",
    "path": path,
    "raw_path": path.encode("ascii"),
    "query_string": b"",
    "headers": [
      (key.lower().encode("ascii"), value.encode("latin-1"))
      for key, value in (headers or {}).items()
    ]
    + ([(b"content-type", b"application/json")] if body is not None else []),
    "client": ("testclient", 50000),
    "server": ("testserver", 80),
  }

  received = False

  async def receive() -> dict[str, Any]:
    nonlocal received
    if received:
      return {"type": "http.disconnect"}
    received = True
    return {"type": "http.request", "body": request_body, "more_body": False}

  async def send(message: dict[str, Any]) -> None:
    nonlocal response_status
    if message["type"] == "http.response.start":
      response_status = message["status"]
    if message["type"] == "http.response.body":
      response_chunks.append(message.get("body", b""))

  await app(scope, receive, send)
  return response_status, json.loads(b"".join(response_chunks).decode("utf-8"))


def request(
  method: str,
  path: str,
  body: dict[str, Any] | None = None,
  headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, Any]]:
  return asyncio.run(call_app(method, path, body, headers))


class InferenceApiTest(unittest.TestCase):
  def setUp(self) -> None:
    self.original_api_key = os.environ.get("PYTHON_SERVICE_API_KEY")
    os.environ["PYTHON_SERVICE_API_KEY"] = "test-secret"
    self.fake_tts = FakeTtsProvider()
    app.dependency_overrides[get_tts_provider] = lambda: self.fake_tts

  def tearDown(self) -> None:
    if self.original_api_key is None:
      os.environ.pop("PYTHON_SERVICE_API_KEY", None)
    else:
      os.environ["PYTHON_SERVICE_API_KEY"] = self.original_api_key
    app.dependency_overrides.clear()

  def auth_headers(self) -> dict[str, str]:
    return {"X-Internal-API-Key": "test-secret"}

  def test_internal_api_key_is_required(self) -> None:
    status, payload = request("POST", "/internal/ipa", {"text": "right", "accent": "US"})

    self.assertEqual(status, 401)
    self.assertFalse(payload["ok"])
    self.assertEqual(payload["error"]["code"], "UNAUTHORIZED")
    self.assertNotIn("test-secret", json.dumps(payload))

  def test_missing_configured_api_key_fails_clearly(self) -> None:
    os.environ.pop("PYTHON_SERVICE_API_KEY", None)

    status, payload = request("GET", "/internal/health", headers={"X-Internal-API-Key": "anything"})

    self.assertEqual(status, 500)
    self.assertFalse(payload["ok"])
    self.assertEqual(payload["error"]["code"], "INTERNAL_SERVICE_MISCONFIGURED")

  def test_internal_ipa_succeeds_with_correct_key(self) -> None:
    status, payload = request(
      "POST",
      "/internal/ipa",
      {"text": "I read it again.", "accent": "US"},
      self.auth_headers(),
    )

    self.assertEqual(status, 200)
    self.assertTrue(payload["ok"])
    self.assertNotIn("error", payload)
    self.assertEqual(payload["data"]["normalized_text"], "I read it again.")
    self.assertTrue(payload["data"]["ipa"].startswith("/"))
    self.assertTrue(payload["data"]["ipa"].endswith("/"))
    self.assertEqual(payload["data"]["oov_words"], [])
    self.assertGreater(payload["data"]["conversion_confidence"], 0)

  def test_internal_tts_returns_wav_base64(self) -> None:
    status, payload = request(
      "POST",
      "/internal/tts",
      {"text": "right", "accent": "US", "speed": "normal"},
      self.auth_headers(),
    )

    self.assertEqual(status, 200)
    self.assertTrue(payload["ok"])
    self.assertNotIn("error", payload)
    self.assertEqual(payload["data"]["audio_format"], "wav")
    self.assertEqual(payload["data"]["duration_ms"], 400)
    self.assertTrue(base64.b64decode(payload["data"]["audio_base64"]).startswith(b"RIFF"))

  def test_tts_distinguishes_normal_and_slow(self) -> None:
    normal_status, normal_payload = request(
      "POST",
      "/internal/tts",
      {"text": "right", "accent": "US", "speed": "normal"},
      self.auth_headers(),
    )
    slow_status, slow_payload = request(
      "POST",
      "/internal/tts",
      {"text": "right", "accent": "US", "speed": "slow"},
      self.auth_headers(),
    )

    self.assertEqual(normal_status, 200)
    self.assertEqual(slow_status, 200)
    self.assertEqual(normal_payload["data"]["duration_ms"], 400)
    self.assertEqual(slow_payload["data"]["duration_ms"], 800)
    self.assertEqual(self.fake_tts.speeds, ["normal", "slow"])

  def test_invalid_accent_and_speed_are_rejected_safely(self) -> None:
    accent_status, accent_payload = request(
      "POST",
      "/internal/ipa",
      {"text": "right", "accent": "UK"},
      self.auth_headers(),
    )
    speed_status, speed_payload = request(
      "POST",
      "/internal/tts",
      {"text": "right", "accent": "US", "speed": "fast"},
      self.auth_headers(),
    )

    self.assertEqual(accent_status, 400)
    self.assertEqual(accent_payload["error"]["code"], "UNSUPPORTED_ACCENT")
    self.assertEqual(speed_status, 400)
    self.assertEqual(speed_payload["error"]["code"], "INVALID_SPEED")


if __name__ == "__main__":
  unittest.main()
