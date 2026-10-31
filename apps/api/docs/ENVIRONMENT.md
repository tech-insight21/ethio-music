# ETHIO MUSIC API — Environment Variables

Copy `apps/api/.env.example` → `apps/api/.env`. All values are read once at
boot and validated with Zod; misconfiguration prints the offending KEYS only
and exits. Never commit `.env` files.

## Core

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | ✔ | `development` | `development` / `test` / `production` |
| `PORT` | ✖ | `8080` | HTTP port |
| `LOG_LEVEL` | ✖ | `info` | pino: `fatal…trace` |

## Supabase

| Variable | Required | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | ✔ | Project URL |
| `SUPABASE_ANON_KEY` | ✔ | Public key — RLS protects data |
| `SUPABASE_SERVICE_ROLE_KEY` | ✔ | **Server-only.** Bypasses RLS for system operations |
| `SUPABASE_JWT_SECRET` | ✔ | Local HS256 verification of access tokens (falls back to the Auth API for asymmetric keys) |

## Postgres (pooler, session mode)

| Variable | Required | Default |
| --- | --- | --- |
| `SUPABASE_REF` | ✔ | — |
| `SUPABASE_DB_PASSWORD` | ✔ | — |
| `SUPABASE_POOLER_HOST` | ✖ | `aws-0-eu-west-1.pooler.supabase.com` |

Used for: analytics SQL, the notification queue (`SKIP LOCKED`), cron jobs,
payments transactions, and the `bot_*` tables.

## Telegram

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` (alias `TG_BOT_TOKEN`) | ✔ | — | Bot API client + initData HMAC validation |
| `TG_WEBHOOK_SECRET` | prod ✔ | — | `X-Telegram-Bot-Api-Secret-Token` check (≥ 8 chars) |
| `TG_INITDATA_MAX_AGE` | ✖ | `86400` | initData freshness window (seconds) |
| `TMA_URL` | ✖ | `https://tech-insight21.github.io/ethio-music/` | "Open Music App" button target |

## HTTP

| Variable | Required | Default |
| --- | --- | --- |
| `CORS_ORIGINS` | prod ✔ | `""` (comma-separated allowlist) |
| `RATE_LIMIT_WINDOW_MS` | ✖ | `60000` |
| `RATE_LIMIT_MAX` | ✖ | `300` (per IP per window) |
| `AUTH_RATE_LIMIT_MAX` | ✖ | `15` |
| `SEARCH_RATE_LIMIT_MAX` | ✖ | `120` |

## Cache / jobs

| Variable | Required | Default |
| --- | --- | --- |
| `CACHE_TTL_MS` | ✖ | `60000` |
| `WORKER_ENABLED` | ✖ | `true` (set `false` for tests/web-only replicas) |
| `WORKER_BATCH_SIZE` | ✖ | `25` |
| `NOTIFY_CRON` | ✖ | `*/1 * * * *` (worker polls every 15 s regardless) |
| `RELEASES_CRON` | ✖ | `*/5 * * * *` — new-release fan-out |
| `PREMIUM_CRON` | ✖ | `17 7 * * *` — expiry notices + sweep |
| `MAINTENANCE_CRON` | ✖ | `3 4 * * *` — history trim, session cleanup |

## Optional

| Variable | Notes |
| --- | --- |
| `COMMAND_FORWARD_URL` | Forward non-payment Telegram updates to a dedicated command bot (same webhook secret header) |

## Secrets used by CI (GitHub)

Repository secrets: `TELEGRAM_BOT_TOKEN`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_REF`,
`SUPABASE_DB_PASSWORD`, `SUPABASE_POOLER_HOST`.
Repository variables: `NEXT_PUBLIC_SUPABASE_URL` (used as `SUPABASE_URL`).
Set via `python3 scripts/gh_set_secret.py KEY value`.
