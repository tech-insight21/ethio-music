import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { writeLimiter } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/async-handler.js";
import { unprocessable } from "../../utils/http-error.js";
import { SONG_SELECT } from "../catalog/catalog.service.js";
import { paginationSchema, pageMeta } from "../../utils/paginate.js";

const router = Router();

const songParam = z.object({ songId: z.string().uuid() });

/** GET /favorites — the caller's favorited songs (RLS: own rows). */
router.get(
  "/",
  authenticate,
  validate({ query: paginationSchema }),
  ah(async (req, res) => {
    const { limit, offset } = req.query as unknown as { limit: number; offset: number };
    const { data, error, count } = await req.db!
      .from("favorites")
      .select(`song:songs(${SONG_SELECT}), created_at`, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw unprocessable("Favorites query failed", error.message);
    res.json({
      favorites: (data ?? []).map((f: { song: unknown; created_at: string }) => ({
        song: f.song,
        since: f.created_at,
      })),
      pagination: pageMeta(limit, offset, count ?? 0),
    });
  }),
);

/** PUT /favorites/:songId — favorite a song (idempotent, composite PK dedups). */
router.put(
  "/:songId",
  authenticate,
  writeLimiter,
  validate({ params: songParam }),
  ah(async (req, res) => {
    const { error } = await req.db!
      .from("favorites")
      .upsert(
        { user_id: req.user!.id, song_id: req.params.songId },
        { onConflict: "user_id,song_id", ignoreDuplicates: true },
      );
    if (error) throw unprocessable("Favorite failed", error.message);
    void req.db!.from("analytics_events").insert({
      user_id: req.user!.id,
      type: "song_favorite",
      entity_type: "song",
      entity_id: req.params.songId,
    });
    res.status(201).json({ favorited: true, song_id: req.params.songId });
  }),
);

/** DELETE /favorites/:songId — remove a favorite (idempotent). */
router.delete(
  "/:songId",
  authenticate,
  writeLimiter,
  validate({ params: songParam }),
  ah(async (req, res) => {
    const { error } = await req.db!
      .from("favorites")
      .delete()
      .eq("user_id", req.user!.id)
      .eq("song_id", req.params.songId);
    if (error) throw unprocessable("Unfavorite failed", error.message);
    res.status(204).end();
  }),
);

export const favoritesRouter = router;
