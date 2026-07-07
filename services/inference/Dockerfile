FROM python:3.12-slim

ARG PIPER_MODEL_URL=https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx
ARG PIPER_CONFIG_URL=https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    PYTHON_SERVICE_API_KEY= \
    PIPER_VOICE_US=en_US-lessac-medium \
    PIPER_VOICE_DIR=/opt/piper/voices/en_US-lessac-medium

WORKDIR /app/services/inference

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl espeak-ng \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN mkdir -p "$PIPER_VOICE_DIR" \
    && curl -fL "$PIPER_MODEL_URL" -o "$PIPER_VOICE_DIR/en_US-lessac-medium.onnx" \
    && curl -fL "$PIPER_CONFIG_URL" -o "$PIPER_VOICE_DIR/en_US-lessac-medium.onnx.json"

COPY src ./src

EXPOSE 8080

CMD ["uvicorn", "pronunciation_mirror_inference.main:app", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8080"]
