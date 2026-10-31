import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/require-admin.js";
import { validate } from "../../middleware/validate.js";
import { writeLimiter } from "../../middleware/rate-limit.js";
import { writeAudit } from "../../middleware/audit.js";
import { ah } from "../../utils/async-handler.js";
import { HttpError, unprocessable } from "../../utils/http-error.js";
import { paginationSchema, pageMeta } from "../../utils/paginate.js";
import { getEntitlement } from "../../lib/entitlement.js";
import { supabaseService } from "../../lib/supabase.js";
import { createStarsInvoice, listPayments, refundStarsPayment } from "./payments.service.js";
import { createPromotionInvoice } from "../promotions/promotions.routes.js";

const router = Router();

/** POST /payments/stars/invoice — create a Stars invoice for a plan. */
router.post(
  "/stars/invoice",
  authenticate,
  writeLimiter,
  validate({ body: z.object({ plan_id: z.string().uuid() }) }),
  ah(async (req, res) => {
    const { plan_id } = req.body as { plan_id: string };
    const intent = await createStarsInvoice(req.user!.id, plan_id);
    res.status(201).json({ payment_id: intent.paymentId, invoice_link: intent.invoiceLink, amount_stars: intent.amountStars });
  }),
);

/** POST /payments/promotions/:id/invoice — Stars invoice for a campaign. */
router.post(
  "/promotions/:id/invoice",
  authenticate,
  writeLimiter,
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ amount_stars: z.number().int().min(50).max(100_000) }),
  }),
  ah(async (req, res) => {
    const { id } = req.params;
    const { amount_stars } = req.body as { amount_stars: number };
    const intent = await createPromotionInvoice(req.user!.id, id, amount_stars);
    res.status(201).json({ payment_id: intent.paymentId, invoice_link: intent.invoiceLink });
  }),
);

/** GET /payments — the caller's receipts. */
router.get(
  "/",
  authenticate,
  validate({ query: paginationSchema }),
  ah(async (req, res) => {
    const { limit, offset } = req.query as unknown as { limit: number; offset: number };
    const { items, total } = await listPayments(req.user!.id, limit, offset);
    res.json({ payments: items, pagination: pageMeta(limit, offset, total) });
  }),
);

router.use(authenticate);

/** GET /payments/:id — one receipt (owner or admin). */
router.get(
  "/:id",
  validate({ params: z.object({ id: z.string().uuid() }) }),
  ah(async (req, res) => {
    const { data, error } = await supabaseService
      .from("payments")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();
    if (error || !data) {
      // owner visibility is enforced below via RLS when not admin
      throw new (await import("../../utils/http-error.js")).HttpError(
        404,
        "not_found",
        "Payment not found",
      );
    }
    if (data.user_id !== req.user!.id) {
      const { getAdminRoles } = await import("../../middleware/require-admin.js");
      const roles = await getAdminRoles(req.user!.id);
      if (roles.length === 0) {
        throw new (await import("../../utils/http-error.js")).HttpError(
          404,
          "not_found",
          "Payment not found",
        );
      }
    }
    res.json({ payment: data });
  }),
);

/** POST /payments/:id/refund — Stars refund (finance:manage, audited). */
router.post(
  "/:id/refund",
  requirePermission("finance:manage"),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  ah(async (req, res) => {
    const result = await refundStarsPayment(req.params.id, req.user!.id);
    writeAudit({
      actorId: req.user!.id,
      actorRole: "admin",
      action: "payment.refund",
      entityType: "payment",
      entityId: req.params.id,
      after: result,
      req,
    });
    res.json(result);
  }),
);

export const paymentsRouter = router;

// ───────────────────────────── subscriptions ─────────────────────────────────

export const subscriptionsRouter = (() => {
  const r = Router();

  /** GET /subscriptions/plans — public (cached). */
  r.get(
    "/plans",
    ah(async (_req, res) => {
      const { cacheGet, cacheSet } = await import("../../lib/cache.js");
      const { env: e } = await import("../../config/env.js");
      const key = "plans:active";
      let plans = cacheGet<unknown[]>(key);
      if (!plans) {
        const { data } = await supabaseService
          .from("plans")
          .select("*")
          .eq("is_active", true)
          .order("sort_order");
        plans = data ?? [];
        cacheSet(key, plans, e.CACHE_TTL_MS);
      }
      res.json({ plans });
    }),
  );

  r.use(authenticate);

  /** GET /subscriptions/me — entitlement + subscription history. */
  r.get(
    "/me",
    ah(async (req, res) => {
      const entitlement = await getEntitlement(req.user!.id);
      const { data } = await supabaseService
        .from("subscriptions")
        .select("*, plan:plans(code, name, price_stars, duration_days)")
        .eq("user_id", req.user!.id)
        .order("created_at", { ascending: false })
        .limit(20);
      res.json({ entitlement, subscriptions: data ?? [] });
    }),
  );

  /**
   * POST /subscriptions/me/cancel — cancel at period end.
   * NOTE: activation NEVER happens here — that path is the verified webhook.
   */
  r.post(
    "/me/cancel",
    validate({ body: z.object({}).default({}) }),
    ah(async (req, res) => {
      const entitlement = await getEntitlement(req.user!.id);
      if (!entitlement.premium) {
        res.json({ canceled: true, note: "No active premium subscription" });
        return;
      }
      const { error } = await req.db!
        .from("subscriptions")
        .update({ status: "canceled", canceled_at: new Date().toISOString(), auto_renew: false })
        .eq("user_id", req.user!.id)
        .eq("status", "active");
      if (error) throw unprocessable("Cancellation failed", error.message);
      res.json({ canceled: true, ends_at: entitlement.expiresAt });
    }),
  );
  return r;
})();

void unprocessable;
