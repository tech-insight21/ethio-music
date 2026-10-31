import type { Telegraf } from "telegraf";
import { getChat, setPref, listFollowedArtists, type PrefKey } from "../../db/store.js";
import { esc, bold, fmtCount } from "../format.js";
import { settingsKb, mainMenuKb } from "../keyboards.js";
import { ensureChat, safe } from "../helpers.js";
import type { BotContext } from "../context.js";

/**
 * /settings — notification preferences (requirement 14).
 * Toggles are stored per chat in bot_chats and honoured by the
 * notification engine and broadcasts.
 */

async function renderSettings(ctx: BotContext, viaAction: boolean): Promise<void> {
  await ensureChat(ctx);
  const chat = await getChat(ctx.chat?.id ?? 0);
  const prefs = {
    notify_new_releases: chat?.notify_new_releases ?? true,
    notify_premium: chat?.notify_premium ?? true,
  };
  const followed = await listFollowedArtists(ctx.chat?.id ?? 0);

  const body = [
    bold("🔔 Your notifications"),
    "",
    `New releases: ${prefs.notify_new_releases ? "✅ ON" : "❌ OFF"}`,
    `Premium alerts: ${prefs.notify_premium ? "✅ ON" : "❌ OFF"}`,
    "",
    followed.length > 0
      ? [bold(`Following (${followed.length})`), ...followed.map((a) => `♪ ${esc(a.name)}`)].join("\n")
      : esc("You're not following any artist yet — try /artists."),
    "",
    esc("Tap below to toggle. Muted = you won't hear from me except replies to you."),
  ].join("\n");

  const extra = { parse_mode: "MarkdownV2" as const, ...settingsKb(prefs) };

  if (viaAction && ctx.callbackQuery && ctx.callbackQuery.message) {
    try {
      await ctx.editMessageText(body, extra);
      await ctx.answerCbQuery();
      return;
    } catch {
      await ctx.answerCbQuery();
    }
  }
  await ctx.reply(body, extra);
}

export function registerSettings(bot: Telegraf<BotContext>): void {
  bot.command("settings", safe(async (ctx) => {
    await renderSettings(ctx, false);
  }));

  bot.action("prefs:menu", safe(async (ctx) => {
    await renderSettings(ctx, true);
  }));

  const toggle = (key: PrefKey, label: string) =>
    safe(async (ctx) => {
      const chat = await getChat(ctx.chat?.id ?? 0);
      const current = key === "notify_new_releases"
        ? chat?.notify_new_releases ?? true
        : chat?.notify_premium ?? true;
      await setPref(ctx.chat?.id ?? 0, key, !current);
      await ctx.answerCbQuery(`${label} ${!current ? "ON ✅" : "OFF ❌"}`);
      await renderSettings(ctx, true);
    });

  bot.action("prefs:nr", toggle("notify_new_releases", "New releases"));
  bot.action("prefs:pr", toggle("notify_premium", "Premium alerts"));

  // Mute button attached to notification messages — one tap opt-out.
  bot.action("prefs:nr0", safe(async (ctx) => {
    await setPref(ctx.chat?.id ?? 0, "notify_new_releases", false);
    await ctx.answerCbQuery("🔕 Muted — /settings to re-enable");
    try {
      await ctx.editMessageReplyMarkup(mainMenuKb(ctx.config.tmaUrl, ctx).reply_markup);
    } catch {
      /* message may be a media caption too old to edit — fine */
    }
  }));
}

export { renderSettings };
