/**
 * Permission model for staff accounts. Roles live in `admin_roles`
 * (moderator | admin | super_admin) and are re-checked live on every
 * privileged request — revoked staff lose access within the cache TTL.
 */
export type AdminRole = "moderator" | "admin" | "super_admin";

export const PERMISSIONS = [
  "catalog:write",
  "artists:review",
  "submissions:review",
  "users:manage",
  "payments:read",
  "finance:manage",
  "promotions:manage",
  "notifications:send",
  "analytics:read",
  "admins:manage",
  "settings:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MODERATOR: Permission[] = [
  "catalog:write",
  "artists:review",
  "submissions:review",
];

const ADMIN: Permission[] = [
  ...MODERATOR,
  "users:manage",
  "payments:read",
  "finance:manage",
  "promotions:manage",
  "notifications:send",
  "analytics:read",
];

export function permissionsFor(role: AdminRole): Permission[] | ["*"] {
  switch (role) {
    case "moderator":
      return MODERATOR;
    case "admin":
      return ADMIN;
    case "super_admin":
      return ["*"];
  }
}

export function hasPermission(roles: AdminRole[], perm: Permission): boolean {
  return roles.some((r) => {
    const perms = permissionsFor(r);
    return perms[0] === "*" || (perms as Permission[]).includes(perm);
  });
}

export function highestRole(roles: AdminRole[]): AdminRole | null {
  if (roles.includes("super_admin")) return "super_admin";
  if (roles.includes("admin")) return "admin";
  if (roles.includes("moderator")) return "moderator";
  return null;
}
