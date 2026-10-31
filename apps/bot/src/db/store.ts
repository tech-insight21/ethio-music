import { query } from "./pool.js";

/**
 * Bot-owned data: chat registry, notification preferences, artist follows,
 * the duplicate-notification ledger and the release watermark.
 *
 * Every write is parameterised (no string interpolation) and every table is
 * bot_* (RLS on, no anon policies) — reachable only through this connection.
 */

export interface BotChat {
  chat_id: string; // bigint comes back as string from pg
  username: string | null;
  first_name: string | null;
  language_code: string | null;
  notify_new_releases: boolean;
  notify_premium: boolean;
  is_blocked: boolean;
}

export type PrefKey = "notify_new_releases" | "notify_premium";

export interface ChatUpsert {
  id: number;
  username?: string | undefined;
  firstName?: string | undefined;
  languageCode?: string | undefined;
}

export async function upsertChat(c: ChatUpsert): Promise<void> {
  await query(
    `insert into bot_chats (chat_id, username, first_name, language_code, is_blocked)
     values ($1, $2, $3, $4, false)
     on conflict (chat_id) do update
       set username      = coalesce(excluded.username, bot_chats.username),
           first_name    = coalesce(excluded.first_name, bot_chats.first_name),
           language_code = coalesce(excluded.language_code, bot_chats.language_code),
           is_blocked    = false`,
    [c.id, c.username ?? null, c.firstName ?? null, c.languageCode ?? null],
  );
}

export async function getChat(chatId: number): Promise<BotChat | null> {
  const rows = await query<BotChat>(`select * from bot_chats where chat_id = $1`, [chatId]);
  return rows[0] ?? null;
}

export async function setPref(chatId: number, key: PrefKey, value: boolean): Promise<void> {
  await query(
    `insert into bot_chats (chat_id, ${key}) values ($1, $2)
     on conflict (chat_id) do update set ${key} = excluded.${key}`,
    [chatId, value],
  );
}

// ── follows ──────────────────────────────────────────────────────────────────

export async function followArtist(chatId: number, artistId: string): Promise<boolean> {
  const rows = await query(
    `insert into bot_follows (chat_id, artist_id) values ($1, $2)
     on conflict (chat_id, artist_id) do nothing
     returning chat_id`,
    [chatId, artistId],
  );
  return rows.length > 0; // false ⇒ already following (composite PK blocked it)
}

export async function unfollowArtist(chatId: number, artistId: string): Promise<boolean> {
  const rows = await query(
    `delete from bot_follows where chat_id = $1 and artist_id = $2 returning chat_id`,
    [chatId, artistId],
  );
  return rows.length > 0;
}

export async function isFollowing(chatId: number, artistId: string): Promise<boolean> {
  const rows = await query(
    `select 1 as ok from bot_follows where chat_id = $1 and artist_id = $2`,
    [chatId, artistId],
  );
  return rows.length > 0;
}

export async function countBotFollowers(artistId: string): Promise<number> {
  const rows = await query<{ n: string }>(
    `select count(*)::text as n from bot_follows where artist_id = $1`,
    [artistId],
  );
  return Number(rows[0]?.n ?? 0);
}

export interface FollowedArtist {
  artist_id: string;
  name: string;
  slug: string;
}

export async function listFollowedArtists(chatId: number): Promise<FollowedArtist[]> {
  return query<FollowedArtist>(
    `select f.artist_id, a.name, a.slug
     from bot_follows f join artists a on a.id = f.artist_id
     where f.chat_id = $1 order by a.name`,
    [chatId],
  );
}

// ── notification fan-out ─────────────────────────────────────────────────────

export interface Recipient {
  chat_id: string;
  notify_new_releases: boolean;
  following: boolean;
}

/**
 * Recipients for a new release: everyone with the global preference on, plus
 * every chat that follows this artist even with the global pref off
 * (an explicit per-artist opt-in). Blocked chats never receive anything.
 */
export async function releaseRecipients(artistId: string): Promise<Recipient[]> {
  return query<Recipient>(
    `select distinct c.chat_id, c.notify_new_releases,
            exists (select 1 from bot_follows f
                    where f.chat_id = c.chat_id and f.artist_id = $1) as following
     from bot_chats c
     where c.is_blocked = false
       and (c.notify_new_releases
            or exists (select 1 from bot_follows f
                       where f.chat_id = c.chat_id and f.artist_id = $1))`,
    [artistId],
  );
}

/**
 * Claim-before-send: the composite PK (chat_id, song_id, kind) is the dedup
 * gate. Returns true only when this call inserted the claim row — i.e. this
 * caller is the one allowed to send. Concurrent dispatchers can never
 * double-send.
 */
export async function claimNotification(
  chatId: number,
  songId: string,
  kind: "new_release" | "premium" | "system",
): Promise<boolean> {
  const rows = await query(
    `insert into bot_sent_notifications (chat_id, song_id, kind) values ($1, $2, $3)
     on conflict (chat_id, song_id, kind) do nothing
     returning chat_id`,
    [chatId, songId, kind],
  );
  return rows.length > 0;
}

// ── watermark (notification engine bookkeeping) ──────────────────────────────

export async function getWatermark(): Promise<Date | null> {
  const rows = await query<{ value: Date | null }>(
    `select value from bot_state where key = 'release_watermark'`,
  );
  return rows[0]?.value ? new Date(rows[0].value) : null;
}

export async function setWatermark(t: Date): Promise<void> {
  await query(
    `insert into bot_state (key, value, updated_at) values ('release_watermark', $1, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [t.toISOString()],
  );
}

/** Database clock — keeps watermark math consistent with songs.created_at. */
export async function dbNow(): Promise<Date> {
  const rows = await query<{ now: Date }>(`select now() as now`);
  return new Date(rows[0].now);
}

// ── admin stats ──────────────────────────────────────────────────────────────

export interface BotStats {
  chats: number;
  opted_in: number;
  follows: number;
  sent: number;
}

export async function botStats(): Promise<BotStats> {
  const rows = await query<BotStats>(
    `select
       (select count(*) from bot_chats)                                            as chats,
       (select count(*) from bot_chats where notify_new_releases and not is_blocked) as opted_in,
       (select count(*) from bot_follows)                                          as follows,
       (select count(*) from bot_sent_notifications)                               as sent`,
  );
  return rows[0];
}

/** Chats eligible for admin broadcasts (skip fully-muted ones). */
export async function broadcastRecipients(): Promise<string[]> {
  const rows = await query<{ chat_id: string }>(
    `select chat_id from bot_chats
     where is_blocked = false and (notify_new_releases or notify_premium)`,
  );
  return rows.map((r) => r.chat_id);
}
