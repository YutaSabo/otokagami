# Piper TTS voice setup

## Selected US English voice

- Voice: `en_US-lessac-medium`
- Source: `rhasspy/piper-voices` on Hugging Face
- Reason: Lessac is a standard Piper US English voice, and the medium model balances naturalness and local inference cost.

## Local model location

Place the downloaded files here:

```text
runtime/piper/voices/en_US-lessac-medium/
```

Expected files:

```text
runtime/piper/voices/en_US-lessac-medium/en_US-lessac-medium.onnx
runtime/piper/voices/en_US-lessac-medium/en_US-lessac-medium.onnx.json
```

These files are intentionally ignored by Git because the ONNX model is large and should be treated as a local runtime artifact.

## Download

```sh
mkdir -p runtime/piper/voices/en_US-lessac-medium

curl -L \
  -o runtime/piper/voices/en_US-lessac-medium/en_US-lessac-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx

curl -L \
  -o runtime/piper/voices/en_US-lessac-medium/en_US-lessac-medium.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json
```

## Environment

For local host execution:

```dotenv
PIPER_VOICE_US=en_US-lessac-medium
PIPER_VOICE_DIR=runtime/piper/voices/en_US-lessac-medium
```

For Docker, mount the host voice directory read-only and set the container path:

```yaml
volumes:
  - ./runtime/piper/voices:/app/runtime/piper/voices:ro
environment:
  PIPER_VOICE_US: en_US-lessac-medium
  PIPER_VOICE_DIR: /app/runtime/piper/voices/en_US-lessac-medium
```

## Smoke test

If `piper` is installed:

```sh
echo "Hello, this is a test." | piper \
  --model runtime/piper/voices/en_US-lessac-medium/en_US-lessac-medium.onnx \
  --output_file tmp/piper-test/hello.wav
```
