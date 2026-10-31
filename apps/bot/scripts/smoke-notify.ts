/**
 * Notification-engine E2E against the LIVE database + real Telegram API.
 *
 * Proves, end to end:
 *   1. a newly approved song is picked up via the watermark
 *   2. claim-before-send writes exactly one dedup row per (chat, song)
 *   3. a second dispatch cannot re-notify (requirement 13)
 *   4. send failures are contained (test chat doesn't exist on Telegram,
 *      so sendMessage fails with "chat not found" — the claim stays,
 *      no crash, and the failure is reported)
 *
 * Inserts a temporary approved song (license fields satisfied — the CHECK
 * constraint requires them), runs the engine twice, asserts, then cleans
 * everything up and restores the watermark.
 *
 *   set -a; source .env; set +a; npm run smoke:notify
 */
import { Telegraf } from "telegraf";
import { loadConfig } from "../src/config.js";
import { initPool, query, closePool } from "../src/db/pool.js";
import {
  upsertChat, followArtist, claimNotification, getWatermark, setWatermark,
} from "../src/db/store.js";
import { initCatalog, listArtists, newestApprovedAt, songsSince } from "../src/db/catalog.js";
import { dispatchNewReleases } from "../src/notify/engine.js";
import { log } from "../src/logger.js";

const TEST_CHAT = 999_000_222;

const results: Array<{ name: string; ok: boolean; info?: string }> = [];
function check(name: string, ok: boolean, info?: string): void {
  results.push({ name, ok, info });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? ` — ${info}` : ""}`);
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  initPool(cfg.db);
  initCatalog(cfg);

  const artist = (await listArtists(1))[0];
  if (!artist) throw new Error("no approved artist — seed missing?");

  // pre-clean from any previous crashed run + reset the watermark so the
  // pipeline is empty BEFORE staging the temp song
  await query(`delete from bot_chats where chat_id = $1`, [TEST_CHAT]);
  await query(`delete from songs where slug like 'e2e-notify-%'`);
  const baseline = await newestApprovedAt();
  if (baseline) await setWatermark(baseline);

  // temp approved song (created_at = now ⇒ fresh vs. watermark)
  const slug = `e2e-notify-${Date.now()}`;
  const songRows = await query<{ id: string }>(
    `insert into songs
       (artist_id, title, slug, audio_url, rights_holder, license_type,
        license_document_url, licensed_at, release_status, duration_seconds)
     values ($1, $2, $3, $4, $5, 'creative_commons', $6, now(), 'approved', 187)
     returning id`,
    [artist.id, "E2E Notify Test Track", slug, "https://example.com/e2e.mp3",
     "ETHIO MUSIC E2E", "https://example.com/license.pdf"],
  );
  const songId = songRows[0].id;
  console.log(`temp song ${songId} (${slug})`);

  try {
    // chat registered, follows the artist, global pref ON (default)
    await upsertChat({ id: TEST_CHAT, username: "e2e_notify", firstName: "E2E" });
    await followArtist(TEST_CHAT, artist.id);

    const telegram = new Telegraf(cfg.botToken).telegram;

    // rewind the watermark so the temp song is fresh
    await setWatermark(new Date(Date.now() - 10 * 60_000));

    const probeWm = await getWatermark();
    const probeSongs = await songsSince(probeWm ?? new Date(0), 25);
    console.log(
      `probe: wm=${probeWm?.toISOString()} songCreated=${songId} found=${probeSongs.length} titles=${probeSongs.map((s) => s.title).join(",")}`,
    );
    const byIdSql = await query<{ release_status: string; created_at: string }>(
      `select release_status, created_at from songs where id = $1`,
      [songId],
    );
    console.log("probe by-id SQL:", JSON.stringify(byIdSql[0]));
    const { createClient } = await import("@supabase/supabase-js");
    const sbProbe = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: false } });
    const { data: byIdRest, error: byIdErr } = await sbProbe
      .from("songs")
      .select("id, title, created_at, release_status")
      .eq("id", songId)
      .maybeSingle();
    console.log("probe by-id REST:", JSON.stringify({ data: byIdRest, error: byIdErr?.message }));

    const report1 = await dispatchNewReleases(cfg, telegram);
    check("run 1 picks up the new song", report1.songs >= 1, `songs=${report1.songs}`);
    check("run 1 claims the (chat, song) pair", report1.claimed >= 1, `claimed=${report1.claimed}`);
    check(
      "run 1 send fails cleanly (test chat not on Telegram)",
      report1.failed >= 1,
      `failed=${report1.failed}`,
    );

    const claims = await query<{ n: string }>(
      `select count(*)::text as n from bot_sent_notifications where song_id = $1 and chat_id = $2`,
      [songId, TEST_CHAT],
    );
    check("exactly one dedup row written", claims[0]?.n === "1", `rows=${claims[0]?.n}`);

    // rewind again: the claim must block the re-notify (the dedup gate itself)
    await setWatermark(new Date(Date.now() - 10 * 60_000));
    const report2 = await dispatchNewReleases(cfg, telegram);
    check(
      "run 2 cannot re-notify (dedup gate)",
      report2.claimed === 0 && report2.sent === 0 && report2.deduped >= 1,
      `claimed=${report2.claimed} deduped=${report2.deduped}`,
    );
  } finally {
    // cleanup: song cascade removes claims; chat cascade removes follows;
    // watermark re-pinned to the newest real release
    await query(`delete from songs where id = $1`, [songId]);
    await query(`delete from bot_chats where chat_id = $1`, [TEST_CHAT]);
    const newest = await newestApprovedAt();
    if (newest) await setWatermark(newest);
    const wm = await getWatermark();
    console.log(`cleanup done — watermark restored to ${wm?.toISOString()}`);
  }
}

main()
  .then(() => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    return closePool().then(() => process.exit(failed.length ? 1 : 0));
  })
  .catch(async (err) => {
    log.error("smoke:notify failed", { err: err instanceof Error ? err.message : String(err) });
    await query(`delete from bot_chats where chat_id = $1`, [TEST_CHAT]).catch(() => undefined);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
