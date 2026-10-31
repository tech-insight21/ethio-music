import { createHash, randomUUID } from "node:crypto";
import { pgQuery } from "../../lib/pg.js";
import { logger } from "../../lib/logger.js";
import { supabaseAnon, supabaseService } from "../../lib/supabase.js";
import { HttpError } from "../../utils/http-error.js";
import type { TgUser } from "../../lib/telegram.js";
import type { ProfileRow } from "../../types.js";
import type { Request } from "express";

/**
 * Auth service: Telegram identity → Supabase auth user → profile → session.
 * The service-role client is used strictly server-side for provisioning;
 * the OTP exchange that mints the session runs on the anon client.
 */

const TG_EMAIL_DOMAIN = "telegram.ethiomusic.app";
export const SESSION_TTL_DAYS = 30;

export const tgEmail = (telegramId: number): string =>
  `tg${telegramId}@${TG_EMAIL_DOMAIN}`;

export interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
  user: { id: string; email?: string | null };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Find the auth user id for a deterministic Telegram email (direct SQL). */
async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const rows = await pgQuery<{ id: string }>(
    "select id from auth.users where email = $1 limit 1",
    [email],
  );
  return rows[0]?.id ?? null;
}

/**
 * Ensure an auth user + profile exist for the verified Telegram identity.
 * The `handle_new_user` DB trigger creates the profile row automatically.
 */
export async function ensureTelegramUser(tg: TgUser): Promise<ProfileRow> {
  const email = tgEmail(tg.id);
  let userId = await findAuthUserIdByEmail(email);

  if (!userId) {
    const fullName = [tg.first_name, tg.last_name].filter(Boolean).join(" ");
    const language = ["am", "om", "ti", "en"].includes(tg.language_code ?? "")
      ? (tg.language_code as ProfileRow["language_code"])
      : "am";
    const { error } = await supabaseService.auth.admin.createUser({
      email,
      password: randomUUID(),
      email_confirm: true,
      user_metadata: {
        username: tg.username?.toLowerCase(),
        full_name: fullName || undefined,
        avatar_url: tg.photo_url ?? undefined,
        language_code: language,
        telegram_id: tg.id,
      },
    });
    if (error) {
      const msg = String(error.message);
      if (!msg.toLowerCase().includes("already")) {
        logger.error({ err: msg }, "tg_user_provision_failed");
        throw new HttpError(500, "provisioning_failed", "Could not provision the account");
      }
    }
    userId = await findAuthUserIdByEmail(email);
    if (!userId) {
      throw new HttpError(500, "provisioning_failed", "Account provisioning did not complete");
    }
  }

  const { data: profile, error } = await supabaseService
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error || !profile) {
    throw new HttpError(500, "profile_missing", "Profile row is missing for the account");
  }

  // Keep the display snapshot fresh on every login (best effort).
  const fullName = [tg.first_name, tg.last_name].filter(Boolean).join(" ");
  if (
    (fullName && profile.full_name !== fullName) ||
    (tg.photo_url && profile.avatar_url !== tg.photo_url)
  ) {
    await supabaseService
      .from("profiles")
      .update({
        full_name: fullName || profile.full_name,
        avatar_url: tg.photo_url ?? profile.avatar_url,
      })
      .eq("id", userId);
  }
  return profile as ProfileRow;
}

/** Link the Telegram chat to the profile (keeps bot preferences intact). */
export async function linkBotChat(tg: TgUser, userId: string): Promise<void> {
  await pgQuery(
    `insert into bot_chats (chat_id, username, first_name, language_code, user_id)
     values ($1, $2, $3, $4, $5)
     on conflict (chat_id) do update
       set user_id = excluded.user_id,
           username = coalesce(excluded.username, bot_chats.username),
           first_name = coalesce(excluded.first_name, bot_chats.first_name)`,
    [tg.id, tg.username ?? null, tg.first_name ?? null, tg.language_code ?? null, userId],
  ).catch((e: unknown) =>
    logger.warn({ err: e instanceof Error ? e.message : e }, "bot_chat_link_failed"),
  );
}

/** Register a minted session: hashed lookup key + raw token for revocation. */
export async function registerSession(
  userId: string,
  refreshToken: string,
  req: Request,
): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await supabaseService.from("user_sessions").insert({
    user_id: userId,
    refresh_token_hash: hashToken(refreshToken),
    refresh_token: refreshToken,
    user_agent: req.headers["user-agent"]?.toString().slice(0, 300) ?? null,
    ip: req.ip ?? null,
    expires_at: expiresAt.toISOString(),
  });
}

/** Mint a fresh Supabase session for an existing deterministic email. */
export async function mintSession(email: string): Promise<SupabaseSession> {
  const { data: link, error: linkErr } = await supabaseService.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !link?.properties?.email_otp) {
    logger.error({ err: linkErr?.message }, "magic_link_mint_failed");
    throw new HttpError(500, "session_mint_failed", "Could not start a new session");
  }
  const { data, error } = await supabaseAnon.auth.verifyOtp({
    type: "magiclink",
    email,
    token: link.properties.email_otp,
  });
  if (error || !data?.session) {
    logger.error({ err: error?.message }, "otp_exchange_failed");
    throw new HttpError(500, "session_mint_failed", "Could not start a new session");
  }
  return data.session as unknown as SupabaseSession;
}

/** Rotate a refresh token into a fresh session (Supabase-side rotation). */
export async function refreshSession(refreshToken: string): Promise<SupabaseSession> {
  const { data, error } = await supabaseAnon.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data?.session) {
    throw new HttpError(401, "invalid_refresh_token", "Refresh token is invalid or expired");
  }
  return data.session as unknown as SupabaseSession;
}

/**
 * Revoke a session server-side. `accessToken` (the caller's access token)
 * lets GoTrue revoke the matching session; scope=local kills exactly that
 * refresh-token family. Without it, the row is only marked locally —
 * note that Supabase already invalidates rotated refresh tokens by design.
 */
export async function revokeRefreshToken(
  refreshToken: string,
  accessToken?: string,
): Promise<void> {
  if (accessToken) {
    const { error } = await supabaseService.auth.admin.signOut(accessToken, "local");
    if (error) logger.warn({ err: error.message }, "signout_best_effort_failed");
  }
  await supabaseService
    .from("user_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("refresh_token_hash", hashToken(refreshToken))
    .is("revoked_at", null);
}

/** Revoke every live session of a user (server-side global sign-out). */
export async function revokeAllSessions(userId: string): Promise<void> {
  // Global logout requires an access token of the user: mint a throwaway
  // session from the deterministic email, then revoke scope=global.
  const email = await pgQuery<{ email: string | null }>(
    "select email from auth.users where id = $1 limit 1",
    [userId],
  ).then((rows) => rows[0]?.email ?? null);

  if (email) {
    try {
      const session = await mintSession(email);
      await supabaseService.auth.admin.signOut(session.access_token, "global");
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err },
        "global_signout_best_effort",
      );
    }
  }
  await supabaseService
    .from("user_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("revoked_at", null);
}
