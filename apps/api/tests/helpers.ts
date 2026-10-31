import { createHmac } from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { supabaseService } from "../src/lib/supabase.js";
import { closePg } from "../src/lib/pg.js";

export const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? process.env.TG_BOT_TOKEN ?? "";

/** Build initData exactly like a Telegram client would, signed with our bot token. */
export function signInitData(
  user: Record<string, unknown>,
  authDate = Math.floor(Date.now() / 1000),
): string {
  const params = new URLSearchParams();
  params.set("auth_date", String(authDate));
  params.set("user", JSON.stringify(user));
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

/** Unique, clearly-marked test Telegram identity (91xxxxxxx range). */
export function testTelegramId(): number {
  return 910_000_000 + Math.floor(Math.random() * 900_000);
}

export function newApp(): Express {
  return createApp();
}

export interface TestUser {
  telegramId: number;
  userId: string | null;
  token: string;
  refreshToken: string;
  profileId: string;
  username: string | null;
}

/** Authenticate a fresh test user through the real /auth/telegram flow. */
export async function createTestUser(app: Express, overrides: Record<string, unknown> = {}): Promise<TestUser> {
  const telegramId = testTelegramId();
  const username = `emg_test_${telegramId}`;
  const initData = signInitData({
    id: telegramId,
    first_name: "EMG",
    last_name: "Test",
    username,
    language_code: "en",
    ...overrides,
  });
  const res = await request(app).post("/api/v1/auth/telegram").send({ initData });
  if (res.status !== 200) {
    throw new Error(`createTestUser failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return {
    telegramId,
    userId: res.body.session?.user?.id ?? null,
    token: res.body.session.access_token,
    refreshToken: res.body.session.refresh_token,
    profileId: res.body.profile.id,
    username: res.body.profile.username,
  };
}

/** Remove every trace of a test user (FK cascade handles the rest). */
export async function cleanupTestUser(user: TestUser | null): Promise<void> {
  try {
    if (user?.userId) {
      await supabaseService.auth.admin.deleteUser(user.userId);
    }
  } catch {
    /* already gone */
  }
  try {
    if (user?.telegramId) {
      const { pgQuery } = await import("../src/lib/pg.js");
      await pgQuery("delete from bot_chats where chat_id = $1", [user.telegramId]);
    }
  } catch {
    /* best effort */
  }
}

/** Close the pg pool so vitest can exit cleanly. */
export async function closeDb(): Promise<void> {
  await closePg();
}
