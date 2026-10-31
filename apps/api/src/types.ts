import type { SupabaseClient } from "@supabase/supabase-js";
import type { Request } from "express";

export interface ProfileRow {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  language_code: "am" | "om" | "ti" | "en";
  country: string;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthUser {
  id: string;
  email: string | null;
  profile: ProfileRow;
  token: string;
}

declare module "express-serve-static-core" {
  interface Request {
    /** correlation id */
    id?: string;
    /** authenticated principal (set by authenticate middleware) */
    user?: AuthUser;
    /** Supabase client scoped to the caller's JWT (RLS enforced) */
    db?: SupabaseClient;
  }
}
