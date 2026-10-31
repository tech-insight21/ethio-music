# ETHIO MUSIC — REST API (`apps/api`)

Production backend for ETHIO MUSIC, an Ethiopian music discovery & streaming
platform integrated with Telegram. **One API serves the Telegram Bot, the
Mini App and the Admin Dashboard.**

- **Stack**: Node.js 22 · TypeScript (strict, NodeNext ESM) · Express 4 ·
  Zod · Supabase PostgreSQL (supabase-js + `pg`) · Supabase Auth ·
  Supabase Storage · Telegram Bot API (Stars payments) · pino · node-cron
- **Docs**: [ARCHITECTURE.md](docs/ARCHITECTURE.md) ·
  [API.md](docs/API.md) · [DEPLOYMENT.md](docs/DEPLOYMENT.md) ·
  [ENVIRONMENT.md](docs/ENVIRONMENT.md)

## Quick start

```bash
cd apps/api
npm install
cp .env.example .env          # fill in values — see docs/ENVIRONMENT.md
npm run dev                   # tsx watch on :8080
npm test                      # 117 integration tests against the live project
npm run build && npm start    # production build (dist/)
```

## What it provides

| Area | Highlights |
| --- | --- |
| Auth | Telegram Mini App `initData` (official HMAC algorithm) → Supabase session; admin password login + live RBAC; refresh rotation; logout & revocation (`user_sessions`) |
| Catalog | songs / albums / artists / genres — public reads (RLS), admin CRUD, license-gated approvals, artwork upload (type+size), audio references, takedown |
| Users | profiles, preferences (JSONB), activity, follows, favorites |
| Playlists | CRUD, ownership enforcement, duplicate guards, transactional reorder |
| Search | multi-entity search (two-query merge), history, trending (recent-play weighted), new releases, genre-affinity recommendations |
| Monetization | Telegram **Stars** invoices, secret-verified webhook activation (single transaction, replay-safe), subscription extension/cancellation, refunds (finance permission), premium entitlement |
| Promotions | artist requests, Stars-paid campaigns (activate only after completed payment), impression/click tracking, CTR reports |
| Notifications | DB-level dedup (`UNIQUE (user_id, dedup_key)`), `SKIP LOCKED` worker, preference honoring, retries with backoff, Telegram delivery tracking, cron fan-out with `job_runs` dedup |
| Admin | staff management (self-role-change blocked), audit logs, platform settings, user suspension, artist submissions |
| Analytics | event ingestion + overview / listeners / content / revenue endpoints |

## Security model (summary)

- Service-role key **never** leaves the server; user-scoped Supabase clients
  run under the caller's JWT so **RLS is the second line of defense**.
- Identity comes only from verified JWTs — no client-supplied ids/roles.
- Every privileged mutation writes an `audit_logs` row.
- Zod validation on all inputs; parameterized SQL only; rate-limit tiers;
  CORS allowlist; helmet; 1 MB body cap; image allowlist for uploads.
- Money path: **no endpoint accepts a client "payment success"** —
  entitlement is granted exclusively by the secret-verified Telegram webhook.

## Repository layout

```
apps/api/
├── src/
│   ├── config/env.ts          zod-validated environment
│   ├── lib/                   supabase clients, pg pool, cache, telegram, rbac, pino
│   ├── middleware/            auth, RBAC, validate, rate-limit, audit, errors
│   ├── modules/<domain>/      routes + service per bounded context
│   ├── jobs/                  worker (SKIP LOCKED) + scheduler (cron, job_runs dedup)
│   └── index.ts               entry: server + worker + graceful shutdown
├── tests/                     vitest + supertest integration suites (live project)
├── scripts/set-webhook.ts     register the Telegram webhook
├── docs/                      architecture, API reference, deployment, env
├── Dockerfile                 multi-stage, non-root, healthcheck
└── render.yaml                one-click Render blueprint
```

## Testing

```bash
npm test        # 117 tests, 9 suites — real Supabase, isolated emg_test_* users
```

Suites: `auth` (17) · `catalog` (20) · `users/playlists/favorites` (16) ·
`search` (14) · `admin` (11) · `notifications+webhook` (12) · `payments` (14) ·
`analytics` (8) · `promotions` (5). Test identities are `emg_test_*` /
Telegram ids `91xxxxxxx` and are removed in `afterAll`.
