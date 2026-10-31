import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://trhfksuskfgvlmwzzsyu.supabase.co";

const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

/**
 * Client-side Supabase.
 * SECURITY: publishable/anon key only — every table is guarded by RLS.
 * The service-role key never appears in this app.
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!key) throw new Error("Missing NEXT_PUBLIC publishable/anon key");
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
}

export const SUPABASE_URL = url;

/* ─────────────────────────────── Types ─────────────────────────────── */

export interface Artist {
  id: string;
  name: string;
  slug: string;
  bio?: string | null;
  avatar_url: string | null;
  cover_url?: string | null;
  region?: string | null;
  verified: boolean;
  monthly_listeners: number;
}

export interface Genre {
  id: string;
  name: string;
  slug: string;
}

export interface Album {
  id: string;
  title: string;
  slug: string;
  description?: string | null;
  cover_url: string | null;
  album_type?: string;
  release_date?: string | null;
  artist_id?: string;
  artist?: Artist | null;
}

export interface Song {
  id: string;
  title: string;
  slug: string;
  audio_url: string;
  cover_url: string | null;
  duration_seconds: number;
  track_number?: number | null;
  play_count: number;
  approved_at?: string | null;
  artist: Artist | null;
  album?: Album | null;
  genres?: { genres: Genre | null }[];
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  name_am: string | null;
  description: string | null;
  price_etb: number;
  duration_days: number;
  features: string[];
}

export interface UserPlaylist {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  is_public: boolean;
  created_at: string;
}

/* ────────────────────────────── Queries ────────────────────────────── */

export const SONG_COLS =
  "*, artist:artists(id,name,slug,avatar_url,verified,monthly_listeners), genres:song_genres(genres(id,name,slug))";

export async function getTrendingSongs(limit = 20): Promise<Song[]> {
  // Ranked by cumulative play_count, maintained server-side.
  const { data, error } = await getSupabase()
    .from("songs")
    .select(SONG_COLS)
    .eq("release_status", "approved")
    .order("play_count", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as Song[];
}

export async function getNewSongs(limit = 10): Promise<Song[]> {
  const { data, error } = await getSupabase()
    .from("songs")
    .select(SONG_COLS)
    .eq("release_status", "approved")
    .order("approved_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as Song[];
}

export async function getArtists(): Promise<Artist[]> {
  const { data, error } = await getSupabase()
    .from("artists")
    .select("id,name,slug,bio,avatar_url,region,verified,monthly_listeners")
    .eq("status", "approved")
    .order("monthly_listeners", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Artist[];
}

export async function getArtistBySlug(slug: string): Promise<Artist> {
  const { data, error } = await getSupabase()
    .from("artists")
    .select("id,name,slug,bio,avatar_url,region,verified,monthly_listeners")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Artist not found");
  return data as unknown as Artist;
}

export async function getArtistAlbums(artistId: string): Promise<Album[]> {
  const { data, error } = await getSupabase()
    .from("albums")
    .select("id,title,slug,cover_url,description,release_date,album_type,artist_id")
    .eq("artist_id", artistId)
    .order("release_date", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as Album[];
}

export async function getArtistSongs(artistId: string, limit = 6): Promise<Song[]> {
  const { data, error } = await getSupabase()
    .from("songs")
    .select(SONG_COLS)
    .eq("artist_id", artistId)
    .eq("release_status", "approved")
    .order("play_count", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as Song[];
}

export async function getFollowerCount(artistId: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from("follows")
    .select("follower_id", { count: "exact", head: true })
    .eq("artist_id", artistId);
  if (error) throw error;
  return count ?? 0;
}

export async function getAlbumById(id: string): Promise<Album & { songs: Song[] }> {
  const { data, error } = await getSupabase()
    .from("albums")
    .select(
      "*, artist:artists(id,name,slug,avatar_url,verified,monthly_listeners)," +
        "songs(id,title,slug,audio_url,cover_url,duration_seconds,track_number,play_count,artist_id," +
        "artist:artists(id,name,slug,avatar_url,verified,monthly_listeners))"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Album not found");
  const album = data as unknown as Album & { songs: Song[] };
  album.songs = (album.songs ?? []).sort(
    (a, b) => (a.track_number ?? 0) - (b.track_number ?? 0)
  );
  return album;
}

export async function getSongById(id: string): Promise<Song> {
  const { data, error } = await getSupabase()
    .from("songs")
    .select(SONG_COLS + ", album:albums(id,title,slug,cover_url)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Song not found");
  return data as unknown as Song;
}

export async function getSongsByIds(ids: string[]): Promise<Song[]> {
  if (ids.length === 0) return [];
  const { data, error } = await getSupabase()
    .from("songs")
    .select(SONG_COLS)
    .in("id", ids)
    .eq("release_status", "approved");
  if (error) throw error;
  return (data ?? []) as unknown as Song[];
}

export async function getPlans(): Promise<Plan[]> {
  const { data, error } = await getSupabase()
    .from("plans")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as unknown as Plan[];
}

export interface FeaturedPromo {
  id: string;
  promotion_type: string;
  artist: Artist | null;
}

export async function getFeaturedArtist(): Promise<Artist | null> {
  const { data, error } = await getSupabase()
    .from("promotions")
    .select("id, promotion_type, artist:artists(id,name,slug,bio,avatar_url,verified,monthly_listeners)")
    .eq("status", "active")
    .gt("ends_at", new Date().toISOString())
    .eq("promotion_type", "featured_artist")
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as unknown as FeaturedPromo | undefined;
  return row?.artist ?? null;
}

/** Search songs by title; artist-name matches are merged separately
 *  (PostgREST does not accept embedded filters inside `.or()`). */
export async function searchCatalog(q: string): Promise<{ songs: Song[]; artists: Artist[] }> {
  const supabase = getSupabase();
  const [byTitle, artistsRes] = await Promise.all([
    supabase
      .from("songs")
      .select(SONG_COLS)
      .eq("release_status", "approved")
      .ilike("title", `%${q}%`)
      .limit(20),
    supabase
      .from("artists")
      .select("id,name,slug,bio,avatar_url,region,verified,monthly_listeners")
      .eq("status", "approved")
      .ilike("name", `%${q}%`)
      .limit(10),
  ]);
  if (byTitle.error) throw byTitle.error;
  if (artistsRes.error) throw artistsRes.error;

  const songs = [...((byTitle.data ?? []) as unknown as Song[])];
  const artistIds = (artistsRes.data ?? []).map((a) => a.id);
  if (artistIds.length > 0) {
    const { data, error } = await supabase
      .from("songs")
      .select(SONG_COLS)
      .eq("release_status", "approved")
      .in("artist_id", artistIds)
      .limit(20);
    if (error) throw error;
    const seen = new Set(songs.map((s) => s.id));
    for (const s of (data ?? []) as unknown as Song[]) if (!seen.has(s.id)) songs.push(s);
  }
  return { songs, artists: (artistsRes.data ?? []) as unknown as Artist[] };
}

/* ────────────────────────── Auth-gated writes ─────────────────────────
 * These run only with a Supabase session created by the backend verifying
 * Telegram initData (supabase/functions/telegram-auth). While the auth
 * backend is not deployed, callers stay in guest mode and the UI shows a
 * clear "requires backend" notice instead of pretending to save. */

export async function fetchMyFavorites(): Promise<string[]> {
  const { data, error } = await getSupabase()
    .from("favorites")
    .select("song_id");
  if (error) throw error;
  return (data ?? []).map((r) => (r as { song_id: string }).song_id);
}

export async function addFavoriteDb(songId: string): Promise<void> {
  const { error } = await getSupabase().from("favorites").insert({ song_id: songId });
  if (error) throw error;
}

export async function removeFavoriteDb(songId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("favorites")
    .delete()
    .eq("song_id", songId);
  if (error) throw error;
}

export async function fetchMyPlaylists(): Promise<UserPlaylist[]> {
  const { data, error } = await getSupabase()
    .from("playlists")
    .select("id,title,description,cover_url,is_public,created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as UserPlaylist[];
}

export async function createPlaylistDb(title: string, isPublic: boolean): Promise<void> {
  const { error } = await getSupabase()
    .from("playlists")
    .insert({ title, is_public: isPublic });
  if (error) throw error;
}

export async function logPlay(songId: string): Promise<void> {
  // RLS allows anonymous insert with user_id = null; authenticated users get
  // user_id attached automatically? (No — explicit; session tokens set the
  // role but user_id column is nullable and not defaulted. We pass it when
  // we have a session.)
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user?.id ?? null;
  const { error } = await supabase
    .from("song_plays")
    .insert({ song_id: songId, source: "tma", user_id: uid });
  if (error) console.warn("logPlay failed:", error.message);
}

/* ──────────────────────────── Error type ───────────────────────────── */

export class NotFoundError extends Error {}
