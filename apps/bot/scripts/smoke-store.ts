/**
 * Store-layer smoke test against the LIVE database.
 * Exercises every bot_* operation with a dedicated test chat, then cleans up.
 * Exit code 0 = all green.
 *
 *   set -a; source .env; set +a; npm run smoke
 */
import { loadConfig } from "../src/config.js";
import { initPool, query, closePool } from "../src/db/pool.js";
import {
  upsertChat, getChat, setPref, followArtist, unfollowArtist, isFollowing,
  listFollowedArtists, countBotFollowers, releaseRecipients,
  claimNotification, getWatermark, setWatermark, dbNow, botStats, broadcastRecipients,
} from "../src/db/store.js";
import { initCatalog, listArtists, latestSongs } from "../src/db/catalog.js";
import { log } from "../src/logger.js";

const TEST_CHAT = 999_000_111; // dedicated smoke-test chat id (never a real user)

const results: Array<{ name: string; ok: boolean; info?: string }> = [];
function check(name: string, ok: boolean, info?: string): void {
  results.push({ name, ok, info });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? ` — ${info}` : ""}`);
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  console.log("db target:", `${cfg.db.user}@${cfg.db.host}:${cfg.db.port}/${cfg.db.database}`);
  initPool(cfg.db);
  initCatalog(cfg);

  // 0. pre-clean (a previous crashed run may have left state) — deterministic reruns
  await query(`delete from bot_chats where chat_id = $1`, [TEST_CHAT]);

  // 1. chat registry — insert then update path
  await upsertChat({ id: TEST_CHAT, username: "e2e_tester", firstName: "E2E", languageCode: "en" });
  await upsertChat({ id: TEST_CHAT, username: "e2e_tester_2" });
  const chat = await getChat(TEST_CHAT);
  check("upsertChat insert+update", chat?.username === "e2e_tester_2" && chat?.first_name === "E2E");

  // 2. preferences
  await setPref(TEST_CHAT, "notify_new_releases", false);
  const muted = (await getChat(TEST_CHAT))?.notify_new_releases === false;
  await setPref(TEST_CHAT, "notify_new_releases", true);
  const unmuted = (await getChat(TEST_CHAT))?.notify_new_releases === true;
  check("setPref toggle", muted && unmuted);

  // 3. follows — composite PK blocks the duplicate
  const artist = (await listArtists(1))[0];
  if (!artist) throw new Error("no approved artist in catalog — seed missing?");
  const first = await followArtist(TEST_CHAT, artist.id);
  const dup = await followArtist(TEST_CHAT, artist.id);
  const following = await isFollowing(TEST_CHAT, artist.id);
  const listed = await listFollowedArtists(TEST_CHAT);
  check("followArtist + dedup", first === true && dup === false && following && listed.length === 1);

  const botFollowers = await countBotFollowers(artist.id);
  check("countBotFollowers", botFollowers >= 1);

  // 4. fan-out recipient selection (global pref on ⇒ recipient, following=true)
  const recipients = await releaseRecipients(artist.id);
  const me = recipients.find((r) => r.chat_id === String(TEST_CHAT));
  check("releaseRecipients", !!me && me.following === true);

  // 5. dedup claim ledger — second claim must lose (needs a real song: FK)
  const anySong = (await latestSongs(1))[0];
  if (!anySong) throw new Error("no approved song in catalog — seed missing?");
  const claim1 = await claimNotification(TEST_CHAT, anySong.id, "new_release");
  const claim2 = await claimNotification(TEST_CHAT, anySong.id, "new_release");
  check("claimNotification dedup", claim1 === true && claim2 === false);

  // 6. unfollow removes the row
  const removed = await unfollowArtist(TEST_CHAT, artist.id);
  const afterUnfollow = await isFollowing(TEST_CHAT, artist.id);
  check("unfollowArtist", removed && !afterUnfollow);

  // 7. watermark round-trip + db clock
  const now = await dbNow();
  await setWatermark(now);
  const wm = await getWatermark();
  check("watermark round-trip", !!wm && Math.abs(wm.getTime() - now.getTime()) < 5000);

  // 8. stats + broadcast eligibility
  const stats = await botStats();
  check("botStats", stats.chats >= 1);
  const bcast = await broadcastRecipients();
  check("broadcastRecipients includes opted-in chat", bcast.includes(String(TEST_CHAT)));

  // cleanup — deleting the chat cascades follows + claims
  await query(`delete from bot_chats where chat_id = $1`, [TEST_CHAT]);
  const gone = (await getChat(TEST_CHAT)) === null;
  check("cleanup cascades", gone);
}

main()
  .then(() => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    return closePool().then(() => process.exit(failed.length ? 1 : 0));
  })
  .catch(async (err) => {
    console.error("smoke failed:", err instanceof Error ? err.stack : err);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
