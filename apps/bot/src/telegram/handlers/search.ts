import type { Telegraf } from "telegraf";
import { log } from "../../logger.js";
import { searchSongs, searchArtists } from "../../db/catalog.js";
import { esc, bold } from "../format.js";
import { mainMenuKb, cbArtist } from "../keyboards.js";
import { ensureChat, safe, withMenuRows, msgText } from "../helpers.js";
import type { BotContext } from "../context.js";

/**
 * Music search — requirement 5.
 * • /search <query>       explicit search
 * • any plain text msg    implicit search (most natural mobile flow)
 * Results: songs (text) + artists (tappable → artist detail with follow).
 */

export async function runSearch(ctx: BotContext, rawQuery: string, viaCommand: boolean): Promise<void> {
  const q = rawQuery.trim().slice(0, 80);
  await ensureChat(ctx);

  if (!q) {
    await ctx.reply(
      [
        bold("🔍 Search ETHIO MUSIC"),
        "",
        esc("Send me a song or artist name, e.g. ") + "/search gammachuu",
        esc("Or just type it in the chat — no command needed."),
      ].join("\n"),
      { parse_mode: "MarkdownV2", ...mainMenuKb(ctx.config.tmaUrl, ctx) },
    );
    return;
  }

  const [songs, artists] = await Promise.all([searchSongs(q, 6), searchArtists(q, 3)]);

  if (songs.length === 0 && artists.length === 0) {
    await ctx.reply(
      [
        `🤷 ${esc(`No results for “${q}”.`)}`,
        "",
        esc("Try another spelling, or browse the catalog:"),
        esc("• /trending — what Ethiopia plays most"),
        esc("• /artists — discover artists"),
      ].join("\n"),
      { parse_mode: "MarkdownV2", ...mainMenuKb(ctx.config.tmaUrl, ctx) },
    );
    return;
  }

  const blocks: string[] = [`🔍 ${bold(`Results for “${q}”`)}`];

  if (artists.length > 0) {
    blocks.push("", bold("Artists"), ...artists.map((a) => `🎤 ${esc(a.name)}`));
  }
  if (songs.length > 0) {
    blocks.push("", bold("Songs"));
    let i = 0;
    for (const s of songs) {
      i += 1;
      const dur = `${Math.floor(s.duration_seconds / 60)}:${String(s.duration_seconds % 60).padStart(2, "0")}`;
      blocks.push(
        `${i}. ${bold(s.title)}${s.artist?.name ? ` — ${esc(s.artist.name)}` : ""} \`${dur}\``,
      );
    }
  }
  blocks.push("", esc("Tap an artist below, or open the app to play everything 👇"));

  // tappable artist rows
  const artistRows = artists.map((a) => [{ text: `🎤 ${a.name}`, callback_data: cbArtist(a.id) }]);

  await ctx.reply(blocks.join("\n"), {
    parse_mode: "MarkdownV2",
    ...withMenuRows(mainMenuKb(ctx.config.tmaUrl, ctx), artistRows),
  });
}

export function registerSearch(bot: Telegraf<BotContext>): void {
  bot.command("search", safe(async (ctx) => {
    const q = msgText(ctx.message).split(/\s+/).slice(1).join(" ");
    log.info("/search", { chat: ctx.chat?.id, q: q.slice(0, 40) });
    await runSearch(ctx, q, true);
  }));

  // Plain text that reached this point = not a command → treat as search.
  bot.on("text", safe(async (ctx) => {
    const text = msgText(ctx.message);
    if (text.startsWith("/")) {
      await ctx.reply(
        `🤔 ${esc("Unknown command.")} ${esc("Send /help to see everything I can do.")}`,
        { parse_mode: "MarkdownV2" },
      );
      return;
    }
    log.info("text->search", { chat: ctx.chat?.id });
    await runSearch(ctx, text, false);
  }));
}
