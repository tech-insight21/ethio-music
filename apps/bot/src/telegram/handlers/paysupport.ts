import type { Telegraf } from "telegraf";
import { Markup } from "telegraf";
import { esc, bold } from "../format.js";
import { safe } from "../helpers.js";
import type { BotContext } from "../context.js";

/**
 * /paysupport — billing help (Telegram requires this command for bots that
 * deal with payments). The bot never charges anyone; subscriptions happen in
 * the mini app via Telebirr / Chapa.
 */

export function registerPaySupport(bot: Telegraf<BotContext>): void {
  bot.command("paysupport", safe(async (ctx) => {
    await ctx.reply(
      [
        bold("💳 Payment & billing support"),
        "",
        esc("Subscriptions are handled inside the mini app with Telebirr or Chapa."),
        "",
        bold("Charged but Premium not active?"),
        esc("1. Wait ~10 minutes — mobile-money confirmations can lag."),
        esc("2. Open the app → Profile → check your subscription status."),
        esc("3. Still wrong? Message this bot with:"),
        esc("   • transaction / reference ID"),
        esc("   • amount and date"),
        esc("   • the phone number used"),
        esc("Our team will review and sort it out."),
        "",
        esc("No auto-charges: plans renew only if you choose to renew."),
      ].join("\n"),
      {
        parse_mode: "MarkdownV2",
        ...Markup.inlineKeyboard([
          [Markup.button.webApp("⭐ Open Premium", `${ctx.config.tmaUrl}premium`)],
        ]),
      },
    );
  }));
}
