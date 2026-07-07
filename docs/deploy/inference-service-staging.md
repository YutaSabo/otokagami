# Python inference service staging deploy

Use Fly.io for the staging Python inference service.

## Fly.io settings

- App name: `otokagami-inference-staging`
- Region: `nrt`
- Internal port: `8080`
- CPU: `shared-cpu-1x`
- Memory: `1GB`
- Working directory: `services/inference`
- Config path: `fly.toml`
- Public URL: `https://otokagami-inference-staging.fly.dev`

The Fly dashboard default of 256 MB is too small for Piper. Use 1 GB for staging.

## Environment variables

Set this as a secret:

| Key | Notes |
| --- | --- |
| `PYTHON_SERVICE_API_KEY` | Internal API key used by the Next.js API when calling `/internal/*`. Do not commit the value. |

These are checked in as staging defaults in `services/inference/fly.toml`:

| Key | Value |
| --- | --- |
| `PIPER_VOICE_US` | `en_US-lessac-medium` |
| `PIPER_VOICE_DIR` | `/opt/piper/voices/en_US-lessac-medium` |

## Deploy with Fly CLI

```sh
cd services/inference
flyctl apps create otokagami-inference-staging --org personal
flyctl secrets set PYTHON_SERVICE_API_KEY='replace-with-a-long-random-token'
flyctl deploy --config fly.toml
```

## Verify

Public health check:

```sh
curl -fsS https://otokagami-inference-staging.fly.dev/healthz
```

Internal health check:

```sh
curl -fsS \
  -H "X-Internal-API-Key: $PYTHON_SERVICE_API_KEY" \
  https://otokagami-inference-staging.fly.dev/internal/health
```

TTS check:

```sh
curl -fsS \
  -H "Content-Type: application/json" \
  -H "X-Internal-API-Key: $PYTHON_SERVICE_API_KEY" \
  -d '{"text":"right","accent":"US","speed":"slow"}' \
  https://otokagami-inference-staging.fly.dev/internal/tts
```

## Fly dashboard

Use the GitHub deploy screen with:

- Branch: `main`
- Working directory: `services/inference`
- Config path: `fly.toml`
- Internal port: `8080`
- Memory: `1GB`

If the dashboard says it cannot find the path, confirm the selected repository is the Otokagami repository and the selected branch includes this commit.
