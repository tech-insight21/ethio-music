import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/require-admin.js";
import { validate } from "../../middleware/validate.js";
import { apiLimiter, writeLimiter } from "../../middleware/rate-limit.js";
import { writeAudit } from "../../middleware/audit.js";
import { ah } from "../../utils/async-handler.js";
import { HttpError, forbidden, notFound, unprocessable } from "../../utils/http-error.js";
import { paginationSchema, pageMeta } from "../../utils/paginate.js";
import { env } from "../../config/env.js";
import {
  ALBUM_SELECT,
  ARTIST_SELECT,
  SONG_SELECT,
  cachedPublic,
  findArtist,
  invalidateCatalogCache,
  supabaseService,
  uniqueSlug,
} from "./catalog.service.js";

const router = Router();

const idOrSlugParam = z.object({ idOrSlug: z.string().min(1).max(120) });

const artistCreateSchema = z.object({
  name: z.string().min(1).max(120),
  bio: z.string().max(4_000).optional(),
  region: z.string().max(80).optional(),
  avatar_url: z.string().url().max(1_000).optional(),
});

const artistUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  bio: z.string().max(4_000).nullable().optional(),
  region: z.string().max(80).nullable().optional(),
  avatar_url: z.string().url().max(1_000).nullable().optional(),
  cover_url: z.string().url().max(1_000).nullable().optional(),
  verified: z.boolean().optional(),
  status: z.enum(["pending", "approved", "rejected", "suspended"]).optional(),
  monthly_listeners: z.number().int().min(0).optional(),
});

// ───────────────────────────── public reads ──────────────────────────────────

router.get(
  "/",
  apiLimiter,
  validate({
    query: paginationSchema.extend({
      verified: z.enum(["true", "false"]).optional(),
      region: z.string().max(80).optional(),
    }),
  }),
  ah(async (req, res) => {
    const { limit, offset, verified, region } = req.query as unknown as {
      limit: number;
      offset: number;
      verified?: string;
      region?: string;
    };
    const key = `artists:${limit}:${offset}:${verified ?? ""}:${region ?? ""}`;
    const result = await cachedPublic<{ items: unknown[]; total: number }>(
      key,
      env.CACHE_TTL_MS,
      async () => {
        let q = supabaseService
          .from("artists")
          .select(ARTIST_SELECT, { count: "exact" })
          .eq("status", "approved")
          .order("monthly_listeners", { ascending: false });
        if (verified === "true") q = q.eq("verified", true);
        if (verified === "false") q = q.eq("verified", false);
        if (region) q = q.eq("region", region);
        const { data, error, count } = await q.range(offset, offset + limit - 1);
        if (error) throw unprocessable("Artist list failed", error.message);
        return { items: data ?? [], total: count ?? 0 };
      },
    );
    res.json({ artists: result.items, pagination: pageMeta(limit, offset, result.total) });
  }),
);

router.get(
  "/:idOrSlug",
  apiLimiter,
  validate({ params: idOrSlugParam }),
  ah(async (req, res) => {
    const artist = await cachedPublic<unknown | null>(
      `artist:${req.params.idOrSlug}`,
      env.CACHE_TTL_MS,
      async () => {
        const isUuid = /^[0-9a-f-]{36}$/i.test(req.params.idOrSlug);
        const { data } = await supabaseService
          .from("artists")
          .select(`${ARTIST_SELECT}, follower_count:follows(count)`)
          .eq(isUuid ? "id" : "slug", req.params.idOrSlug)
          .eq("status", "approved")
          .maybeSingle();
        return data;
      },
    );
    if (!artist) throw notFound("Artist not found");
    res.json({ artist });
  }),
);

router.get(
  "/:idOrSlug/albums",
  apiLimiter,
  validate({ params: idOrSlugParam, query: paginationSchema }),
  ah(async (req, res) => {
    const artist = await findArtist(req.params.idOrSlug);
    const { limit, offset } = req.query as never as { limit: number; offset: number };
    const { data, error, count } = await supabaseService
      .from("albums")
      .select(ALBUM_SELECT, { count: "exact" })
      .eq("artist_id", artist.id)
      .order("release_date", { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);
    if (error) throw unprocessable("Album list failed", error.message);
    res.json({ albums: data ?? [], pagination: pageMeta(limit, offset, count ?? 0) });
  }),
);

router.get(
  "/:idOrSlug/songs",
  apiLimiter,
  validate({ params: idOrSlugParam, query: paginationSchema }),
  ah(async (req, res) => {
    const artist = await findArtist(req.params.idOrSlug);
    const { limit, offset } = req.query as never as { limit: number; offset: number };
    const { data, error, count } = await supabaseService
      .from("songs")
      .select(SONG_SELECT, { count: "exact" })
      .eq("artist_id", artist.id)
      .eq("release_status", "approved")
      .order("play_count", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw unprocessable("Song list failed", error.message);
    res.json({ songs: data ?? [], pagination: pageMeta(limit, offset, count ?? 0) });
  }),
);

// ───────────────────── authenticated (artist-facing) ─────────────────────────

/** Self-service artist registration — lands as `pending` for staff review. */
router.post(
  "/",
  authenticate,
  writeLimiter,
  validate({ body: artistCreateSchema }),
  ah(async (req, res) => {
    const body = req.body as { name: string; bio?: string; region?: string; avatar_url?: string };
    const slug = await uniqueSlug("artists", body.name);
    const { data, error } = await supabaseService
      .from("artists")
      .insert({
        name: body.name,
        slug,
        bio: body.bio ?? null,
        region: body.region ?? null,
        avatar_url: body.avatar_url ?? null,
        owner_id: req.user!.id,
        status: "pending",
      })
      .select(ARTIST_SELECT)
      .single();
    if (error) throw unprocessable("Artist registration failed", error.message);

    // seed the review pipeline
    await supabaseService.from("artist_submissions").insert({
      artist_id: (data as { id: string }).id,
      submitted_by: req.user!.id,
      status: "pending",
      message: "Artist self-registration",
    });
    res.status(201).json({ artist: data });
  }),
);

/** Follow/unfollow live in the users module; this manages the profile + submissions. */
router.post(
  "/:idOrSlug/submissions",
  authenticate,
  writeLimiter,
  validate({
    params: idOrSlugParam,
    body: z.object({ message: z.string().max(1_000).optional() }),
  }),
  ah(async (req, res) => {
    const artist = await findArtist(req.params.idOrSlug);
    if (artist.owner_id !== req.user!.id) {
      throw forbidden("Only the artist owner can submit for review");
    }
    const { data, error } = await supabaseService
      .from("artist_submissions")
      .insert({
        artist_id: artist.id,
        submitted_by: req.user!.id,
        status: "pending",
        message: (req.body as { message?: string }).message ?? null,
      })
      .select("*")
      .single();
    if (error) throw unprocessable("Submission failed", error.message);
    res.status(201).json({ submission: data });
  }),
);

// ───────────────────────────── admin operations ──────────────────────────────

router.patch(
  "/:idOrSlug",
  authenticate,
  requirePermission("artists:review"),
  validate({ params: idOrSlugParam, body: artistUpdateSchema }),
  ah(async (req, res) => {
    const artist = await findArtist(req.params.idOrSlug);
    const before = await supabaseService.from("artists").select("*").eq("id", artist.id).single();
    const { data, error } = await supabaseService
      .from("artists")
      .update(req.body as Record<string, unknown>)
      .eq("id", artist.id)
      .select(ARTIST_SELECT)
      .single();
    if (error) throw unprocessable("Artist update failed", error.message);
    writeAudit({
      actorId: req.user!.id,
      actorRole: "moderator",
      action: "artist.update",
      entityType: "artist",
      entityId: artist.id,
      before: before.data,
      after: req.body,
      req,
    });
    await invalidateCatalogCache();
    res.json({ artist: data });
  }),
);

router.delete(
  "/:idOrSlug",
  authenticate,
  requirePermission("catalog:write"),
  validate({ params: idOrSlugParam }),
  ah(async (req, res) => {
    const artist = await findArtist(req.params.idOrSlug);
    const { error } = await supabaseService.from("artists").delete().eq("id", artist.id);
    if (error) throw unprocessable("Artist delete failed", error.message);
    writeAudit({
      actorId: req.user!.id,
      actorRole: "moderator",
      action: "artist.delete",
      entityType: "artist",
      entityId: artist.id,
      req,
    });
    await invalidateCatalogCache();
    res.status(204).end();
  }),
);

export const artistsRouter = router;
void HttpError;
