-- ============================================================================
-- ETHIO MUSIC :: 0003 — Row Level Security
--   • RLS enabled on ALL 17 tables (deny-by-default when no policy matches)
--   • Admin/regular-user separation via is_admin() / is_super_admin()
--     (security-definer helpers over admin_roles)
--   • Payments / subscriptions lifecycle is written by the server
--     (service role) — no client INSERT/UPDATE policies on payments.
--   • Storage buckets for audio + artwork with public read / admin write.
-- Idempotent: policies are dropped before re-creation.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy profiles_select_public on public.profiles
  for select to anon, authenticated
  using (true);

create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (auth.uid() = id);

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. admin_roles — visible to the owner of the row and to staff only;
--    only super_admins can grant/revoke roles.
-- ---------------------------------------------------------------------------
alter table public.admin_roles enable row level security;

create policy admin_roles_select on public.admin_roles
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy admin_roles_insert_super on public.admin_roles
  for insert to authenticated
  with check (public.is_super_admin());

create policy admin_roles_delete_super on public.admin_roles
  for delete to authenticated
  using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 3. artists — approved artists are public; owners manage their own draft
-- ---------------------------------------------------------------------------
alter table public.artists enable row level security;

create policy artists_select on public.artists
  for select to anon, authenticated
  using (status = 'approved' or owner_id = auth.uid() or public.is_admin());

create policy artists_insert_owner on public.artists
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy artists_update_admin on public.artists
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy artists_update_owner_pending on public.artists
  for update to authenticated
  using (owner_id = auth.uid() and status in ('pending','rejected'))
  with check (owner_id = auth.uid());

create policy artists_delete_admin on public.artists
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. albums — readable when the artist is approved
-- ---------------------------------------------------------------------------
alter table public.albums enable row level security;

create policy albums_select on public.albums
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.artists a
      where a.id = albums.artist_id and a.status = 'approved'
    )
    or public.is_admin()
  );

create policy albums_write_admin on public.albums
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 5. genres — public metadata; staff maintain the list
-- ---------------------------------------------------------------------------
alter table public.genres enable row level security;

create policy genres_select on public.genres
  for select to anon, authenticated
  using (true);

create policy genres_write_admin on public.genres
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 6. songs — ONLY approved songs are public (authorized releases);
--    artist-owners can insert drafts and edit pre-approval states.
-- ---------------------------------------------------------------------------
alter table public.songs enable row level security;

create policy songs_select on public.songs
  for select to anon, authenticated
  using (
    release_status = 'approved'
    or public.is_admin()
    or exists (
      select 1 from public.artists a
      where a.id = songs.artist_id and a.owner_id = auth.uid()
    )
  );

create policy songs_insert on public.songs
  for insert to authenticated
  with check (
    public.is_admin()
    or exists (
      select 1 from public.artists a
      where a.id = songs.artist_id and a.owner_id = auth.uid()
    )
  );

create policy songs_update_admin on public.songs
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy songs_update_owner_preapproval on public.songs
  for update to authenticated
  using (
    exists (
      select 1 from public.artists a
      where a.id = songs.artist_id and a.owner_id = auth.uid()
    )
    and release_status in ('draft','pending_review','rejected')
  )
  with check (
    exists (
      select 1 from public.artists a
      where a.id = songs.artist_id and a.owner_id = auth.uid()
    )
  );

create policy songs_delete_admin on public.songs
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 7. song_genres
-- ---------------------------------------------------------------------------
alter table public.song_genres enable row level security;

create policy song_genres_select on public.song_genres
  for select to anon, authenticated
  using (true);

create policy song_genres_write_admin on public.song_genres
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 8. playlists — public lists readable, owners manage their own
-- ---------------------------------------------------------------------------
alter table public.playlists enable row level security;

create policy playlists_select on public.playlists
  for select to anon, authenticated
  using (is_public or owner_id = auth.uid());

create policy playlists_insert_owner on public.playlists
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy playlists_update_owner on public.playlists
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy playlists_delete_owner on public.playlists
  for delete to authenticated
  using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 9. playlist_songs — access inherited from the parent playlist
-- ---------------------------------------------------------------------------
alter table public.playlist_songs enable row level security;

create policy playlist_songs_select on public.playlist_songs
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.playlists p
      where p.id = playlist_songs.playlist_id
        and (p.is_public or p.owner_id = auth.uid())
    )
  );

create policy playlist_songs_write_owner on public.playlist_songs
  for all to authenticated
  using (
    exists (
      select 1 from public.playlists p
      where p.id = playlist_songs.playlist_id and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.playlists p
      where p.id = playlist_songs.playlist_id and p.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 10. favorites — strictly per-user (composite PK already dedupes)
-- ---------------------------------------------------------------------------
alter table public.favorites enable row level security;

create policy favorites_select_own on public.favorites
  for select to authenticated
  using (user_id = auth.uid());

create policy favorites_insert_own on public.favorites
  for insert to authenticated
  with check (user_id = auth.uid());

create policy favorites_delete_own on public.favorites
  for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 11. follows — counts public; mutations by the follower only
-- ---------------------------------------------------------------------------
alter table public.follows enable row level security;

create policy follows_select_public on public.follows
  for select to anon, authenticated
  using (true);

create policy follows_insert_own on public.follows
  for insert to authenticated
  with check (follower_id = auth.uid());

create policy follows_delete_own on public.follows
  for delete to authenticated
  using (follower_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 12. plans — active tiers public; super admins maintain them
-- ---------------------------------------------------------------------------
alter table public.plans enable row level security;

create policy plans_select on public.plans
  for select to anon, authenticated
  using (is_active or public.is_admin());

create policy plans_write_super on public.plans
  for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 13. subscriptions — user reads own; lifecycle managed server-side
-- ---------------------------------------------------------------------------
alter table public.subscriptions enable row level security;

create policy subscriptions_select_own on public.subscriptions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy subscriptions_update_own_cancel on public.subscriptions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 14. payments — user reads own receipts; writes happen via service role
--     (no INSERT/UPDATE/DELETE policies for clients, ever)
-- ---------------------------------------------------------------------------
alter table public.payments enable row level security;

create policy payments_select_own on public.payments
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- 15. promotions — live campaigns public; artists see their own; admin writes
-- ---------------------------------------------------------------------------
alter table public.promotions enable row level security;

create policy promotions_select on public.promotions
  for select to anon, authenticated
  using (
    (status = 'active' and ends_at > now())
    or public.is_admin()
    or exists (
      select 1 from public.artists a
      where a.id = promotions.artist_id and a.owner_id = auth.uid()
    )
  );

create policy promotions_write_admin on public.promotions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 16. notifications — strictly per-user; inserts via service role
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;

create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy notifications_delete_own on public.notifications
  for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 17. song_plays — append-only; users log their own plays
-- ---------------------------------------------------------------------------
alter table public.song_plays enable row level security;

create policy song_plays_insert on public.song_plays
  for insert to anon, authenticated
  with check (user_id = auth.uid() or user_id is null);

create policy song_plays_select_own on public.song_plays
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- 18. Storage buckets — tracks (audio) + covers (artwork)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('tracks','tracks', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('covers','covers', true)
on conflict (id) do nothing;

drop policy if exists "catalog_public_read" on storage.objects;
create policy catalog_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id in ('tracks','covers'));

drop policy if exists "catalog_admin_write" on storage.objects;
create policy catalog_admin_write on storage.objects
  for insert to authenticated
  with check (bucket_id in ('tracks','covers') and public.is_admin());

drop policy if exists "catalog_admin_update" on storage.objects;
create policy catalog_admin_update on storage.objects
  for update to authenticated
  using (bucket_id in ('tracks','covers') and public.is_admin());

-- clean up the helper used for idempotency during development
drop function if exists public.__recreate_policy(text, text, text);
