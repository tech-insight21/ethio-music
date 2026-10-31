import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { attachOptionalUser, authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/require-admin.js";
import { validate } from "../../middleware/validate.js";
import { writeLimiter, searchLimiter } from "../../middleware/rate-limit.js";
import { writeAudit } from "../../middleware/audit.js";
import { ah } from "../../utils/async-handler.js";
import { HttpError, badRequest, forbidden, notFound, unprocessable } from "../../utils/http-error.js";
import { paginationSchema, pageMeta } from "../../utils/paginate.js";
import { env } from "../../config/env.js";
import { cacheGet, cacheSet, cacheInvalidate } from "../../lib/cache.js";
import { pgQuery } from "../../lib/pg.js";
import { supabaseService } from "../../lib/supabase.js";
import { tgCreateInvoiceLink } from "../../lib/telegram.js";
import { findArtist } from "../catalog/catalog.service.js";

const router = Router();

const PROMOTION_TYPES = ["featured_artist", "banner", "playlist_slot", "push_campaign"] as const;

const PROMO_SELECT = `*, artist:artists(id, name, slug, avatar_url, verified), song:songs(id, title, slug, cover_url)`;

// ───────────────────────────── public surface ────────────────────────────────

/** GET /promotions/active — live campaigns (cached 60 s). */
router.get(
  "/active",
  ah(async (_req, res) => {
    const hit = cacheGet<unknown[]>("promotions:active");
    if (hit) {
      res.json({ promotions: hit });
      return;
    }
    const { data, error } = await supabaseService
      .from("promotions")
      .select(PROMO_SELECT)
      .eq("status", "active")
      .lte("starts_at", new Date().toISOString())
      .gt("ends_at", new Date().toISOString())
      .order("starts_at");
    if (error) throw unprocessable("Promotions query failed", error.message);
    cacheSet("promotions:active", data ?? [], env.CACHE_TTL_MS);
    res.json({ promotions: data ?? [] });
  }),
);

/** POST /promotions/:id/impression|click — counters (public, rate-limited). */
async function trackCounter(
  promotionId: string,
  column: "impressions" | "clicks",
): Promise<void> {
  await pgQuery(
    `update promotions set ${column} = ${column} + 1 where id = $1 and status = 'active'`,
    [promotionId],
  );
}

router.post(
  "/:id/impression",
  searchLimiter,
  validate({ params: z.object({ id: z.string().uuid() }) }),
  ah(async (req, res) => {
    await trackCounter(req.params.id, "impressions");
    res.status(202).json({ tracked: true });
  }),
);

router.post(
  "/:id/click",
  searchLimiter,
  validate({ params: z.object({ id: z.string().uuid() }) }),
  ah(async (req, res) => {
    await trackCounter(req.params.id, "clicks");
    res.status(202).json({ tracked: true });
  }),
);

// ─────────────────────────── artist-facing routes ────────────────────────────

router.use(authenticate);

/** GET /promotions/mine — campaigns of artists the caller owns. */
router.get(
  "/mine",
  ah(async (req, res) => {
    const { data, error } = await req.db!
      .from("promotions")
      .select(PROMO_SELECT)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw unprocessable("Promotions query failed", error.message);
    res.json({ promotions: data ?? [] });
  }),
);

/**
 * POST /promotions/requests — an artist owner creates a campaign draft.
 * Payment happens through Stars (see /payments/promotions/:id/invoice);
 * the webhook activates the campaign once paid.
 */
router.post(
  "/requests",
  writeLimiter,
  validate({
    body: z.object({
      artist_id: z.string().uuid(),
      song_id: z.string().uuid().optional(),
      promotion_type: z.enum(PROMOTION_TYPES),
      starts_at: z.coerce.date(),
      ends_at: z.coerce.date(),
      message: z.string().max(500).optional(),
    }),
  }),
  ah(async (req, res) => {
    const body = req.body as {
      artist_id: string;
      song_id?: string;
      promotion_type: (typeof PROMOTION_TYPES)[number];
      starts_at: Date;
      ends_at: Date;
      message?: string;
    };
    const artist = await findArtist(body.artist_id);
    if (artist.owner_id !== req.user!.id) {
      throw forbidden("Only the artist owner can request promotion");
    }
    if (artist.status !== "approved") throw badRequest("Artist must be approved first");
    if (body.ends_at <= body.starts_at) throw badRequest("ends_at must be after starts_at");
    if (body.ends_at.getTime() - body.starts_at.getTime() > 90 * 86_400_000) {
      throw badRequest("Campaigns are capped at 90 days");
    }

    const { data, error } = await supabaseService
      .from("promotions")
      .insert({
        artist_id: artist.id,
        song_id: body.song_id ?? null,
        promotion_type: body.promotion_type,
        status: "draft",
        starts_at: body.starts_at.toISOString(),
        ends_at: body.ends_at.toISOString(),
      })
      .select(PROMO_SELECT)
      .single();
    if (error) throw unprocessable("Promotion request failed", error.message);
    res.status(201).json({ promotion: data });
  }),
);

// ───────────────────────────── admin management ──────────────────────────────

export const adminPromotionsRouter = (() => {
  const r = Router();
  r.use(authenticate, requirePermission("promotions:manage"));

  r.get(
    "/",
    validate({ query: paginationSchema.extend({ status: z.string().max(20).optional() }) }),
    ah(async (req, res) => {
      const { limit, offset, status } = req.query as unknown as {
        limit: number;
        offset: number;
        status?: string;
      };
      let q = supabaseService
        .from("promotions")
        .select(`${PROMO_SELECT}, payments(status, amount_stars, provider_ref)`, { count: "exact" });
      if (status) q = q.eq("status", status as never);
      const { data, error, count } = await q
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw unprocessable("Promotions query failed", error.message);
      res.json({ promotions: data ?? [], pagination: pageMeta(limit, offset, count ?? 0) });
    }),
  );

  /** PATCH — schedule / approve / pause (approve requires a completed payment). */
  r.patch(
    "/:id",
    validate({
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        status: z.enum(["draft", "active", "paused", "completed", "canceled"]),
        starts_at: z.coerce.date().optional(),
        ends_at: z.coerce.date().optional(),
      }),
    }),
    ah(async (req, res) => {
      const { id } = req.params;
      const body = req.body as { status?: string; starts_at?: Date; ends_at?: Date };
      const before = await supabaseService.from("promotions").select("*").eq("id", id).maybeSingle();
      if (!before.data) throw notFound("Promotion not found");

      if (body.status === "active" && before.data.status !== "active") {
        const paid = await pgQuery(
          `select 1 from payments where promotion_id = $1 and status = 'completed' limit 1`,
          [id],
        );
        if (paid.length === 0) {
          throw badRequest("Campaigns can only go live after a completed payment");
        }
      }
      if (body.starts_at && body.ends_at && body.ends_at <= body.starts_at) {
        throw badRequest("ends_at must be after starts_at");
      }

      const patch: Record<string, unknown> = {};
      if (body.status) patch.status = body.status;
      if (body.starts_at) patch.starts_at = body.starts_at.toISOString();
      if (body.ends_at) patch.ends_at = body.ends_at.toISOString();

      const { data, error } = await supabaseService
        .from("promotions")
        .update(patch)
        .eq("id", id)
        .select(PROMO_SELECT)
        .single();
      if (error) throw unprocessable("Promotion update failed", error.message);

      writeAudit({
        actorId: req.user!.id,
        actorRole: "admin",
        action: "promotion.update",
        entityType: "promotion",
        entityId: id,
        before: before.data,
        after: patch,
        req,
      });
      cacheInvalidate("promotions:active");
      res.json({ promotion: data });
    }),
  );

  /** GET /:id/report — campaign performance. */
  r.get(
    "/:id/report",
    validate({ params: z.object({ id: z.string().uuid() }) }),
    ah(async (req, res) => {
      const { id } = req.params;
      const { data: promo } = await supabaseService
        .from("promotions")
        .select(`${PROMO_SELECT}, payments(status, amount_stars, paid_at, provider_ref)`)
        .eq("id", id)
        .maybeSingle();
      if (!promo) throw notFound("Promotion not found");
      const impressions = (promo as { impressions: number }).impressions;
      const clicks = (promo as { clicks: number }).clicks;
      res.json({
        promotion: promo,
        performance: {
          impressions,
          clicks,
          ctr: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
        },
      });
    }),
  );

  return r;
})();

/** Stars invoice for a promotion campaign (artist pays for their request). */
export async function createPromotionInvoice(
  userId: string,
  promotionId: string,
  amountStars: number,
): Promise<{ paymentId: string; invoiceLink: string }> {
  const { data: promo } = await supabaseService
    .from("promotions")
    .select("id, status, artist:artists(owner_id, name)")
    .eq("id", promotionId)
    .maybeSingle();
  const p = promo as { id: string; status: string; artist: { owner_id: string; name: string } } | null;
  if (!p) throw notFound("Promotion not found");
  if (p.artist.owner_id !== userId) throw forbidden("Not your campaign");
  if (p.status !== "draft") throw badRequest("This campaign already has a payment in flight");
  if (!Number.isInteger(amountStars) || amountStars < 50 || amountStars > 100_000) {
    throw badRequest("amount_stars must be an integer between 50 and 100000");
  }

  const payload = randomUUID();
  const invoiceLink = await tgCreateInvoiceLink({
    title: "ETHIO MUSIC — Artist Promotion",
    description: `Promotion campaign for ${p.artist.name}. Activates after payment.`,
    payload,
    currency: "XTR",
    prices: [{ label: "Promotion campaign", amount: amountStars }],
  });
  const { data, error } = await supabaseService
    .from("payments")
    .insert({
      user_id: userId,
      promotion_id: promotionId,
      provider: "telegram_stars",
      currency: "XTR",
      amount_etb: 0.01,
      amount_stars: amountStars,
      status: "pending",
      payload,
    })
    .select("id")
    .single();
  if (error) throw unprocessable("Payment intent failed", error.message);
  return { paymentId: (data as { id: string }).id, invoiceLink };
}

export const promotionsRouter = router;
void HttpError;
