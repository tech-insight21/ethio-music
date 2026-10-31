import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";

const message = {
  error: { code: "rate_limited", message: "Too many requests, please slow down" },
};

const base = { standardHeaders: "draft-7" as const, legacyHeaders: false, message };

/** Global API budget per IP. */
export const apiLimiter = rateLimit({
  ...base,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
});

/** Tight budget for credential endpoints (brute-force protection). */
export const authLimiter = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: env.AUTH_RATE_LIMIT_MAX,
});

/** Search fan-out budget. */
export const searchLimiter = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: env.SEARCH_RATE_LIMIT_MAX,
});

/** Write-sensitive engagement routes (follow/favorite/playlist mutations). */
export const writeLimiter = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: 60,
});
