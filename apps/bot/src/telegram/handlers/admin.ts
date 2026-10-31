import type { Telegraf } from "telegraf";
import { randomBytes } from "node:crypto";
import { botStats, broadcastRecipients, getWatermark } from "../../db/store.js";
import { catalogCounts } from "../../db/catalog.js";
import { dispatchNewReleases } from "../../notify/engine.js";
import { log } from "../../logger.js";
import { esc, bold, fmtCount } from "../format.js";
import { broadcastConfirmKb } from "../keyboards.js";
import { safe, msgText } from "../helpers.js";
import type { BotContext, ActionCtx } from "../context.js";

/**
 * Admin-only commands (requirement 9).
 *
 *   /admin            bot + catalog stats
 *   /broadcast <msg>  fan-out announcement (single-use confirm ⇒ no dupes)
 *   /notify           run the new-release dispatch now
 *
 * Access = ADMIN_TELEGRAM_IDS env allowlist (comma-separated Telegram ids).
 * Find yours with @userinfobot. Empty list ⇒ admin commands refuse to run.
 */

const DENY = "⛔ Admin only. Set ADMIN_TELEGRAM_IDS (comma-separated Telegram user ids) to enable.";
const pending = new Map<string, { text: string; expires: number }>();

function isAdmin(ctx: BotContext): boolean {
  return ctx.config.adminIds.has(ctx.from?.id ?? 0);
}

export function registerAdmin(bot: Telegraf<BotContext>): void {
  bot.command("admin", safe(async (ctx) => {
    if (!isAdmin(ctx)) return void (await ctx.reply(DENY));
    const [stats, catalog, wm] = await Promise.all([botStats(), catalogCounts(), getWatermark()]);
    await ctx.reply(
      [
        bold("🛠 ETHIO MUSIC — bot admin"),
        "",
        bold("Bot"),
        `👥 chats registered: ${fmtCount(stats.chats)}`,
        `🔔 opted into new releases: ${fmtCount(stats.opted_in)}`,
        `🎤 bot follows: ${fmtCount(stats.follows)}`,
        `📨 notifications sent: ${fmtCount(stats.sent)}`,
        `⏱ release watermark: ${wm ? esc(wm.toISOString()) : "not set"}`,
        "",
        bold("Catalog (approved, via RLS)"),
        `🎤 artists: ${fmtCount(catalog.artists)}`,
        `🎵 songs: ${fmtCount(catalog.songs)}`,
      ].join("\n"),
      { parse_mode: "MarkdownV2" },
    );
  }));

  bot.command("broadcast", safe(async (ctx) => {
    if (!isAdmin(ctx)) return void (await ctx.reply(DENY));
    const text = msgText(ctx.message).split(/\s+/).slice(1).join(" ").trim();
    if (!text) {
      await ctx.reply(`Usage: ${esc("/broadcast <message>")} ${esc("— e.g. album drops, promos.")}`, {
        parse_mode: "MarkdownV2",
      });
      return;
    }
    if (text.length > 3500) return void (await ctx.reply("Too long — keep broadcasts under 3500 characters."));

    // single-use token: a second confirm tap (or a retry) can't re-send
    const token = randomBytes(4).toString("hex");
    pending.set(token, { text, expires: Date.now() + 10 * 60_000 });

    await ctx.reply(
      [
        bold("📢 Broadcast preview"),
        "",
        esc(text),
        "",
        esc(`Recipients: chats opted into any notifications.`),
        esc("Confirm below — the button works once."),
      ].join("\n"),
      { parse_mode: "MarkdownV2", ...broadcastConfirmKb(token) },
    );
  }));

  bot.action(/^adm:bc:([0-9a-f]{8})$/, safe(async (ctx: ActionCtx) => {
    if (!isAdmin(ctx)) return void (await ctx.answerCbQuery(DENY));
    const job = pending.get(ctx.match[1]);
    if (!job || job.expires < Date.now()) {
      pending.delete(ctx.match[1]);
      return void (await ctx.answerCbQuery("Expired or already sent — compose again."));
    }
    pending.delete(ctx.match[1]); // consume immediately ⇒ duplicate-proof

    const chatIds = await broadcastRecipients();
    let ok = 0;
    let failed = 0;
    for (const id of chatIds) {
      try {
        await ctx.telegram.sendMessage(Number(id), `📢 ${job.text}`);
        ok += 1;
      } catch (err) {
        failed += 1;
        log.warn("broadcast send failed", { chat: id, err: err instanceof Error ? err.message : err });
      }
      await new Promise((r) => setTimeout(r, 35)); // ≤ ~30 msg/s (Telegram limit)
    }
    await ctx.answerCbQuery("Broadcasting…");
    await ctx.reply(`📢 Broadcast done — ✅ ${ok} delivered, ❌ ${failed} failed.`);
  }));

  bot.action("adm:bc:no", safe(async (ctx) => {
    if (!isAdmin(ctx)) return void (await ctx.answerCbQuery(DENY));
    await ctx.answerCbQuery("Cancelled");
    await ctx.deleteMessage().catch(() => undefined);
  }));

  bot.command("notify", safe(async (ctx) => {
    if (!isAdmin(ctx)) return void (await ctx.reply(DENY));
    await ctx.reply("🔎 Checking for new releases…");
    const report = await dispatchNewReleases(ctx.config, ctx.telegram);
    await ctx.reply(
      [
        bold("🛠 Dispatch report"),
        `🆕 new songs found: ${report.songs}`,
        `📨 messages sent: ${report.sent}`,
        `⏭ skipped (already sent): ${report.claimed - report.sent + report.deduped}`,
        `❌ failed: ${report.failed}`,
        `⏱ watermark → ${esc(report.to)}`,
      ].join("\n"),
      { parse_mode: "MarkdownV2" },
    );
  }));
}
