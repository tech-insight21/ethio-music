import { Router } from "express";
import { z } from "zod";
import { attachOptionalUser } from "../../middleware/authenticate.js";
import { searchLimiter } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/async-handler.js";
import { unprocessable } from "../../utils/http-error.js";
import { ALBUM_SELECT, SONG_SELECT } from "../catalog/catalog.service.js";
import { supabaseService } from "../../lib/supabase.js";
import { pgQuery } from "../../lib/pg.js";

const router = Router();

const searchQuery = z.object({
  q: z.string().trim().min(2).max(80),
});

/**
 * GET /search?q= — multi-entity search.
 *
 * NOTE (PostgREST): `or()` cannot filter embedded resources
 * (artists.name.ilike inside or() is rejected), so song search runs a
 * two-query merge: (1) title ILIKE, (2) songs whose artist name matches —
 * merged + deduped in memory. Same approach as the Mini App and the bot.
 */
router.get(
  "/",
  attachOptionalUser,
  searchLimiter,
  validate({ query: searchQuery }),
  ah(async (req, res) => {
    const q = (req.query.q as string).trim();
    const like = `%${q}%`;
    const artistIdsPromise = supabaseService
      .from("artists")
      .select("id")
      .ilike("name", like)
      .eq("status", "approved")
      .limit(50);

    const [titleSongs, artistIdRows] = await Promise.all([
      supabaseService
        .from("songs")
        .select(SONG_SELECT)
        .eq("release_status", "approved")
        .ilike("title", like)
        .order("play_count", { ascending: false })
        .limit(20),
      artistIdsPromise,
    ]);
    if (titleSongs.error) throw unprocessable("Search failed", titleSongs.error.message);

    let artistSongs: { data: unknown[] | null; error: { message: string } | null } = {
      data: [],
      error: null,
    };
    const artistIds = (artistIdRows.data ?? []).map((r) => r.id);
    if (artistIds.length > 0) {
      artistSongs = await supabaseService
        .from("songs")
        .select(SONG_SELECT)
        .eq("release_status", "approved")
        .in("artist_id", artistIds)
        .order("play_count", { ascending: false })
        .limit(20);
    }

    const [artists, albums, genres] = await Promise.all([
      supabaseService
        .from("artists")
        .select("*")
        .eq("status", "approved")
        .ilike("name", like)
        .order("monthly_listeners", { ascending: false })
        .limit(10),
      supabaseService
        .from("albums")
        .select(ALBUM_SELECT)
        .ilike("title", like)
        .order("release_date", { ascending: false, nullsFirst: false })
        .limit(10),
      supabaseService
        .from("genres")
        .select("*")
        .ilike("name", like)
        .limit(10),
    ]);
    if (artists.error || albums.error || genres.error || artistSongs.error) {
      throw unprocessable("Search failed");
    }

    // merge + dedupe songs (title matches first, then artist matches)
    const seen = new Set<string>();
    const songs: unknown[] = [];
    for (const row of [...(titleSongs.data ?? []), ...(artistSongs.data ?? [])]) {
      const id = (row as { id: string }).id;
      if (!seen.has(id)) {
        seen.add(id);
        songs.push(row);
      }
    }

    const total = songs.length + artists.data!.length + albums.data!.length + genres.data!.length;

    // record history for authenticated callers (RLS: own row)
    if (req.user) {
      const { error: histErr } = await req.db!.from("search_history").insert({
        user_id: req.user.id,
        query: q.slice(0, 120),
        results_count: total,
      });
      if (histErr) throw unprocessable("Could not record search", histErr.message);
      void req.db!.from("analytics_events").insert({
        user_id: req.user.id,
        type: "search",
        meta: { query: q.slice(0, 120), results: total },
      });
    }

    res.json({ query: q, songs, artists: artists.data ?? [], albums: albums.data ?? [], genres: genres.data ?? [], total });
  }),
);

// ─────────────────────────── search history ──────────────────────────────────

router.get(
  "/history",
  attachOptionalUser,
  searchLimiter,
  ah(async (req, res) => {
    if (!req.user) {
      res.json({ history: [] });
      return;
    }
    const { data, error } = await req.db!
      .from("search_history")
      .select("id, query, results_count, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw unprocessable("History query failed", error.message);

    // dedupe consecutive identical queries for display
    const seen = new Set<string>();
    const history = (data ?? []).filter((h) => {
      const key = h.query.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    res.json({ history });
  }),
);

router.delete(
  "/history",
  attachOptionalUser,
  searchLimiter,
  ah(async (req, res) => {
    if (!req.user) {
      res.status(204).end();
      return;
    }
    const { error } = await req.db!.from("search_history").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw unprocessable("History clear failed", error.message);
    res.status(204).end();
  }),
);

router.delete(
  "/history/:id",
  attachOptionalUser,
  searchLimiter,
  validate({ params: z.object({ id: z.string().uuid() }) }),
  ah(async (req, res) => {
    if (!req.user) {
      res.status(204).end();
      return;
    }
    await req.db!.from("search_history").delete().eq("id", req.params.id);
    res.status(204).end();
  }),
);

export const searchRouter = router;
void pgQuery;
