# ETHIO MUSIC — REST API Architecture (apps/api)

Production backend serving the Telegram Bot, the Mini App and the Admin
Dashboard through **one versioned API**: `/api/v1/*`.

## 1. Stack

| Concern            | Choice                                                        |
| ------------------ | ------------------------------------------------------------- |
| Runtime            | Node.js 20+, TypeScript (NodeNext ESM, strict)                |
| HTTP               | Express 4 + helmet + cors + express-rate-limit                |
| Validation         | Zod (body / query / params, fail-closed 422)                  |
| Database           | Supabase PostgreSQL — supabase-js (REST) + `pg` pool (SQL)    |
| Auth               | Telegram Mini App initData (official HMAC algorithm) → Supabase Auth session; HS256 JWT verified locally with `SUPABASE_JWT_SECRET` |
| RBAC               | `admin_roles` table checked live (30 s TTL cache)             |
| Storage            | Supabase Storage (`tracks`, `covers` buckets)                 |
| Payments           | Telegram Stars (XTR) via Bot API `createInvoiceLink` + webhook|
| Jobs               | node-cron scheduler + `pg` `FOR UPDATE SKIP LOCKED` queue     |
| Logging            | pino (structured, per-request, response-time)                 |

## 2. Layering

```
src/
  index.ts            entry — env check, http server, worker bootstrap
  app.ts              createApp(): middleware chain + route mounting
  config/env.ts       zod-validated environment (secrets never in code)
  lib/                supabase clients (anon / user-scoped / service),
                      pg pool (pooler, ipv4first), pino logger, TTL cache,
                      Telegram Bot API client (token bucket 25 msg/s, 429 retry)
  middleware/         request-id + timing log, authenticate (JWT → profile),
                      requireAdmin/requirePermission, validate (zod),
                      rate-limit tiers, error-handler, not-found
  modules/<domain>/   routes.ts (zod schemas + handlers) + service.ts (data)
  jobs/               scheduler.ts (cron) + worker.ts (notification queue)
tests/                vitest + supertest integration suites (live project)
```

## 3. Authentication model

### 3.1 Telegram Mini App (`POST /api/v1/auth/telegram`)
1. Body `{ initData }` — validate with the **official algorithm**:
   `secret = HMAC_SHA256("WebAppData", BOT_TOKEN)`,
   `expected = HMAC_SHA256(secret, data_check_string)`, constant-time compare,
   `auth_date` freshness window (default 24 h).
2. Ensure the auth user exists (service role): deterministic email
   `tg{id}@telegram.ethiomusic.app`, `admin.createUser` — the
   `handle_new_user` trigger creates the `profiles` row.
3. Mint a real Supabase session: `admin.generateLink(magiclink)` →
   `verifyOtp` on an anon client. Link `bot_chats.user_id ↔ profiles.id`
   so Telegram notifications can target the account.
4. Register the session in `user_sessions` (hashed refresh token) and return
   `{ session: { access_token, refresh_token, user }, profile }`.

Client calls then send `Authorization: Bearer <access_token>`. The API
**never trusts** any client-provided user id or role — identity comes only
from the verified JWT `sub`.

### 3.2 Admin (`POST /api/v1/auth/admin/login`)
Supabase `signInWithPassword` → service-role read of `admin_roles`
(403 when absent) → same session shape. `requirePermission()` re-checks
`admin_roles` **live** so revoked staff lose access within seconds.

### 3.3 Session management
`user_sessions` stores one row per minted session (sha-256 of the refresh
token, UA, IP, expiry). `POST /auth/logout` revokes the Supabase refresh
token + marks the row revoked; `DELETE /auth/sessions` revokes all;
`GET /auth/sessions` lists devices.

## 4. Authorization matrix

| Permission             | moderator | admin | super_admin |
| ---------------------- |:--:|:--:|:--:|
| catalog:write          | ✔ | ✔ | ✔ |
| artists:review         | ✔ | ✔ | ✔ |
| submissions:review     | ✔ | ✔ | ✔ |
| users:manage           | ✖ | ✔ | ✔ |
| payments:read          | ✖ | ✔ | ✔ |
| finance:manage (refund)| ✖ | ✔ | ✔ |
| promotions:manage      | ✖ | ✔ | ✔ |
| notifications:send     | ✖ | ✔ | ✔ |
| analytics:read         | ✖ | ✔ | ✔ |
| admins:manage          | ✖ | ✖ | ✔ |
| settings:manage        | ✖ | ✖ | ✔ |

Self-service guard: no principal can grant/change **its own** admin role.

## 5. Database extensions (migration `20260105000000_backend_api.sql`)

Additive only — no existing table or column is dropped or retyped.

- `payments`: enum value `telegram_stars`, `amount_stars int`, `payload text UNIQUE`
  (invoice payload → pre-checkout lookup), `plan_id uuid FK plans`,
  currency check widened with `'XTR'`.
- `notifications`: delivery pipeline columns — `status`, `attempts`,
  `last_error`, `send_at`, `channel`, `telegram_message_id`, `dedup_key`
  + **unique partial index `(user_id, dedup_key)`** = DB-level duplicate push
  prevention shared by bot and API.
- `bot_chats`: `user_id uuid FK profiles` (Telegram chat ↔ account link).
- `plans`: `price_stars int` (Stars price for the same tier).
- `songs`: `language text` check `(am|om|ti|en)`.
- New tables: `user_sessions`, `audit_logs`, `platform_settings`,
  `search_history`, `analytics_events`, `artist_submissions`,
  `job_runs` (cron dedup: `PK(job, period_key)`).
- RLS enabled on every new table; client-facing own-row policies only where
  meaningful (`search_history`), everything else service/pooler-only.

## 6. Money path (Telegram Stars) — never trust the client

```
TMA/Bot          API                              Telegram
  │ POST /payments/stars/invoice {plan_id}
  │──────────────▶ verify entitlement, insert payments(pending, payload UUID)
  │◀── invoiceLink ─ createInvoiceLink(XTR) ──────▶│
  │ open link, pay                                 │
  │                POST /telegram/webhook ◀────────│ pre_checkout_query
  │                (secret header, idempotent OK/decline)
  │                POST /telegram/webhook ◀────────│ successful_payment
  │                pg TRANSACTION: payments pending→completed (provider_ref
  │                UNIQUE = replay-safe) → insert/extend subscriptions →
  │                enqueue confirmation notification
```

No endpoint accepts a client-side "payment success" — entitlement is only
ever written by the secret-verified webhook. Refunds call
`refundStarPayment` and cancel the derived subscription.

## 7. Notification pipeline (respect prefs, no duplicates, rate limits)

1. `notificationService.enqueue()` inserts `notifications` rows
   (`dedup_key` unique → duplicates impossible at DB level).
2. Worker (`jobs/worker.ts`) claims batches with
   `SELECT … FOR UPDATE SKIP LOCKED` (multi-instance safe), honours
   `bot_chats.notify_new_releases / notify_premium / is_blocked` and
   profiles preferences, tracks `telegram_message_id`.
3. Retries: attempts < 5, exponential backoff (`send_at` + 2^attempts min).
4. Telegram rate limits: token bucket 25 msg/s + 429 `retry_after` handling.
5. Scheduler (`jobs/scheduler.ts`) cron jobs deduped via `job_runs`
   `PK(job, period_key)` insert-or-skip: new releases → followers,
   premium expiries, scheduled promotions, analytics rollups,
   search-history trimming.

## 8. API surface

| Group | Key endpoints |
| --- | --- |
| auth | `POST /auth/telegram`, `POST /auth/admin/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET/DELETE /auth/sessions`, `GET /auth/me` |
| users | `GET/PATCH /users/me`, `GET/PUT /users/me/preferences`, `GET /users/me/activity`, `POST/DELETE /users/me/follows/:artistId`, `GET /users/me/follows`, `GET/POST/DELETE /users/me/favorites/:songId`, `PUT /admin/users/:id/status` |
| artists | `GET /artists`, `GET /artists/:idOrSlug`, `GET /artists/:id/albums`, `POST /artists` (owner), `POST /artists/:id/submissions`, admin: `PATCH /artists/:id` (verify/approve/suspend) |
| albums | `GET /albums`, `GET /albums/:idOrSlug`, `POST/PATCH/DELETE /albums` (admin) |
| songs | `GET /songs`, `GET /songs/:idOrSlug`, `POST /songs/:id/play`, admin: `POST /songs`, `PATCH /songs/:id`, `POST /songs/:id/approve|takedown`, `POST /admin/songs/:id/artwork` (multipart, type+size validated), `POST /admin/songs/:id/audio-url` |
| genres | `GET /genres`, admin: `POST/PATCH/DELETE /genres/:id` |
| playlists | `GET /playlists` (public), `GET /playlists/mine`, `POST /playlists`, `PATCH/DELETE /playlists/:id` (owner), `POST/DELETE /playlists/:id/songs/:songId`, `PUT /playlists/:id/songs` (reorder) |
| favorites | `GET /favorites`, `PUT/DELETE /favorites/:songId` |
| search | `GET /search?q=` (songs+artists+albums+genres, records history), `GET/DELETE /search/history` |
| trending | `GET /trending` (weighted plays), `GET /trending/artists`, `GET /releases/new`, personalized `GET /discover/recommendations` |
| subscriptions | `GET /subscriptions/plans`, `GET /subscriptions/me`, `POST /subscriptions/me/cancel` |
| payments | `POST /payments/stars/invoice`, `GET /payments` (own receipts), `GET /payments/:id`, admin refund `POST /payments/:id/refund` |
| promotions | `GET /promotions/active`, `POST /promotions/requests` (artist), `POST /promotions/:id/impression|click`, admin: `GET /admin/promotions`, `PATCH /admin/promotions/:id` (approve/schedule), `GET /admin/promotions/:id/report` |
| notifications | `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`, `DELETE /notifications/:id`, admin send `POST /admin/notifications/broadcast` |
| analytics | `POST /analytics/events`, admin: `GET /analytics/overview`, `/analytics/listeners`, `/analytics/content`, `/analytics/revenue` |
| admin | `GET/POST /admin/admins`, `PUT /admin/admins/:userId/role`, `DELETE /admin/admins/:userId/role/:role`, `GET /admin/audit-logs`, `GET/PUT /admin/settings`, `GET /admin/users`, `GET /admin/submissions`, `PATCH /admin/submissions/:id` |
| telegram | `POST /telegram/webhook` (secret-verified bot updates: payments, /start, chat registry) |

## 9. Security controls

- Zod validation on every route; parameterized SQL only (no string concat).
- Rate limits: 300/min/IP global, 15/min auth, 120/min search; stricter per
  write-sensitive routes.
- CORS allowlist from `CORS_ORIGINS`; helmet defaults; JSON body 1 MB cap;
  multer upload allowlist `image/(png|jpeg|webp)` ≤ 5 MB.
- Secrets only server-side (service-role key never leaves the process);
  webhook authenticated by `X-Telegram-Bot-Api-Secret-Token` (timing-safe).
- `audit_logs` rows written for every admin mutation (actor, action,
  entity, before/after, ip, ua).
- Users cannot modify their own admin roles or profile `is_active`;
  suspended profiles are rejected at authenticate time.

## 10. Testing & deployment

- vitest + supertest against the **live** Supabase project with clearly
  marked `emg_test_*` identities, full cleanup in `afterAll`; negative
  security tests (RBAC, rate limit, webhook secret, injection, self-role
  change) included.
- `Dockerfile` (multi-stage, non-root) + render/Railway/Fly deployment docs
  (`npm run tg:set-webhook` registers the webhook with secret token).
- CI: `.github/workflows/api-ci.yml` — typecheck + build + integration
  tests with repository secrets.
