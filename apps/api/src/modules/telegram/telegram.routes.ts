import { Router, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { pgQuery } from "../../lib/pg.js";
import { botToken, tgAnswerCallbackQuery, tgSendMessage } from "../../lib/telegram.js";
import {
  handlePreCheckout,
  handleSuccessfulPayment,
  type PreCheckoutQuery,
} from "../payments/payments.service.js";
import { enqueueNotification } from "../notifications/notification.service.js";

const router = Router();

/** Single webhook for the bot: payments first, chat registry, minimal
 *  commands (payment-critical path must never depend on the command bot). */
router.post(
  "/webhook",
  (req: Request, res: Response) => {
    // 1) Telegram secret-token check (timing-safe)
    const secret = env.TG_WEBHOOK_SECRET;
    const header = req.headers["x-telegram-bot-api-secret-token"];
    if (!secret || typeof header !== "string" || !safeEqual(header, secret)) {
      logger.warn({ ip: req.ip }, "telegram_webhook_rejected");
      res.status(401).json({ error: { code: "unauthorized", message: "Invalid webhook secret" } });
      return;
    }
    const update = req.body as TelegramUpdate;
    void handleUpdate(update)
      .catch((err: unknown) =>
        logger.error({ err: err instanceof Error ? err.message : err }, "webhook_update_error"),
      )
      .finally(() => {
        // Always 200 — non-2xx makes Telegram retry forever.
        if (!res.headersSent) res.json({ ok: true });
      });
  },
);

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    from?: TgUserLike;
    text?: string;
    successful_payment?: {
      currency: string;
      total_amount: number;
      invoice_payload: string;
      telegram_payment_charge_id: string;
      provider_payment_charge_id?: string;
    };
  };
  pre_checkout_query?: PreCheckoutQuery;
  callback_query?: { id: string; from: TgUserLike; data?: string };
  my_chat_member?: {
    chat: { id: number };
    from: TgUserLike;
    new_chat_member: { status: string };
  };
}

interface TgUserLike {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
}

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  // ── payments (money path) ──────────────────────────────────────────────
  if (update.pre_checkout_query) {
    const q = update.pre_checkout_query;
    try {
      await handlePreCheckout(q);
      const { tgAnswerPreCheckoutQuery } = await import("../../lib/telegram.js");
      await tgAnswerPreCheckoutQuery(q.id, true);
    } catch (err) {
      const { tgAnswerPreCheckoutQuery } = await import("../../lib/telegram.js");
      await tgAnswerPreCheckoutQuery(
        q.id,
        false,
        err instanceof Error ? "This invoice is no longer valid." : undefined,
      ).catch(() => undefined);
      logger.warn({ err: err instanceof Error ? err.message : err }, "pre_checkout_declined");
    }
    return;
  }

  if (update.message?.successful_payment) {
    const fromId = update.message.from?.id ?? update.message.chat.id;
    const result = await handleSuccessfulPayment(
      update.message.successful_payment,
      update,
      fromId,
    );
    if (!result.duplicate) {
      // receipt message + confirmation notification
      await tgSendMessage(
        update.message.chat.id,
        "✅ <b>Payment received</b>\nYour Premium is active. Enjoy unlimited streaming!",
      ).catch(() => undefined);
      const linkedUserId = await resolveUserId(fromId);
      if (linkedUserId) {
        await enqueueNotification({
          userId: linkedUserId,
          type: "payment",
          title: "Premium activated",
          body: "Your Telegram Stars payment was confirmed.",
          dedupKey: `paid:${result.paymentId}`,
          channel: "in_app",
        }).catch(() => undefined);
      }
    }
    return;
  }

  // ── chat registry + minimal commands ───────────────────────────────────
  if (update.message) {
    const { chat, from, text } = update.message;
    await upsertChat(chat.id, from);
    const cmd = (text ?? "").trim().split(/\s+/)[0];
    if (cmd === "/start" || cmd === "/app") {
      await tgSendMessage(chat.id, welcomeText(from), {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🎵 Open Music App", web_app: { url: env.TMA_URL } }],
            [{ text: "🌐 Open in browser", url: env.TMA_URL }],
          ],
        },
      }).catch((err: unknown) =>
        logger.warn({ err: err instanceof Error ? err.message : err }, "start_reply_failed"),
      );
      return;
    }
    await forwardCommand(update).catch(() => undefined);
    return;
  }

  // ── block / unblock tracking ───────────────────────────────────────────
  if (update.my_chat_member) {
    const blocked = update.my_chat_member.new_chat_member.status === "kicked";
      await pgQuery(
      `insert into bot_chats (chat_id, username, first_name, is_blocked)
       values ($1, $2, $3, $4)
       on conflict (chat_id) do update set is_blocked = excluded.is_blocked, updated_at = now()`,
      [
        update.my_chat_member.chat.id,
        update.my_chat_member.from?.username ?? null,
        update.my_chat_member.from?.first_name ?? null,
        blocked,
      ],
    );
    return;
  }

  // ── callback queries: ack so the client stops spinning ─────────────────
  if (update.callback_query) {
    await tgAnswerCallbackQuery(update.callback_query.id).catch(() => undefined);
  }
}

function welcomeText(from?: TgUserLike): string {
  const name = from?.first_name ?? "there";
  return (
    `🎧 <b>Welcome to ETHIO MUSIC, ${escapeHtml(name)}!</b>\n\n` +
    "Discover Ethiopian music — Ethio-jazz, Amharic pop, Oromo pop, Tigrigna and more.\n\n" +
    "Tap the button below to launch the Mini App."
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function upsertChat(chatId: number, from?: TgUserLike): Promise<void> {
  await pgQuery(
    `insert into bot_chats (chat_id, username, first_name, language_code)
     values ($1, $2, $3, $4)
     on conflict (chat_id) do update
       set username = coalesce(excluded.username, bot_chats.username),
           first_name = coalesce(excluded.first_name, bot_chats.first_name),
           updated_at = now()`,
    [chatId, from?.username ?? null, from?.first_name ?? null, from?.language_code ?? null],
  );
}

async function resolveUserId(telegramId: number): Promise<string | null> {
  const rows = await pgQuery<{ user_id: string | null }>(
    "select user_id from bot_chats where chat_id = $1",
    [telegramId],
  );
  return rows[0]?.user_id ?? null;
}

/** Optional passthrough for a dedicated command bot (webhook coexistence). */
async function forwardCommand(update: TelegramUpdate): Promise<void> {
  if (!env.COMMAND_FORWARD_URL) return;
  await fetch(env.COMMAND_FORWARD_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": env.TG_WEBHOOK_SECRET ?? "",
    },
    body: JSON.stringify(update),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined);
}

void botToken;
export const telegramRouter = router;
