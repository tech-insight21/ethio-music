import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/require-admin.js";
import { validate } from "../../middleware/validate.js";
import { apiLimiter } from "../../middleware/rate-limit.js";
import { writeAudit } from "../../middleware/audit.js";
import { ah } from "../../utils/async-handler.js";
import { unprocessable } from "../../utils/http-error.js";
import { paginationSchema, pageMeta } from "../../utils/paginate.js";
import { env } from "../../config/env.js";
import {
  ALBUM_SELECT,
  SONG_SELECT,
  cachedPublic,
  findAlbum,
  invalidateCatalogCache,
  supabaseService,
  uniqueSlug,
} from "./catalog.service.js";

const router = Router();

const albumCreateSchema = z.object({
  artist_id: z.string().uuid(),
  title: z.string().min(1).max(160),
  description: z.string().max(4_000).nullable().optional(),
  cover_url: z.string().url().max(1_000).nullable().optional(),
  album_type: z.enum(["single", "ep", "album", "compilation"]).default("album"),
  release_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

const albumUpdateSchema = albumCreateSchema
  .partial()
  .omit({ artist_id: true })
  .refine((v) => Object.keys(v).length > 0, { message: "Empty update" });

const idOrSlugParam = z.object({ idOrSlug: z.string().min(1).max(120) });
const idParam = z.object({ id: z.string().min(1).max(120) });

router.get(
  "/",
  apiLimiter,
  validate({ query: paginationSchema.extend({ artist_id: z.string().uuid().optional() }) }),
  ah(async (req, res) => {
    const { limit, offset, artist_id } = req.query as unknown as {
      limit: number;
      offset: number;
      artist_id?: string;
    };
    const key = `albums:${limit}:${offset}:${artist_id ?? ""}`;
    const result = await cachedPublic<{ items: unknown[]; total: number }>(
      key,
      env.CACHE_TTL_MS,
      async () => {
        let q = supabaseService
          .from("albums")
          .select(ALBUM_SELECT, { count: "exact" })
          .order("release_date", { ascending: false, nullsFirst: false });
        if (artist_id) q = q.eq("artist_id", artist_id);
        const { data, error, count } = await q.range(offset, offset + limit - 1);
        if (error) throw unprocessable("Album list failed", error.message);
        return { items: data ?? [], total: count ?? 0 };
      },
    );
    res.json({ albums: result.items, pagination: pageMeta(limit, offset, result.total) });
  }),
);

router.get(
  "/:idOrSlug",
  apiLimiter,
  validate({ params: idOrSlugParam }),
  ah(async (req, res) => {
    const album = await cachedPublic<unknown | null>(
      `album:${req.params.idOrSlug}`,
      env.CACHE_TTL_MS,
      async () => {
        const isUuid = /^[0-9a-f-]{36}$/i.test(req.params.idOrSlug);
        const { data } = await supabaseService
          .from("albums")
          .select(ALBUM_SELECT)
          .eq(isUuid ? "id" : "slug", req.params.idOrSlug)
          .maybeSingle();
        return data;
      },
    );
    if (!album) throw unprocessable("Album not found", undefined);
    res.json({ album });
  }),
);

router.get(
  "/:idOrSlug/songs",
  apiLimiter,
  validate({ params: idOrSlugParam }),
  ah(async (req, res) => {
    const album = await findAlbum(req.params.idOrSlug);
    const { data, error } = await supabaseService
      .from("songs")
      .select(SONG_SELECT)
      .eq("album_id", album.id)
      .eq("release_status", "approved")
      .order("track_number", { ascending: true, nullsFirst: false });
    if (error) throw unprocessable("Track list failed", error.message);
    res.json({ songs: data ?? [] });
  }),
);

router.post(
  "/",
  authenticate,
  requirePermission("catalog:write"),
  validate({ body: albumCreateSchema }),
  ah(async (req, res) => {
    const body = req.body as {
      artist_id: string;
      title: string;
      release_date?: string | null;
      album_type: string;
    } & Record<string, unknown>;
    const slug = await uniqueSlug("albums", body.title);
    const { data, error } = await supabaseService
      .from("albums")
      .insert({ ...body, slug, release_date: body.release_date ?? null })
      .select(ALBUM_SELECT)
      .single();
    if (error) throw unprocessable("Album creation failed", error.message);
    writeAudit({
      actorId: req.user!.id,
      actorRole: "moderator",
      action: "album.create",
      entityType: "album",
      entityId: (data as { id: string }).id,
      after: { title: body.title, slug },
      req,
    });
    await invalidateCatalogCache();
    res.status(201).json({ album: data });
  }),
);

router.patch(
  "/:id",
  authenticate,
  requirePermission("catalog:write"),
  validate({ params: idParam, body: albumUpdateSchema }),
  ah(async (req, res) => {
    const album = await findAlbum(req.params.id);
    const before = await supabaseService.from("albums").select("*").eq("id", album.id).single();
    const { data, error } = await supabaseService
      .from("albums")
      .update(req.body as Record<string, unknown>)
      .eq("id", album.id)
      .select(ALBUM_SELECT)
      .single();
    if (error) throw unprocessable("Album update failed", error.message);
    writeAudit({
      actorId: req.user!.id,
      actorRole: "moderator",
      action: "album.update",
      entityType: "album",
      entityId: album.id,
      before: before.data,
      after: req.body,
      req,
    });
    await invalidateCatalogCache();
    res.json({ album: data });
  }),
);

router.delete(
  "/:id",
  authenticate,
  requirePermission("catalog:write"),
  validate({ params: idParam }),
  ah(async (req, res) => {
    const album = await findAlbum(req.params.id);
    const { error } = await supabaseService.from("albums").delete().eq("id", album.id);
    if (error) throw unprocessable("Album delete failed", error.message);
    writeAudit({
      actorId: req.user!.id,
      actorRole: "moderator",
      action: "album.delete",
      entityType: "album",
      entityId: album.id,
      req,
    });
    await invalidateCatalogCache();
    res.status(204).end();
  }),
);

export const albumsRouter = router;
