# ETHIO MUSIC API — Deployment Guide

The API is a stateless Node service + a Supabase project. Any host that can
run Docker (or Node 22) works. Recommended: **Render** (blueprint included),
Railway, Fly.io, or a VPS with the Dockerfile.

## 1. Prerequisites

- The Supabase project with migrations applied:
  `source .env && python3 scripts/run_migrations.py` (CI does this on push
  via the `db-migrate` workflow).
- A Telegram bot token (`@BotFather`), already used by the bot.
- A random webhook secret: `openssl rand -hex 32`.

## 2. Environment

Copy `apps/api/.env.example` and fill it in. Full reference:
[ENVIRONMENT.md](ENVIRONMENT.md). Critical rules:

- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_JWT_SECRET` / DB password are
  **server-only** — never ship them to any client.
- `TG_WEBHOOK_SECRET` must be ≥ 8 chars in production (requests without the
  matching `X-Telegram-Bot-Api-Secret-Token` header are rejected with 401).
- `CORS_ORIGINS` — comma-separated allowlist (e.g.
  `https://tech-insight21.github.io`). Empty in production = browsers blocked.

## 3. Deploy options

### Render (blueprint)
1. Push the repo; in Render choose **New → Blueprint** and select the repo.
   `apps/api/render.yaml` defines the service with a health check and
   generated `TG_WEBHOOK_SECRET`.
2. Fill the `sync: false` env vars in the dashboard.

### Docker (any host)
```bash
cd apps/api
docker build -t ethio-music-api .
docker run -d --name emg-api -p 8080:8080 --env-file .env ethio-music-api
curl http://localhost:8080/healthz    # {"ok":true,...}
```

### Process managers
```bash
npm ci && npm run build
node dist/index.js          # PORT=8080 default; use systemd/pm2 to supervise
```

## 4. Register the Telegram webhook

Only ONE webhook per bot is allowed — stop any long-polling bot process first.

```bash
npm run tg:set-webhook -- https://your-api-host.example.com
# ✅ Webhook registered for @ethiopmusicbot:
#    https://your-api-host.example.com/api/v1/telegram/webhook
```

The webhook handles (secret-verified): Stars `pre_checkout_query` +
`successful_payment` (the money path), `/start` + `/app` with the
**Open Music App** button, chat registry, block/unblock tracking. Non-payment
command updates can be forwarded to a dedicated command bot via
`COMMAND_FORWARD_URL`.

## 5. Workers

`WORKER_ENABLED=true` (default) starts:
- **Notification worker** — polls every 15 s, claims batches with
  `FOR UPDATE SKIP LOCKED` (multi-replica safe), honours user preferences,
  retries with exponential backoff (max 5 attempts), tracks
  `telegram_message_id`.
- **Cron scheduler** — new-release fan-out (5 min), premium expiry notices +
  expiry sweep (daily), maintenance/trimming (daily). Every run is deduped
  through `job_runs (job, period_key)` so replicas never double-fire.

Run multiple API replicas freely — the queue and cron claims are safe.

## 6. CI/CD

`.github/workflows/api-ci.yml` runs on every push touching `apps/api/**` or
migrations: `npm ci` → typecheck → build → **117 integration tests** against
the live Supabase project (isolated `emg_test_*` identities, full cleanup).
Required repository secrets: `TELEGRAM_BOT_TOKEN`, `SUPABASE_URL`(var),
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`,
`SUPABASE_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_POOLER_HOST`.

`.github/workflows/db-migrate.yml` applies new `supabase/migrations/*.sql`
files automatically on push (tracked in `public.schema_migrations_local`).

## 7. Bot coexistence notes

- `apps/bot` currently runs in polling mode (dev). In production choose:
  - **API webhook (recommended)** — payments + notifications live here;
  - or bot webhook mode — then set `COMMAND_FORWARD_URL` on the API so
    payment-critical updates still reach it.
- The notification engine is shared: bot cron and API worker both claim rows
  atomically, and the `bot_sent_notifications` / `notifications(dedup_key)`
  ledgers make duplicate pushes impossible regardless of who runs first.

## 8. Monitoring

- `GET /healthz` — liveness (always cheap).
- `GET /readyz` — readiness (checks the Postgres pool).
- Structured pino logs per request (method, path, status, ms, user, reqId);
  set `LOG_LEVEL=warn` in production to reduce noise.
- Response times are logged per request — pipe to your APM of choice.
