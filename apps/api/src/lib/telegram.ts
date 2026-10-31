import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";
import { logger } from "./logger.js";

/**
 * Telegram Bot API client.
 *  - token-bucket throttle (~25 msg/s, well inside Telegram limits)
 *  - automatic 429 retry honoring `retry_after` (max 2 retries)
 *  - all methods throw TelegramApiError on failure
 */
export class TelegramApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly errorCode: number | null,
    public readonly description: string,
  ) {
    super(`Telegram ${method} failed: ${description}`);
    this.name = "TelegramApiError";
  }
}

export function botToken(): string {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new HttpError(
      503,
      "telegram_not_configured",
      "TELEGRAM_BOT_TOKEN is not configured on the server",
    );
  }
  return env.TELEGRAM_BOT_TOKEN;
}

// ── token bucket ─────────────────────────────────────────────────────────────
const BUCKET_CAPACITY = 25;
const sentAt: number[] = [];

async function throttle(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (sentAt.length > 0 && now - sentAt[0]! > 1_000) sentAt.shift();
    if (sentAt.length < BUCKET_CAPACITY) {
      sentAt.push(now);
      return;
    }
    const waitMs = 1_000 - (now - sentAt[0]!) + 5;
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

async function tgCall<T>(method: string, payload: unknown): Promise<T> {
  await throttle();
  const url = `https://api.telegram.org/bot${botToken()}/${method}`;
  let lastError: TelegramApiError | null = null;

  for (let attempt = 0; attempt <= 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      lastError = new TelegramApiError(
        method,
        null,
        err instanceof Error ? err.message : "network error",
      );
      continue;
    }

    const body = (await res.json().catch(() => null)) as
      | { ok: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } }
      | null;

    if (body?.ok) return body.result as T;

    if (body?.error_code === 429) {
      const wait = (body.parameters?.retry_after ?? 1) * 1_000;
      logger.warn({ method, retry_after: body.parameters?.retry_after }, "tg_rate_limited");
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
    }
    throw new TelegramApiError(
      method,
      body?.error_code ?? res.status,
      body?.description ?? `HTTP ${res.status}`,
    );
  }
  throw lastError ?? new TelegramApiError(method, null, "unreachable");
}

// ── typed helpers ────────────────────────────────────────────────────────────

export interface InvoiceLinkParams {
  title: string;
  description: string;
  payload: string;
  currency: "XTR";
  prices: { label: string; amount: number }[];
  photo_url?: string;
}

export function tgCreateInvoiceLink(p: InvoiceLinkParams): Promise<string> {
  return tgCall<string>("createInvoiceLink", p);
}

export function tgSendMessage(
  chatId: number | string,
  text: string,
  opts: Record<string, unknown> = {},
): Promise<{ message_id: number; chat: { id: number } }> {
  return tgCall("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...opts });
}

export function tgAnswerPreCheckoutQuery(
  id: string,
  ok: boolean,
  errorMessage?: string,
): Promise<boolean> {
  return tgCall("answerPreCheckoutQuery", {
    pre_checkout_query_id: id,
    ok,
    ...(ok ? {} : { error_message: errorMessage ?? "Payment could not be processed" }),
  });
}

export function tgAnswerCallbackQuery(id: string, text?: string): Promise<boolean> {
  return tgCall("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
}

export function tgRefundStarPayment(
  userId: number,
  telegramPaymentChargeId: string,
): Promise<boolean> {
  return tgCall("refundStarPayment", {
    user_id: userId,
    telegram_payment_charge_id: telegramPaymentChargeId,
  });
}

export function tgSetWebhook(
  url: string,
  secretToken: string,
): Promise<boolean> {
  return tgCall("setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "callback_query", "pre_checkout_query", "my_chat_member"],
    drop_pending_updates: false,
  });
}

export function tgGetMe(): Promise<{ id: number; username: string }> {
  return tgCall("getMe", {});
}

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export function tgDisplayName(u: TgUser): string {
  return [u.first_name, u.last_name].filter(Boolean).join(" ") || `user ${u.id}`;
}
