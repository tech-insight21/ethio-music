import { Telegraf, Markup } from "telegraf";
import { searchSongs, topSongs, listPlans, CatalogSong } from "./supabase";

/**
 * ETHIO MUSIC Telegram bot.
 *
 * Env:
 *   BOT_TOKEN          — from @BotFather (never commit!)
 *   SUPABASE_URL       — project URL
 *   SUPABASE_ANON_KEY  — public anon key (RLS-protected reads only)
 *   TMA_URL            — https URL of the deployed mini app
 */

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("Missing BOT_TOKEN env var");
  process.exit(1);
}

const TMA_URL = process.env.TMA_URL ?? "https://tech-insight21.github.io/ethio-music/";
const bot = new Telegraf(token);

function webAppKeyboard() {
  return Markup.keyboard([
    [Markup.button.webApp("🎵 Open ETHIO MUSIC", TMA_URL)],
  ]).resize();
}

function songLine(s: CatalogSong, i: number): string {
  const min = Math.floor(s.duration_seconds / 60);
  const sec = String(s.duration_seconds % 60).padStart(2, "0");
  return `${i + 1}. *${s.title}* — ${s.artist?.name ?? "Unknown"} \`${min}:${sec}\``;
}

bot.start((ctx) =>
  ctx.reply(
    [
      "🇪🇹 *እንኳን ደህና መጡ ወደ ETHIO MUSIC!*",
      "",
      "Ethiopia's music mini app — Amharic · Oromo · Tigrinya · English.",
      "🎧 100% licensed releases, artists get paid.",
      "",
      "Commands:",
      "/trending — top songs right now",
      "/search <query> — find songs & artists",
      "/plans — subscription tiers (ETB)",
      "",
      "Tap the button below to open the full music app 👇",
    ].join("\n"),
    { parse_mode: "Markdown", ...webAppKeyboard() }
  )
);

bot.command("trending", async (ctx) => {
  try {
    const songs = await topSongs(5);
    if (songs.length === 0) return ctx.reply("Catalog is warming up — check back soon! 🎶");
    await ctx.reply(
      ["🔥 *Trending in Ethiopia*", "", ...songs.map(songLine)].join("\n"),
      { parse_mode: "Markdown", ...webAppKeyboard() }
    );
  } catch {
    ctx.reply("⚠️ Could not reach the catalog. Try again shortly.");
  }
});

bot.command("search", async (ctx) => {
  const q = (ctx.message.text.split(" ").slice(1).join(" ") || "").trim();
  if (!q) return ctx.reply("Usage: /search <song or artist name>");
  try {
    const songs = await searchSongs(q, 5);
    if (songs.length === 0) return ctx.reply(`No results for “${q}” 🤷`);
    await ctx.reply(
      [`🔍 *Results for “${q}”*`, "", ...songs.map(songLine)].join("\n"),
      { parse_mode: "Markdown", ...webAppKeyboard() }
    );
  } catch {
    ctx.reply("⚠️ Search failed. Try again shortly.");
  }
});

bot.command("plans", async (ctx) => {
  try {
    const plans = await listPlans();
    const lines = plans.map(
      (p) =>
        `• *${p.name}${p.name_am ? ` (${p.name_am})` : ""}* — ${
          p.price_etb === 0 ? "Free" : `${p.price_etb} ETB / ${p.duration_days}d`
        }\n  ${p.description ?? ""}`
    );
    await ctx.reply(
      ["⭐ *ETHIO MUSIC Premium*", "", ...lines, "", "Pay with Telebirr or Chapa inside the app 👇"].join("\n"),
      { parse_mode: "Markdown", ...webAppKeyboard() }
    );
  } catch {
    ctx.reply("⚠️ Could not load plans.");
  }
});

bot.command("app", (ctx) =>
  ctx.reply("🎵 Open the mini app:", {
    ...Markup.inlineKeyboard([
      Markup.button.webApp("Open ETHIO MUSIC", TMA_URL),
    ]),
  })
);

bot.catch((err) => console.error("bot error:", err));

console.log("ETHIO MUSIC bot is polling…");
bot.launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
