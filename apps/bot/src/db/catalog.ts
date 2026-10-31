import { createClient } from "@supabase/supabase-js";
import type { Config } from "../config.js";

/**
 * Music catalog access — the SAME backend the Telegram Mini App uses:
 * the Supabase REST API with the public anon/publishable key, protected by
 * RLS (only 'approved' releases are visible). The bot can never read
 * non-approved content and cannot touch user data. No service role here.
 */

let client: ReturnType<typeof createClient> | null = null;

export function initCatalog(cfg: Config): void {
  client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: false },
  });
}

function sb(): ReturnType<typeof createClient> {
  if (!client) throw new Error("Catalog client not initialised — call initCatalog()");
  return client;
}

// ── types ────────────────────────────────────────────────────────────────────

export interface CatalogSong {
  id: string;
  title: string;
  duration_seconds: number;
  play_count: number;
  cover_url: string | null;
  created_at: string;
  artist: { id: string; name: string; slug: string } | null;
  album: { title: string } | null;
}

export interface CatalogArtist {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  region: string | null;
  verified: boolean;
  monthly_listeners: number;
  avatar_url: string | null;
}

export interface CatalogPlan {
  id: string;
  code: string;
  name: string;
  name_am: string | null;
  price_etb: number;
  duration_days: number;
  description: string | null;
}

const SONG_COLS = `id, title, duration_seconds, play_count, cover_url, created_at,
  artist:artists(id, name, slug), album:albums(title)`;

// ── songs ────────────────────────────────────────────────────────────────────

export async function topSongs(limit = 5, offset = 0): Promise<CatalogSong[]> {
  const { data, error } = await sb()
    .from("songs")
    .select(SONG_COLS)
    .eq("release_status", "approved")
    .order("play_count", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as unknown as CatalogSong[];
}

export async function latestSongs(limit = 5, offset = 0): Promise<CatalogSong[]> {
  const { data, error } = await sb()
    .from("songs")
    .select(SONG_COLS)
    .eq("release_status", "approved")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as unknown as CatalogSong[];
}

/** Approved songs created after `since` — feeds the notification engine. */
export async function songsSince(since: Date, limit = 25): Promise<CatalogSong[]> {
  const { data, error } = await sb()
    .from("songs")
    .select(SONG_COLS)
    .eq("release_status", "approved")
    .gt("created_at", since.toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as CatalogSong[];
}

export async function newestApprovedAt(): Promise<Date | null> {
  const { data, error } = await sb()
    .from("songs")
    .select("created_at")
    .eq("release_status", "approved")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{ created_at: string }>;
  return rows[0]?.created_at ? new Date(rows[0].created_at) : null;
}

/**
 * Search songs by title. PostgREST does not accept embedded-resource filters
 * inside .or() (artist matches), so title and artist runs run as two queries
 * and merge — the same workaround the mini app uses.
 */
export async function searchSongs(q: string, limit = 8): Promise<CatalogSong[]> {
  const [byTitle, byArtistName] = await Promise.all([
    sb()
      .from("songs")
      .select(SONG_COLS)
      .eq("release_status", "approved")
      .ilike("title", `%${q}%`)
      .order("play_count", { ascending: false })
      .limit(limit),
    sb().from("artists").select("id").ilike("name", `%${q}%`).limit(limit),
  ]);
  if (byTitle.error) throw byTitle.error;

  const merged: CatalogSong[] = [...((byTitle.data ?? []) as unknown as CatalogSong[])];
  const seen = new Set(merged.map((s) => s.id));

  const artistIds = ((byArtistName.data ?? []) as unknown as Array<{ id: string }>).map(
    (a) => a.id,
  );
  if (artistIds.length > 0) {
    const { data, error } = await sb()
      .from("songs")
      .select(SONG_COLS)
      .eq("release_status", "approved")
      .in("artist_id", artistIds)
      .order("play_count", { ascending: false })
      .limit(limit);
    if (error) throw error;
    for (const s of (data ?? []) as unknown as CatalogSong[]) {
      if (!seen.has(s.id)) merged.push(s);
    }
  }
  return merged.slice(0, limit);
}

// ── artists ──────────────────────────────────────────────────────────────────

export async function listArtists(limit = 5, offset = 0): Promise<CatalogArtist[]> {
  const { data, error } = await sb()
    .from("artists")
    .select(
      "id, name, slug, bio, region, verified, monthly_listeners, avatar_url",
    )
    .eq("status", "approved")
    .order("monthly_listeners", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as unknown as CatalogArtist[];
}

export async function getArtist(id: string): Promise<CatalogArtist | null> {
  const { data, error } = await sb()
    .from("artists")
    .select("id, name, slug, bio, region, verified, monthly_listeners, avatar_url")
    .eq("id", id)
    .eq("status", "approved")
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as CatalogArtist) ?? null;
}

export async function searchArtists(q: string, limit = 3): Promise<CatalogArtist[]> {
  const { data, error } = await sb()
    .from("artists")
    .select("id, name, slug, bio, region, verified, monthly_listeners, avatar_url")
    .eq("status", "approved")
    .ilike("name", `%${q}%`)
    .order("monthly_listeners", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as CatalogArtist[];
}

export async function artistTopSongs(artistId: string, limit = 5): Promise<CatalogSong[]> {
  const { data, error } = await sb()
    .from("songs")
    .select(SONG_COLS)
    .eq("release_status", "approved")
    .eq("artist_id", artistId)
    .order("play_count", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as CatalogSong[];
}

/**
 * Follower counts from the APP side (public counts, anon-readable).
 * Bot-side follows live in bot_follows and are added by the caller.
 */
export async function appFollowerCount(artistId: string): Promise<number> {
  const { count, error } = await sb()
    .from("follows")
    .select("*", { count: "exact", head: true })
    .eq("artist_id", artistId);
  if (error) throw error;
  return count ?? 0;
}

// ── plans ────────────────────────────────────────────────────────────────────

export async function listPlans(): Promise<CatalogPlan[]> {
  const { data, error } = await sb()
    .from("plans")
    .select("id, code, name, name_am, price_etb, duration_days, description")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as unknown as CatalogPlan[];
}

/** Head counts for /admin. */
export async function catalogCounts(): Promise<{ artists: number; songs: number }> {
  const [a, s] = await Promise.all([
    sb().from("artists").select("*", { count: "exact", head: true }).eq("status", "approved"),
    sb().from("songs").select("*", { count: "exact", head: true }).eq("release_status", "approved"),
  ]);
  if (a.error) throw a.error;
  if (s.error) throw s.error;
  return { artists: a.count ?? 0, songs: s.count ?? 0 };
}
