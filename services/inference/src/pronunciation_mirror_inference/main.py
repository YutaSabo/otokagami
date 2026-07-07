import base64
import contextlib
import hmac
import os
import re
import shutil
import subprocess
import tempfile
import unicodedata
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field


SERVICE_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = SERVICE_ROOT.parents[1]
HEADER_NAME = "X-Internal-API-Key"


def load_env_file(env_path: Path, override: bool = False) -> None:
  if not env_path.exists():
    return

  for raw_line in env_path.read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
      continue
    name, value = line.split("=", 1)
    name = name.strip()
    if not name or (name in os.environ and not override):
      continue
    os.environ[name] = value.strip().strip('"').strip("'")


def load_service_env() -> None:
  load_env_file(REPO_ROOT / ".env")
  load_env_file(SERVICE_ROOT / ".env", override=True)


load_service_env()


app = FastAPI(title="Pronunciation Mirror Inference", version="0.1.0")


class ApiError(BaseModel):
  code: str
  message: str
  retryable: bool = False


class IpaRequest(BaseModel):
  text: str = Field(min_length=1, max_length=500)
  accent: str = "US"


class IpaWord(BaseModel):
  text: str
  ipa: str | None
  in_dictionary: bool


class IpaData(BaseModel):
  normalized_text: str
  ipa: str
  words: list[IpaWord]
  oov_words: list[str]
  conversion_confidence: float = Field(ge=0, le=1)


class TtsRequest(BaseModel):
  text: str = Field(min_length=1, max_length=500)
  accent: str = "US"
  speed: str = "normal"


class TtsData(BaseModel):
  audio_format: str
  audio_base64: str
  duration_ms: int


class ApiResponse(BaseModel):
  ok: bool
  data: dict[str, Any] | None = None
  error: ApiError | None = None


@dataclass(frozen=True)
class TtsAudio:
  wav_bytes: bytes
  duration_ms: int


def error_response(
  status_code: int,
  code: str,
  message: str,
  retryable: bool = False,
) -> JSONResponse:
  return JSONResponse(
    status_code=status_code,
    content={
      "ok": False,
      "error": {
        "code": code,
        "message": message,
        "retryable": retryable,
      },
    },
  )


@app.exception_handler(HTTPException)
async def http_error_handler(_request: Request, exc: HTTPException) -> JSONResponse:
  detail = exc.detail if isinstance(exc.detail, dict) else {}
  return error_response(
    status_code=exc.status_code,
    code=str(detail.get("code", "REQUEST_FAILED")),
    message=str(detail.get("message", "Request failed.")),
    retryable=bool(detail.get("retryable", False)),
  )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(
  _request: Request,
  _exc: RequestValidationError,
) -> JSONResponse:
  return error_response(
    status_code=422,
    code="INVALID_REQUEST",
    message="Request body is invalid.",
  )


def raise_api_error(
  status_code: int,
  code: str,
  message: str,
  retryable: bool = False,
) -> None:
  raise HTTPException(
    status_code=status_code,
    detail={"code": code, "message": message, "retryable": retryable},
  )


def require_internal_api_key(
  x_internal_api_key: Annotated[str | None, Header(alias=HEADER_NAME)] = None,
) -> None:
  expected = os.environ.get("PYTHON_SERVICE_API_KEY")
  if not expected:
    raise_api_error(
      500,
      "INTERNAL_SERVICE_MISCONFIGURED",
      "Internal service API key is not configured.",
    )
  if not x_internal_api_key or not hmac.compare_digest(x_internal_api_key, expected):
    raise_api_error(401, "UNAUTHORIZED", "Invalid internal API key.")


def normalize_text(text: str) -> str:
  normalized = unicodedata.normalize("NFKC", text)
  normalized = normalized.replace("“", '"').replace("”", '"')
  normalized = normalized.replace("‘", "'").replace("’", "'")
  normalized = re.sub(r"\s+", " ", normalized).strip()
  if not normalized:
    raise_api_error(400, "INVALID_REQUEST", "Text must not be empty.")
  return normalized


def tokenize_words(text: str) -> list[str]:
  return re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", text)


ARPABET_TO_IPA = {
  "AA": "ɑ",
  "AE": "æ",
  "AH": "ʌ",
  "AO": "ɔ",
  "AW": "aʊ",
  "AY": "aɪ",
  "B": "b",
  "CH": "tʃ",
  "D": "d",
  "DH": "ð",
  "EH": "ɛ",
  "ER": "ɝ",
  "EY": "eɪ",
  "F": "f",
  "G": "ɡ",
  "HH": "h",
  "IH": "ɪ",
  "IY": "i",
  "JH": "dʒ",
  "K": "k",
  "L": "l",
  "M": "m",
  "N": "n",
  "NG": "ŋ",
  "OW": "oʊ",
  "OY": "ɔɪ",
  "P": "p",
  "R": "r",
  "S": "s",
  "SH": "ʃ",
  "T": "t",
  "TH": "θ",
  "UH": "ʊ",
  "UW": "u",
  "V": "v",
  "W": "w",
  "Y": "j",
  "Z": "z",
  "ZH": "ʒ",
}


CMU_FALLBACK = {
  "about": ["AH0", "B", "AW1", "T"],
  "again": ["AH0", "G", "EH1", "N"],
  "i": ["AY1"],
  "it": ["IH1", "T"],
  "light": ["L", "AY1", "T"],
  "read": ["R", "IY1", "D"],
  "right": ["R", "AY1", "T"],
  "think": ["TH", "IH1", "NG", "K"],
  "van": ["V", "AE1", "N"],
}


def arpabet_word_to_ipa(phonemes: list[str]) -> str:
  ipa_parts: list[str] = []
  stress_index: int | None = None

  for phoneme in phonemes:
    base = re.sub(r"\d", "", phoneme)
    stress = re.search(r"[12]", phoneme)
    if stress and stress.group(0) == "1" and stress_index is None:
      stress_index = len(ipa_parts)
    mapped = ARPABET_TO_IPA.get(base)
    if mapped:
      ipa_parts.append(mapped)

  if stress_index is not None and len(ipa_parts) > 1:
    ipa_parts.insert(stress_index, "ˈ")
  return "".join(ipa_parts)


def phonemize_with_python_package(text: str) -> str | None:
  try:
    from phonemizer import phonemize
  except ImportError:
    return None

  try:
    ipa = phonemize(
      text,
      language="en-us",
      backend="espeak",
      strip=True,
      preserve_punctuation=True,
      with_stress=True,
    )
  except Exception:
    return None
  return ipa.strip() or None


def phonemize_with_espeak(text: str) -> str | None:
  espeak = shutil.which("espeak-ng") or shutil.which("espeak")
  if not espeak:
    return None

  try:
    completed = subprocess.run(
      [espeak, "-q", "--ipa=3", "-v", "en-us", text],
      check=True,
      capture_output=True,
      text=True,
      timeout=5,
    )
  except Exception:
    return None
  return completed.stdout.strip() or None


def fallback_word_ipa(word: str) -> str | None:
  return arpabet_word_to_ipa(CMU_FALLBACK[word.lower()]) if word.lower() in CMU_FALLBACK else None


def phonemize_text(text: str) -> tuple[str | None, bool]:
  package_result = phonemize_with_python_package(text)
  if package_result:
    return package_result, True

  espeak_result = phonemize_with_espeak(text)
  if espeak_result:
    return espeak_result, True

  return None, False


def convert_to_ipa(text: str) -> IpaData:
  words = tokenize_words(text)
  word_results: list[IpaWord] = []
  for word in words:
    ipa = fallback_word_ipa(word)
    word_results.append(IpaWord(text=word, ipa=ipa, in_dictionary=ipa is not None))
  oov_words = [word.text for word in word_results if not word.in_dictionary]

  phrase_ipa, external_converter_used = phonemize_text(text)
  if not phrase_ipa:
    phrase_ipa = " ".join(word.ipa or word.text.lower() for word in word_results)

  if not phrase_ipa:
    raise_api_error(
      502,
      "IPA_CONVERSION_FAILED",
      "IPA conversion failed.",
      retryable=True,
    )

  confidence = 1.0 if not oov_words else max(0.45, 1.0 - (len(oov_words) / max(len(words), 1)) * 0.55)
  if not external_converter_used:
    confidence = min(confidence, 0.75)

  return IpaData(
    normalized_text=text,
    ipa=f"/{phrase_ipa.strip('/')}/",
    words=word_results,
    oov_words=oov_words,
    conversion_confidence=round(confidence, 2),
  )


def duration_ms_for_wav(path: Path) -> int:
  with contextlib.closing(wave.open(str(path), "rb")) as wav_file:
    frames = wav_file.getnframes()
    rate = wav_file.getframerate()
    if rate <= 0:
      return 0
    return round((frames / rate) * 1000)


def resolve_piper_model() -> Path:
  voice_name = os.environ.get("PIPER_VOICE_US")
  voice_dir = os.environ.get("PIPER_VOICE_DIR")
  if not voice_name or not voice_dir:
    raise_api_error(
      500,
      "INTERNAL_SERVICE_MISCONFIGURED",
      "Piper voice is not configured.",
    )

  voice_path = Path(voice_name)
  if voice_path.suffix == ".onnx" and voice_path.exists():
    return voice_path

  base_dir = Path(voice_dir)
  base_dirs = [base_dir]
  if not base_dir.is_absolute():
    base_dirs.extend([SERVICE_ROOT / base_dir, REPO_ROOT / base_dir])

  candidates = []
  for candidate_base_dir in base_dirs:
    candidates.extend(
      [
        candidate_base_dir / f"{voice_name}.onnx",
        candidate_base_dir / "model.onnx",
        candidate_base_dir / voice_name / f"{voice_name}.onnx",
      ],
    )
  for candidate in candidates:
    if candidate.exists():
      return candidate

  raise_api_error(502, "TTS_FAILED", "Piper voice model is unavailable.", retryable=True)


def resolve_piper_binary() -> str:
  configured = os.environ.get("PIPER_BIN")
  if configured:
    return configured

  path_binary = shutil.which("piper")
  if path_binary:
    return path_binary

  local_binary = REPO_ROOT / ".venv" / "bin" / "piper"
  if local_binary.exists():
    return str(local_binary)

  return "piper"


class PiperTtsProvider:
  def synthesize(self, text: str, speed: str) -> TtsAudio:
    piper_bin = resolve_piper_binary()
    model_path = resolve_piper_model()
    length_scale = "1.0" if speed == "normal" else "1.45"

    with tempfile.TemporaryDirectory(prefix="pronunciation-mirror-tts-") as temp_dir:
      output_path = Path(temp_dir) / "speech.wav"
      try:
        subprocess.run(
          [
            piper_bin,
            "--model",
            str(model_path),
            "--output_file",
            str(output_path),
            "--length_scale",
            length_scale,
          ],
          input=text,
          text=True,
          check=True,
          capture_output=True,
          timeout=90,
        )
      except Exception:
        raise_api_error(502, "TTS_FAILED", "Piper TTS generation failed.", retryable=True)

      if not output_path.exists():
        raise_api_error(502, "TTS_FAILED", "Piper TTS did not produce audio.", retryable=True)

      return TtsAudio(wav_bytes=output_path.read_bytes(), duration_ms=duration_ms_for_wav(output_path))


def get_tts_provider() -> PiperTtsProvider:
  return PiperTtsProvider()


def validate_accent(accent: str) -> None:
  if accent != "US":
    raise_api_error(400, "UNSUPPORTED_ACCENT", "Only US accent is supported.")


def validate_speed(speed: str) -> None:
  if speed not in {"normal", "slow"}:
    raise_api_error(400, "INVALID_SPEED", "Speed must be normal or slow.")


@app.get("/internal/health", response_model=ApiResponse, response_model_exclude_none=True)
def health(_auth: Annotated[None, Depends(require_internal_api_key)]) -> dict[str, Any]:
  return {"ok": True, "data": {"service": "inference", "status": "ok"}}


@app.get("/healthz", response_model=ApiResponse, response_model_exclude_none=True)
def public_health() -> dict[str, Any]:
  return {"ok": True, "data": {"service": "inference", "status": "ok"}}


@app.post("/internal/ipa", response_model=ApiResponse, response_model_exclude_none=True)
def ipa(
  request: IpaRequest,
  _auth: Annotated[None, Depends(require_internal_api_key)],
) -> dict[str, Any]:
  validate_accent(request.accent)
  normalized_text = normalize_text(request.text)
  data = convert_to_ipa(normalized_text)
  return {"ok": True, "data": data.model_dump()}


@app.post("/internal/tts", response_model=ApiResponse, response_model_exclude_none=True)
def tts(
  request: TtsRequest,
  _auth: Annotated[None, Depends(require_internal_api_key)],
  provider: Annotated[PiperTtsProvider, Depends(get_tts_provider)],
) -> dict[str, Any]:
  validate_accent(request.accent)
  validate_speed(request.speed)
  normalized_text = normalize_text(request.text)
  audio = provider.synthesize(normalized_text, request.speed)
  data = TtsData(
    audio_format="wav",
    audio_base64=base64.b64encode(audio.wav_bytes).decode("ascii"),
    duration_ms=audio.duration_ms,
  )
  return {"ok": True, "data": data.model_dump()}
