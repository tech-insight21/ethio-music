import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

/**
 * Supabase clients.
 *  - anon:    public, RLS-protected reads (same key the Mini App ships)
 *  - service: server-side only — NEVER exposed to any client
 *  - asUser:  per-request client carrying the caller's JWT so RLS applies
 */
const authOpts = { persistSession: false, autoRefreshToken: false } as const;

export const supabaseAnon: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  { auth: authOpts },
);

export const supabaseService: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: authOpts },
);

/** Client that executes queries under the user's own RLS identity. */
export function supabaseAsUser(accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: authOpts,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
