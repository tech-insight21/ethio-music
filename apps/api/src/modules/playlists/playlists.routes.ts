import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate, attachOptionalUser } from "../../middleware/authenticate.js";
import { writeLimiter } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/async-handler.js";
import { conflict, forbidden, notFound, unprocessable } from "../../utils/http-error.js";
import { paginationSchema, pageMeta } from "../../utils/paginate.js";
import { findSong, SONG_SELECT } from "../catalog/catalog.service.js";
import { supabaseAnon } from "../../lib/supabase.js";
import { withTransaction } from "../../lib/pg.js";

const router = Router();

const playlistCreateSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(1_000).nullable().optional(),
  is_public: z.boolean().default(true),
  cover_url: z.string().url().max(1_000).nullable().optional(),
});

const playlistUpdateSchema = playlistCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Empty update" });

const idParam = z.object({ id: z.string().uuid() });
const songParam = z.object({ id: z.string().uuid(), songId: z.string().uuid() });

const PLAYLIST_SELECT = `*, owner:profiles!playlists_owner_id_fkey(id, username, full_name, avatar_url)`;
const PLAYLIST_SONGS_SELECT = `position, added_at, song:songs(${SONG_SELECT})`;

/** Anonymous/optional-auth requests resolve through a client that still
 *  applies RLS (anon shows public rows; authenticated shows own too). */
function scoped(req: Request) {
  return req.db ?? supabaseAnon;
}

function songCount(p: Record<string, unknown>): number {
  return (p.playlist_songs as { count: number }[] | undefined)?.[0]?.count ?? 0;
}

// ───────────────── public + optional-auth reads (RLS enforced) ───────────────

/** GET /playlists — public playlists (anon sees is_public only). */
router.get(
  "/",
  validate({ query: paginationSchema }),
  ah(async (req, res) => {
    const { limit, offset } = req.query as unknown as { limit: number; offset: number };
    const db = scoped(req);
    const { data, error, count } = await db
      .from("playlists")
      .select(`${PLAYLIST_SELECT}, playlist_songs(count)`, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw unprocessable("Playlist list failed", error.message);
    res.json({
      playlists: (data ?? []).map((p) => ({ ...p, song_count: songCount(p), playlist_songs: undefined })),
      pagination: pageMeta(limit, offset, count ?? 0),
    });
  }),
);

router.use(attachOptionalUser);

/** GET /playlists/mine — every playlist owned by the caller (auth required). */
router.get(
  "/mine",
  authenticate,
  ah(async (req, res) => {
    const { data, error } = await req.db!
      .from("playlists")
      .select(`${PLAYLIST_SELECT}, playlist_songs(count)`)
      .eq("owner_id", req.user!.id)
      .order("created_at", { ascending: false });
    if (error) throw unprocessable("Playlist list failed", error.message);
    res.json({
      playlists: (data ?? []).map((p) => ({ ...p, song_count: songCount(p), playlist_songs: undefined })),
    });
  }),
);

/** GET /playlists/:id — public or owned (RLS decides). */
router.get(
  "/:id",
  validate({ params: idParam }),
  ah(async (req, res) => {
    const { data, error } = await scoped(req)
      .from("playlists")
      .select(PLAYLIST_SELECT)
      .eq("id", req.params.id)
      .maybeSingle();
    if (error || !data) throw notFound("Playlist not found");
    res.json({ playlist: data });
  }),
);

/** GET /playlists/:id/songs — ordered tracks (visibility via RLS). */
router.get(
  "/:id/songs",
  validate({ params: idParam }),
  ah(async (req, res) => {
    const db = scoped(req);
    const { data: playlist } = await db
      .from("playlists")
      .select("id")
      .eq("id", req.params.id)
      .maybeSingle();
    if (!playlist) throw notFound("Playlist not found");

    const { data, error } = await db
      .from("playlist_songs")
      .select(PLAYLIST_SONGS_SELECT)
      .eq("playlist_id", req.params.id)
      .order("position", { ascending: true });
    if (error) throw unprocessable("Playlist songs failed", error.message);
    res.json({ songs: data ?? [] });
  }),
);

// ─────────────────────── authenticated mutations ─────────────────────────────

router.use(authenticate);

/** POST /playlists — create (RLS enforces owner_id = auth.uid()). */
router.post(
  "/",
  writeLimiter,
  validate({ body: playlistCreateSchema }),
  ah(async (req, res) => {
    const body = req.body as { title: string; description?: string; is_public: boolean; cover_url?: string };
    const { data, error } = await req.db!
      .from("playlists")
      .insert({
        owner_id: req.user!.id,
        title: body.title,
        description: body.description ?? null,
        is_public: body.is_public,
        cover_url: body.cover_url ?? null,
      })
      .select(PLAYLIST_SELECT)
      .single();
    if (error) throw unprocessable("Playlist creation failed", error.message);
    res.status(201).json({ playlist: data });
  }),
);

/** PATCH /playlists/:id — owner only. */
router.patch(
  "/:id",
  writeLimiter,
  validate({ params: idParam, body: playlistUpdateSchema }),
  ah(async (req, res) => {
    const existing = await req.db!
      .from("playlists")
      .select("id, owner_id")
      .eq("id", req.params.id)
      .maybeSingle();
    if (!existing.data) throw notFound("Playlist not found");
    if (existing.data.owner_id !== req.user!.id) throw forbidden("Not your playlist");

    const { data, error } = await req.db!
      .from("playlists")
      .update(req.body as Record<string, unknown>)
      .eq("id", req.params.id)
      .select(PLAYLIST_SELECT)
      .single();
    if (error) throw unprocessable("Playlist update failed", error.message);
    res.json({ playlist: data });
  }),
);

/** DELETE /playlists/:id — owner only (cascade removes tracks). */
router.delete(
  "/:id",
  writeLimiter,
  validate({ params: idParam }),
  ah(async (req, res) => {
    const existing = await req.db!
      .from("playlists")
      .select("id, owner_id")
      .eq("id", req.params.id)
      .maybeSingle();
    if (!existing.data) throw notFound("Playlist not found");
    if (existing.data.owner_id !== req.user!.id) throw forbidden("Not your playlist");

    const { error } = await req.db!.from("playlists").delete().eq("id", req.params.id);
    if (error) throw unprocessable("Playlist delete failed", error.message);
    res.status(204).end();
  }),
);

/** POST /playlists/:id/songs/:songId — append (position = max+1, dedup 409). */
router.post(
  "/:id/songs/:songId",
  writeLimiter,
  validate({ params: songParam }),
  ah(async (req, res) => {
    const owned = await req.db!
      .from("playlists")
      .select("id, owner_id")
      .eq("id", req.params.id)
      .maybeSingle();
    if (!owned.data) throw notFound("Playlist not found");
    if (owned.data.owner_id !== req.user!.id) throw forbidden("Not your playlist");

    const song = await findSong(req.params.songId);
    if (song.release_status !== "approved") throw notFound("Song not available");

    const { data: last } = await req.db!
      .from("playlist_songs")
      .select("position")
      .eq("playlist_id", req.params.id)
      .order("position", { ascending: false })
      .limit(1);
    const nextPos = ((last?.[0] as { position: number } | undefined)?.position ?? -1) + 1;

    const { data, error } = await req.db!
      .from("playlist_songs")
      .insert({ playlist_id: req.params.id, song_id: song.id, position: nextPos })
      .select(PLAYLIST_SONGS_SELECT)
      .single();
    if (error) {
      if (error.code === "23505") throw conflict("Song already in this playlist");
      throw unprocessable("Add song failed", error.message);
    }
    res.status(201).json({ entry: data });
  }),
);

/** DELETE /playlists/:id/songs/:songId — remove one track. */
router.delete(
  "/:id/songs/:songId",
  writeLimiter,
  validate({ params: songParam }),
  ah(async (req, res) => {
    const owned = await req.db!
      .from("playlists")
      .select("id, owner_id")
      .eq("id", req.params.id)
      .maybeSingle();
    if (!owned.data) throw notFound("Playlist not found");
    if (owned.data.owner_id !== req.user!.id) throw forbidden("Not your playlist");

    const { error } = await req.db!
      .from("playlist_songs")
      .delete()
      .eq("playlist_id", req.params.id)
      .eq("song_id", req.params.songId);
    if (error) throw unprocessable("Remove song failed", error.message);
    res.status(204).end();
  }),
);

/** PUT /playlists/:id/songs — reorder: { song_ids: [...] } in the desired order. */
router.put(
  "/:id/songs",
  writeLimiter,
  validate({
    params: idParam,
    body: z.object({ song_ids: z.array(z.string().uuid()).min(1).max(500) }),
  }),
  ah(async (req, res) => {
    const owned = await req.db!
      .from("playlists")
      .select("id, owner_id")
      .eq("id", req.params.id)
      .maybeSingle();
    if (!owned.data) throw notFound("Playlist not found");
    if (owned.data.owner_id !== req.user!.id) throw forbidden("Not your playlist");

    const songIds = (req.body as { song_ids: string[] }).song_ids;
    // Ownership verified through RLS above. `position` is not unique, so a
    // single array-based UPDATE inside one transaction rewrites the order.
    const positions = songIds.map((_, i) => i);
    await withTransaction(async (tx) => {
      await tx.query(
        `update playlist_songs as ps
            set position = d.pos
           from (select unnest($2::int[]) as pos, unnest($3::uuid[]) as sid) d
          where ps.playlist_id = $1 and ps.song_id = d.sid`,
        [req.params.id, positions, songIds],
      );
    });
    const { data } = await req.db!
      .from("playlist_songs")
      .select(PLAYLIST_SONGS_SELECT)
      .eq("playlist_id", req.params.id)
      .order("position", { ascending: true });
    res.json({ songs: data ?? [] });
  }),
);

export const playlistsRouter = router;
