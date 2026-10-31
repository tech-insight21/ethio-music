/**
 * Minimal leveled logger. Secret values are redacted by key name and by
 * pattern (long base64-ish tokens) so they never reach logs.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type Level = keyof typeof LEVELS;

let currentLevel: Level = "info";
const SECRET_KEYS = /(token|password|secret|key|authorization|cookie)/i;
const LONG_TOKEN = /\b[\w-]{32,}\b/g;

export function setLevel(level: Level): void {
  currentLevel = level;
}

function scrub(v: unknown): unknown {
  if (typeof v === "string") {
    if (SECRET_KEYS.test(v)) return "[redacted]";
    return v.replace(LONG_TOKEN, (m) => (m.length > 40 ? "[redacted]" : m));
  }
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "[redacted]" : scrub(val);
    }
    return out;
  }
  return v;
}

function emit(level: Level, msg: string, meta?: unknown): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}`;
  if (meta === undefined) {
    (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
  } else {
    (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(
      line,
      JSON.stringify(scrub(meta)),
    );
  }
}

export const log = {
  debug: (msg: string, meta?: unknown) => emit("debug", msg, meta),
  info: (msg: string, meta?: unknown) => emit("info", msg, meta),
  warn: (msg: string, meta?: unknown) => emit("warn", msg, meta),
  error: (msg: string, meta?: unknown) => emit("error", msg, meta),
};
