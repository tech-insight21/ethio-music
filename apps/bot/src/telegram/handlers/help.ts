import type { Telegraf } from "telegraf";
import { esc, bold } from "../format.js";
import { mainMenuKb } from "../keyboards.js";
import { safe } from "../helpers.js";
import type { BotContext } from "../context.js";

/** /help — command reference + FAQ. */

export function registerHelp(bot: Telegraf<BotContext>): void {
  bot.command("help", safe(async (ctx) => {
    await ctx.reply(
      [
        bold("❓ ETHIO MUSIC — Help"),
        "",
        bold("Commands"),
        `${esc("/start")} — ${esc("welcome + main menu")}`,
        `${esc("/app")} — ${esc("open the mini app")}`,
        `${esc("/search <name>")} — ${esc("find songs & artists")}`,
        `${esc("/trending")} — ${esc("most-played songs")}`,
        `${esc("/new")} — ${esc("fresh releases")}`,
        `${esc("/artists")} — ${esc("discover & follow artists")}`,
        `${esc("/premium")} — ${esc("subscription plans (ETB)")}`,
        `${esc("/settings")} — ${esc("notification preferences")}`,
        `${esc("/paysupport")} — ${esc("billing help")}`,
        "",
        bold("Tips"),
        esc("• Type any song or artist name — no command needed."),
        esc("• Follow an artist and I'll ping you when they release."),
        esc("• Everything plays inside the mini app — tap 🎵 Open Music App."),
      ].join("\n"),
      { parse_mode: "MarkdownV2", ...mainMenuKb(ctx.config.tmaUrl, ctx) },
    );
  }));
}
