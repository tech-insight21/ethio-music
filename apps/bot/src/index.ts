import { Telegraf } from "telegraf";
import { loadConfig } from "./config.js";
import { log, setLevel } from "./logger.js";
import { initPool, closePool } from "./db/pool.js";
import { initCatalog } from "./db/catalog.js";
import { createBot, PUBLIC_COMMANDS } from "./telegram/bot.js";
import { dispatchNewReleases } from "./notify/engine.js";

/**
 * ETHIO MUSIC Telegram bot — entrypoint.
 *
 * Modes (picked from env):
 *   NOTIFY_ONLY=1            headless new-release dispatch (Actions cron),
 *                            then exit 0.
 *   WEBHOOK_URL=https://…    webhook mode (prod hosting: Railway/Render/Fly/VPS)
 *   otherwise                long polling (local dev)
 *
 * Required env: BOT_TOKEN, SUPABASE_URL, SUPABASE_ANON_KEY,
 * plus SUPABASE_REF + SUPABASE_DB_PASSWORD (+ SUPABASE_POOLER_HOST) or DATABASE_URL.
 * See .env.example and README for the full table.
 */

async function main(): Promise<void> {
  const cfg = loadConfig();
  setLevel(cfg.logLevel);
  initPool(cfg.db);
  initCatalog(cfg);

  // ── headless notification dispatch (GitHub Actions cron) ──────────────────
  if (cfg.mode === "notify-only") {
    log.info("notify-only mode: dispatching new releases");
    const telegram = new Telegraf(cfg.botToken).telegram;
    const report = await dispatchNewReleases(cfg, telegram);
    log.info("notify-only done", report);
    await closePool();
    return;
  }

  const bot = createBot(cfg);

  // profile + commands (idempotent on every start)
  const me = await bot.telegram.getMe();
  await bot.telegram.setMyCommands([...PUBLIC_COMMANDS]);
  await bot.telegram.setMyDescription(
    "Ethiopia's music bot — trending songs, artist follows, new-release alerts and the full mini app.",
  );
  await bot.telegram.setMyShortDescription("🇪🇹 Ethiopia's music home in Telegram.");
  log.info(`authorized as @${me.username}`);

  if (cfg.mode === "webhook" && cfg.webhook) {
    // Telegram calls back to ${WEBHOOK_URL}${WEBHOOK_PATH}; the secret token
    // header lets Telegraf reject anything that isn't from Telegram itself.
    await bot.launch({
      webhook: {
        domain: cfg.webhook.url,
        hookPath: cfg.webhook.path,
        port: cfg.webhook.port,
        secretToken: cfg.webhook.secret ?? undefined,
      },
      allowedUpdates: ["message", "callback_query"],
    });
    log.info(`webhook mode live on :${cfg.webhook.port}${cfg.webhook.path}`);
  } else {
    try {
      await bot.launch({ allowedUpdates: ["message", "callback_query"] });
      log.info("polling mode live — press Ctrl+C to stop");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("409")) {
        log.error(
          "Conflict: another bot instance is polling or a webhook is still set. " +
            "Stop the other instance, or set WEBHOOK_URL to use webhook mode.",
        );
      }
      throw err;
    }
  }

  const stop = async (signal: string) => {
    log.info(`received ${signal}, shutting down…`);
    try {
      bot.stop(signal as never);
    } catch {
      /* already stopped */
    }
    await closePool();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}

main().catch(async (err) => {
  log.error("fatal", { err: err instanceof Error ? err.message : String(err) });
  await closePool().catch(() => undefined);
  process.exit(1);
});
