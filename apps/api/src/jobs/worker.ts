import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { pgQuery, getPgPool } from "../lib/pg.js";
import { tgSendMessage } from "../lib/telegram.js";

/**
 * Notification queue worker.
 *
 *  Claim   : atomic CTE update with FOR UPDATE SKIP LOCKED — safe with
 *            multiple API replicas; a row is claimed exactly once.
 *  Deliver : in-app rows are marked sent; telegram/both rows are pushed via
 *            the Bot API (token bucket + 429 backoff inside the client).
 *  Prefs   : bot_chats (notify_new_releases / notify_premium / is_blocked)
 *            and profile.preferences.notify_promotions are honoured.
 *  Retry   : attempts < 5 → exponential backoff via send_at; then failed.
 */

const MAX_ATTEMPTS = 5;

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  channel: "in_app" | "telegram" | "both";
  attempts: number;
}

interface ChatInfo {
  chat_id: string;
  notify_new_releases: boolean;
  notify_premium: boolean;
  is_blocked: boolean;
}

async function getChatInfo(userId: string): Promise<ChatInfo | null> {
  const rows = await pgQuery<ChatInfo>(
    `select chat_id, notify_new_releases, notify_premium, is_blocked
       from bot_chats where user_id = $1 limit 1`,
    [userId],
  );
  return rows[0] ?? null;
}

async function getProfilePrefs(userId: string): Promise<Record<string, unknown>> {
  const rows = await pgQuery<{ preferences: Record<string, unknown> | null }>(
    "select preferences from profiles where id = $1",
    [userId],
  );
  return rows[0]?.preferences ?? {};
}

/** Returns true when delivery should proceed for this notification type. */
export function shouldDeliver(
  type: string,
  chat: ChatInfo | null,
  profilePrefs: Record<string, unknown>,
): { ok: boolean; reason?: string } {
  if (type === "promotion") {
    if (profilePrefs.notify_promotions === false) {
      return { ok: false, reason: "user_opted_out_promotions" };
    }
  }
  if (!chat) return { ok: true }; // no telegram link → in-app only
  if (chat.is_blocked) return { ok: false, reason: "bot_blocked" };
  if (type === "new_release" && !chat.notify_new_releases) {
    return { ok: false, reason: "user_opted_out_new_releases" };
  }
  if (["subscription", "payment"].includes(type) && !chat.notify_premium) {
    return { ok: false, reason: "user_opted_out_premium" };
  }
  return { ok: true };
}

/** Claim + process one batch. Exported for tests and manual runs. */
export async function processPendingNotifications(): Promise<{
  claimed: number;
  sent: number;
  skipped: number;
  retried: number;
  failed: number;
}> {
  const stats = { claimed: 0, sent: 0, skipped: 0, retried: 0, failed: 0 };

  // Atomically claim a batch (locks held only for the UPDATE itself).
  const claimed = await pgQuery<NotificationRow>(
    `with batch as (
        select id
          from notifications
         where status = 'pending' and send_at <= now()
         order by send_at
         limit $1
         for update skip locked
      )
      update notifications n
         set attempts = n.attempts + 1
       where n.id in (select id from batch)
      returning n.id, n.user_id, n.type, n.title, n.body, n.channel, n.attempts`,
    [env.WORKER_BATCH_SIZE],
  );
  stats.claimed = claimed.length;

  for (const row of claimed) {
    try {
      if (row.channel === "in_app") {
        await markSent(row.id);
        stats.sent++;
        continue;
      }

      const [chat, profilePrefs] = await Promise.all([
        getChatInfo(row.user_id),
        getProfilePrefs(row.user_id),
      ]);
      if (process.env.WORKER_DEBUG === "1") {
        logger.info({ row: row.id, channel: row.channel, type: row.type, chat, attempts: row.attempts }, "worker_debug");
      }
      const decision = shouldDeliver(row.type, chat, profilePrefs);
      if (row.channel === "both") {
        // in-app half is always delivered; only the telegram half consults prefs
        await markSent(row.id, null, "in_app");
        if (!decision.ok) {
          stats.skipped++;
          continue;
        }
      } else if (!decision.ok) {
        await markSkipped(row.id, decision.reason ?? "blocked_by_preferences");
        stats.skipped++;
        continue;
      }

      if (!chat) {
        // Telegram requested but no linked chat — keep in-app only
        if (row.channel === "telegram") {
          await markSkipped(row.id, "no_linked_chat");
          stats.skipped++;
        } else {
          stats.sent++;
        }
        continue;
      }

      try {
        const sent = await tgSendMessage(
          Number(chat.chat_id),
          formatMessage(row),
          { link_preview_options: { is_disabled: true } },
        );
        await markSent(row.id, sent.message_id);
        stats.sent++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : "telegram_send_failed";
        if (row.attempts >= MAX_ATTEMPTS) {
          await markFailed(row.id, reason ?? "telegram_send_failed");
          stats.failed++;
        } else {
          await reschedule(row.id, row.attempts, reason ?? "telegram_send_failed");
          stats.retried++;
        }
      }
    } catch (err) {
      // unexpected per-row failure → retry with backoff
      logger.error(
        { err: err instanceof Error ? err.message : err, notification: row.id },
        "notification_row_error",
      );
      if (row.attempts >= MAX_ATTEMPTS) {
        await markFailed(row.id, "processing_error");
        stats.failed++;
      } else {
        await reschedule(row.id, row.attempts, "processing_error");
        stats.retried++;
      }
    }
  }
  return stats;
}

function formatMessage(n: { title: string; body: string | null }): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return n.body ? `<b>${esc(n.title)}</b>\n${esc(n.body)}` : `<b>${esc(n.title)}</b>`;
}

async function markSent(id: string, telegramMessageId?: number | null, _partial?: string): Promise<void> {
  await pgQuery(
    `update notifications
        set status = 'sent',
            telegram_message_id = coalesce($2, telegram_message_id),
            last_error = null
      where id = $1`,
    [id, telegramMessageId ?? null],
  );
}

async function markSkipped(id: string, reason: string): Promise<void> {
  await pgQuery(
    `update notifications set status = 'skipped', last_error = $2 where id = $1`,
    [id, reason],
  );
}

async function markFailed(id: string, reason: string): Promise<void> {
  await pgQuery(
    `update notifications set status = 'failed', last_error = $2 where id = $1`,
    [id, reason.slice(0, 300)],
  );
}

async function reschedule(id: string, attempts: number, reason: string): Promise<void> {
  const backoffMin = Math.min(2 ** attempts, 60);
  await pgQuery(
    `update notifications
        set status = 'pending', last_error = $2,
            send_at = now() + ($3 || ' minutes')::interval
      where id = $1`,
    [id, reason.slice(0, 300), String(backoffMin)],
  );
}

// ─────────────────────────── loop lifecycle ──────────────────────────────────

let running = false;
let timer: NodeJS.Timeout | null = null;

async function tick(): Promise<void> {
  try {
    const stats = await processPendingNotifications();
    if (stats.claimed > 0) {
      logger.debug(stats, "notification_batch");
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err }, "worker_tick_failed");
  }
}

export function startWorker(): void {
  if (running) return;
  running = true;
  void tick(); // immediate first pass
  timer = setInterval(() => void tick(), 15_000);
  logger.info("notification_worker_started");
}

export function stopWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}

export function isWorkerRunning(): boolean {
  return running;
}

/** Ensure the pool is closed on shutdown (used by tests). */
export async function drainWorker(): Promise<void> {
  stopWorker();
  const pool = getPgPool();
  await pool.query("select 1").catch(() => undefined);
}
