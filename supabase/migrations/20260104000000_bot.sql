-- ============================================================================
-- ETHIO MUSIC :: 0005 — Telegram bot tables
--
--   bot_chats               registry of Telegram chats + notification prefs
--   bot_follows             chat ↔ artist follow graph (composite PK = no dupes)
--   bot_sent_notifications  claim ledger (composite PK = no duplicate pushes)
--   bot_state               key/value store (release watermark, run bookkeeping)
--
--   SECURITY MODEL
--   • RLS is ENABLED on every bot_* table and NO anon policies are created:
--     PostgREST (anon / authenticated / service role via API) cannot read or
--     write any row. Only the direct Postgres connection used by the bot
--     process (owner role) touches these tables.
--   • No user PII beyond what Telegram itself sends (chat id, @username,
--     display name, language code).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. bot_chats — one row per Telegram chat that ever talked to the bot
-- ---------------------------------------------------------------------------
create table public.bot_chats (
  chat_id             bigint primary key,          -- Telegram chat id
  username            text,                        -- @username (nullable)
  first_name          text,
  language_code       text,                        -- Telegram client language
  -- notification preferences (requirement: respect user prefs)
  notify_new_releases boolean not null default true,
  notify_premium      boolean not null default true,
  is_blocked          boolean not null default false,  -- bot blocked by user
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.bot_chats is 'Telegram chat registry + notification preferences. Written only by the bot process over direct SQL.';

-- keep updated_at fresh (same helper as the core tables)
drop trigger if exists trg_bot_chats_updated on public.bot_chats;
create trigger trg_bot_chats_updated before update on public.bot_chats
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. bot_follows — Telegram users following artists (notification graph)
-- ---------------------------------------------------------------------------
create table public.bot_follows (
  chat_id    bigint not null references public.bot_chats (chat_id) on delete cascade,
  artist_id  uuid   not null references public.artists    (id)     on delete cascade,
  created_at timestamptz not null default now(),
  primary key (chat_id, artist_id)
);
comment on table public.bot_follows is 'Artist follows made from Telegram. Composite PK makes duplicate follows impossible.';

create index if not exists idx_bot_follows_artist on public.bot_follows (artist_id);

-- ---------------------------------------------------------------------------
-- 3. bot_sent_notifications — dedup ledger: one row per (chat, song, kind)
-- ---------------------------------------------------------------------------
create table public.bot_sent_notifications (
  chat_id   bigint not null references public.bot_chats (chat_id) on delete cascade,
  song_id   uuid   not null references public.songs       (id)     on delete cascade,
  kind      text   not null default 'new_release'
                   check (kind in ('new_release','premium','system')),
  sent_at   timestamptz not null default now(),
  primary key (chat_id, song_id, kind)
);
comment on table public.bot_sent_notifications is 'Claim-before-send ledger. INSERT ... ON CONFLICT DO NOTHING RETURNING is the dedup gate.';

create index if not exists idx_bot_sent_song on public.bot_sent_notifications (song_id);

-- ---------------------------------------------------------------------------
-- 4. bot_state — small key/value store (release watermark, run bookkeeping)
-- ---------------------------------------------------------------------------
create table public.bot_state (
  key        text primary key,
  value      timestamptz,
  updated_at timestamptz not null default now()
);
comment on table public.bot_state is 'Bot bookkeeping. Key ''release_watermark'' = last processed songs.created_at.';

drop trigger if exists trg_bot_state_updated on public.bot_state;
create trigger trg_bot_state_updated before update on public.bot_state
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. RLS: lock everything down (enable, no policies ⇒ PostgREST denied)
-- ---------------------------------------------------------------------------
alter table public.bot_chats              enable row level security;
alter table public.bot_follows            enable row level security;
alter table public.bot_sent_notifications enable row level security;
alter table public.bot_state              enable row level security;
