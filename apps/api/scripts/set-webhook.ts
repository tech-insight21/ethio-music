import { env } from "../src/config/env.js";
import { tgSetWebhook, tgGetMe } from "../src/lib/telegram.js";

/**
 * Register the Telegram webhook for the API.
 *   npm run tg:set-webhook -- https://your-api-host.example.com
 */
const base = process.argv[2];
if (!base) {
  console.error("Usage: npm run tg:set-webhook -- <public-base-url>");
  process.exit(1);
}
if (!env.TG_WEBHOOK_SECRET) {
  console.error("TG_WEBHOOK_SECRET must be set (openssl rand -hex 32)");
  process.exit(1);
}

const me = await tgGetMe();
const url = `${base.replace(/\/+$/, "")}/api/v1/telegram/webhook`;
const ok = await tgSetWebhook(url, env.TG_WEBHOOK_SECRET);
if (!ok) {
  console.error("setWebhook failed");
  process.exit(1);
}
console.log(`✅ Webhook registered for @${me.username}: ${url}`);
console.log("ℹ️  Note: only ONE webhook per bot — stop any long-polling bot process first.");
