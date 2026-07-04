# Python Inference Service

Internal Python service for IPA conversion and Piper TTS generation.

This service is meant to be called by the Next.js API only. Expo must not call
these endpoints directly.

## Setup

```bash
cd services/inference
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
cd ../..
```

Install the system tools used by the runtime:

- `espeak-ng` for IPA conversion through `phonemizer`.
- `piper` for local TTS generation.

The IPA endpoint prefers `phonemizer` with eSpeak NG, then falls back to the
local eSpeak CLI if available, then to a small CMU-style dictionary fallback for
MVP seed words.

## Environment

Create `services/inference/.env` or export these variables in your shell:

```dotenv
PYTHON_SERVICE_API_KEY=
PIPER_VOICE_US=en_US-lessac-medium
PIPER_VOICE_DIR=../../runtime/piper/voices/en_US-lessac-medium
```

Optional:

```dotenv
PIPER_BIN=piper
```

Piper voice setup is documented in `docs/setup/PIPER_TTS.md`.

## Run

```bash
npm run dev:inference
```

Health check:

```bash
curl \
  -H "X-Internal-API-Key: $PYTHON_SERVICE_API_KEY" \
  http://localhost:8000/internal/health
```

IPA check:

```bash
curl \
  -H "Content-Type: application/json" \
  -H "X-Internal-API-Key: $PYTHON_SERVICE_API_KEY" \
  -d '{"text":"I read it again.","accent":"US"}' \
  http://localhost:8000/internal/ipa
```

TTS check:

```bash
curl \
  -H "Content-Type: application/json" \
  -H "X-Internal-API-Key: $PYTHON_SERVICE_API_KEY" \
  -d '{"text":"right","accent":"US","speed":"slow"}' \
  http://localhost:8000/internal/tts
```

## Test

```bash
npm --workspace @pronunciation-mirror/inference run test
```
