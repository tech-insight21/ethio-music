import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { cacheGet, cacheSet } from "../lib/cache.js";
import { supabaseService } from "../lib/supabase.js";
import { hasPermission, type AdminRole, type Permission } from "../lib/rbac.js";
import { forbidden } from "../utils/http-error.js";

/**
 * RBAC middleware. Roles are read from `admin_roles` through the service
 * client (bypassing RLS by design) with a short TTL cache. Live re-checks
 * mean revoked roles expire within seconds.
 */

export async function getAdminRoles(userId: string): Promise<AdminRole[]> {
  const key = `roles:${userId}`;
  const cached = cacheGet<AdminRole[]>(key);
  if (cached) return cached;

  const { data, error } = await supabaseService
    .from("admin_roles")
    .select("role")
    .eq("user_id", userId);

  const roles = error ? [] : ((data ?? []).map((r) => r.role as AdminRole));
  cacheSet(key, roles, 30_000);
  return roles;
}

export function invalidateAdminRoles(userId?: string): void {
  if (userId) cacheSet(`roles:${userId}`, [], 0);
  else cacheSet("roles:*", [], 0); // callers may clear broadly via cacheInvalidate
}

/** Requires ANY staff role. */
export function requireAdmin() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) return next(forbidden("Administrator access required"));
    const roles = await getAdminRoles(req.user.id);
    if (roles.length === 0) return next(forbidden("Administrator access required"));
    next();
  };
}

/** Requires a specific permission (see lib/rbac.ts matrix). */
export function requirePermission(perm: Permission) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) return next(forbidden("Administrator access required"));
    const roles = await getAdminRoles(req.user.id);
    if (!hasPermission(roles, perm)) {
      return next(forbidden(`Missing permission: ${perm}`));
    }
    next();
  };
}

export async function isSuperAdmin(userId: string): Promise<boolean> {
  const roles = await getAdminRoles(userId);
  return roles.includes("super_admin");
}

/** Maintenance mode: reject non-staff traffic when platform flag is set. */
export async function maintenanceGate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const settings = cacheGet<Record<string, unknown>>("platform_settings");
  let mode = settings?.maintenance_mode;
  if (mode === undefined) {
    const { data } = await supabaseService
      .from("platform_settings")
      .select("value")
      .eq("key", "maintenance_mode")
      .maybeSingle();
    mode = (data?.value as boolean) ?? false;
    cacheSet("platform_settings", { ...(settings ?? {}), maintenance_mode: mode }, 60_000);
  }
  if (mode === true) {
    if (req.user && (await getAdminRoles(req.user.id)).length > 0) return next();
    return next(
      forbidden(
        `${env.NODE_ENV === "production" ? "Service" : "API"} is in maintenance mode`,
      ),
    );
  }
  next();
}
