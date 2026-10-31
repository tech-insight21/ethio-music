-- ============================================================================
-- ETHIO MUSIC :: 0006 — REST API backend extensions
--
--   ADDITIVE ONLY. No existing table is dropped, renamed or retyped.
--   Existing live data (profiles, catalog, bot tables) is untouched.
--
--   Adds:
--     • payments      → telegram_stars provider, amount_stars, payload
--                       (invoice idempotency), plan_id, XTR currency
--     • notifications → delivery pipeline (status/attempts/backoff/dedup_key
--                       with UNIQUE partial index = no duplicate pushes)
--     • bot_chats     → user_id link (Telegram chat ↔ account)
--     • plans         → price_stars (Telegram Stars pricing)
--     • songs         → language (am/om/ti/en filter)
--     • new tables    → user_sessions, audit_logs, platform_settings,
--                       search_history, analytics_events,
--                       artist_submissions, job_runs (cron dedup)
--     • RLS enabled on every new table (deny-by-default)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enumerated types (idempotent)
-- ---------------------------------------------------------------------------
alter type public.payment_provider add value if not exists 'telegram_stars';

do $$ begin
  create type public.submission_status as enum ('pending','approved','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notif_status as enum ('pending','sent','failed','skipped');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notif_channel as enum ('in_app','telegram','both');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. payments — Telegram Stars support
-- ---------------------------------------------------------------------------
alter table public.payments
  add column if not exists plan_id      uuid references public.plans (id) on delete set null,
  add column if not exists amount_stars integer check (amount_stars is null or amount_stars > 0),
  add column if not exists payload      text;

-- invoice payload ↔ pending payment (pre-checkout lookup, replay safety)
create unique index if not exists idx_payments_payload
  on public.payments (payload) where payload is not null;

-- Stars are billed in XTR
alter table public.payments drop constraint if exists payments_currency_check;
alter table public.payments
  add constraint payments_currency_check check (currency in ('ETB','USD','XTR'));

create index if not exists idx_payments_provider
  on public.payments (provider, status, created_at desc);
create index if not exists idx_payments_plan
  on public.payments (plan_id) where plan_id is not null;

-- ---------------------------------------------------------------------------
-- 3. notifications — delivery pipeline + DB-level dedup
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column if not exists status              public.notif_status not null default 'pending',
  add column if not exists channel             public.notif_channel not null default 'in_app',
  add column if not exists attempts            integer not null default 0,
  add column if not exists send_at             timestamptz not null default now(),
  add column if not exists last_error          text,
  add column if not exists telegram_message_id bigint,
  add column if not exists dedup_key           text;

-- (user, dedup_key) unique ⇒ the SAME notification can never be enqueued twice,
-- whichever process (bot cron or API worker) gets there first.
create unique index if not exists idx_notifications_dedup
  on public.notifications (user_id, dedup_key) where dedup_key is not null;

-- queue poller index
create index if not exists idx_notifications_queue
  on public.notifications (send_at) where status = 'pending';

-- ---------------------------------------------------------------------------
-- 4. bot_chats — link the Telegram chat to the account profile
-- ---------------------------------------------------------------------------
alter table public.bot_chats
  add column if not exists user_id uuid references public.profiles (id) on delete set null;

create index if not exists idx_bot_chats_user
  on public.bot_chats (user_id) where user_id is not null;

-- ---------------------------------------------------------------------------
-- 5. plans / songs — small additive columns
-- ---------------------------------------------------------------------------
alter table public.plans
  add column if not exists price_stars integer check (price_stars is null or price_stars >= 0);

alter table public.songs
  add column if not exists language text
    check (language is null or language in ('am','om','ti','en'));

create index if not exists idx_songs_language
  on public.songs (language) where language is not null;

-- Stars pricing for the seeded tiers (configurable via admin API)
update public.plans set price_stars = 250 where code = 'premium'     and price_stars is null;
update public.plans set price_stars = 450 where code = 'family'      and price_stars is null;
update public.plans set price_stars = 600 where code = 'artist-pro'  and price_stars is null;

-- ---------------------------------------------------------------------------
-- 6. New tables
-- ---------------------------------------------------------------------------

-- 6a. user_sessions — API session registry (hashed refresh tokens)
create table if not exists public.user_sessions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  refresh_token_hash text not null unique,
  refresh_token      text,                -- server-side session store (RLS-locked)
  user_agent         text,
  ip                 text,
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz not null default now(),
  expires_at         timestamptz not null,
  revoked_at         timestamptz
);
create index if not exists idx_user_sessions_user
  on public.user_sessions (user_id, created_at desc);

-- 6b. audit_logs — append-only trail of administrator actions
create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles (id) on delete set null,
  actor_role  text,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  before      jsonb not null default '{}'::jsonb,
  after       jsonb not null default '{}'::jsonb,
  ip          text,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_logs_created
  on public.audit_logs (created_at desc);
create index if not exists idx_audit_logs_actor
  on public.audit_logs (actor_id, created_at desc);
create index if not exists idx_audit_logs_entity
  on public.audit_logs (entity_type, entity_id);

-- 6c. platform_settings — key/value platform configuration
create table if not exists public.platform_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);

insert into public.platform_settings (key, value, description) values
  ('maintenance_mode', 'false', 'When true, non-admin API access returns 503.'),
  ('new_release_notifications_enabled', 'true', 'Global kill-switch for new-release fan-out.'),
  ('default_language', '"am"', 'Default UI language for new accounts.'),
  ('min_app_version', '"1.0.0"', 'Minimum supported client version.')
on conflict (key) do nothing;

-- 6d. search_history — per-user query log (trimmed by a maintenance job)
create table if not exists public.search_history (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  query         text not null check (char_length(query) between 1 and 120),
  results_count integer not null default 0 check (results_count >= 0),
  created_at    timestamptz not null default now()
);
create index if not exists idx_search_history_user
  on public.search_history (user_id, created_at desc);

-- 6e. analytics_events — generic event log (search, plays, conversions…)
create table if not exists public.analytics_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles (id) on delete set null,
  type        text not null,
  entity_type text,
  entity_id   text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_analytics_events_type
  on public.analytics_events (type, created_at desc);
create index if not exists idx_analytics_events_user
  on public.analytics_events (user_id, created_at desc);
create index if not exists idx_analytics_events_created
  on public.analytics_events (created_at desc);

-- 6f. artist_submissions — onboarding/review pipeline for artists
create table if not exists public.artist_submissions (
  id          uuid primary key default gen_random_uuid(),
  artist_id   uuid not null references public.artists (id) on delete cascade,
  submitted_by uuid references public.profiles (id) on delete set null,
  status      public.submission_status not null default 'pending',
  message     text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_artist_submissions_status
  on public.artist_submissions (status, created_at desc);
create index if not exists idx_artist_submissions_artist
  on public.artist_submissions (artist_id);

drop trigger if exists trg_artist_submissions_updated on public.artist_submissions;
create trigger trg_artist_submissions_updated before update on public.artist_submissions
  for each row execute function public.set_updated_at();

-- 6g. job_runs — cron dedup: PK (job, period_key) insert-or-skip
create table if not exists public.job_runs (
  job         text not null,
  period_key  text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  primary key (job, period_key)
);

-- ---------------------------------------------------------------------------
-- 7. RLS — deny-by-default on all new tables
-- ---------------------------------------------------------------------------
alter table public.user_sessions        enable row level security;
alter table public.audit_logs           enable row level security;
alter table public.platform_settings    enable row level security;
alter table public.analytics_events     enable row level security;
alter table public.artist_submissions   enable row level security;
alter table public.job_runs             enable row level security;
alter table public.search_history       enable row level security;

-- search_history: safe own-row policies for direct client access
create policy search_history_select_own on public.search_history
  for select to authenticated using (user_id = auth.uid());
create policy search_history_insert_own on public.search_history
  for insert to authenticated with check (user_id = auth.uid());
create policy search_history_delete_own on public.search_history
  for delete to authenticated using (user_id = auth.uid());

-- artist_submissions: owners see/insert their own, staff review everything
create policy artist_submissions_select on public.artist_submissions
  for select to authenticated
  using (
    submitted_by = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.artists a
      where a.id = artist_submissions.artist_id and a.owner_id = auth.uid()
    )
  );
create policy artist_submissions_insert on public.artist_submissions
  for insert to authenticated
  with check (
    exists (
      select 1 from public.artists a
      where a.id = artist_submissions.artist_id and a.owner_id = auth.uid()
    )
  );
create policy artist_submissions_update_admin on public.artist_submissions
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- platform_settings: read-only for staff via direct clients; API manages writes
create policy platform_settings_select_admin on public.platform_settings
  for select to authenticated using (public.is_admin());
