import { randomBytes } from "node:crypto";
import { supabaseAnon, supabaseService } from "../../lib/supabase.js";
import { cacheGet, cacheSet, cacheInvalidate } from "../../lib/cache.js";
import { notFound } from "../../utils/http-error.js";

/** Shared catalog data-access helpers (public reads cached, admin writes). */

export const SONG_SELECT = `*, artist:artists(id,name,slug,verified,avatar_url), album:albums(id,title,slug,cover_url), genres:song_genres(genre:genres(id,name,slug))`;
export const ALBUM_SELECT = `*, artist:artists(id,name,slug,verified,avatar_url)`;
export const ARTIST_SELECT = `*`;

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "item";
}

/** Generate a unique slug by probing the table; appends a random suffix on clash. */
export async function uniqueSlug(
  table: "songs" | "albums" | "artists" | "genres" | "playlists",
  base: string,
): Promise<string> {
  const root = slugify(base);
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? root : `${root}-${randomBytes(2).toString("hex")}`;
    const { data } = await supabaseService.from(table).select("id").eq("slug", candidate).limit(1);
    if (!data?.length) return candidate;
  }
  return `${root}-${randomBytes(4).toString("hex")}`;
}

export async function invalidateCatalogCache(): Promise<void> {
  cacheInvalidate("catalog:");
}

interface CatalogRow {
  id: string;
  slug: string;
}

export interface SongRef extends CatalogRow {
  release_status: string;
}
export interface ArtistRef extends CatalogRow {
  status: string;
  owner_id: string | null;
}

/** Resolve a song by uuid or slug (approved or staff-visible handled by caller). */
export async function findSong(idOrSlug: string): Promise<SongRef> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  const col = isUuid ? "id" : "slug";
  const { data, error } = await supabaseService
    .from("songs")
    .select("id, slug, release_status")
    .eq(col, idOrSlug)
    .maybeSingle();
  if (error || !data) throw notFound("Song not found");
  return data as SongRef;
}

export async function findArtist(idOrSlug: string): Promise<ArtistRef> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  const col = isUuid ? "id" : "slug";
  const { data, error } = await supabaseService
    .from("artists")
    .select("id, slug, status, owner_id")
    .eq(col, idOrSlug)
    .maybeSingle();
  if (error || !data) throw notFound("Artist not found");
  return data as ArtistRef;
}

export async function findAlbum(idOrSlug: string): Promise<CatalogRow> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  const col = isUuid ? "id" : "slug";
  const { data, error } = await supabaseService
    .from("albums")
    .select("id, slug")
    .eq(col, idOrSlug)
    .maybeSingle();
  if (error || !data) throw notFound("Album not found");
  return data as CatalogRow;
}

/** Cached fetch helper for public catalog reads (anon client ⇒ RLS applies). */
export async function cachedPublic<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const hit = cacheGet<T>(`catalog:${key}`);
  if (hit !== undefined) return hit;
  const value = await fetcher();
  cacheSet(`catalog:${key}`, value, ttlMs);
  return value;
}

export { supabaseAnon, supabaseService };
