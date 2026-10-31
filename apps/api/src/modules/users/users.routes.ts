import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { writeLimiter } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/async-handler.js";
import { HttpError, conflict, notFound, unprocessable } from "../../utils/http-error.js";
import { paginationSchema, pageMeta } from "../../utils/paginate.js";
import { getEntitlement } from "../../lib/entitlement.js";
import { cacheInvalidate } from "../../lib/cache.js";
import { ARTIST_SELECT, findArtist } from "../catalog/catalog.service.js";

const router = Router();

const PREFERENCE_DEFAULTS = {
  notify_new_releases: true,
  notify_premium: true,
  notify_promotions: true,
  autoplay: true,
  data_saver: false,
} as const;

const profileUpdateSchema = z
  .object({
    username: z.string().regex(/^[a-z0-9_]{3,24}$/, "3-24 chars, lowercase letters, digits, _"),
    full_name: z.string().max(120).nullable(),
    bio: z.string().max(1_000).nullable(),
    avatar_url: z.string().url().max(1_000).nullable(),
    language_code: z.enum(["am", "om", "ti", "en"]),
    country: z.string().regex(/^[A-Z]{2}$/).nullable(),
    phone: z.string().max(32).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Empty update" });

export const preferencesSchema = z
  .object({
    notify_new_releases: z.boolean(),
    notify_premium: z.boolean(),
    notify_promotions: z.boolean(),
    autoplay: z.boolean(),
    data_saver: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Empty preferences" });

const uuidParam = z.object({ artistId: z.string().uuid() });

/** GET /users/me — profile + entitlement + raw preferences. */
router.get(
  "/me",
  authenticate,
  ah(async (req, res) => {
    const user = req.user!;
    const entitlement = await getEntitlement(user.id);
    res.json({
      user: {
        id: user.profile.id,
        username: user.profile.username,
        full_name: user.profile.full_name,
        avatar_url: user.profile.avatar_url,
        bio: user.profile.bio,
        language_code: user.profile.language_code,
        country: user.profile.country,
        phone: user.profile.phone,
        created_at: user.profile.created_at,
      },
      preferences: { ...PREFERENCE_DEFAULTS, ...(req.user!.profile.preferences ?? {}) },
      entitlement,
    });
  }),
);

/** PATCH /users/me — self-service profile update (RLS: own row only). */
router.patch(
  "/me",
  authenticate,
  writeLimiter,
  validate({ body: profileUpdateSchema }),
  ah(async (req, res) => {
    const { data, error } = await req.db!
      .from("profiles")
      .update(req.body as Record<string, unknown>)
      .eq("id", req.user!.id)
      .select("id, username, full_name, bio, avatar_url, language_code, country, phone")
      .single();
    if (error) {
      if (error.code === "23505") throw conflict("Username is already taken");
      throw unprocessable("Profile update failed", error.message);
    }
    cacheInvalidate(`profile:${req.user!.id}`); // kill the auth cache snapshot
    res.json({ user: data });
  }),
);

/** GET /users/me/preferences — merged defaults + stored. */
router.get(
  "/me/preferences",
  authenticate,
  ah(async (req, res) => {
    const defaults = PREFERENCE_DEFAULTS;
    res.json({ preferences: { ...defaults, ...(req.user!.profile.preferences ?? {}) } });
  }),
);

/** PUT /users/me/preferences — validate + merge into profiles.preferences. */
router.put(
  "/me/preferences",
  authenticate,
  writeLimiter,
  validate({ body: preferencesSchema }),
  ah(async (req, res) => {
    const merged = { ...(req.user!.profile.preferences ?? {}), ...(req.body as object) };
    const { error } = await req.db!
      .from("profiles")
      .update({ preferences: merged })
      .eq("id", req.user!.id);
    if (error) throw unprocessable("Preferences update failed", error.message);
    cacheInvalidate(`profile:${req.user!.id}`);
    res.json({ preferences: merged });
  }),
);

/** GET /users/me/activity — recent personal events. */
router.get(
  "/me/activity",
  authenticate,
  validate({ query: paginationSchema }),
  ah(async (req, res) => {
    const { limit, offset } = req.query as unknown as { limit: number; offset: number };
    const { data, error, count } = await req.db!
      .from("analytics_events")
      .select("id, type, entity_type, entity_id, meta, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw unprocessable("Activity query failed", error.message);
    res.json({ events: data ?? [], pagination: pageMeta(limit, offset, count ?? 0) });
  }),
);

// ─────────────────────────────── follows ─────────────────────────────────────

/** GET /users/me/follows — artists this account follows. */
router.get(
  "/me/follows",
  authenticate,
  ah(async (req, res) => {
    const { data, error } = await req.db!
      .from("follows")
      .select(`artist:artists(${ARTIST_SELECT}), created_at`)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw unprocessable("Follows query failed", error.message);
    res.json({
      follows: (data ?? []).map((row: { artist: unknown; created_at: string }) => ({
        artist: row.artist,
        since: row.created_at,
      })),
    });
  }),
);

/** POST /users/me/follows/:artistId — follow an approved artist (idempotent). */
router.post(
  "/me/follows/:artistId",
  authenticate,
  writeLimiter,
  validate({ params: uuidParam }),
  ah(async (req, res) => {
    const artist = await findArtist(req.params.artistId);
    if (artist.status !== "approved") throw notFound("Artist not available");

    const { error } = await req.db!
      .from("follows")
      .upsert(
        { follower_id: req.user!.id, artist_id: artist.id },
        { onConflict: "follower_id,artist_id", ignoreDuplicates: true },
      );
    if (error) throw unprocessable("Follow failed", error.message);

    // notify the analytics trail
    void req.db!.from("analytics_events").insert({
      user_id: req.user!.id,
      type: "artist_follow",
      entity_type: "artist",
      entity_id: artist.id,
    });
    void req.db!.from("analytics_events");

    res.status(201).json({ following: true, artist_id: artist.id });
  }),
);

/** DELETE /users/me/follows/:artistId — unfollow (idempotent). */
router.delete(
  "/me/follows/:artistId",
  authenticate,
  writeLimiter,
  validate({ params: uuidParam }),
  ah(async (req, res) => {
    const { error } = await req.db!
      .from("follows")
      .delete()
      .eq("follower_id", req.user!.id)
      .eq("artist_id", req.params.artistId);
    if (error) throw unprocessable("Unfollow failed", error.message);
    res.status(204).end();
  }),
);

export const usersRouter = router;
void HttpError;
