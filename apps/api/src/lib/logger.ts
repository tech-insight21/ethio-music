import pino from "pino";
import { isProd } from "../config/env.js";

/**
 * Structured logger. Authorization headers / tokens are redacted.
 * All request logging funnels through here with a request id.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "ethio-music-api" },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "access_token",
      "refresh_token",
      "initData",
      "password",
    ],
    censor: "[redacted]",
  },
  ...(isProd
    ? {}
    : { transport: { target: "pino/file", options: { destination: 1 } } }),
});
