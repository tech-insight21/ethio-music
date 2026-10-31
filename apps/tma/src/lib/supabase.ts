import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://trhfksuskfgvlmwzzsyu.supabase.co";

const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

/**
 * Client-side Supabase instance.
 *
 * SECURITY: only the publishable/anon key is used here. It is safe to expose
 * in the browser because every table is protected by Row Level Security.
 * The service-role key NEVER appears in this app.
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!key) throw new Error("Missing NEXT_PUBLIC publishable/anon key");
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export const SUPABASE_URL = url;

/* ── Types matching the database schema ─────────────────────────────── */

export interface Artist {
  id: string;
  name: string;
  slug: string;
  avatar_url: string | null;
  verified: boolean;
  monthly_listeners: number;
}

export interface Genre {
  id: string;
  name: string;
  slug: string;
}

export interface Song {
  id: string;
  title: string;
  slug: string;
  audio_url: string;
  cover_url: string | null;
  duration_seconds: number;
  play_count: number;
  artist: Artist | null;
  genres: { genres: Genre | null }[];
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

export interface FeaturedPromotion {
  id: string;
  promotion_type: string;
  artist: Artist | null;
}
