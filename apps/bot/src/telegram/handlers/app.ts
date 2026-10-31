import type { Telegraf } from "telegraf";
import { Markup } from "telegraf";
import { esc, bold } from "../format.js";
import { safe } from "../helpers.js";
import type { BotContext } from "../context.js";

/** /app — the Open Music App button (requirement 2). */

export function registerApp(bot: Telegraf<BotContext>): void {
  bot.command("app", safe(async (ctx) => {
    const isPrivate = ctx.chat?.type === "private";
    const button = isPrivate
      ? [Markup.button.webApp("🎵 Open ETHIO MUSIC", ctx.config.tmaUrl)]
      : [Markup.button.url("🌐 Open Web Player", ctx.config.tmaUrl)];

    await ctx.reply(
      [
        bold("🎵 ETHIO MUSIC — Mini App"),
        "",
        esc("Full player, playlists, favorites and premium — right inside Telegram."),
      ].join("\n"),
      { parse_mode: "MarkdownV2", ...Markup.inlineKeyboard([button]) },
    );
  }));
}
