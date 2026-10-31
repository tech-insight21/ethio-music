/**
 * ETHIO MUSIC bot — configuration loader.
 *
 * SECURITY CONTRACT
 * • Secrets come ONLY from the environment (process.env) — never hardcoded.
 * • The service-role key is intentionally NOT supported: the bot reads the
 *   catalog with the same public anon key as the mini app and writes to the
 *   isolated bot_* tables over the direct Postgres connection.
 * • loadConfig() fails fast with the *names* of missing variables — it never
 *   logs secret values.
 */

export type RunMode = "polling" | "webhook" | "notify-only";

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface WebhookConfig {
  url: string; // public https base URL, e.g. https://ethio-bot.up.railway.app
  port: number;
  path: string; // secret-ish hook path
  secret: string | null; // X-Telegram-Bot-Api-Secret-Token
}

export interface Config {
  botToken: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  tmaUrl: string;
  db: DbConfig;
  adminIds: Set<number>;
  mode: RunMode;
  webhook: WebhookConfig | null;
  logLevel: "debug" | "info" | "warn" | "error";
}

export const DEFAULT_TMA_URL = "https://tech-insight21.github.io/ethio-music/";
export const DEFAULT_WEBHOOK_PATH = "/telegram-webhook";

function requireEnv(name: string, ...aliases: string[]): string {
  const v = [name, ...aliases].map((k) => process.env[k]).find((x) => x && x.trim() !== "");
  if (!v) {
    throw new Error(
      `Missing required env var: ${name}${aliases.length ? ` (or ${aliases.join(", ")})` : ""}`,
    );
  }
  return v.trim();
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function buildDbConfig(): DbConfig {
  const url = optional("DATABASE_URL");
  if (url && /^postgres(ql)?:\/\//.test(url)) {
    try {
      const u = new URL(url);
      return {
        host: u.hostname,
        port: Number(u.port || 5432),
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        database: u.pathname.replace(/^\//, "") || "postgres",
      };
    } catch {
      throw new Error("DATABASE_URL is set but not a valid postgres:// URL");
    }
  }
  // Non-postgres DATABASE_URL values (e.g. a host-provided default) are ignored.
  const ref = requireEnv("SUPABASE_REF");
  const password = requireEnv("SUPABASE_DB_PASSWORD");
  const host = optional("SUPABASE_POOLER_HOST") ?? `aws-0-eu-west-1.pooler.supabase.com`;
  return {
    host,
    port: 5432,
    user: `postgres.${ref}`,
    password,
    database: "postgres",
  };
}

export function loadConfig(): Config {
  const mode: RunMode = optional("NOTIFY_ONLY") === "1" ? "notify-only"
    : optional("WEBHOOK_URL") ? "webhook" : "polling";

  const botToken = requireEnv("BOT_TOKEN", "TELEGRAM_BOT_TOKEN");
  const supabaseUrl = requireEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = requireEnv(
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );

  let webhook: WebhookConfig | null = null;
  if (mode === "webhook") {
    const url = optional("WEBHOOK_URL")!.replace(/\/+$/, "");
    if (!url.startsWith("https://") && !url.includes("localhost") && !url.includes("127.0.0.1")) {
      throw new Error("WEBHOOK_URL must be an https:// URL (Telegram requirement)");
    }
    webhook = {
      url,
      port: Number(optional("PORT") ?? 3000),
      path: optional("WEBHOOK_PATH") ?? DEFAULT_WEBHOOK_PATH,
      secret: optional("WEBHOOK_SECRET") ?? null,
    };
  }

  const adminIds = new Set<number>();
  for (const part of (optional("ADMIN_TELEGRAM_IDS") ?? "").split(",")) {
    const n = Number(part.trim());
    if (Number.isSafeInteger(n) && n > 0) adminIds.add(n);
  }

  const logLevel = (optional("LOG_LEVEL") ?? "info") as Config["logLevel"];

  return {
    botToken,
    supabaseUrl,
    supabaseAnonKey,
    tmaUrl: optional("TMA_URL") ?? DEFAULT_TMA_URL,
    db: buildDbConfig(),
    adminIds,
    mode,
    webhook,
    logLevel,
  };
}
