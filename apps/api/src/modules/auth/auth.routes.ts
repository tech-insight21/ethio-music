import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { authenticate } from "../../middleware/authenticate.js";
import { authLimiter } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { getAdminRoles } from "../../middleware/require-admin.js";
import { ah } from "../../utils/async-handler.js";
import { HttpError, unauthorized } from "../../utils/http-error.js";
import { botToken, tgDisplayName } from "../../lib/telegram.js";
import { getEntitlement } from "../../lib/entitlement.js";
import { logger } from "../../lib/logger.js";
import { supabaseAnon, supabaseService } from "../../lib/supabase.js";
import {
  ensureTelegramUser,
  linkBotChat,
  mintSession,
  refreshSession,
  registerSession,
  revokeAllSessions,
  revokeRefreshToken,
  tgEmail,
} from "./auth.service.js";
import { verifyInitData } from "./telegram-initdata.js";

const router = Router();

const telegramAuthSchema = z.object({
  initData: z.string().min(20).max(8_192),
});

const adminLoginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(6).max(200),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(10).max(1_000),
});

const logoutSchema = z.object({
  refresh_token: z.string().min(10).max(1_000),
});

const idParam = z.object({ id: z.string().uuid() });

/**
 * POST /api/v1/auth/telegram
 * Telegram Mini App login. The RAW initData is validated with the official
 * HMAC algorithm; client-provided identity fields are never trusted alone.
 */
router.post(
  "/telegram",
  authLimiter,
  validate({ body: telegramAuthSchema }),
  ah(async (req, res) => {
    const verified = verifyInitData(
      req.body.initData,
      botToken(),
      env.TG_INITDATA_MAX_AGE,
    );
    if (!verified.ok) {
      logger.warn({ reason: verified.reason }, "initdata_rejected");
      throw new HttpError(
        401,
        "invalid_initdata",
        `initData verification failed: ${verified.reason}`,
      );
    }

    const profile = await ensureTelegramUser(verified.user);
    const session = await mintSession(tgEmail(verified.user.id));
    await registerSession(profile.id, session.refresh_token, req);
    await linkBotChat(verified.user, profile.id);

    res.json({
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        token_type: session.token_type ?? "bearer",
        expires_in: session.expires_in ?? 3_600,
        user: {
          id: session.user.id,
          email: session.user.email ?? tgEmail(verified.user.id),
        },
      },
      profile: {
        id: profile.id,
        username: profile.username,
        full_name: profile.full_name,
        avatar_url: profile.avatar_url,
        language_code: profile.language_code,
        telegram_display_name: tgDisplayName(verified.user),
      },
    });
  }),
);

/**
 * POST /api/v1/auth/admin/login
 * Staff login: Supabase password auth + live `admin_roles` check.
 */
router.post(
  "/admin/login",
  authLimiter,
  validate({ body: adminLoginSchema }),
  ah(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    const { data, error } = await supabaseAnon.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data?.session) throw unauthorized("Invalid credentials");

    const roles = await getAdminRoles(data.user.id);
    if (roles.length === 0) {
      throw new HttpError(403, "not_staff", "This account does not have staff access");
    }
    await registerSession(data.user.id, data.session.refresh_token, req);

    res.json({
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        token_type: data.session.token_type ?? "bearer",
        expires_in: data.session.expires_in ?? 3_600,
        user: { id: data.user.id, email: data.user.email ?? email },
      },
      roles,
    });
  }),
);

/** POST /api/v1/auth/refresh — rotate a refresh token. */
router.post(
  "/refresh",
  authLimiter,
  validate({ body: refreshSchema }),
  ah(async (req, res) => {
    const oldToken = (req.body as { refresh_token: string }).refresh_token;
    const session = await refreshSession(oldToken);
    await registerSession(session.user.id, session.refresh_token, req);
    // Supabase rotation already invalidated the old token server-side;
    // only our local registry row needs marking.
    await revokeRefreshToken(oldToken);
    res.json({
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        token_type: session.token_type ?? "bearer",
        expires_in: session.expires_in ?? 3_600,
      },
    });
  }),
);

/** POST /api/v1/auth/logout — revoke the given session. */
router.post(
  "/logout",
  authenticate,
  validate({ body: logoutSchema }),
  ah(async (req, res) => {
    await revokeRefreshToken(
      (req.body as { refresh_token: string }).refresh_token,
      req.user!.token,
    );
    res.status(204).end();
  }),
);

/** GET /api/v1/auth/me — profile, staff roles and premium entitlement. */
router.get(
  "/me",
  authenticate,
  ah(async (req, res) => {
    const user = req.user!;
    const [roles, entitlement] = await Promise.all([
      getAdminRoles(user.id),
      getEntitlement(user.id),
    ]);
    res.json({
      user: {
        id: user.profile.id,
        email: user.email,
        username: user.profile.username,
        full_name: user.profile.full_name,
        avatar_url: user.profile.avatar_url,
        language_code: user.profile.language_code,
        country: user.profile.country,
        created_at: user.profile.created_at,
      },
      roles,
      entitlement,
    });
  }),
);

/** GET /api/v1/auth/sessions — list the caller's active sessions. */
router.get(
  "/sessions",
  authenticate,
  ah(async (req, res) => {
    const { data, error } = await supabaseService
      .from("user_sessions")
      .select("id, user_agent, ip, created_at, expires_at")
      .eq("user_id", req.user!.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new HttpError(500, "sessions_query_failed", error.message);
    res.json({ sessions: data ?? [] });
  }),
);

/** DELETE /api/v1/auth/sessions — revoke ALL sessions of the caller. */
router.delete(
  "/sessions",
  authenticate,
  ah(async (req, res) => {
    await revokeAllSessions(req.user!.id);
    res.status(204).end();
  }),
);

/** DELETE /api/v1/auth/sessions/:id — revoke one session (ownership enforced). */
router.delete(
  "/sessions/:id",
  authenticate,
  validate({ params: idParam }),
  ah(async (req, res) => {
    const { data, error } = await supabaseService
      .from("user_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .eq("user_id", req.user!.id)
      .is("revoked_at", null)
      .select("id");
    if (error) throw new HttpError(500, "session_revoke_failed", error.message);
    if (!data?.length) throw new HttpError(404, "not_found", "Session not found or already revoked");
    res.status(204).end();
  }),
);

export const authRoutes = router;
