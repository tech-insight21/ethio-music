# ETHIO MUSIC 🇪🇹

Ethiopia's music streaming **Telegram Mini App** — Amharic · Oromo · Tigrinya · English.
Built on Supabase (PostgreSQL + Row Level Security). **Only licensed releases are ever hosted.**

## Monorepo layout

```
ethio-music/
├── apps/
│   ├── tma/                    # Telegram Mini App — Next.js, static export → GitHub Pages
│   └── bot/                    # Telegram bot — Telegraf (search, trending, plans)
├── supabase/
│   └── migrations/             # Ordered SQL migrations (schema + RLS + seed)
├── scripts/
│   └── run_migrations.py       # Idempotent migration runner (local + CI)
└── .github/workflows/
    ├── deploy.yml              # Build TMA → GitHub Pages → set bot menu button
    └── db-migrate.yml          # Apply pending migrations on push
```

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
