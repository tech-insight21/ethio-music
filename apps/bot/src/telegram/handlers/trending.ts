import type { Telegraf } from "telegraf";
import { topSongs } from "../../db/catalog.js";
import { pagerKb } from "../keyboards.js";
import { renderSongsPage, safe, PAGE_SIZE } from "../helpers.js";
import type { BotContext, ActionCtx } from "../context.js";

/** /trending — most-played approved songs, paginated inline. */

export function registerTrending(bot: Telegraf<BotContext>): void {
  const def = {
    header: "🔥 Trending in Ethiopia",
    empty: "The chart is warming up — check back soon! 🎶",
    fetch: (limit: number, offset: number) => topSongs(limit, offset),
  };

  bot.command("trending", safe(async (ctx) => {
    await renderSongsPage(ctx, "t", 0, def, pagerKb("t", 0, true));
  }));

  bot.action(/^pg:t:(\d+)$/, safe(async (ctx: ActionCtx) => {
    const page = Number(ctx.match[1]);
    await renderSongsPage(ctx, "t", page, def, pagerKb("t", page, true));
  }));
}
