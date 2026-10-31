# ETHIO MUSIC 🇪🇹

Ethiopia's music streaming **Telegram Mini App** — Amharic · Oromo · Tigrinya · English.
Built on Supabase (PostgreSQL + Row Level Security). **Only licensed releases are ever hosted.**

## Monorepo layout

```
ethio-music/
├── apps/
│   ├── tma/                    # Telegram Mini App — Next.js, static export → GitHub Pages
│   │   └── src/
│   │       ├── app/            # 13 routes: / search/ trending/ artists/ artist/ album/
│   │       │                   #   song/ player/ library/ playlists/ favorites/ premium/ profile/
│   │       ├── components/     # reusable UI (nav, mini-player, covers, states, cards)
│   │       └── lib/            # supabase queries, auth, player, favorites, telegram SDK
│   └── bot/                    # Telegram bot — Telegraf (search, trending, plans)
├── supabase/
│   ├── migrations/             # Ordered SQL migrations (schema + RLS + seed)
│   └── functions/telegram-auth/# Edge Function: verifies initData, mints sessions
├── scripts/
│   └── run_migrations.py       # Idempotent migration runner (local + CI)
└── .github/workflows/
    ├── deploy.yml              # Build TMA → GitHub Pages → set bot menu button
    ├── db-migrate.yml          # Apply pending migrations on push
    └── deploy-functions.yml    # Deploy edge functions (needs SUPABASE_ACCESS_TOKEN)
```

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
2. Paste the contents of each file in numeric order (`20260101000000_extensions.sql` → `..._schema.sql` → `..._rls.sql` → `..._seed.sql`) and run.
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

### Bot (`apps/bot`)
```bash
cd apps/bot
npm install
BOT_TOKEN=<token> SUPABASE_ANON_KEY=<anon> TMA_URL=<url> npm start
```
The bot uses the **public anon key only** — all reads are RLS-protected.

## Seed data notice
All artists/songs in `20260101030000_seed.sql` are **fictional** placeholders for
development. Audio URLs point to the `tracks` storage bucket — upload real (licensed)
files there when onboarding the catalog.

## Security rules (non-negotiable)
1. `.env` files are git-ignored; only `.env.example` is committed.
2. The **service-role key never** appears in `apps/tma`, in any `NEXT_PUBLIC_*` var, or in git.
3. Rotate any credential that has ever been pasted into a chat or ticket.
