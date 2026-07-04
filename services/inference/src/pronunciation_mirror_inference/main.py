from typing import Annotated

from fastapi import FastAPI, Header, HTTPException

app = FastAPI(title="Pronunciation Mirror Inference", version="0.1.0")


@app.get("/internal/health")
def health() -> dict[str, str]:
  return {"service": "inference", "status": "ok"}


@app.post("/internal/ipa")
def ipa_placeholder(
  x_internal_api_key: Annotated[str | None, Header(alias="X-Internal-API-Key")] = None,
) -> None:
  if not x_internal_api_key:
    raise HTTPException(status_code=401, detail="Missing internal API key")

  raise HTTPException(status_code=501, detail="IPA conversion is implemented in a later phase")


@app.post("/internal/tts")
def tts_placeholder(
  x_internal_api_key: Annotated[str | None, Header(alias="X-Internal-API-Key")] = None,
) -> None:
  if not x_internal_api_key:
    raise HTTPException(status_code=401, detail="Missing internal API key")

  raise HTTPException(status_code=501, detail="TTS generation is implemented in a later phase")
