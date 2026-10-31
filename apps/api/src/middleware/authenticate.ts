import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import type { ProfileRow } from "../types.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { supabaseAsUser, supabaseService } from "../lib/supabase.js";
import { cacheGet, cacheSet } from "../lib/cache.js";
import { forbidden, unauthorized } from "../utils/http-error.js";

/**
 * Verifies the Supabase access token (HS256, locally, no network hop) and
 * loads the profile. Falls back to the network Auth API when local
 * verification is impossible (e.g. asymmetric signing keys).
 * Identity comes ONLY from the verified token — never from the body.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next(unauthorized());
  const token = header.slice("Bearer ".length).trim();
  if (token.length < 20) return next(unauthorized());

  let sub: string | undefined;
  let email: string | null = null;

  const cacheKey = `jwt:${token.slice(-24)}`;
  const cached = cacheGet<{ sub: string; email: string | null }>(cacheKey);
  if (cached) {
    sub = cached.sub;
    email = cached.email;
  } else {
    try {
      const decoded = jwt.verify(token, env.SUPABASE_JWT_SECRET, {
        algorithms: ["HS256"],
      }) as { sub?: string; email?: string };
      if (!decoded.sub) throw new jwt.JsonWebTokenError("missing sub");
      sub = decoded.sub;
      email = decoded.email ?? null;
    } catch (localErr) {
      // Network fallback for projects using asymmetric signing keys.
      const { data, error } = await supabaseService.auth.getUser(token);
      if (error || !data?.user) {
        logger.debug(
          { err: localErr instanceof Error ? localErr.message : "?" },
          "auth_token_rejected",
        );
        return next(unauthorized("Invalid or expired session token"));
      }
      sub = data.user.id;
      email = data.user.email ?? null;
    }
    cacheSet(cacheKey, { sub, email }, 600_000); // ≤ token lifetime bound
  }

  // Profile (10 s cache — suspensions take effect quickly).
  const profileKey = `profile:${sub}`;
  let profile = cacheGet<ProfileRow>(profileKey);
  if (!profile) {
    const { data, error } = await supabaseService
      .from("profiles")
      .select("*")
      .eq("id", sub)
      .maybeSingle();
    if (error || !data) return next(unauthorized("Account profile not found"));
    profile = data as ProfileRow;
    cacheSet(profileKey, profile, 10_000);
  }

  if (!profile.is_active) {
    return next(forbidden("This account has been suspended"));
  }

  req.user = { id: sub, email, profile, token };
  req.db = supabaseAsUser(token);
  next();
}

/** Optional auth: attach the user when a valid token is present, else pass. */
export async function attachOptionalUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.headers.authorization?.startsWith("Bearer ")) return next();
  return authenticate(req, res, (err?) => (err ? next() : next()));
}
