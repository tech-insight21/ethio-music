# ETHIO MUSIC 🇪🇹

Ethiopia's music streaming **Telegram Mini App** — Amharic · Oromo · Tigrinya · English.
Built on Supabase (PostgreSQL + Row Level Security). **Only licensed releases are ever hosted.**

## Monorepo layout

```
ethio-music/
├── apps/
│   ├── api/                    # REST API — Node.js, TypeScript, Express, Zod
│   │   └── src/                # modular: auth / catalog / users / playlists /
│   │   │                       # search / payments (Telegram Stars) / promotions /
│   │   │                       # notifications (worker) / analytics / admin
│   │   ├── tests/              # 117 integration tests (vitest + supertest, live project)
│   │   └── docs/               # ARCHITECTURE / API / DEPLOYMENT / ENVIRONMENT
│   ├── tma/                    # Telegram Mini App — Next.js, static export → GitHub Pages
│   │   └── src/
│   │       ├── app/            # 13 routes: / search/ trending/ artists/ artist/ album/
│   │       │                   #   song/ player/ library/ playlists/ favorites/ premium/ profile/
│   │       ├── components/     # reusable UI (nav, mini-player, covers, states, cards)
│   │       └── lib/            # supabase queries, auth, player, favorites, telegram SDK
│   └── bot/                    # Telegram bot — Telegraf, modular (see below)
├── supabase/
│   ├── migrations/             # Ordered SQL migrations (schema + RLS + seed + bot + api)
│   └── functions/telegram-auth/# Edge Function: verifies initData, mints sessions
├── scripts/
│   ├── run_migrations.py       # Idempotent migration runner (local + CI)
│   ├── verify_api_schema.py    # Post-migration schema verification
│   └── gh_set_secret.py        # GitHub Actions secret helper
└── .github/workflows/
    ├── deploy.yml              # Build TMA → GitHub Pages → sync bot profile/commands
    ├── db-migrate.yml          # Apply pending migrations on push
    ├── api-ci.yml              # API: typecheck → build → 117 integration tests
    ├── bot-notify.yml          # Every 30 min: new-release dispatch (headless)
    └── deploy-functions.yml    # Deploy edge functions (needs SUPABASE_ACCESS_TOKEN)
```

## REST API (apps/api)

One backend for the **bot, mini app and admin dashboard**: `/api/v1/*`.

- **Auth**: Telegram Mini App `initData` (official HMAC algorithm) → Supabase
  sessions; admin password login; refresh rotation; logout/revocation.
- **RBAC**: moderator/admin/super_admin permission matrix, live re-checked
  from `admin_roles`; every privileged mutation lands in `audit_logs`.
- **Money**: Telegram Stars — invoices via `createInvoiceLink`, activation
  ONLY through the secret-verified webhook in one transaction
  (unique `provider_ref` + `payload` = replay-safe). No client-side
  "payment success" is ever trusted.
- **Notifications**: DB-level dedup (`UNIQUE (user_id, dedup_key)`),
  `FOR UPDATE SKIP LOCKED` worker, preference honoring, exponential-backoff
  retries, cron fan-out deduped via `job_runs`.
- **Security**: Zod everywhere, parameterized SQL, rate-limit tiers, CORS
  allowlist, helmet, upload type/size gates, service-role key server-only.

Docs: `apps/api/docs/ARCHITECTURE.md` · `API.md` · `DEPLOYMENT.md` ·
`ENVIRONMENT.md`. Tests: `cd apps/api && npm test` (117).

## Mini app (apps/tma) — 13 pages

| Route | Page | Data source |
|---|---|---|
| `/` | Home | featured promo, trending, new releases, artists |
| `/search/` | Search | live catalog search (songs + artists) |
| `/trending/` | Trending | top 20 by real play counts |
| `/artists/` | Artists | approved artists |
| `/artist/?slug=` | Artist profile | bio, followers, popular, discography |
| `/album/?id=` | Album details | tracklist, play album |
| `/song/?id=` | Song details | artwork, genres, share, licensing note |
| `/player/?id=` | Full-screen player | queue, seek, haptics, deep-linkable |
| `/library/` | My library | favorites + playlists hub |
| `/playlists/` | Playlists | CRUD (requires sign-in) |
| `/favorites/` | Favorites | device-local as guest, synced when signed in |
| `/premium/` | Subscription | live plans from DB |
| `/profile/` | User profile | Telegram identity, language, session |

## Authentication (Telegram initData — the safe way)

The client **never** derives identity from `initDataUnsafe`. Flow:

1. Client reads the raw `WebApp.initData` string.
2. Client POSTs it to `POST {SUPABASE_URL}/functions/v1/telegram-auth`.
3. The edge function verifies the HMAC-SHA256 signature against the bot
   token, rejects stale `auth_date`, provisions the auth user (the
   `handle_new_user` trigger creates the matching `profiles` row), and
   returns a real Supabase session.
4. Client stores it via `supabase.auth.setSession()`.

Deploy the function (one-time):
```bash
supabase functions deploy telegram-auth --project-ref <ref> --no-verify-jwt
supabase secrets set TELEGRAM_BOT_TOKEN=<bot token>
```
Or push — `.github/workflows/deploy-functions.yml` automates it once the
`SUPABASE_ACCESS_TOKEN` secret + `SUPABASE_ACCESS_TOKEN_SET=yes` variable exist.

### Backend integration status (honest list)

| Feature | State |
|---|---|
| Catalog browsing, search, player, play analytics | ✅ live (Supabase + RLS) |
| Favorites (guest) | ✅ device-local, labeled as such |
| Sign-in / synced favorites / follows / playlists | ⏳ deploy `telegram-auth` (code ready) |
| Telebirr/Chapa checkout | ⏳ payments milestone (merchant + webhook + activation) |
| Push notifications | ⏳ future milestone |


## Database (17 tables, RLS on every table)

| Domain | Tables |
|---|---|
| Identity & Access | `profiles`, `admin_roles` |
| Music Catalog | `artists`, `albums`, `genres`, `songs`, `song_genres` |
| Engagement | `playlists`, `playlist_songs`, `favorites`, `follows`, `notifications`, `song_plays` |
| Monetization | `plans`, `promotions`, `subscriptions`, `payments` |
| Telegram bot (RLS-locked, no anon policies) | `bot_chats`, `bot_follows`, `bot_sent_notifications`, `bot_state` |

Key guarantees:
- **UUID primary keys** everywhere (`gen_random_uuid`)
- **Composite PKs** on `favorites`, `follows`, `song_genres`, `playlist_songs` ⇒ duplicates impossible
- **`created_at` / `updated_at`** maintained by triggers on all mutable tables
- **RLS deny-by-default** — 47 policies; payments/subscriptions written only via the server (service role, never in client code)
- **Admin/user separation** via `admin_roles` + `is_admin()` / `is_super_admin()` security-definer helpers
- **Licensing gate** — `songs.rights_holder` is mandatory and a CHECK constraint blocks `release_status='approved'` unless `licensed_at` + `license_document_url` are on file

## Running migrations

### Option A — Supabase SQL Editor (manual)
1. Open your project → **SQL Editor** → *New query*.
2. Paste the contents of each file in numeric order (`20260101000000_extensions.sql` → `..._schema.sql` → `..._rls.sql` → `..._seed.sql` → `..._bot.sql`) and run.
3. Files are idempotent (`create extension if not exists`, `on conflict do nothing`).

### Option B — CLI (automatic, recommended)
```bash
export SUPABASE_REF=<project-ref>
export SUPABASE_DB_PASSWORD=<postgres password>
export SUPABASE_POOLER_HOST=aws-0-eu-west-1.pooler.supabase.com   # IPv4 pooler
python3 scripts/run_migrations.py
```
The runner records applied versions in `public.schema_migrations_local`, so re-running
skips completed migrations. GitHub Actions runs this automatically on every push that
touches `supabase/migrations/**`.

> ℹ️ Direct host `db.<ref>.supabase.co` is IPv6-only. Use the **pooler** host for IPv4 access.

### Option C — Supabase CLI (local dev)
```bash
supabase link --project-ref <ref>
supabase db push
```

## Apps

### Mini app (`apps/tma`)
```bash
cd apps/tma
npm install
npm run build          # static export → out/
npx serve out          # or deploy anywhere static
```
Env needed at build time: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
GitHub Pages deploys automatically on push to `main` (workflow `deploy.yml`), and the
bot's menu button is re-pointed at the live URL afterwards.

### Bot (`apps/bot`) — Telegraf, modular

Commands: `/start` `/app` `/search` `/trending` `/new` `/artists` `/premium`
`/paysupport` `/help` `/settings` + admin-only `/admin` `/broadcast` `/notify`.
Any plain text message is treated as a search. Artists can be followed straight
from the bot; followers get new-release alerts.

```
src/
├── config.ts               # env validation — fails fast, never logs secrets
├── logger.ts               # leveled + redacting logger
├── index.ts                # entry: polling | webhook | NOTIFY_ONLY modes
├── db/
│   ├── pool.ts             # direct Postgres (pooler) for bot_* tables only
│   ├── store.ts            # chats, prefs, follows, dedup ledger, watermark
│   └── catalog.ts          # music catalog via anon REST — same backend as TMA
├── telegram/
│   ├── bot.ts              # assembly + global error net
│   ├── format.ts           # strict MarkdownV2 escaping helpers
│   ├── keyboards.ts        # inline keyboards (menus, pagers, follow, prefs)
│   ├── context.ts          # BotContext / ActionCtx types
│   ├── helpers.ts          # safe() error isolation, chat registration, paging
│   └── handlers/           # start, help, app, search, trending, new, artists,
│                           # premium, paysupport, settings, admin
└── notify/engine.ts        # watermark → fan-out → claim-before-send
scripts/
├── smoke-store.ts          # DB-layer smoke test (11 checks, self-cleaning)
├── e2e-local.ts            # full command/callback E2E (24 checks, mocked API)
└── smoke-notify.ts         # engine E2E incl. dedup proof (5 checks, live API)
```

Local development (long polling):
```bash
cd apps/bot && npm install
export BOT_TOKEN=... SUPABASE_URL=... SUPABASE_ANON_KEY=...
export SUPABASE_REF=... SUPABASE_DB_PASSWORD=... SUPABASE_POOLER_HOST=...
npm start          # polling; or: npm run e2e / npm run smoke / npm run smoke:notify
```

Production (webhook) — set `WEBHOOK_URL=https://<public-host>`, optional
`PORT`, `WEBHOOK_PATH`, `WEBHOOK_SECRET`; the bot calls `setWebhook` itself:
```bash
WEBHOOK_URL=https://ethio-bot.fly.dev npm start
```
Works on any host with outbound HTTPS: Railway/Render (`npm start`), Fly.io,
a VPS behind Caddy/Nginx, etc.

Notifications without hosting: `.github/workflows/bot-notify.yml` runs
`npm run notify` every 30 minutes (headless dispatch — needs no listener).

Admin setup: `ADMIN_TELEGRAM_IDS=<your telegram id>` (comma-separated; find it
with @userinfobot). Unlocks `/admin` (stats), `/broadcast <msg>` (single-use
confirm → duplicates impossible), `/notify` (manual dispatch).

Security model:
- Catalog reads use the **public anon key** (RLS: approved-only) — identical to the mini app.
- Bot-private tables (`bot_chats`, `bot_follows`, `bot_sent_notifications`, `bot_state`) are RLS-locked with **zero anon policies** — reachable only through the bot's Postgres connection.
- **No service-role key** is used anywhere in the bot.
- Secrets live in env/GitHub Actions secrets; the logger redacts token-like values.

Duplicate-notification guarantee: `bot_sent_notifications` has a composite PK
`(chat_id, song_id, kind)`; the engine claims with `INSERT … ON CONFLICT DO
NOTHING RETURNING` **before** sending, so concurrent dispatchers can never
double-send, and the watermark in `bot_state` scopes each run.

## Seed data notice
All artists/songs in `20260101030000_seed.sql` are **fictional** placeholders for
development. Audio URLs point to the `tracks` storage bucket — upload real (licensed)
files there when onboarding the catalog.

## Security rules (non-negotiable)
1. `.env` files are git-ignored; only `.env.example` is committed.
2. The **service-role key never** appears in `apps/tma`, in any `NEXT_PUBLIC_*` var, or in git.
3. Rotate any credential that has ever been pasted into a chat or ticket.
