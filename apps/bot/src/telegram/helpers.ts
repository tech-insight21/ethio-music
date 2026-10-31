import type { MiddlewareFn } from "telegraf";
import { log } from "../logger.js";
import { upsertChat } from "../db/store.js";
import type { BotContext } from "./context.js";
import type { CatalogSong } from "../db/catalog.js";
import { songLine, esc, bold } from "./format.js";

/**
 * Shared handler utilities: error isolation, chat registration and the
 * paged song-list renderer used by /trending, /new and search.
 */

const FRIENDLY_ERROR = "⚠️ Something went wrong on our side. Please try again in a moment.";

/** Wrap a handler so one failing update never kills the bot or the chain. */
export function safe<T = BotContext>(
  handler: (ctx: T) => Promise<void>,
): MiddlewareFn<BotContext> {
  return async (ctx) => {
    try {
      await handler(ctx as unknown as T);
    } catch (err) {
      log.error(`handler failed for update ${ctx.update?.update_id}`, {
        err: err instanceof Error ? err.message : String(err),
      });
      try {
        await ctx.reply(FRIENDLY_ERROR);
      } catch {
        /* sending the error notice itself failed — nothing else to do */
      }
    }
  };
}

/** Text of a message, if any (message type union varies per event). */
export function msgText(m: unknown): string {
  if (m && typeof m === "object" && "text" in m && typeof (m as { text: unknown }).text === "string") {
    return (m as { text: string }).text;
  }
  return "";
}

/** Register the chat on every interaction (welcome, prefs, dedup fan-out). */
export async function ensureChat(ctx: BotContext): Promise<void> {
  if (!ctx.chat) return;
  await upsertChat({
    id: ctx.chat.id,
    username: ctx.from?.username,
    firstName: ctx.from?.first_name,
    languageCode: ctx.from?.language_code,
  });
}

export const PAGE_SIZE = 5;

export interface PagedSongs {
  header: string;
  empty: string;
  fetch: (limit: number, offset: number) => Promise<CatalogSong[]>;
}

/**
 * Render one page of songs. Works for a fresh command (reply) and for
 * pager callbacks (edit in place, falling back to a new reply on old
 * messages that can no longer be edited).
 */
export async function renderSongsPage(
  ctx: BotContext,
  kind: "t" | "n",
  page: number,
  def: PagedSongs,
  footerKb: ReturnType<typeof import("./keyboards.js").pagerKb>,
): Promise<void> {
  const songs = await def.fetch(PAGE_SIZE + 1, page * PAGE_SIZE);
  const hasMore = songs.length > PAGE_SIZE;
  const visible = songs.slice(0, PAGE_SIZE);

  const body =
    visible.length === 0
      ? def.empty
      : [bold(def.header), "", ...visible.map((s, i) => songLine(s, page * PAGE_SIZE + i + 1))].join(
          "\n",
        );

  const extra = { parse_mode: "MarkdownV2" as const, ...footerKb };

  if (ctx.callbackQuery && ctx.callbackQuery.message) {
    try {
      await ctx.editMessageText(body, extra);
      await ctx.answerCbQuery();
      return;
    } catch {
      /* message too old / identical — fall through to a fresh reply */
      await ctx.answerCbQuery();
    }
  }
  await ctx.reply(body, extra);
}

/** Combine extra rows with the main menu keyboard. */
export function withMenuRows(
  base: ReturnType<typeof import("./keyboards.js").mainMenuKb>,
  rows: unknown[][],
): { inline_keyboard: unknown[][] } {
  const kb = (base as { reply_markup: { inline_keyboard: unknown[][] } }).reply_markup;
  return { inline_keyboard: [...rows, ...kb.inline_keyboard] };
}

/** Truncate long bios safely for Telegram messages. */
export function truncate(s: string, max = 280): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

export { esc };
