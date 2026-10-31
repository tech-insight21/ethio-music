import type { Telegraf } from "telegraf";
import { Markup } from "telegraf";
import { listPlans } from "../../db/catalog.js";
import { esc, bold, planLine } from "../format.js";
import { mainMenuKb } from "../keyboards.js";
import { ensureChat, safe, withMenuRows } from "../helpers.js";
import type { BotContext } from "../context.js";

/**
 * /premium — live plan catalog (same backend as the mini app).
 * NOTE: the bot does NOT fake payments — subscribing happens in the mini
 * app (Telebirr / Chapa); the button deep-links straight to the plans page.
 */

export function registerPremium(bot: Telegraf<BotContext>): void {
  bot.command("premium", safe(async (ctx) => {
    await ensureChat(ctx);
    const plans = await listPlans();

    if (plans.length === 0) {
      await ctx.reply(
        `⭐ ${bold("ETHIO MUSIC Premium")}\n\n${esc("Plans are being set up — check back soon!")}`,
        { parse_mode: "MarkdownV2", ...mainMenuKb(ctx.config.tmaUrl, ctx) },
      );
      return;
    }

    const body = [
      bold("⭐ ETHIO MUSIC Premium"),
      "",
      esc("Support Ethiopian artists and unlock everything:"),
      ...plans.map((p) => planLine(p)),
      "",
      esc("💳 Pay with Telebirr or Chapa inside the app."),
    ].join("\n");

    await ctx.reply(body, {
      parse_mode: "MarkdownV2",
      ...withMenuRows(
        mainMenuKb(ctx.config.tmaUrl, ctx),
        [[Markup.button.webApp("⭐ Subscribe in App", `${ctx.config.tmaUrl}premium`)]],
      ),
    });
  }));
}
