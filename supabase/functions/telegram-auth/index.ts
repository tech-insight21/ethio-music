// ============================================================================
// ETHIO MUSIC :: telegram-auth (Supabase Edge Function, Deno)
//
// Verifies Telegram Mini App initData server-side and mints a Supabase
// session. The client sends the RAW initData string; this function is the
// ONLY place that decides whether the user is real.
//
// Verification (per Telegram spec):
//   secret_key   = HMAC_SHA256(key="WebAppData", data=BOT_TOKEN)
//   expected_hex = HMAC_SHA256(key=secret_key, data=data_check_string)
//   data_check_string = initData params (minus hash) sorted, joined by \n
//
// Setup (one-time, by the project owner):
//   supabase functions deploy telegram-auth
//   supabase secrets set TELEGRAM_BOT_TOKEN=<bot token from @BotFather>
//
// Request:  POST /functions/v1/telegram-auth   { "initData": "<raw>" }
// Response: 200 { session: { access_token, refresh_token, user } }
//           401 invalid signature / stale auth_date
//           400 missing initData
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const AUTH_TTL_SECONDS = 86_400; // reject initData older than 24h

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function verifyInitData(
  initData: string,
  botToken: string
): Promise<{ ok: true; params: URLSearchParams } | { ok: false; reason: string }> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing hash" };
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const enc = new TextEncoder();

  // secret_key = HMAC("WebAppData", BOT_TOKEN)
  const secretKey = await crypto.subtle.importKey(
    "raw",
    enc.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const secret = await crypto.subtle.sign("HMAC", secretKey, enc.encode(botToken));

  // expected = HMAC(secret_key, data_check_string)
  const verifyKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", verifyKey, enc.encode(dataCheckString));
  const computed = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (computed !== hash.toLowerCase()) return { ok: false, reason: "bad signature" };

  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > AUTH_TTL_SECONDS) {
    return { ok: false, reason: "stale auth_date" };
  }
  return { ok: true, params };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) return json({ error: "TELEGRAM_BOT_TOKEN not configured" }, 500);

  let initData: string | undefined;
  try {
    ({ initData } = (await req.json()) as { initData?: string });
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (!initData) return json({ error: "initData required" }, 400);

  const verified = await verifyInitData(initData, botToken);
  if (!verified.ok) return json({ error: verified.reason }, 401);

  // Parse the (now trusted) Telegram user
  let tgUser: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    photo_url?: string;
    language_code?: string;
  };
  try {
    tgUser = JSON.parse(verified.params.get("user") ?? "{}");
  } catch {
    return json({ error: "malformed user payload" }, 400);
  }
  if (!tgUser?.id) return json({ error: "user payload missing" }, 400);

  // Mint/refresh a Supabase session for this Telegram identity.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, // server-side only, never exposed
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Deterministic, non-loginable email binding the Telegram id.
  const email = `tg${tgUser.id}@telegram.ethiomusic.app`;
  const password = crypto.randomUUID(); // random; never used for login

  // 1. ensure the auth user exists (the handle_new_user DB trigger creates
  //    the matching public.profiles row automatically)
  const { error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      username: tgUser.username?.toLowerCase(),
      full_name: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" "),
      avatar_url: tgUser.photo_url ?? null,
      language_code: tgUser.language_code ?? "am",
      telegram_id: tgUser.id,
    },
  });

  // "already registered" is fine — existing users take the same path below.
  if (createErr && !String(createErr.message).includes("already")) {
    return json({ error: "user provisioning failed" }, 500);
  }

  // 2. mint a fresh session: magic link → OTP exchange
  const { data: link, error: linkErr } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !link?.properties?.email_otp) {
    return json({ error: "could not mint session link" }, 500);
  }

  const { data: otpData, error: otpErr } = await supabase.auth.verifyOtp({
    type: "magiclink",
    email,
    token: link.properties.email_otp,
  });
  if (otpErr || !otpData?.session) {
    return json({ error: "session mint failed" }, 500);
  }

  return json({
    session: {
      access_token: otpData.session.access_token,
      refresh_token: otpData.session.refresh_token,
      user: otpData.user,
    },
  });
});
