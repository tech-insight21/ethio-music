import { Router } from "express";
import { z } from "zod";
import multer, { type FileFilterCallback } from "multer";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/require-admin.js";
import { validate } from "../../middleware/validate.js";
import { apiLimiter } from "../../middleware/rate-limit.js";
import { writeAudit } from "../../middleware/audit.js";
import { ah } from "../../utils/async-handler.js";
import { HttpError, badRequest, notFound, unprocessable } from "../../utils/http-error.js";
import { paginationSchema, pageMeta } from "../../utils/paginate.js";
import { getEntitlement } from "../../lib/entitlement.js";
import { pgQuery } from "../../lib/pg.js";
import { env } from "../../config/env.js";
import {
  SONG_SELECT,
  cachedPublic,
  findSong,
  invalidateCatalogCache,
  slugify,
  supabaseService,
  uniqueSlug,
} from "./catalog.service.js";

const router = Router();

const licenseEnum = z.enum([
  "owned_master",
  "licensed_master",
  "distribution_deal",
  "creative_commons",
]);
const languageEnum = z.enum(["am", "om", "ti", "en"]);
const releaseStateEnum = z.enum([
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "taken_down",
]);

const songCreateSchema = z.object({
  artist_id: z.string().uuid(),
  album_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(160),
  audio_url: z.string().url().max(1_000),
  cover_url: z.string().url().max(1_000).nullable().optional(),
  duration_seconds: z.number().int().min(0).max(7_200).default(0),
  track_number: z.number().int().min(0).nullable().optional(),
  isrc: z.string().min(6).max(20).nullable().optional(),
  explicit: z.boolean().default(false),
  language: languageEnum.nullable().optional(),
  license_type: licenseEnum.default("distribution_deal"),
  rights_holder: z.string().min(1).max(200),
  license_document_url: z.string().url().max(1_000).nullable().optional(),
  distribution_agreement_url: z.string().url().max(1_000).nullable().optional(),
  licensed_at: z.coerce.date().nullable().optional(),
  license_expires_at: z.coerce.date().nullable().optional(),
  release_status: z.enum(["draft", "pending_review"]).default("draft"),
  genre_ids: z.array(z.string().uuid()).max(8).default([]),
});

const songUpdateSchema = songCreateSchema
  .partial()
  .omit({ artist_id: true })
  .extend({ release_status: releaseStateEnum.optional() });

const idParam = z.object({ id: z.string().min(1).max(120) });

const listQuery = paginationSchema.extend({
  artist_id: z.string().uuid().optional(),
  album_id: z.string().uuid().optional(),
  genre_id: z.string().uuid().optional(),
  language: languageEnum.optional(),
  sort: z.enum(["newest", "popular"]).default("newest"),
});

// ───────────────────────────── public reads ──────────────────────────────────

router.get(
  "/",
  apiLimiter,
  validate({ query: listQuery }),
  ah(async (req, res) => {
    const { limit, offset, artist_id, album_id, genre_id, language, sort } = req.query as never as
      { limit: number; offset: number } & Record<string, string | undefined>;

    let songIds: string[] | null = null;
    if (genre_id) {
      const { data: links } = await supabaseService
        .from("song_genres")
        .select("song_id")
        .eq("genre_id", genre_id);
      songIds = (links ?? []).map((l) => l.song_id);
      if (songIds.length === 0) {
        res.json({ songs: [], pagination: pageMeta(limit, offset, 0) });
        return;
      }
    }

    let query = supabaseService.from("songs").select(SONG_SELECT, { count: "exact" });
    // Public surface only shows approved songs; staff with a token may pass ?all=1
    const wantsAll = req.query.all === "1" && req.user;
    if (!wantsAll) query = query.eq("release_status", "approved");
    if (artist_id) query = query.eq("artist_id", artist_id);
    if (album_id) query = query.eq("album_id", album_id);
    if (language) query = query.eq("language", language);
    if (songIds) query = query.in("id", songIds);
    query = sort === "popular"
      ? query.order("play_count", { ascending: false })
      : query.order("created_at", { ascending: false });
    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) throw unprocessable("Song list failed", error.message);
    res.json({ songs: data ?? [], pagination: pageMeta(limit, offset, count ?? 0) });
  }),
);

router.get(
  "/:id",
  apiLimiter,
  validate({ params: idParam }),
  ah(async (req, res) => {
    const song = await cachedPublic(
      `song:${req.params.id}`,
      env.CACHE_TTL_MS,
      async () => {
        const isUuid = /^[0-9a-f-]{36}$/i.test(req.params.id);
        const q = supabaseService.from("songs").select(SONG_SELECT).eq(
          isUuid ? "id" : "slug",
          req.params.id,
        );
        const { data, error } = await (req.user ? q : q.eq("release_status", "approved")).maybeSingle();
        if (error) throw unprocessable("Song lookup failed", error.message);
        return data;
      },
    );
    if (!song) throw notFound("Song not found");
    res.json({ song });
  }),
);

/**
 * POST /songs/:id/play — record a play (song_plays + play_count + analytics).
 * Free tier listens to previews; the response states the entitlement so the
 * client can honor it. The API never fakes a paywall on public audio.
 */
router.post(
  "/:id/play",
  apiLimiter,
  validate({ params: idParam }),
  ah(async (req, res) => {
    const song = await findSong(req.params.id);
    if (song.release_status !== "approved") throw notFound("Song not available");

    const userId = req.user?.id ?? null;
    const seconds = z.coerce
      .number()
      .int()
      .min(0)
      .max(7_200)
      .default(0)
      .catch(0)
      .parse(req.body?.seconds_played ?? 0);
    const source = ["tma", "bot", "api", "web"].includes(req.body?.source)
      ? req.body.source
      : "api";

    const [entitlement] = await Promise.all([
      userId ? getEntitlement(userId) : Promise.resolve({ premium: false } as never),
      supabaseService.from("song_plays").insert({
        song_id: song.id,
        user_id: userId,
        source,
        seconds_played: seconds,
      }),
    ]);
    // fire-and-forget analytics event
    void supabaseService
      .from("analytics_events")
      .insert({
        user_id: userId,
        type: "song_play",
        entity_type: "song",
        entity_id: song.id,
        meta: { source, seconds_played: seconds },
      })
      .then(() => undefined);

    // Atomic play_count increment (direct SQL avoids read-modify-write races)
    await pgQuery("update songs set play_count = play_count + 1 where id = $1", [song.id]);

    res.json({
      ok: true,
      song_id: song.id,
      preview_only: !entitlement.premium,
    });
  }),
);

// ───────────────────────────── admin operations ──────────────────────────────

router.post(
  "/",
  authenticate,
  requirePermission("catalog:write"),
  validate({ body: songCreateSchema }),
  ah(async (req, res) => {
    const body = req.body as {
      title: string;
      genre_ids: string[];
      album_id?: string | null;
      licensed_at?: Date | null;
    } & Record<string, unknown>;

    const slug = await uniqueSlug("songs", body.title);
    const { genre_ids, licensed_at, license_expires_at, ...rest } = body as never as
      { genre_ids: string[]; licensed_at?: Date; license_expires_at?: Date } & Record<string, unknown>;

    const { data, error } = await supabaseService
      .from("songs")
      .insert({
        ...rest,
        slug,
        album_id: body.album_id ?? null,
        licensed_at: licensed_at ? new Date(licensed_at).toISOString() : null,
        license_expires_at: license_expires_at ? new Date(license_expires_at).toISOString() : null,
      })
      .select(SONG_SELECT)
      .single();
    if (error) throw unprocessable("Song creation failed", error.message);

    if (genre_ids.length > 0) {
      await supabaseService
        .from("song_genres")
        .insert(genre_ids.map((gid) => ({ song_id: (data as { id: string }).id, genre_id: gid })));
    }
    const actor = req.user!;
    writeAudit({
      actorId: actor.id,
      actorRole: "moderator",
      action: "song.create",
      entityType: "song",
      entityId: (data as { id: string }).id,
      after: { title: body.title, slug },
      req,
    });
    await invalidateCatalogCache();
    res.status(201).json({ song: data });
  }),
);

router.patch(
  "/:id",
  authenticate,
  requirePermission("catalog:write"),
  validate({ params: idParam, body: songUpdateSchema }),
  ah(async (req, res) => {
    const found = await findSong(req.params.id);
    const body = { ...(req.body as Record<string, unknown>) };
    const before = await supabaseService.from("songs").select("*").eq("id", found.id).single();

    // license gate: only 'approved' when license fields are on file (DB enforces too)
    if (body.release_status === "approved") {
      const merged = { ...(before.data as Record<string, unknown>), ...body };
      if (!merged.licensed_at || !merged.license_document_url) {
        throw unprocessable(
          "A song cannot be approved without license metadata (licensed_at + license_document_url)",
        );
      }
      body.approved_by = req.user!.id;
      body.approved_at = new Date().toISOString();
    }
    if (body.release_status && body.release_status !== "approved") {
      body.approved_by = null;
      body.approved_at = null;
    }

    const { data, error } = await supabaseService
      .from("songs")
      .update(body)
      .eq("id", found.id)
      .select(SONG_SELECT)
      .single();
    if (error) throw unprocessable("Song update failed", error.message);

    writeAudit({
      actorId: req.user!.id,
      actorRole: "moderator",
      action: "song.update",
      entityType: "song",
      entityId: found.id,
      before: before.data,
      after: body,
      req,
    });
    await invalidateCatalogCache();
    res.json({ song: data });
  }),
);

router.post(
  "/:id/approve",
  authenticate,
  requirePermission("catalog:write"),
  validate({ params: idParam }),
  ah(async (req, res) => {
    const found = await findSong(req.params.id);
    const { data: current } = await supabaseService
      .from("songs")
      .select("licensed_at, license_document_url, release_status")
      .eq("id", found.id)
      .single();
    if (!current?.licensed_at || !current?.license_document_url) {
      throw unprocessable(
        "Approval requires license metadata on file (licensed_at + license_document_url)",
      );
    }
    const { data, error } = await supabaseService
      .from("songs")
      .update({
        release_status: "approved",
        approved_by: req.user!.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", found.id)
      .select(SONG_SELECT)
      .single();
    if (error) throw unprocessable("Approval failed", error.message);
    writeAudit({
      actorId: req.user!.id,
      actorRole: "moderator",
      action: "song.approve",
      entityType: "song",
      entityId: found.id,
      before: current,
      after: { release_status: "approved" },
      req,
    });
    await invalidateCatalogCache();
    res.json({ song: data });
  }),
);

router.post(
  "/:id/takedown",
  authenticate,
  requirePermission("catalog:write"),
  validate({ params: idParam }),
  ah(async (req, res) => {
    const found = await findSong(req.params.id);
    const { data, error } = await supabaseService
      .from("songs")
      .update({ release_status: "taken_down", approved_by: null, approved_at: null })
      .eq("id", found.id)
      .select(SONG_SELECT)
      .single();
    if (error) throw unprocessable("Takedown failed", error.message);
    writeAudit({
      actorId: req.user!.id,
      actorRole: "moderator",
      action: "song.takedown",
      entityType: "song",
      entityId: found.id,
      after: { release_status: "taken_down" },
      req,
    });
    await invalidateCatalogCache();
    res.json({ song: data });
  }),
);

router.delete(
  "/:id",
  authenticate,
  requirePermission("catalog:write"),
  validate({ params: idParam }),
  ah(async (req, res) => {
    const found = await findSong(req.params.id);
    const { error } = await supabaseService.from("songs").delete().eq("id", found.id);
    if (error) throw unprocessable("Song delete failed", error.message);
    writeAudit({
      actorId: req.user!.id,
      actorRole: "moderator",
      action: "song.delete",
      entityType: "song",
      entityId: found.id,
      req,
    });
    await invalidateCatalogCache();
    res.status(204).end();
  }),
);

// ─────────────────────── artwork upload (type+size validated) ────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (
    _req: Express.Request,
    file: Express.Multer.File,
    cb: FileFilterCallback,
  ) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)) {
      cb(new HttpError(422, "invalid_file_type", "Only PNG, JPEG or WebP images are allowed"));
      return;
    }
    cb(null, true);
  },
});

router.post(
  "/:id/artwork",
  authenticate,
  requirePermission("catalog:write"),
  upload.single("artwork"),
  validate({ params: idParam }),
  ah(async (req, res) => {
    const found = await findSong(req.params.id);
    const file = req.file;
    if (!file) throw badRequest("artwork file is required (field name: artwork)");

    const ext = file.mimetype === "image/png" ? "png" : file.mimetype === "image/webp" ? "webp" : "jpg";
    const path = `songs/${found.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabaseService.storage
      .from("covers")
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
    if (upErr) throw unprocessable("Artwork upload failed", upErr.message);

    const { data: pub } = supabaseService.storage.from("covers").getPublicUrl(path);
    const coverUrl = pub.publicUrl;
    const { data, error } = await supabaseService
      .from("songs")
      .update({ cover_url: coverUrl })
      .eq("id", found.id)
      .select("id, slug, cover_url")
      .single();
    if (error) throw unprocessable("Artwork link failed", error.message);

    writeAudit({
      actorId: req.user!.id,
      actorRole: "moderator",
      action: "song.artwork",
      entityType: "song",
      entityId: found.id,
      after: { cover_url: coverUrl },
      req,
    });
    await invalidateCatalogCache();
    res.json({ song: data });
  }),
);

/** Authoritative audio reference + licensing documents (URL-validated). */
router.post(
  "/:id/audio-url",
  authenticate,
  requirePermission("catalog:write"),
  validate({
    params: idParam,
    body: z.object({
      audio_url: z.string().url().max(1_000),
      license_document_url: z.string().url().max(1_000).optional(),
      distribution_agreement_url: z.string().url().max(1_000).optional(),
      licensed_at: z.coerce.date().optional(),
      license_expires_at: z.coerce.date().nullable().optional(),
    }),
  }),
  ah(async (req, res) => {
    const found = await findSong(req.params.id);
    const body = req.body as {
      audio_url: string;
      license_document_url?: string;
      distribution_agreement_url?: string;
      licensed_at?: Date;
      license_expires_at?: Date | null;
    };
    const patch: Record<string, unknown> = { audio_url: body.audio_url };
    if (body.license_document_url !== undefined) patch.license_document_url = body.license_document_url;
    if (body.distribution_agreement_url !== undefined) patch.distribution_agreement_url = body.distribution_agreement_url;
    if (body.licensed_at !== undefined) patch.licensed_at = new Date(body.licensed_at).toISOString();
    if (body.license_expires_at !== undefined) {
      patch.license_expires_at = body.license_expires_at
        ? new Date(body.license_expires_at).toISOString()
        : null;
    }
    const { data, error } = await supabaseService
      .from("songs")
      .update(patch)
      .eq("id", found.id)
      .select("id, slug, audio_url, license_document_url, distribution_agreement_url")
      .single();
    if (error) throw unprocessable("Audio reference update failed", error.message);
    writeAudit({
      actorId: req.user!.id,
      actorRole: "moderator",
      action: "song.audio_url",
      entityType: "song",
      entityId: found.id,
      after: patch,
      req,
    });
    await invalidateCatalogCache();
    res.json({ song: data });
  }),
);

export const songsRouter = router;
void slugify;
