import { Router } from "express";
import { z } from "zod";
import { attachOptionalUser, authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/require-admin.js";
import { validate } from "../../middleware/validate.js";
import { apiLimiter } from "../../middleware/rate-limit.js";
import { ah } from "../../utils/async-handler.js";
import { unprocessable } from "../../utils/http-error.js";
import { cacheGet, cacheSet } from "../../lib/cache.js";
import { pgQuery } from "../../lib/pg.js";
import { supabaseService } from "../../lib/supabase.js";
import { env } from "../../config/env.js";

const router = Router();

const EVENT_TYPES = [
  "song_play",
  "search",
  "artist_follow",
  "song_favorite",
  "playlist_create",
  "premium_convert",
  "app_open",
  "share",
] as const;

/** POST /analytics/events — lightweight event ingestion. */
router.post(
  "/events",
  attachOptionalUser,
  apiLimiter,
  validate({
    body: z.object({
      type: z.enum(EVENT_TYPES),
      entity_type: z.string().max(40).optional(),
      entity_id: z.string().max(120).optional(),
      meta: z.record(z.unknown()).default({}),
    }),
  }),
  ah(async (req, res) => {
    const body = req.body as {
      type: string;
      entity_type?: string;
      entity_id?: string;
      meta: Record<string, unknown>;
    };
    const userId = req.user?.id ?? null;
    if (!userId && !["app_open", "song_play", "share"].includes(body.type)) {
      res.status(202).json({ recorded: false, note: "anonymous events limited to app_open/song_play/share" });
      return;
    }
    // analytics_events is RLS-locked (no client policies) → service insert,
    // attribution ONLY from the verified token (never from the body).
    const { error } = await supabaseService.from("analytics_events").insert({
      user_id: userId,
      type: body.type,
      entity_type: body.entity_type ?? null,
      entity_id: body.entity_id ?? null,
      meta: body.meta,
    });
    if (error) throw unprocessable("Event not recorded", error.message);
    res.status(202).json({ recorded: true });
  }),
);

// ───────────────────────────── admin analytics ───────────────────────────────

router.use(authenticate, requirePermission("analytics:read"));

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await fn();
  cacheSet(key, value, env.CACHE_TTL_MS);
  return value;
}

/** GET /analytics/overview — platform KPIs. */
router.get(
  "/overview",
  ah(async (_req, res) => {
    const data = await cached("analytics:overview", async () => {
      const rows = await pgQuery(
        `select
          (select count(*) from profiles)                                          as total_users,
          (select count(*) from profiles where created_at > now() - interval '24 hours') as new_users_24h,
          (select count(*) from profiles where created_at > now() - interval '7 days')  as new_users_7d,
          (select count(distinct user_id) from analytics_events
             where created_at > now() - interval '24 hours' and user_id is not null)   as dau,
          (select count(distinct user_id) from (
              select user_id from analytics_events where created_at > now() - interval '30 days' and user_id is not null
              union
              select user_id from song_plays where played_at > now() - interval '30 days' and user_id is not null
           ) u)                                                                     as mau,
          (select count(*) from songs where release_status = 'approved')            as approved_songs,
          (select count(*) from artists where status = 'approved')                  as approved_artists,
          (select count(*) from playlists)                                          as playlists,
          (select count(*) from follows)                                            as follows,
          (select count(*) from subscriptions where status = 'active' and ends_at > now()) as active_subscriptions,
          (select count(*) from payments where status = 'completed')                as completed_payments,
          (select count(*) from bot_chats)                                          as bot_chats`,
      );
      return rows[0];
    });
    res.json(data);
  }),
);

/** GET /analytics/listeners — 30-day activity + acquisition series. */
router.get(
  "/listeners",
  ah(async (_req, res) => {
    const data = await cached("analytics:listeners", async () => {
      const activity = await pgQuery(
        `with days as (
           select generate_series(current_date - 29, current_date, '1 day')::date as day
         )
         select d.day::text,
                (select count(distinct sp.user_id) from song_plays sp
                  where sp.played_at::date = d.day and sp.user_id is not null)      as active_listeners,
                (select count(*) from profiles p where p.created_at::date = d.day)  as new_users
           from days d order by d.day`,
      );
      return { daily: activity };
    });
    res.json(data);
  }),
);

/** GET /analytics/content — top songs / artists / genres, searches. */
router.get(
  "/content",
  ah(async (_req, res) => {
    const data = await cached("analytics:content", async () => {
      const [topSongs, topArtists, topGenres, searches] = await Promise.all([
        pgQuery(
          `select s.id, s.title, s.slug, s.play_count,
                  coalesce(r.recent_30d, 0)::int as plays_30d,
                  a.name as artist_name, a.slug as artist_slug
             from songs s
             join artists a on a.id = s.artist_id
             left join (
               select song_id, count(*) as recent_30d from song_plays
                where played_at > now() - interval '30 days' group by 1
             ) r on r.song_id = s.id
            where s.release_status = 'approved'
            order by s.play_count desc limit 10`,
        ),
        pgQuery(
          `select a.id, a.name, a.slug, a.monthly_listeners,
                  coalesce(sum(s.play_count), 0)::bigint as total_plays
             from artists a left join songs s on s.artist_id = a.id and s.release_status = 'approved'
            where a.status = 'approved'
            group by a.id order by total_plays desc limit 10`,
        ),
        pgQuery(
          `select g.id, g.name, g.slug, count(sg.song_id)::int as songs,
                  coalesce(sum(s.play_count), 0)::bigint as plays
             from genres g
             left join song_genres sg on sg.genre_id = g.id
             left join songs s on s.id = sg.song_id and s.release_status = 'approved'
            group by g.id order by plays desc limit 10`,
        ),
        pgQuery<{ total: string; unique_users: string; top: { query: string; n: string }[] }>(
          `select (select count(*) from analytics_events where type = 'search')::text as total,
                  (select count(distinct user_id) from analytics_events where type = 'search' and user_id is not null)::text as unique_users`,
        ),
      ]);
      const topQueries = await pgQuery(
        `select query, count(*)::text as n from search_history
          group by query order by count(*) desc limit 10`,
      );
      return {
        top_songs: topSongs,
        top_artists: topArtists,
        top_genres: topGenres,
        searches: { ...searches[0], top_queries: topQueries },
      };
    });
    res.json(data);
  }),
);

/** GET /analytics/revenue — Stars/ETB revenue + conversions + promos. */
router.get(
  "/revenue",
  ah(async (_req, res) => {
    const data = await cached("analytics:revenue", async () => {
      const [totals, series, conversions, promotions] = await Promise.all([
        pgQuery(
          `select provider, currency, status,
                  count(*)::int as payments,
                  coalesce(sum(amount_stars), 0)::int as stars,
                  coalesce(sum(case when currency = 'ETB' then amount_etb else 0 end), 0) as etb
             from payments
            group by provider, currency, status`,
        ),
        pgQuery(
          `with days as (select generate_series(current_date - 29, current_date, '1 day')::date as day)
           select d.day::text,
                  (select count(*) from payments p where p.paid_at::date = d.day and p.status = 'completed') as payments,
                  (select coalesce(sum(p.amount_stars), 0) from payments p where p.paid_at::date = d.day and p.status = 'completed') as stars
             from days d order by d.day`,
        ),
        pgQuery(
          `select count(distinct p.user_id)::int as paying_users,
                  (select count(*) from profiles)::int as total_users
             from payments p where p.status = 'completed'`,
        ),
        pgQuery(
          `select status, count(*)::int as campaigns,
                  coalesce(sum(impressions), 0)::int as impressions,
                  coalesce(sum(clicks), 0)::int as clicks
             from promotions group by status`,
        ),
      ]);
      return { totals, daily: series, conversions: conversions[0], promotions };
    });
    res.json(data);
  }),
);

export const analyticsRouter = router;
