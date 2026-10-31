import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { corsOrigins, env, isProd } from "./config/env.js";
import { requestContext } from "./middleware/request-context.js";
import { apiLimiter } from "./middleware/rate-limit.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { v1Router } from "./modules/index.js";
import { getPgPool } from "./lib/pg.js";

export function createApp(): Express {
  const app = express();

  app.set("trust proxy", 1); // deployed behind Render/NGINX/Cloudflare
  app.disable("x-powered-by");

  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true); // curl / server-to-server
        if (corsOrigins.length === 0 || corsOrigins.includes(origin)) return cb(null, true);
        cb(new Error("Origin not allowed by CORS"));
      },
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(requestContext);

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, service: "ethio-music-api", uptime: Math.round(process.uptime()) });
  });

  app.get("/readyz", async (_req, res) => {
    try {
      await getPgPool().query("select 1");
      res.json({ ok: true, db: true });
    } catch (err) {
      res.status(503).json({
        ok: false,
        db: false,
        error: err instanceof Error ? err.message : "unreachable",
      });
    }
  });

  if (isProd && corsOrigins.length === 0) {
    // Fail closed: in production an empty allowlist blocks browser clients.
    console.warn("[cors] CORS_ORIGINS is empty in production — browser calls will be blocked");
  }

  app.use("/api/v1", apiLimiter, v1Router);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
