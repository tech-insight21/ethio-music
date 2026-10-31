import { randomUUID } from "node:crypto";
import { pgQuery, withTransaction } from "../../lib/pg.js";
import { logger } from "../../lib/logger.js";
import { supabaseService } from "../../lib/supabase.js";
import {
  HttpError,
  badRequest,
  forbidden,
  notFound,
  unprocessable,
} from "../../utils/http-error.js";
import { tgCreateInvoiceLink } from "../../lib/telegram.js";

/**
 * Telegram Stars (XTR) payments.
 *
 * Money path — the client can NEVER activate a subscription:
 *   1. POST /payments/stars/invoice → payments(pending, payload UUID) + invoice link
 *   2. Telegram sends pre_checkout_query  → we validate the payload server-side
 *   3. Telegram sends successful_payment  → secret-verified webhook runs ONE
 *      transaction: pending→completed (provider_ref UNIQUE = replay-safe),
 *      subscription created/extended, confirmation notification enqueued.
 */

export interface PaymentIntent {
  paymentId: string;
  invoiceLink: string;
  amountStars: number;
}

interface PlanRow {
  id: string;
  code: string;
  name: string;
  price_stars: number | null;
  duration_days: number;
  is_active: boolean;
}

/** Create a Stars invoice for a subscription plan. */
export async function createStarsInvoice(
  userId: string,
  planId: string,
): Promise<PaymentIntent> {
  const { data: plan } = await supabaseService
    .from("plans")
    .select("id, code, name, price_stars, duration_days, is_active")
    .eq("id", planId)
    .maybeSingle();
  const p = plan as PlanRow | null;
  if (!p || !p.is_active) throw notFound("Plan not found");
  if (p.code === "free") throw badRequest("The free plan does not require payment");
  if (!p.price_stars || p.price_stars <= 0) {
    throw unprocessable("This plan is not purchasable with Telegram Stars");
  }

  const payload = randomUUID();
  const invoiceLink = await tgCreateInvoiceLink({
    title: `ETHIO MUSIC — ${p.name}`,
    description: `${p.duration_days}-day subscription. Activates automatically after payment.`,
    payload,
    currency: "XTR",
    prices: [{ label: `${p.name} (${p.duration_days} days)`, amount: p.price_stars }],
  });

  const { data, error } = await supabaseService
    .from("payments")
    .insert({
      user_id: userId,
      plan_id: p.id,
      provider: "telegram_stars",
      currency: "XTR",
      amount_etb: 0.01, // NOT NULL > 0 by schema; Stars amounts live in amount_stars
      amount_stars: p.price_stars,
      status: "pending",
      payload,
    })
    .select("id")
    .single();
  if (error) throw unprocessable("Payment intent failed", error.message);

  return { paymentId: (data as { id: string }).id, invoiceLink, amountStars: p.price_stars };
}

// ─────────────────────────── webhook handlers ────────────────────────────────

export interface PreCheckoutQuery {
  id: string;
  from: { id: number };
  currency: string;
  total_amount: number;
  invoice_payload: string;
}

export async function handlePreCheckout(q: PreCheckoutQuery): Promise<void> {
  const rows = await pgQuery<{ id: string }>(
    `select id from payments where payload = $1 and status = 'pending' limit 1`,
    [q.invoice_payload],
  );
  return rows.length > 0
    ? Promise.resolve()
    : Promise.reject(new Error("unknown or already-paid payload"));
}

export interface SuccessfulPayment {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id?: string;
}

export interface ProcessedPayment {
  duplicate: boolean;
  paymentId?: string;
  subscriptionId?: string;
}

/** Idempotent activation — the ONLY path that grants entitlement. */
export async function handleSuccessfulPayment(
  sp: SuccessfulPayment,
  rawUpdate: unknown,
  telegramUserId: number,
): Promise<ProcessedPayment> {
  const result = await withTransaction(async (tx) => {
    // 1) flip pending → completed (unique provider_ref + payload guard)
    const updated = await tx.query<{
      id: string;
      user_id: string;
      plan_id: string | null;
      promotion_id: string | null;
    }>(
      `update payments
          set status = 'completed',
              provider_ref = $2,
              paid_at = now(),
              raw_payload = $3::jsonb
        where payload = $1 and status = 'pending'
        returning id, user_id, plan_id, promotion_id`,
      [sp.invoice_payload, sp.telegram_payment_charge_id, JSON.stringify(rawUpdate)],
    );

    if (updated.rows.length === 0) {
      return { duplicate: true } satisfies ProcessedPayment;
    }
    const payment = updated.rows[0];

    // 2) activate / extend the subscription when the payment buys a plan
    let subscriptionId: string | undefined;
    if (payment.plan_id) {
      const planRows = await tx.query<{ duration_days: number }>(
        "select duration_days from plans where id = $1",
        [payment.plan_id],
      );
      const days = planRows.rows[0]?.duration_days ?? 30;

      const subRows = await tx.query<{ id: string; ends_at: string }>(
        `select id, ends_at from subscriptions
          where user_id = $1 and plan_id = $2 and status = 'active' and ends_at > now()
          order by ends_at desc limit 1
          for update`,
        [payment.user_id, payment.plan_id],
      );

      if (subRows.rows.length > 0) {
        const sub = subRows.rows[0];
        await tx.query(
          `update subscriptions
              set ends_at = ends_at + ($2 || ' days')::interval,
                  updated_at = now()
            where id = $1`,
          [sub.id, String(days)],
        );
        subscriptionId = sub.id;
      } else {
        const inserted = await tx.query<{ id: string }>(
          `insert into subscriptions (user_id, plan_id, status, starts_at, ends_at)
           values ($1, $2, 'active', now(), now() + ($3 || ' days')::interval)
           returning id`,
          [payment.user_id, payment.plan_id, String(days)],
        );
        subscriptionId = inserted.rows[0].id;
      }
      await tx.query(`update payments set subscription_id = $2 where id = $1`, [payment.id, subscriptionId]);
    }

    // 3) promotion payments activate their campaign
    if (payment.promotion_id) {
      await tx.query(
        `update promotions set status = 'active', updated_at = now()
          where id = $1 and status in ('draft','paused') and ends_at > now()`,
        [payment.promotion_id],
      );
    }

    return { duplicate: false, paymentId: payment.id, subscriptionId } satisfies ProcessedPayment;
  });

  if (!result.duplicate) {
    logger.info(
      { paymentId: result.paymentId, subscriptionId: result.subscriptionId, telegramUserId },
      "stars_payment_completed",
    );
  } else {
    logger.warn({ payload: sp.invoice_payload }, "stars_payment_replay_ignored");
  }
  return result;
}

/** Admin refund via Bot API + revoke the derived subscription. */
export async function refundStarsPayment(
  paymentId: string,
  adminId: string,
): Promise<{ refunded: boolean }> {
  const rows = await pgQuery<{
    id: string;
    user_id: string;
    provider_ref: string | null;
    status: string;
    subscription_id: string | null;
    raw_payload: { message?: { chat?: { id?: number } } };
  }>(
    `select id, user_id, provider_ref, status, subscription_id, raw_payload
       from payments where id = $1 for update`,
    [paymentId],
  );
  const payment = rows[0];
  if (!payment) throw notFound("Payment not found");
  if (payment.status !== "completed") throw badRequest("Only completed payments can be refunded");
  if (!payment.provider_ref) throw badRequest("Payment has no provider reference");

  const chatId = payment.raw_payload?.message?.chat?.id;
  if (!chatId) throw unprocessable("Cannot refund without the payer's Telegram context");

  const { tgRefundStarPayment } = await import("../../lib/telegram.js");
  await tgRefundStarPayment(chatId, payment.provider_ref); // throws on Telegram refusal

  await withTransaction(async (tx) => {
    await tx.query(
      `update payments set status = 'refunded', updated_at = now() where id = $1`,
      [paymentId],
    );
    if (payment.subscription_id) {
      await tx.query(
        `update subscriptions set status = 'canceled', canceled_at = now(), ends_at = now(), updated_at = now()
          where id = $1 and status = 'active'`,
        [payment.subscription_id],
      );
    }
  });

  logger.info({ paymentId, adminId }, "stars_payment_refunded");
  return { refunded: true };
}

/** Verified receipts for the caller (or everything for admins). */
export async function listPayments(userId: string, limit: number, offset: number) {
  const rows = await pgQuery(
    `select id, plan_id, promotion_id, subscription_id, provider, currency,
            amount_etb, amount_stars, status, payload, paid_at, created_at
       from payments where user_id = $1
      order by created_at desc limit $2 offset $3`,
    [userId, limit, offset],
  );
  const totalRows = await pgQuery<{ count: string }>(
    "select count(*)::text as count from payments where user_id = $1",
    [userId],
  );
  return { items: rows, total: Number(totalRows[0]?.count ?? 0) };
}

void HttpError;
void forbidden;
