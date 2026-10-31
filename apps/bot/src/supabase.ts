import { createClient } from "@supabase/supabase-js";

/**
 * Bot-side Supabase client.
 *
 * SECURITY: the bot uses the PUBLIC anon key and depends on RLS — it can only
 * ever read 'approved' content. The service-role key is NOT used here.
 */
export const supabase = createClient(
  process.env.SUPABASE_URL ?? "https://trhfksuskfgvlmwzzsyu.supabase.co",
  process.env.SUPABASE_ANON_KEY ?? "",
  { auth: { persistSession: false } }
);

export interface CatalogSong {
  id: string;
  title: string;
  slug: string;
  duration_seconds: number;
  play_count: number;
  artist: { name: string; slug: string } | null;
}

export async function searchSongs(query: string, limit = 5): Promise<CatalogSong[]> {
  const { data, error } = await supabase
    .from("songs")
    .select("id, title, slug, duration_seconds, play_count, artist:artists(name, slug)")
    .eq("release_status", "approved")
    .or(`title.ilike.%${query}%,artists.name.ilike.%${query}%`)
    .order("play_count", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as CatalogSong[];
}

export async function topSongs(limit = 5): Promise<CatalogSong[]> {
  const { data, error } = await supabase
    .from("songs")
    .select("id, title, slug, duration_seconds, play_count, artist:artists(name, slug)")
    .eq("release_status", "approved")
    .order("play_count", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as CatalogSong[];
}

export interface CatalogPlan {
  id: string;
  name: string;
  name_am: string | null;
  price_etb: number;
  duration_days: number;
  description: string | null;
}

export async function listPlans(): Promise<CatalogPlan[]> {
  const { data, error } = await supabase
    .from("plans")
    .select("id, name, name_am, price_etb, duration_days, description")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as unknown as CatalogPlan[];
}
