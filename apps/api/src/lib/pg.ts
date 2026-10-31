import dns from "node:dns";
import pg from "pg";
import { databaseUrl } from "../config/env.js";
import { logger } from "./logger.js";

// Supabase poolers publish AAAA records; prefer IPv4 so hosts without IPv6
// connectivity (CI runners, some VPS) connect on the first try.
dns.setDefaultResultOrder("ipv4first");

let pool: pg.Pool | null = null;

export function getPgPool(): pg.Pool {
  if (pool) return pool;
  pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 12_000,
    ssl: { rejectUnauthorized: false },
  });
  pool.on("error", (err) => {
    logger.error({ err: err.message }, "pg_idle_client_error");
  });
  return pool;
}

/** Parameterized query helper — the ONLY way SQL is executed. */
export async function pgQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const res = await getPgPool().query(text, params as unknown[]);
  return res.rows as T[];
}

/** Run `fn` inside a transaction; rolls back on throw. */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function closePg(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
