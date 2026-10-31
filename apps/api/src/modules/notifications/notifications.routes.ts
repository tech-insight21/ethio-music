import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/require-admin.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/async-handler.js";
import { notFound, unprocessable } from "../../utils/http-error.js";
import { paginationSchema, pageMeta } from "../../utils/paginate.js";
import { pgQuery } from "../../lib/pg.js";
import { supabaseService } from "../../lib/supabase.js";
import { enqueueNotification } from "./notification.service.js";

const router = Router();

/** GET /notifications — the caller's in-app inbox (RLS: own rows). */
router.get(
  "/",
  authenticate,
  validate({ query: paginationSchema.extend({ unread: z.enum(["true", "false"]).optional() }) }),
  ah(async (req, res) => {
    const { limit, offset, unread } = req.query as unknown as {
      limit: number;
      offset: number;
      unread?: string;
    };
    let q = req.db!.from("notifications").select("*", { count: "exact" });
    if (unread === "true") q = q.is("read_at", null);
    const { data, error, count } = await q
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw unprocessable("Notifications query failed", error.message);
    res.json({
      notifications: data ?? [],
      unread_count: (data ?? []).filter((n: { read_at: string | null }) => !n.read_at).length,
      pagination: pageMeta(limit, offset, count ?? 0),
    });
  }),
);

router.use(authenticate);

/** POST /notifications/:id/read */
router.post(
  "/:id/read",
  validate({ params: z.object({ id: z.string().uuid() }) }),
  ah(async (req, res) => {
    const { error } = await req.db!
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .is("read_at", null);
    if (error) throw unprocessable("Mark read failed", error.message);
    res.status(204).end();
  }),
);

/** POST /notifications/read-all */
router.post(
  "/read-all",
  ah(async (req, res) => {
    const { error } = await req.db!
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", req.user!.id)
      .is("read_at", null);
    if (error) throw unprocessable("Mark all read failed", error.message);
    res.status(204).end();
  }),
);

/** DELETE /notifications/:id */
router.delete(
  "/:id",
  validate({ params: z.object({ id: z.string().uuid() }) }),
  ah(async (req, res) => {
    await req.db!.from("notifications").delete().eq("id", req.params.id);
    res.status(204).end();
  }),
);

/** GET /notifications/telegram — link status + Telegram-side preferences. */
router.get(
  "/telegram",
  ah(async (req, res) => {
    const rows = await pgQuery(
      `select chat_id, username, notify_new_releases, notify_premium, is_blocked
         from bot_chats where user_id = $1 limit 1`,
      [req.user!.id],
    );
    const chat = rows[0];
    res.json({
      linked: !!chat,
      chat_id: chat?.chat_id ?? null,
      username: chat?.username ?? null,
      preferences: {
        notify_new_releases: chat?.notify_new_releases ?? true,
        notify_premium: chat?.notify_premium ?? true,
      },
      bot_blocked: chat?.is_blocked ?? false,
    });
  }),
);

/** PUT /notifications/telegram — update Telegram notification preferences. */
router.put(
  "/telegram",
  validate({
    body: z
      .object({
        notify_new_releases: z.boolean().optional(),
        notify_premium: z.boolean().optional(),
      })
      .refine((v) => Object.keys(v).length > 0, { message: "Empty update" }),
  }),
  ah(async (req, res) => {
    const body = req.body as { notify_new_releases?: boolean; notify_premium?: boolean };
    const rows = await pgQuery(
      `update bot_chats
          set notify_new_releases = coalesce($2, notify_new_releases),
              notify_premium = coalesce($3, notify_premium),
              updated_at = now()
        where user_id = $1
        returning chat_id, notify_new_releases, notify_premium`,
      [req.user!.id, body.notify_new_releases ?? null, body.notify_premium ?? null],
    );
    if (rows.length === 0) throw notFound("No linked Telegram chat — open the bot first");
    res.json({
      preferences: {
        notify_new_releases: rows[0].notify_new_releases,
        notify_premium: rows[0].notify_premium,
      },
    });
  }),
);

// ───────────────────────────── admin sending ─────────────────────────────────

export const adminNotificationsRouter = (() => {
  const r = Router();
  r.use(authenticate, requirePermission("notifications:send"));

  /** POST /admin/notifications/broadcast — to opted-in Telegram chats + in-app. */
  r.post(
    "/broadcast",
    validate({
      body: z.object({
        title: z.string().min(1).max(200),
        body: z.string().max(1_000).optional(),
        only_premium_optin: z.boolean().default(false),
      }),
    }),
    ah(async (req, res) => {
      const { title, body, only_premium_optin } = req.body as {
        title: string;
        body?: string;
        only_premium_optin: boolean;
      };
      const rows = await pgQuery<{ chat_id: string; user_id: string | null }>(
        `select chat_id, user_id from bot_chats
          where not is_blocked and ($1 = false or notify_premium)
          limit 2000`,
        [only_premium_optin],
      );
      let queued = 0;
      for (const row of rows) {
        if (row.user_id) {
          const result = await enqueueNotification({
            userId: row.user_id,
            type: "system",
            title,
            body,
            channel: "both",
          });
          if (result.queued) queued++;
        } else {
          // unlinked chat — direct push (already opted into the bot)
          const { tgSendMessage } = await import("../../lib/telegram.js");
          await tgSendMessage(Number(row.chat_id), `<b>${title}</b>${body ? `\n${body}` : ""}`).catch(
            () => undefined,
          );
          queued++;
        }
      }
      res.json({ recipients: rows.length, queued });
    }),
  );

  /** POST /admin/notifications/send — one user. */
  r.post(
    "/send",
    validate({
      body: z.object({
        user_id: z.string().uuid(),
        title: z.string().min(1).max(200),
        body: z.string().max(1_000).optional(),
        dedup_key: z.string().max(120).optional(),
      }),
    }),
    ah(async (req, res) => {
      const b = req.body as { user_id: string; title: string; body?: string; dedup_key?: string };
      const { data: profile } = await supabaseService
        .from("profiles")
        .select("id")
        .eq("id", b.user_id)
        .maybeSingle();
      if (!profile) throw notFound("User not found");
      const result = await enqueueNotification({
        userId: b.user_id,
        type: "system",
        title: b.title,
        body: b.body,
        dedupKey: b.dedup_key,
        channel: "both",
      });
      res.json(result);
    }),
  );
  return r;
})();

export const notificationsRouter = router;
