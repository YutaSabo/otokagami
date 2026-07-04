# Pronunciation Mirror

Pronunciation Mirror MVP is organized as a monorepo for an iPhone-only Expo app, a Next.js API, a Python inference service, and local Supabase assets.

## Package Management

This repository uses npm workspaces.

Reason: npm ships with Node.js, works without an extra package-manager bootstrap step, and keeps Expo/React Native dependency resolution close to the default tooling path.

## Workspace Layout

```text
apps/mobile          Expo React Native iPhone app
apps/api             Next.js API
services/inference   Python inference service
supabase             Supabase local config, migrations, seed
```

## First-Time Setup

```bash
npm install
cp .env.example .env
cd services/inference
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
cd ../..
```

Fill `.env` locally. Do not paste secret values into chat, logs, or committed files.

## Local Development

Expected startup order after environment values are set:

```bash
supabase start
supabase db reset
npm run dev:inference
npm run dev:api
npm run dev:mobile
```

The mobile app is configured for Expo dev client/prebuild and iOS only.

## Root Checks

```bash
npm run lint
npm run test
npm run build
npm run check
```

`check` runs lint, tests, and build/config checks across the workspaces.

## Workspace Commands

```bash
npm run dev:mobile      # Expo dev client Metro server
npm run dev:api         # Next.js API on port 3000
npm run dev:inference   # Python service on port 8000
```

Health checks:

```bash
curl http://localhost:3000/api/health
curl http://localhost:8000/internal/health
```

## Environment Rules

Only `EXPO_PUBLIC_*` values are available to the mobile bundle. Server-only keys such as `AZURE_SPEECH_KEY`, `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REVENUECAT_SECRET_KEY`, `REVENUECAT_WEBHOOK_AUTH_TOKEN`, and `PYTHON_SERVICE_API_KEY` must remain outside Expo public variables.
