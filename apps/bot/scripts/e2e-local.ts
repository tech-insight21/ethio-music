/**
 * Local E2E harness — exercises EVERY command and inline callback through the
 * real Telegraf pipeline (bot.handleUpdate), with the Telegram API layer
 * mocked so the run is deterministic and side-effect free.
 *
 * Asserts both sides of each interaction:
 *   • handler behaviour  → captured callApi payloads (text / keyboards / alerts)
 *   • state effects      → live bot_* tables (chat registry, follows, prefs)
 *
 *   set -a; source .env; set +a; npm run e2e
 */
import type { Telegraf } from "telegraf";
import { loadConfig } from "../src/config.js";
import { initPool, query, closePool } from "../src/db/pool.js";
import { getChat, isFollowing } from "../src/db/store.js";
import { initCatalog, listArtists, searchSongs } from "../src/db/catalog.js";
import { createBot } from "../src/telegram/bot.js";
import type { BotContext } from "../src/telegram/context.js";
import { log } from "../src/logger.js";

const TEST_CHAT = 999_000_333;

const results: Array<{ name: string; ok: boolean; info?: string }> = [];
function check(name: string, ok: boolean, info?: string): void {
  results.push({ name, ok, info });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? ` — ${info}` : ""}`);
}

interface CapturedCall { method: string; payload: Record<string, unknown> }

function mockTelegramApi(bot: Telegraf<BotContext>): CapturedCall[] {
  const calls: CapturedCall[] = [];
  // handleUpdate() creates a fresh Telegram instance per update, so the mock
  // must go on the prototype that actually owns callApi.
  let proto: object | null = Object.getPrototypeOf(bot.telegram);
  while (proto && !Object.getOwnPropertyNames(proto).includes("callApi")) {
    proto = Object.getPrototypeOf(proto);
  }
  if (!proto) throw new Error("callApi not found in prototype chain");
  const original = (proto as Record<string, unknown>).callApi as (
    method: string,
    payload?: unknown,
  ) => Promise<unknown>;
  (proto as Record<string, unknown>).callApi = async (method: string, payload?: unknown) => {
    calls.push({ method, payload: (payload ?? {}) as Record<string, unknown> });
    if (method === "getMe") {
      return { id: 1, is_bot: true, first_name: "ETHIO MUSIC", username: "ethiopmusicbot" };
    }
    if (method.startsWith("send") || method.startsWith("edit")) {
      return { message_id: 1, date: 0, chat: { id: TEST_CHAT, type: "private" } };
    }
    return true;
  };
  // restore on process exit so nothing else inherits the mock
  process.on("exit", () => {
    (proto as Record<string, unknown>).callApi = original;
  });
  return calls;
}

let updateId = 10_000;
function textUpdate(text: string) {
  updateId += 1;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: TEST_CHAT, is_bot: false, first_name: "E2E", username: "e2e_tester", language_code: "en" },
      chat: { id: TEST_CHAT, type: "private", first_name: "E2E" },
      date: Math.floor(Date.now() / 1000),
      text,
      // real Telegram always tags commands with a bot_command entity —
      // Telegraf's command filter requires it
      ...(text.startsWith("/")
        ? { entities: [{ offset: 0, length: text.split(/\s+/)[0].length, type: "bot_command" }] }
        : {}),
    },
  };
}
function callbackUpdate(data: string) {
  updateId += 1;
  return {
    update_id: updateId,
    callback_query: {
      id: String(updateId),
      from: { id: TEST_CHAT, is_bot: false, first_name: "E2E", username: "e2e_tester", language_code: "en" },
      message: {
        message_id: 500,
        chat: { id: TEST_CHAT, type: "private", first_name: "E2E" },
        date: Math.floor(Date.now() / 1000),
        text: "E2E origin message",
      },
      chat_instance: "e2e",
      data,
    },
  };
}

function sent(calls: CapturedCall[], method: string): string {
  const found = [...calls].reverse().find((c) => c.method === method);
  if (!found) return "";
  const p = found.payload as { text?: string; caption?: string };
  return (p.text ?? p.caption ?? "").toString();
}
function lastMethod(calls: CapturedCall[]): string {
  return calls[calls.length - 1]?.method ?? "(none)";
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  initPool(cfg.db);
  initCatalog(cfg);

  const bot = createBot(cfg);
  const calls = mockTelegramApi(bot);

  // pre-clean from any previous crashed run
  await query(`delete from bot_chats where chat_id = $1`, [TEST_CHAT]);

  const artists = await listArtists(5);
  const firstArtist = artists[0];
  if (!firstArtist) throw new Error("catalog empty — run the seed migration first");

  // ── 1. /start — welcome + registration ────────────────────────────────────
  await bot.handleUpdate(textUpdate("/start") as never);
  const startMsg = sent(calls, "sendMessage");
  check("/start welcome renders", startMsg.includes("እንኳን ደህና መጡ") && startMsg.includes("ETHIO MUSIC"));
  check("/start registers chat with web-app keyboard", (await getChat(TEST_CHAT)) !== null && lastMethod(calls) === "sendMessage");

  // ── 2. /help, /app ─────────────────────────────────────────────────────────
  await bot.handleUpdate(textUpdate("/help") as never);
  check("/help lists commands", sent(calls, "sendMessage").includes("/paysupport"));
  await bot.handleUpdate(textUpdate("/app") as never);
  const appCall = [...calls].reverse().find((c) => c.method === "sendMessage");
  const appKb = (appCall?.payload as { reply_markup?: { inline_keyboard?: Array<Array<{ web_app?: { url: string } }>> } }).reply_markup;
  check("/app shows Open Music App button", !!appKb?.inline_keyboard?.[0]?.[0]?.web_app?.url);

  // ── 3. /trending + pager ───────────────────────────────────────────────────
  await bot.handleUpdate(textUpdate("/trending") as never);
  check("/trending lists songs", sent(calls, "sendMessage").includes("Trending"));
  await bot.handleUpdate(callbackUpdate("pg:t:1") as never);
  check(
    "pager pg:t:1 edits in place",
    sent(calls, "editMessageText").includes("Trending") && sent(calls, "editMessageText").includes("6."),
  );

  // ── 4. /new ─────────────────────────────────────────────────────────────────
  await bot.handleUpdate(textUpdate("/new") as never);
  check("/new lists fresh releases", sent(calls, "sendMessage").includes("Fresh on ETHIO MUSIC"));

  // ── 5. search: command + plain text ────────────────────────────────────────
  const seedSong = (await searchSongs("a", 1))[0];
  await bot.handleUpdate(textUpdate(`/search ${seedSong ? seedSong.title.slice(0, 6) : "a"}`) as never);
  check("/search finds results", sent(calls, "sendMessage").includes("Results for"));
  await bot.handleUpdate(textUpdate("zzz_no_such_song_e2e") as never);
  check("plain text → search (empty state)", sent(calls, "sendMessage").includes("No results"));
  await bot.handleUpdate(textUpdate("/totally_unknown_cmd") as never);
  check("unknown command gets guidance", sent(calls, "sendMessage").includes("Unknown command"));

  // ── 6. /artists → detail → follow → duplicate follow → unfollow ───────────
  await bot.handleUpdate(textUpdate("/artists") as never);
  check("/artists lists artists", sent(calls, "sendMessage").includes("Ethiopian artists"));
  await bot.handleUpdate(callbackUpdate(`ad:${firstArtist.id}`) as never);
  check("artist detail shows top tracks", sent(calls, "editMessageText").includes("Top tracks"));
  await bot.handleUpdate(callbackUpdate(`f:${firstArtist.id}`) as never);
  check("follow writes bot_follows", await isFollowing(TEST_CHAT, firstArtist.id));
  await bot.handleUpdate(callbackUpdate(`f:${firstArtist.id}`) as never);
  check("duplicate follow blocked (composite PK)", (await query<{ n: string }>(`select count(*)::text n from bot_follows where chat_id=$1`, [TEST_CHAT]))[0].n === "1");
  await bot.handleUpdate(callbackUpdate(`u:${firstArtist.id}`) as never);
  check("unfollow removes row", !(await isFollowing(TEST_CHAT, firstArtist.id)));

  // ── 7. /premium, /paysupport ────────────────────────────────────────────────
  await bot.handleUpdate(textUpdate("/premium") as never);
  check("/premium shows ETB plans", sent(calls, "sendMessage").includes("ETB"));
  await bot.handleUpdate(textUpdate("/paysupport") as never);
  check("/paysupport explains billing", sent(calls, "sendMessage").includes("Telebirr"));

  // ── 8. /settings + preference toggles ──────────────────────────────────────
  await bot.handleUpdate(textUpdate("/settings") as never);
  check("/settings shows prefs", sent(calls, "sendMessage").includes("New releases: ✅ ON"));
  await bot.handleUpdate(callbackUpdate("prefs:nr") as never);
  check("toggle new releases OFF", (await getChat(TEST_CHAT))?.notify_new_releases === false);
  await bot.handleUpdate(callbackUpdate("prefs:nr") as never);
  check("toggle new releases back ON", (await getChat(TEST_CHAT))?.notify_new_releases === true);
  await bot.handleUpdate(callbackUpdate("prefs:nr0") as never);
  check("mute button on notifications works", (await getChat(TEST_CHAT))?.notify_new_releases === false);
  await query(`update bot_chats set notify_new_releases = true where chat_id = $1`, [TEST_CHAT]);

  // ── 9. admin: denied by default (no ADMIN_TELEGRAM_IDS) ─────────────────────
  await bot.handleUpdate(textUpdate("/admin") as never);
  check("/admin denied without allowlist", sent(calls, "sendMessage").includes("Admin only"));
  await bot.handleUpdate(textUpdate("/broadcast secret test") as never);
  check("/broadcast denied without allowlist", sent(calls, "sendMessage").includes("Admin only"));

  // ── 10. home callback ────────────────────────────────────────────────────────
  await bot.handleUpdate(callbackUpdate("home") as never);
  check("home callback returns to main menu", sent(calls, "editMessageText").includes("እንኳን ደህና መጡ"));

  if (process.env.E2E_DEBUG) {
    for (const c of calls) {
      const p = c.payload as { text?: string; caption?: string };
      const t = (p.text ?? p.caption ?? "").replace(/\n/g, " ⏎ ");
      if (t) console.log(`DEBUG ${c.method}: ${t.slice(0, 200)}`);
    }
  }
}

main()
  .then(() => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    return query(`delete from bot_chats where chat_id = $1`, [TEST_CHAT])
      .then(closePool)
      .then(() => process.exit(failed.length ? 1 : 0));
  })
  .catch(async (err) => {
    log.error("e2e failed", { err: err instanceof Error ? err.message : String(err) });
    await query(`delete from bot_chats where chat_id = $1`, [TEST_CHAT]).catch(() => undefined);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
