import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission, requireAdmin, getAdminRoles, isSuperAdmin } from "../../middleware/require-admin.js";
import { validate } from "../../middleware/validate.js";
import { writeAudit } from "../../middleware/audit.js";
import { ah } from "../../utils/async-handler.js";
import { HttpError, badRequest, forbidden, notFound, unprocessable } from "../../utils/http-error.js";
import { paginationSchema, pageMeta } from "../../utils/paginate.js";
import { cacheInvalidate } from "../../lib/cache.js";
import { supabaseService } from "../../lib/supabase.js";
import { highestRole, type AdminRole } from "../../lib/rbac.js";
import { enqueueNotification } from "../notifications/notification.service.js";

const router = Router();

// every route below requires a staff identity
router.use(authenticate, requireAdmin());

const uuidParam = z.object({ id: z.string().uuid() });
const userParam = z.object({ userId: z.string().uuid() });

// ─────────────────────────── user administration ─────────────────────────────

/** GET /admin/users — paginated + searchable directory. */
router.get(
  "/users",
  requirePermission("users:manage"),
  validate({
    query: paginationSchema.extend({
      q: z.string().trim().max(80).optional(),
      status: z.enum(["active", "suspended", "all"]).default("active"),
    }),
  }),
  ah(async (req, res) => {
    const { limit, offset, q, status } = req.query as unknown as {
      limit: number;
      offset: number;
      q?: string;
      status: string;
    };
    let query = supabaseService
      .from("profiles")
      .select("id, username, full_name, avatar_url, language_code, is_active, created_at", { count: "exact" });
    if (status !== "all") query = query.eq("is_active", status === "active");
    if (q) query = query.or(`username.ilike.%${q}%,full_name.ilike.%${q}%`);
    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw unprocessable("User directory failed", error.message);
    res.json({ users: data ?? [], pagination: pageMeta(limit, offset, count ?? 0) });
  }),
);

/** PUT /admin/users/:id/status — suspend / reactivate (audit + instant effect). */
router.put(
  "/users/:id/status",
  requirePermission("users:manage"),
  validate({ params: uuidParam, body: z.object({ is_active: z.boolean() }) }),
  ah(async (req, res) => {
    const targetId = req.params.id;
    if (targetId === req.user!.id) {
      throw forbidden("You cannot change your own account status");
    }
    const { data: before } = await supabaseService
      .from("profiles")
      .select("id, is_active")
      .eq("id", targetId)
      .maybeSingle();
    if (!before) throw notFound("User not found");

    const { data, error } = await supabaseService
      .from("profiles")
      .update({ is_active: (req.body as { is_active: boolean }).is_active })
      .eq("id", targetId)
      .select("id, username, is_active")
      .single();
    if (error) throw unprocessable("Status change failed", error.message);

    cacheInvalidate(`profile:${targetId}`);
    writeAudit({
      actorId: req.user!.id,
      actorRole: "admin",
      action: "user.status",
      entityType: "profile",
      entityId: targetId,
      before,
      after: { is_active: (req.body as { is_active: boolean }).is_active },
      req,
    });
    await enqueueNotification({
      userId: targetId,
      type: "system",
      title: (req.body as { is_active: boolean }).is_active
        ? "Account reactivated"
        : "Account suspended",
      body: (req.body as { is_active: boolean }).is_active
        ? "Your ETHIO MUSIC account is active again."
        : "Your account was suspended. Contact support if you think this is a mistake.",
      channel: "in_app",
      dedupKey: `acct-status-${targetId}-${(req.body as { is_active: boolean }).is_active}`,
    });
    res.json({ user: data });
  }),
);

// ─────────────────────────── staff administration ────────────────────────────

const ROLE_VALUES = ["moderator", "admin", "super_admin"] as const;

/** GET /admin/admins — staff roster (admins:manage ⇒ super_admin only). */
router.get(
  "/admins",
  requirePermission("admins:manage"),
  ah(async (_req, res) => {
    const { data, error } = await supabaseService
      .from("admin_roles")
      .select("id, role, created_at, user:profiles!admin_roles_user_id_fkey(id, username, full_name, avatar_url, is_active)");
    if (error) throw unprocessable("Staff roster failed", error.message);
    res.json({ admins: data ?? [] });
  }),
);

/** POST /admin/admins — create a staff account (super_admin only). */
router.post(
  "/admins",
  requirePermission("admins:manage"),
  validate({
    body: z.object({
      email: z.string().email().max(200),
      password: z.string().min(10).max(200),
      full_name: z.string().max(120).optional(),
      role: z.enum(ROLE_VALUES),
    }),
  }),
  ah(async (req, res) => {
    const { email, password, full_name, role } = req.body as {
      email: string;
      password: string;
      full_name?: string;
      role: AdminRole;
    };
    const { data: created, error: createErr } = await supabaseService.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name ?? undefined },
    });
    if (createErr && !String(createErr.message).toLowerCase().includes("already")) {
      throw unprocessable("Admin account creation failed", createErr.message);
    }

    // resolve the (possibly pre-existing) auth user id
    let userId = created?.user?.id ?? null;
    if (!userId) {
      const { data: link } = await supabaseService.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
      userId = link?.user?.id ?? null;
    }
    if (!userId) throw unprocessable("Could not resolve the staff account");

    const { error: roleErr } = await supabaseService
      .from("admin_roles")
      .insert({ user_id: userId, role, granted_by: req.user!.id });
    if (roleErr && roleErr.code !== "23505") {
      throw unprocessable("Role grant failed", roleErr.message);
    }

    writeAudit({
      actorId: req.user!.id,
      actorRole: "super_admin",
      action: "admin.create",
      entityType: "profile",
      entityId: userId,
      after: { email, role },
      req,
    });
    cacheInvalidate(`roles:${userId}`);
    res.status(201).json({ admin: { user_id: userId, email, role } });
  }),
);

/** PUT /admin/admins/:userId/role — grant or change a role. */
router.put(
  "/admins/:userId/role",
  requirePermission("admins:manage"),
  validate({
    params: userParam,
    body: z.object({ role: z.enum(ROLE_VALUES) }),
  }),
  ah(async (req, res) => {
    const targetId = req.params.userId;
    const { role } = req.body as { role: AdminRole };

    // SECURITY: no principal may change its own administrator role.
    if (targetId === req.user!.id) {
      throw forbidden("You cannot change your own administrator role");
    }

    const { data: existing } = await supabaseService
      .from("admin_roles")
      .select("id, role")
      .eq("user_id", targetId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabaseService
        .from("admin_roles")
        .update({ role, granted_by: req.user!.id })
        .eq("id", existing.id);
      if (error) throw unprocessable("Role change failed", error.message);
    } else {
      const { error } = await supabaseService
        .from("admin_roles")
        .insert({ user_id: targetId, role, granted_by: req.user!.id });
      if (error) throw unprocessable("Role grant failed", error.message);
    }

    writeAudit({
      actorId: req.user!.id,
      actorRole: "super_admin",
      action: "admin.role.change",
      entityType: "admin_role",
      entityId: targetId,
      before: existing ?? {},
      after: { role },
      req,
    });
    cacheInvalidate(`roles:${targetId}`);
    res.json({ user_id: targetId, role });
  }),
);

/** DELETE /admin/admins/:userId/role — revoke all staff roles of a user. */
router.delete(
  "/admins/:userId/role",
  requirePermission("admins:manage"),
  validate({ params: userParam }),
  ah(async (req, res) => {
    const targetId = req.params.userId;
    if (targetId === req.user!.id) {
      throw forbidden("You cannot revoke your own administrator role");
    }
    const { data: before } = await supabaseService
      .from("admin_roles")
      .select("id, role")
      .eq("user_id", targetId);
    const { error } = await supabaseService
      .from("admin_roles")
      .delete()
      .eq("user_id", targetId);
    if (error) throw unprocessable("Role revoke failed", error.message);

    writeAudit({
      actorId: req.user!.id,
      actorRole: "super_admin",
      action: "admin.role.revoke",
      entityType: "admin_role",
      entityId: targetId,
      before: before ?? [],
      req,
    });
    cacheInvalidate(`roles:${targetId}`);
    res.status(204).end();
  }),
);

// ─────────────────────────── artist submissions ──────────────────────────────

/** GET /admin/submissions — review queue. */
router.get(
  "/submissions",
  requirePermission("submissions:review"),
  validate({
    query: paginationSchema.extend({
      status: z.enum(["pending", "approved", "rejected"]).default("pending"),
    }),
  }),
  ah(async (req, res) => {
    const { limit, offset, status } = req.query as unknown as {
      limit: number;
      offset: number;
      status: string;
    };
    const { data, error, count } = await supabaseService
      .from("artist_submissions")
      .select(
        `*, artist:artists(id, name, slug, status, verified, owner_id),
         submitter:profiles!artist_submissions_submitted_by_fkey(id, username, full_name)`,
        { count: "exact" },
      )
      .eq("status", status)
      .order("created_at", { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw unprocessable("Submissions query failed", error.message);
    res.json({ submissions: data ?? [], pagination: pageMeta(limit, offset, count ?? 0) });
  }),
);

/** PATCH /admin/submissions/:id — approve/reject; approval publishes the artist. */
router.patch(
  "/submissions/:id",
  requirePermission("submissions:review"),
  validate({
    params: uuidParam,
    body: z.object({
      status: z.enum(["approved", "rejected"]),
      message: z.string().max(1_000).optional(),
    }),
  }),
  ah(async (req, res) => {
    const { status, message } = req.body as { status: "approved" | "rejected"; message?: string };
    const { data: submission } = await supabaseService
      .from("artist_submissions")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();
    if (!submission) throw notFound("Submission not found");

    const { data, error } = await supabaseService
      .from("artist_submissions")
      .update({
        status,
        message: message ?? null,
        reviewed_by: req.user!.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", req.params.id)
      .select("*")
      .single();
    if (error) throw unprocessable("Submission review failed", error.message);

    if (status === "approved" && submission.artist_id) {
      await supabaseService
        .from("artists")
        .update({ status: "approved" })
        .eq("id", submission.artist_id);
      cacheInvalidate("catalog:");
    }

    if (submission.submitted_by) {
      await enqueueNotification({
        userId: submission.submitted_by,
        type: "system",
        title: status === "approved" ? "Artist approved 🎉" : "Artist submission rejected",
        body:
          status === "approved"
            ? "Your artist profile is now live on ETHIO MUSIC."
            : message ?? "Your submission was not approved this time.",
        channel: "in_app",
        dedupKey: `submission-${req.params.id}-${status}`,
      });
    }

    writeAudit({
      actorId: req.user!.id,
      actorRole: "moderator",
      action: "submission.review",
      entityType: "artist_submission",
      entityId: req.params.id,
      before: submission,
      after: { status },
      req,
    });
    res.json({ submission: data });
  }),
);

// ─────────────────────────── audit logs & settings ───────────────────────────

/** GET /admin/audit-logs — filterable, paginated trail. */
router.get(
  "/audit-logs",
  requireAdmin(),
  validate({
    query: paginationSchema.extend({
      actor_id: z.string().uuid().optional(),
      action: z.string().max(60).optional(),
      entity_type: z.string().max(60).optional(),
    }),
  }),
  ah(async (req, res) => {
    const { limit, offset, actor_id, action, entity_type } = req.query as unknown as {
      limit: number;
      offset: number;
      actor_id?: string;
      action?: string;
      entity_type?: string;
    };
    let query = supabaseService
      .from("audit_logs")
      .select("*", { count: "exact" });
    if (actor_id) query = query.eq("actor_id", actor_id);
    if (action) query = query.eq("action", action);
    if (entity_type) query = query.eq("entity_type", entity_type);
    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw unprocessable("Audit log query failed", error.message);
    res.json({ logs: data ?? [], pagination: pageMeta(limit, offset, count ?? 0) });
  }),
);

/** GET /admin/settings — platform configuration (staff-readable). */
router.get(
  "/settings",
  requireAdmin(),
  ah(async (_req, res) => {
    const { data, error } = await supabaseService
      .from("platform_settings")
      .select("*")
      .order("key");
    if (error) throw unprocessable("Settings query failed", error.message);
    res.json({ settings: data ?? [] });
  }),
);

/** PUT /admin/settings — upsert one key (super_admin only). */
router.put(
  "/settings",
  requirePermission("settings:manage"),
  validate({
    body: z.object({
      key: z.string().regex(/^[a-z0-9_]{2,60}$/),
      value: z.union([z.string(), z.number(), z.boolean(), z.record(z.unknown())]),
      description: z.string().max(300).optional(),
    }),
  }),
  ah(async (req, res) => {
    const { key, value, description } = req.body as {
      key: string;
      value: unknown;
      description?: string;
    };
    const { data: before } = await supabaseService
      .from("platform_settings")
      .select("*")
      .eq("key", key)
      .maybeSingle();

    const { data, error } = await supabaseService
      .from("platform_settings")
      .upsert(
        {
          key,
          value: value as object,
          description: description ?? before?.description ?? null,
          updated_by: req.user!.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      )
      .select("*")
      .single();
    if (error) throw unprocessable("Settings update failed", error.message);

    cacheInvalidate("platform_settings");
    writeAudit({
      actorId: req.user!.id,
      actorRole: "super_admin",
      action: "settings.update",
      entityType: "platform_setting",
      entityId: key,
      before: before ?? {},
      after: { key, value },
      req,
    });
    res.json({ setting: data });
  }),
);

export const adminRouter = router;
void badRequest;
void highestRole;
void HttpError;
