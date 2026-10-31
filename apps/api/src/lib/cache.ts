import { env } from "../config/env.js";

/**
 * Small in-process TTL cache for hot catalog reads (trending, genres, plans).
 * Single-instance caching; swap for Redis when running many replicas.
 */
type Entry = { value: unknown; expiresAt: number };

const store = new Map<string, Entry>();
const MAX_KEYS = 1_000;

export function cacheGet<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function cacheSet(key: string, value: unknown, ttlMs = env.CACHE_TTL_MS): void {
  if (store.size >= MAX_KEYS) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Drop entries whose key starts with `prefix`; clear everything when omitted. */
export function cacheInvalidate(prefix?: string): void {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
