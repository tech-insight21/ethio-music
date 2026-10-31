import { supabaseService } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";
import { pgQuery } from "../../lib/pg.js";

/**
 * Notification enqueue layer.
 *
 *  • `dedup_key` + the UNIQUE partial index on (user_id, dedup_key) makes
 *    duplicate notifications impossible at the DB level — whichever process
 *    (API worker, bot cron, scheduler) claims first wins.
 *  • Telegram delivery is resolved by the worker via bot_chats (chat_id,
 *    notification preferences). channel='both' stores one row delivered
 *    in-app AND pushed to Telegram.
 */

export type NotificationType =
  | "new_release"
  | "subscription"
  | "payment"
  | "promotion"
  | "follow"
  | "system";

export type NotificationChannel = "in_app" | "telegram" | "both";

export interface EnqueueInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  /** unique per (user, key) — skips the insert silently when replayed */
  dedupKey?: string;
  channel?: NotificationChannel;
  sendAt?: Date;
}

export interface EnqueueResult {
  queued: boolean;
  id?: string;
}

export async function enqueueNotification(input: EnqueueInput): Promise<EnqueueResult> {
  const { userId, type, title, body, data, dedupKey, channel = "in_app", sendAt } = input;

  const payload = {
    user_id: userId,
    type,
    title: title.slice(0, 200),
    body: body?.slice(0, 1_000) ?? null,
    data: (data ?? {}) as object,
    status: "pending" as const,
    channel,
    send_at: (sendAt ?? new Date()).toISOString(),
    dedup_key: dedupKey ?? null,
  };

  try {
    if (dedupKey) {
      const rows = await pgQuery<{ id: string }>(
        `insert into notifications (user_id, type, title, body, data, status, channel, send_at, dedup_key)
         values ($1, $2::public.notification_type, $3, $4, $5::jsonb, 'pending', $6::public.notif_channel, $7, $8)
         on conflict (user_id, dedup_key) where dedup_key is not null do nothing
         returning id`,
        [
          userId,
          type,
          payload.title,
          payload.body,
          JSON.stringify(payload.data),
          channel,
          payload.send_at,
          dedupKey,
        ],
      );
      if (rows.length === 0) return { queued: false };
      return { queued: true, id: rows[0].id };
    }
    const { data, error } = await supabaseService.from("notifications").insert(payload).select("id").single();
    if (error) throw error;
    return { queued: true, id: (data as { id: string }).id };
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : err, userId, type, dedupKey },
      "notification_enqueue_failed",
    );
    return { queued: false };
  }
}

/** Fan-out helper: enqueue for many users with a per-user dedup key. */
export async function enqueueMany(
  userIds: string[],
  build: (userId: string) => EnqueueInput,
): Promise<{ queued: number; skipped: number }> {
  let queued = 0;
  let skipped = 0;
  for (const userId of userIds) {
    const result = await enqueueNotification(build(userId));
    if (result.queued) queued++;
    else skipped++;
  }
  return { queued, skipped };
}
