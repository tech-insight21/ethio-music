import type { Telegraf } from "telegraf";
import { listArtists, getArtist, artistTopSongs, appFollowerCount } from "../../db/catalog.js";
import { followArtist, unfollowArtist, isFollowing, countBotFollowers } from "../../db/store.js";
import { log } from "../../logger.js";
import { esc, bold, fmtCount, artistLine } from "../format.js";
import { pagerKb, artistKb, cbArtist } from "../keyboards.js";
import { ensureChat, safe, truncate, PAGE_SIZE } from "../helpers.js";
import type { BotContext, ActionCtx } from "../context.js";

/**
 * Artist discovery + follow — requirements 6 & 8.
 * /artists (paged list) → artist detail (bio, stats, top tracks) →
 * 🔔 Follow / ✓ Following toggle. Follows feed the notification engine.
 */

async function renderArtistList(ctx: BotContext, page: number): Promise<void> {
  const artists = await listArtists(PAGE_SIZE + 1, page * PAGE_SIZE);
  const hasMore = artists.length > PAGE_SIZE;
  const visible = artists.slice(0, PAGE_SIZE);

  const body =
    visible.length === 0
      ? "🎤 No artists in the catalog yet — check back soon!"
      : [
          bold("🎤 Ethiopian artists"),
          esc(`Page ${page + 1}`),
          "",
          ...visible.map((a, i) => `${page * PAGE_SIZE + i + 1}. ${artistLine(a)}`),
        ].join("\n");

  const rows = visible.map((a) => [{ text: `♪ ${a.name}`, callback_data: cbArtist(a.id) }]);
  const pager = pagerKb("a", page, hasMore);
  const kb = {
    inline_keyboard: [
      ...rows,
      ...(pager as { reply_markup: { inline_keyboard: typeof rows } }).reply_markup.inline_keyboard,
    ],
  };
  const extra = { parse_mode: "MarkdownV2" as const, ...kb };

  if (ctx.callbackQuery && ctx.callbackQuery.message) {
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

async function renderArtistDetail(ctx: BotContext, artistId: string, viaAction: boolean): Promise<void> {
  await ensureChat(ctx);
  const artist = await getArtist(artistId);
  if (!artist) {
    await ctx.answerCbQuery("Artist not found");
    return;
  }

  const [appFollowers, botFollowers, following, top] = await Promise.all([
    appFollowerCount(artistId),
    countBotFollowers(artistId),
    isFollowing(ctx.chat?.id ?? 0, artistId),
    artistTopSongs(artistId, 5),
  ]);

  const followers = appFollowers + botFollowers;
  const followerWord = followers === 1 ? "follower" : "followers";

  const body = [
    `${bold(artist.name)}${artist.verified ? " ✅" : ""}`,
    [
      `👥 ${fmtCount(followers)} ${followerWord}`,
      `🎧 ${fmtCount(artist.monthly_listeners)} listeners`,
      artist.region ? `📍 ${esc(artist.region)}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    "",
    artist.bio ? truncate(artist.bio) : esc("Biography coming soon."),
    "",
    top.length > 0
      ? [bold("Top tracks"), ...top.map((s, i) => `${i + 1}. ${bold(s.title)} · ${s.duration_seconds}s`)].join("\n")
      : esc("No released tracks yet."),
  ].join("\n");

  const extra = {
    parse_mode: "MarkdownV2" as const,
    ...artistKb(artistId, following, ctx.config.tmaUrl, ctx),
  };

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

export function registerArtists(bot: Telegraf<BotContext>): void {
  bot.command("artists", safe(async (ctx) => {
    await ensureChat(ctx);
    await renderArtistList(ctx, 0);
  }));

  bot.action(/^pg:a:(\d+)$/, safe(async (ctx: ActionCtx) => {
    await renderArtistList(ctx, Number(ctx.match[1]));
  }));

  bot.action(/^ad:([0-9a-f-]{36})$/i, safe(async (ctx: ActionCtx) => {
    await renderArtistDetail(ctx, ctx.match[1], true);
  }));

  // Follow — composite PK blocks duplicates; report honestly either way.
  bot.action(/^f:([0-9a-f-]{36})$/i, safe(async (ctx: ActionCtx) => {
    const artistId = ctx.match[1];
    await ensureChat(ctx);
    const inserted = await followArtist(ctx.chat?.id ?? 0, artistId);
    log.info("follow", { chat: ctx.chat?.id, artist: artistId, inserted });
    if (inserted) {
      await ctx.answerCbQuery("🔔 Following! You'll get new-release alerts.");
    } else {
      await ctx.answerCbQuery("Already following ✓");
    }
    await renderArtistDetail(ctx, artistId, true);
  }));

  bot.action(/^u:([0-9a-f-]{36})$/i, safe(async (ctx: ActionCtx) => {
    const artistId = ctx.match[1];
    await ensureChat(ctx);
    const removed = await unfollowArtist(ctx.chat?.id ?? 0, artistId);
    await ctx.answerCbQuery(removed ? "Unfollowed." : "You weren't following this artist.");
    await renderArtistDetail(ctx, artistId, true);
  }));
}

export { renderArtistDetail };
