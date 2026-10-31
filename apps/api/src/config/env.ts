import { z } from "zod";

/**
 * Central, fail-fast environment configuration.
 * Secrets live ONLY here and are never logged or shipped to clients.
 * TELEGRAM_BOT_TOKEN accepts the TG_BOT_TOKEN alias used by this repo.
 */
const boolish = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined ? def : ["1", "true", "yes"].includes(v.trim().toLowerCase()),
    );

const raw = {
  ...process.env,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? process.env.TG_BOT_TOKEN,
};

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(10),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  SUPABASE_JWT_SECRET: z.string().min(10),

  // Direct Postgres (pooler, session mode)
  SUPABASE_REF: z.string().min(3),
  SUPABASE_DB_PASSWORD: z.string().min(3),
  SUPABASE_POOLER_HOST: z.string().min(3).default("aws-0-eu-west-1.pooler.supabase.com"),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(10).optional(),
  TG_WEBHOOK_SECRET: z.string().min(8).optional(),
  TG_INITDATA_MAX_AGE: z.coerce.number().int().positive().default(86_400),
  TMA_URL: z.string().url().default("https://tech-insight21.github.io/ethio-music/"),

  // HTTP
  CORS_ORIGINS: z.string().default(""),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(15),
  SEARCH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

  // Cache / jobs
  CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(60_000),
  WORKER_ENABLED: boolish(true),
  WORKER_BATCH_SIZE: z.coerce.number().int().positive().max(100).default(25),
  NOTIFY_CRON: z.string().default("*/1 * * * *"),
  RELEASES_CRON: z.string().default("*/5 * * * *"),
  PREMIUM_CRON: z.string().default("17 7 * * *"),
  MAINTENANCE_CRON: z.string().default("3 4 * * *"),

  COMMAND_FORWARD_URL: z.string().url().optional(),
});

const parsed = envSchema.safeParse(raw);
if (!parsed.success) {
  // Print only the offending KEYS — never the values.
  const keys = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  console.error(`[env] invalid/missing configuration for: ${keys}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

/** Direct Postgres connection string (Supabase pooler, session mode). */
export const databaseUrl =
  `postgresql://postgres.${env.SUPABASE_REF}:${encodeURIComponent(env.SUPABASE_DB_PASSWORD)}` +
  `@${env.SUPABASE_POOLER_HOST}:5432/postgres`;

export const corsOrigins = env.CORS_ORIGINS.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
