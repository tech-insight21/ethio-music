import type { Telegram } from "telegraf";
import type { Config } from "../config.js";
import { log } from "../logger.js";
import { songsSince, newestApprovedAt, type CatalogSong } from "../db/catalog.js";
import {
  getWatermark,
  setWatermark,
  dbNow,
  releaseRecipients,
  claimNotification,
} from "../db/store.js";
import { coverUrlOf, esc, bold, fmtDuration, fmtCount } from "../telegram/format.js";
import { releaseKb } from "../telegram/keyboards.js";

/**
 * New-release notification engine (requirements 7, 13, 14).
 *
 * Watermark  : bot_state.release_watermark — songs with created_at > watermark
 *              are "fresh". First run initialises the watermark to the newest
 *              existing release so a fresh install doesn't spam the catalog.
 * Dedup      : bot_sent_notifications (chat_id, song_id, kind) composite PK —
 *              claim-before-send via INSERT … ON CONFLICT DO NOTHING RETURNING.
 *              Exactly one dispatcher can ever claim a (chat, song) pair.
 * Preferences: recipients = chats with notify_new_releases ON, plus chats
 *              following the song's artist (explicit per-artist opt-in even
 *              when the global pref is OFF). Blocked chats are excluded.
 *
 * Send failures keep the claim (at-most-once) — a retry after a real Telegram
 * outage would risk duplicates otherwise; the log makes gaps observable.
 */

export interface DispatchReport {
  from: string;
  to: string;
  songs: number;
  claimed: number;
  sent: number;
  failed: number;
  deduped: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SEND_GAP_MS = 35; // stay under Telegram's ~30 msg/s global limit

export async function dispatchNewReleases(
  cfg: Config,
  telegram: Telegram,
): Promise<DispatchReport> {
  // 1. watermark (init on first run: don't announce the existing catalog)
  let wm = await getWatermark();
  if (!wm) {
    const newest = await newestApprovedAt();
    wm = newest ?? (await dbNow());
    await setWatermark(wm);
    log.info("watermark initialised", { to: wm.toISOString() });
  }
  const runStart = await dbNow();

  // 2. fresh approved songs (anon REST, RLS: approved only)
  const songs = await songsSince(wm, 25);
  let claimed = 0;
  let sent = 0;
  let failed = 0;
  let deduped = 0;

  for (const song of songs) {
    const artistId = song.artist?.id;
    if (!artistId) continue;
    const recipients = await releaseRecipients(artistId);
    for (const r of recipients) {
      const chatId = Number(r.chat_id);
      if (!(await claimNotification(chatId, song.id, "new_release"))) {
        deduped += 1; // already delivered by an earlier run/dispatcher
        continue;
      }
      claimed += 1;
      try {
        await sendRelease(telegram, chatId, song, {
          following: r.following,
          tmaUrl: cfg.tmaUrl,
        });
        sent += 1;
      } catch (err) {
        failed += 1;
        log.warn("release send failed", {
          chat: chatId,
          song: song.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      await sleep(SEND_GAP_MS);
    }
  }

  // 3. advance watermark to run start (songs landing mid-run → next run)
  await setWatermark(runStart);

  const report: DispatchReport = {
    from: wm.toISOString(),
    to: runStart.toISOString(),
    songs: songs.length,
    claimed,
    sent,
    failed,
    deduped,
  };
  log.info("dispatch complete", report);
  return report;
}

function releaseText(song: CatalogSong, following: boolean): string {
  return [
    following ? "🔔 New release from an artist you follow" : "🆕 New release on ETHIO MUSIC",
    "",
    `🎵 ${bold(song.title)}`,
    song.artist?.name ? `🎤 ${esc(song.artist.name)}` : "",
    `⏱ ${fmtDuration(song.duration_seconds)} · ${fmtCount(song.play_count)} plays`,
    "",
    esc("Tap below to play it in the app 👇"),
  ]
    .filter(Boolean)
    .join("\n");
}

async function sendRelease(
  telegram: Telegram,
  chatId: number,
  song: CatalogSong,
  opts: { following: boolean; tmaUrl: string },
): Promise<void> {
  const text = releaseText(song, opts.following);
  const kb = releaseKb({ artistId: song.artist!.id, following: opts.following, tmaUrl: opts.tmaUrl });
  const cover = coverUrlOf(song);

  if (cover) {
    await telegram.sendPhoto(chatId, cover, { caption: text, parse_mode: "MarkdownV2", ...kb });
  } else {
    await telegram.sendMessage(chatId, text, { parse_mode: "MarkdownV2", ...kb });
  }
}
