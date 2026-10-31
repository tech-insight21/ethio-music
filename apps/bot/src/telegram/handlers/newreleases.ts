import type { Telegraf } from "telegraf";
import { latestSongs } from "../../db/catalog.js";
import { pagerKb } from "../keyboards.js";
import { renderSongsPage, safe } from "../helpers.js";
import type { BotContext, ActionCtx } from "../context.js";

/** /new — latest approved releases, paginated inline. */

export function registerNewReleases(bot: Telegraf<BotContext>): void {
  const def = {
    header: "🆕 Fresh on ETHIO MUSIC",
    empty: "No releases yet — the catalog is warming up! 🎶",
    fetch: (limit: number, offset: number) => latestSongs(limit, offset),
  };

  bot.command("new", safe(async (ctx) => {
    await renderSongsPage(ctx, "n", 0, def, pagerKb("n", 0, true));
  }));

  bot.action(/^pg:n:(\d+)$/, safe(async (ctx: ActionCtx) => {
    const page = Number(ctx.match[1]);
    await renderSongsPage(ctx, "n", page, def, pagerKb("n", page, true));
  }));
}
