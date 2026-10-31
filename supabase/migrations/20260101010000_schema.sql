-- ============================================================================
-- ETHIO MUSIC :: 0002 — Core schema (17 tables)
--   Domain: Identity & Access | Music Catalog | Engagement | Monetization
--
--   Conventions
--   • UUID primary keys (gen_random_uuid)
--   • created_at / updated_at timestamptz on mutable tables
--   • "Authorized releases only": songs carry license + rights-holder fields
--     and a CHECK that an 'approved' song MUST have a recorded license.
--   • favorites / follows use composite PKs ⇒ duplicate rows impossible.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Enumerated types
-- ---------------------------------------------------------------------------
create type public.user_role            as enum ('user','moderator','admin','super_admin');
create type public.artist_status        as enum ('pending','approved','rejected','suspended');
create type public.release_status       as enum ('draft','pending_review','approved','rejected','taken_down');
create type public.license_type         as enum ('owned_master','licensed_master','distribution_deal','creative_commons');
create type public.album_type           as enum ('single','ep','album','compilation');
create type public.subscription_status  as enum ('trialing','active','past_due','canceled','expired');
create type public.payment_status       as enum ('pending','processing','completed','failed','refunded');
create type public.payment_provider     as enum ('telebirr','chapa','flutterwave','stripe');
create type public.promotion_type       as enum ('featured_artist','banner','playlist_slot','push_campaign');
create type public.promotion_status     as enum ('draft','active','paused','completed','canceled');
create type public.notification_type    as enum ('new_release','subscription','payment','promotion','follow','system');

-- ---------------------------------------------------------------------------
-- 1. IDENTITY & ACCESS
-- ---------------------------------------------------------------------------

-- 1a. profiles — 1:1 extension of auth.users
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text unique check (username ~ '^[a-z0-9_]{3,24}$'),
  full_name     text,
  avatar_url    text,
  bio           text,
  language_code text  not null default 'am'
                check (language_code in ('am','om','ti','en')),  -- am/om/ti/en
  country       text  not null default 'ET',
  phone         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.profiles is 'End-user profile, 1:1 with auth.users. Languages: Amharic, Oromo, Tigrinya, English.';

-- 1b. admin_roles — RBAC separation of staff from regular users
create table public.admin_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       public.user_role not null default 'admin'
             check (role in ('moderator','admin','super_admin')),
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
comment on table public.admin_roles is 'Staff roles. Regular users are simply absent. is_admin() reads this table.';

-- ---------------------------------------------------------------------------
-- 2. MUSIC CATALOG
-- ---------------------------------------------------------------------------

-- 2a. artists
create table public.artists (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(name) between 1 and 120),
  slug             text not null unique check (slug ~ '^[a-z0-9-]{2,80}$'),
  bio              text,
  avatar_url       text,
  cover_url        text,
  country          text not null default 'ET',
  region           text,                        -- Oromia, Tigray, Addis Ababa…
  verified         boolean not null default false,
  status           public.artist_status not null default 'pending',
  owner_id         uuid references public.profiles (id) on delete set null,
  monthly_listeners integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- 2b. albums
create table public.albums (
  id           uuid primary key default gen_random_uuid(),
  artist_id    uuid not null references public.artists (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 160),
  slug         text not null unique check (slug ~ '^[a-z0-9-]{2,100}$'),
  description  text,
  cover_url    text,
  album_type   public.album_type not null default 'album',
  release_date date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 2c. genres
create table public.genres (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  slug        text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  description text,
  created_at  timestamptz not null default now()
);

-- 2d. songs — carries the licensing / distribution-rights fields
create table public.songs (
  id                       uuid primary key default gen_random_uuid(),
  artist_id                uuid not null references public.artists (id) on delete cascade,
  album_id                 uuid references public.albums (id) on delete set null,
  title                    text not null check (char_length(title) between 1 and 160),
  slug                     text not null unique check (slug ~ '^[a-z0-9-]{2,120}$'),
  audio_url                text not null,
  cover_url                text,
  duration_seconds         integer not null default 0 check (duration_seconds >= 0),
  track_number             integer,
  isrc                     text unique,
  explicit                 boolean not null default false,
  play_count               bigint not null default 0 check (play_count >= 0),
  -- ── licensing & distribution (authorized releases only) ──────────────────
  license_type             public.license_type not null default 'distribution_deal',
  rights_holder            text not null,          -- who controls the master
  license_document_url     text,                   -- signed agreement / certificate
  distribution_agreement_url text,                 -- distributor authorization
  licensed_at              timestamptz,
  license_expires_at       timestamptz,
  -- ── editorial state machine ───────────────────────────────────────────────
  release_status           public.release_status not null default 'draft',
  approved_by              uuid references public.profiles (id) on delete set null,
  approved_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- an approved song MUST have its license on file (go-live gate)
  constraint songs_approved_requires_license
    check (release_status <> 'approved'
           or (licensed_at is not null and license_document_url is not null))
);
comment on column public.songs.rights_holder is 'Legal owner/controller of the master recording. Mandatory.';

-- 2e. song_genres — many-to-many
create table public.song_genres (
  song_id  uuid not null references public.songs (id)  on delete cascade,
  genre_id uuid not null references public.genres (id) on delete cascade,
  primary key (song_id, genre_id)
);

-- ---------------------------------------------------------------------------
-- 3. ENGAGEMENT
-- ---------------------------------------------------------------------------

-- 3a. playlists
create table public.playlists (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 120),
  description text,
  cover_url   text,
  is_public   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 3b. playlist_songs — ordered join; composite PK blocks duplicates
create table public.playlist_songs (
  playlist_id uuid not null references public.playlists (id) on delete cascade,
  song_id     uuid not null references public.songs    (id) on delete cascade,
  position    integer not null default 0 check (position >= 0),
  added_at    timestamptz not null default now(),
  primary key (playlist_id, song_id)
);

-- 3c. favorites — composite PK blocks duplicate likes
create table public.favorites (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  song_id    uuid not null references public.songs    (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, song_id)
);

-- 3d. follows — composite PK blocks duplicate follows
create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  artist_id   uuid not null references public.artists  (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, artist_id)
);

-- 3e. notifications
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       public.notification_type not null default 'system',
  title      text not null,
  body       text,
  data       jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. MONETIZATION
-- ---------------------------------------------------------------------------

-- 4a. plans (subscription tiers, prices in Ethiopian Birr)
create table public.plans (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (code ~ '^[a-z0-9-]{2,40}$'),
  name          text not null,
  name_am       text,                       -- Amharic display name
  description   text,
  price_etb     numeric(10,2) not null default 0 check (price_etb >= 0),
  duration_days integer not null default 30 check (duration_days > 0),
  features      jsonb not null default '[]'::jsonb,
  is_active     boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 4b. promotions (artist-facing paid promotion)
create table public.promotions (
  id             uuid primary key default gen_random_uuid(),
  artist_id      uuid not null references public.artists (id) on delete cascade,
  song_id        uuid references public.songs (id) on delete set null,
  promotion_type public.promotion_type not null,
  status         public.promotion_status not null default 'draft',
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  amount_etb     numeric(10,2) not null default 0 check (amount_etb >= 0),
  impressions    integer not null default 0 check (impressions >= 0),
  clicks         integer not null default 0 check (clicks >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint promotions_period check (ends_at > starts_at)
);

-- 4c. subscriptions
create table public.subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  plan_id    uuid not null references public.plans (id) on delete restrict,
  status     public.subscription_status not null default 'active',
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz not null,
  auto_renew boolean not null default false,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_period check (ends_at > starts_at)
);

-- 4d. payments (Telebirr / Chapa webhooks write via service role only)
create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  promotion_id    uuid references public.promotions (id) on delete set null,
  amount_etb      numeric(10,2) not null check (amount_etb > 0),
  currency        text not null default 'ETB' check (currency in ('ETB','USD')),
  provider        public.payment_provider not null,
  provider_ref    text unique,               -- provider transaction id
  status          public.payment_status not null default 'pending',
  paid_at         timestamptz,
  raw_payload     jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 4e. song_plays — append-only analytics log
create table public.song_plays (
  id             uuid primary key default gen_random_uuid(),
  song_id        uuid not null references public.songs (id) on delete cascade,
  user_id        uuid references public.profiles (id) on delete set null,
  source         text not null default 'tma'
                 check (source in ('tma','bot','api','web')),
  seconds_played integer not null default 0 check (seconds_played >= 0),
  played_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. Helper functions & triggers
-- ---------------------------------------------------------------------------

-- 5a. generic updated_at maintainer
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','artists','albums','songs','playlists',
    'plans','subscriptions','payments','promotions'
  ] loop
    execute format('drop trigger if exists trg_%s_updated on public.%I', t, t);
    execute format(
      'create trigger trg_%s_updated before update on public.%I
       for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- 5b. RBAC helpers (security definer → safe to call from RLS policies
--     without recursive evaluation of admin_roles policies)
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = 'public' as $$
  select exists (
    select 1 from public.admin_roles
    where user_id = auth.uid()
      and role in ('moderator','admin','super_admin')
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer
set search_path = 'public' as $$
  select exists (
    select 1 from public.admin_roles
    where user_id = auth.uid() and role = 'super_admin'
  );
$$;

-- 5c. auto-create a profile whenever an auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = 'public' as $$
begin
  insert into public.profiles (id, username, full_name, avatar_url, language_code)
  values (
    new.id,
    coalesce(
      lower(new.raw_user_meta_data ->> 'username'),
      'user_' || left(replace(new.id::text, '-', ''), 12)
    ),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(new.raw_user_meta_data ->> 'language_code', 'am')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 6. Indexes (beyond the UNIQUE constraints already declared above)
-- ---------------------------------------------------------------------------
create index if not exists idx_artists_status        on public.artists (status);
create index if not exists idx_artists_name_trgm     on public.artists using gin (name gin_trgm_ops);
create index if not exists idx_albums_artist         on public.albums (artist_id);
create index if not exists idx_songs_artist          on public.songs (artist_id);
create index if not exists idx_songs_album           on public.songs (album_id);
create index if not exists idx_songs_status          on public.songs (release_status);
create index if not exists idx_songs_title_trgm      on public.songs using gin (title gin_trgm_ops);
create index if not exists idx_song_genres_genre     on public.song_genres (genre_id);
create index if not exists idx_playlists_owner       on public.playlists (owner_id);
create index if not exists idx_playlist_songs_song   on public.playlist_songs (song_id);
create index if not exists idx_playlist_songs_pos    on public.playlist_songs (playlist_id, position);
create index if not exists idx_favorites_song        on public.favorites (song_id);
create index if not exists idx_follows_artist        on public.follows (artist_id);
create index if not exists idx_subscriptions_user    on public.subscriptions (user_id, status);
create index if not exists idx_subscriptions_ends    on public.subscriptions (ends_at) where status = 'active';
create index if not exists idx_payments_user         on public.payments (user_id);
create index if not exists idx_payments_status       on public.payments (status);
create index if not exists idx_promotions_active     on public.promotions (status, starts_at, ends_at);
create index if not exists idx_notifications_user    on public.notifications (user_id, created_at desc);
create index if not exists idx_notifications_unread  on public.notifications (user_id) where read_at is null;
create index if not exists idx_song_plays_song       on public.song_plays (song_id, played_at desc);
create index if not exists idx_song_plays_user       on public.song_plays (user_id);
