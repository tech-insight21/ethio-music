import { Router } from "express";
import { z } from "zod";
import { attachOptionalUser } from "../../middleware/authenticate.js";
import { apiLimiter } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/async-handler.js";
import { unprocessable } from "../../utils/http-error.js";
import { paginationSchema, pageMeta } from "../../utils/paginate.js";
import { env } from "../../config/env.js";
import { cacheGet, cacheSet } from "../../lib/cache.js";
import { pgQuery } from "../../lib/pg.js";
import { supabaseService } from "../../lib/supabase.js";
import { SONG_SELECT } from "../catalog/catalog.service.js";

const router = Router();

const listQuery = paginationSchema.extend({ window: z.enum(["7d", "30d", "all"]).default("30d") });

/** Trending songs: play_count weighted by recent plays (7-day window). */
export async function trendingSongs(limit: number, offset: number) {
  const rows = await pgQuery(
    `select s.id,
            coalesce(p.recent, 0)::int as plays_7d
       from songs s
       left join (
         select song_id, count(*) as recent
           from song_plays
          where played_at > now() - interval '7 days'
          group by 1
       ) p on p.song_id = s.id
      where s.release_status = 'approved'
      order by s.play_count + 5 * coalesce(p.recent, 0) desc, s.play_count desc
      limit $1 offset $2`,
    [limit, offset],
  );
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const { data } = await supabaseService.from("songs").select(SONG_SELECT).in("id", ids);
  const byId = new Map((data ?? []).map((s) => [s.id, s]));
  return rows
    .map((r) => {
      const song = byId.get(r.id) as Record<string, unknown> | undefined;
      return song ? { ...song, plays_7d: r.plays_7d } : null;
    })
    .filter(Boolean);
}

router.get(
  "/",
  apiLimiter,
  validate({ query: listQuery }),
  ah(async (req, res) => {
    const { limit, offset } = req.query as unknown as { limit: number; offset: number };
    const key = `trending:songs:${limit}:${offset}`;
    const cached = cacheGet<unknown[]>(key);
    if (cached) {
      res.json({ songs: cached });
      return;
    }
    const songs = await trendingSongs(limit, offset);
    cacheSet(key, songs, env.CACHE_TTL_MS);
    res.json({ songs });
  }),
);

/** Trending artists: monthly listeners + recent play volume. */
router.get(
  "/artists",
  apiLimiter,
  validate({ query: paginationSchema }),
  ah(async (req, res) => {
    const { limit, offset } = req.query as unknown as { limit: number; offset: number };
    const key = `trending:artists:${limit}:${offset}`;
    const cached = cacheGet<unknown[]>(key);
    if (cached) {
      res.json({ artists: cached });
      return;
    }
    const artists = await pgQuery(
      `select a.id, a.name, a.slug, a.avatar_url, a.cover_url, a.verified,
              a.monthly_listeners, a.region,
              coalesce(p.plays_30d, 0)::int as plays_30d
         from artists a
         left join (
           select s.artist_id, count(*) as plays_30d
             from song_plays sp
             join songs s on s.id = sp.song_id
            where sp.played_at > now() - interval '30 days'
            group by 1
         ) p on p.artist_id = a.id
        where a.status = 'approved'
        order by a.monthly_listeners + 10 * coalesce(p.plays_30d, 0) desc,
                 a.monthly_listeners desc
        limit $1 offset $2`,
      [limit, offset],
    );
    cacheSet(key, artists, env.CACHE_TTL_MS);
    res.json({ artists });
  }),
);

export const trendingRouter = router;

// ─────────────────────────── new releases ────────────────────────────────────

export const newReleasesRouter = (() => {
  const r = Router();

  r.get(
    "/",
    apiLimiter,
    validate({ query: paginationSchema }),
    ah(async (req, res) => {
      const { limit, offset } = req.query as unknown as { limit: number; offset: number };
      const { data, error, count } = await supabaseService
        .from("songs")
        .select(SONG_SELECT, { count: "exact" })
        .eq("release_status", "approved")
        .order("approved_at", { ascending: false, nullsFirst: false })
        .range(offset, offset + limit - 1);
      if (error) throw unprocessable("New releases failed", error.message);
      res.json({ releases: data ?? [], pagination: pageMeta(limit, offset, count ?? 0) });
    }),
  );
  return r;
})();

// ─────────────────────── personalized recommendations ────────────────────────

export const discoverRouter = (() => {
  const r = Router();

  /** GET /discover/recommendations — genre affinity from favorites + plays. */
  r.get(
    "/recommendations",
    attachOptionalUser,
    ah(async (req, res) => {
      if (!req.user) {
        const fallback = await trendingSongs(20, 0);
        res.json({ recommendations: fallback, basis: "trending" });
        return;
      }
      const userId = req.user.id;
      const rows = await pgQuery(
        `with affinity as (
            select sg.genre_id, count(*)::numeric as score
              from favorites f
              join song_genres sg on sg.song_id = f.song_id
             where f.user_id = $1
             group by 1
            union all
            select sg.genre_id, count(*)::numeric * 0.5
              from song_plays sp
              join song_genres sg on sg.song_id = sp.song_id
             where sp.user_id = $1
             group by 1
         ),
         top_genres as (
            select genre_id from affinity group by genre_id order by sum(score) desc limit 5
         )
         select s.id
           from songs s
           join artists a on a.id = s.artist_id and a.status = 'approved'
          where s.release_status = 'approved'
            and s.id not in (select coalesce(song_id, '00000000-0000-0000-0000-000000000000'::uuid)
                               from favorites where user_id = $1)
            and exists (select 1 from song_genres sg
                         where sg.song_id = s.id
                           and sg.genre_id in (select genre_id from top_genres))
          order by s.play_count desc
          limit 20`,
        [userId],
      );

      if (rows.length === 0) {
        const fallback = await trendingSongs(20, 0);
        res.json({ recommendations: fallback, basis: "trending" });
        return;
      }
      const ids = rows.map((r2) => r2.id);
      const { data } = await supabaseService.from("songs").select(SONG_SELECT).in("id", ids);
      // keep the SQL ranking order
      const byId = new Map((data ?? []).map((s) => [s.id, s]));
      res.json({
        recommendations: ids.map((id) => byId.get(id)).filter(Boolean),
        basis: "genre_affinity",
      });
    }),
  );
  return r;
})();
