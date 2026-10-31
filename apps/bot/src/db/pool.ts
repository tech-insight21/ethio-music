import pg from "pg";
import dns from "node:dns";
import type { DbConfig } from "../config.js";

// Supabase poolers publish AAAA records; prefer IPv4 so hosts without
// IPv6 connectivity (CI runners, some VPS) connect on the first try.
dns.setDefaultResultOrder("ipv4first");

/**
 * Direct Postgres connection (Supabase pooler, session mode).
 * Used ONLY for the bot_* tables — the music catalog itself is read through
 * the same public anon REST API the mini app uses (see db/catalog.ts).
 *
 * The bot_* tables have RLS enabled with zero policies, so this owner
 * connection is the only way in; PostgREST cannot touch them.
 */

let pool: pg.Pool | null = null;

export function initPool(db: DbConfig): pg.Pool {
  if (pool) return pool;
  pool = new pg.Pool({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    database: db.database,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 12_000,
    ssl: { rejectUnauthorized: false },
  });
  pool.on("error", (err) => {
    // keep the process alive on idle-client errors; log for observability
    console.error("[pool] idle client error:", err.message);
  });
  return pool;
}

export function getPool(): pg.Pool {
  if (!pool) throw new Error("DB pool not initialised — call initPool() first");
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query(text, params as unknown[]);
  return res.rows as T[];
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
