import { log } from "../../logger.js";
import { bold, esc } from "../format.js";
import { mainMenuKb } from "../keyboards.js";
import { ensureChat, safe } from "../helpers.js";
import type { BotContext } from "../context.js";
import type { Telegraf } from "telegraf";

/**
 * /start — welcome message, chat registration and the main inline menu.
 * The "home" callback re-renders the same screen from any sub-page.
 */

export function welcomeText(name: string | undefined): string {
  return [
    `🇪🇹 ${bold("እንኳን ደህና መጡ ወደ ETHIO MUSIC!")}${name ? `\n${esc("Selam")} ${bold(name)} 👋` : ""}`,
    "",
    esc("Ethiopia's music home in Telegram — Amharic · Oromo · Tigrinya · English."),
    esc("🎧 100% licensed releases. Artists get paid."),
    "",
    bold("What I can do"),
    `${esc("🔥 /trending")} — ${esc("top songs right now")}`,
    `${esc("🆕 /new")} — ${esc("fresh releases")}`,
    `${esc("🎤 /artists")} — ${esc("discover artists & follow them")}`,
    `${esc("🔍 /search")} — ${esc("find songs (or just type a name)")}`,
    `${esc("⭐ /premium")} — ${esc("subscription plans (ETB)")}`,
    `${esc("🔔 /settings")} — ${esc("notification preferences")}`,
    "",
    esc("Or tap below to open the full mini app 👇"),
  ].join("\n");
}

async function showWelcome(ctx: BotContext, isFirstTime: boolean): Promise<void> {
  await ensureChat(ctx);
  const text = welcomeText(ctx.from?.first_name);
  const kb = mainMenuKb(ctx.config.tmaUrl, ctx);
  const extra = { parse_mode: "MarkdownV2" as const, ...kb };

  if (!isFirstTime && ctx.callbackQuery && ctx.callbackQuery.message) {
    try {
      await ctx.editMessageText(text, extra);
      await ctx.answerCbQuery();
      return;
    } catch {
      await ctx.answerCbQuery();
    }
  }
  await ctx.reply(text, extra);
}

export function registerStart(bot: Telegraf<BotContext>): void {
  bot.start(safe(async (ctx) => {
    log.info("/start", { chat: ctx.chat?.id, from: ctx.from?.username });
    await showWelcome(ctx, true);
  }));

  bot.action("home", safe(async (ctx) => {
    await showWelcome(ctx, false);
  }));
}
