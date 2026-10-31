import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { TgUser } from "../../lib/telegram.js";

/**
 * Official Telegram Mini App initData validation:
 *
 *   secret_key        = HMAC_SHA256(key="WebAppData", data=BOT_TOKEN)
 *   computed_hash     = HMAC_SHA256(key=secret_key, data=data_check_string)
 *   data_check_string = initData fields (sorted, joined by \n, hash excluded)
 *
 * Newer clients also carry a `signature` field (Telegram Ed25519 signature
 * for third-party validation). It is excluded from the check string the same
 * way `hash` is; both strategies are attempted for maximum compatibility.
 */
export type InitDataVerification =
  | { ok: true; user: TgUser; authDate: number; params: URLSearchParams }
  | { ok: false; reason: string };

const tgUserSchema = z.object({
  id: z.number().int().positive(),
  is_bot: z.boolean().optional(),
  first_name: z.string().max(64).optional(),
  last_name: z.string().max(64).optional(),
  username: z.string().max(32).optional(),
  language_code: z.string().max(16).optional(),
  photo_url: z.string().url().optional(),
});

function computeHash(dataCheckString: string, botToken: string): string {
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  return createHmac("sha256", secret).update(dataCheckString).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a.toLowerCase(), "hex");
  const bufB = Buffer.from(b.toLowerCase(), "hex");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds: number,
): InitDataVerification {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing hash" };
  params.delete("hash");

  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  let signatureValid = safeEqualHex(computeHash(dcs, botToken), hash);
  if (!signatureValid && params.has("signature")) {
    // fallback: also exclude the third-party `signature` field
    const params2 = new URLSearchParams(initData);
    const h2 = params2.get("hash");
    if (h2) {
      params2.delete("hash");
      params2.delete("signature");
      const dcs2 = [...params2.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
      signatureValid = safeEqualHex(computeHash(dcs2, botToken), h2);
    }
  }
  if (!signatureValid) return { ok: false, reason: "bad signature" };

  const authDate = Number(params.get("auth_date") ?? 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!authDate || nowSec - authDate > maxAgeSeconds) {
    return { ok: false, reason: "stale auth_date" };
  }
  if (authDate - nowSec > 60) {
    return { ok: false, reason: "auth_date in the future" };
  }

  let userJson: unknown;
  try {
    userJson = JSON.parse(params.get("user") ?? "");
  } catch {
    return { ok: false, reason: "malformed user payload" };
  }
  const parsedUser = tgUserSchema.safeParse(userJson);
  if (!parsedUser.success) return { ok: false, reason: "invalid user payload" };
  if (parsedUser.data.is_bot) return { ok: false, reason: "bot users are not allowed" };

  return { ok: true, user: parsedUser.data, authDate, params };
}
