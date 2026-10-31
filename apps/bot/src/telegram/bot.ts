import { Telegraf } from "telegraf";
import type { Config } from "../config.js";
import { log } from "../logger.js";
import type { BotContext } from "./context.js";
import { registerStart } from "./handlers/start.js";
import { registerHelp } from "./handlers/help.js";
import { registerApp } from "./handlers/app.js";
import { registerSearch } from "./handlers/search.js";
import { registerTrending } from "./handlers/trending.js";
import { registerNewReleases } from "./handlers/newreleases.js";
import { registerArtists } from "./handlers/artists.js";
import { registerPremium } from "./handlers/premium.js";
import { registerPaySupport } from "./handlers/paysupport.js";
import { registerSettings } from "./handlers/settings.js";
import { registerAdmin } from "./handlers/admin.js";

/**
 * Bot assembly. Registration order matters: command handlers run before the
 * plain-text fallback, and a handler that completes without next() stops the
 * chain — so /search consumes "/search …" and the .on("text") fallback only
 * ever sees non-command text.
 */

export const PUBLIC_COMMANDS = [
  { command: "start", description: "🇪🇹 Welcome + main menu" },
  { command: "app", description: "🎵 Open the music app" },
  { command: "search", description: "🔍 Find songs & artists" },
  { command: "trending", description: "🔥 Most-played songs" },
  { command: "new", description: "🆕 Fresh releases" },
  { command: "artists", description: "🎤 Discover & follow artists" },
  { command: "premium", description: "⭐ Subscription plans (ETB)" },
  { command: "settings", description: "🔔 Notification preferences" },
  { command: "paysupport", description: "💳 Billing help" },
  { command: "help", description: "❓ Everything the bot can do" },
] as const;

export function createBot(cfg: Config): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(cfg.botToken);

  bot.context.config = cfg;

  // lightweight observability
  bot.use(async (_ctx, next) => {
    const started = Date.now();
    await next();
    log.debug("update handled", { ms: Date.now() - started });
  });

  registerStart(bot);
  registerHelp(bot);
  registerApp(bot);
  registerTrending(bot);
  registerNewReleases(bot);
  registerArtists(bot);
  registerPremium(bot);
  registerPaySupport(bot);
  registerSettings(bot);
  registerAdmin(bot);
  // MUST be last: registerSearch installs the plain-text fallback, and any
  // command registered after it would never be reached.
  registerSearch(bot);

  // global error net — anything that escaped safe() lands here
  bot.catch((err, ctx) => {
    log.error("unhandled bot error", {
      update: ctx?.update?.update_id,
      err: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
  });

  return bot;
}
