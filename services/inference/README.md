# Python Inference Service

This service will host IPA conversion and Piper TTS endpoints in later phases.

## Setup

```bash
cd services/inference
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
cd ../..
```

## Run

```bash
npm run dev:inference
```

Health check:

```bash
curl http://localhost:8000/internal/health
```
