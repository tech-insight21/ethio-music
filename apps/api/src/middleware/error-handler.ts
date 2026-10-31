import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { isProd } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { HttpError } from "../utils/http-error.js";

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: "not_found", message: `Route ${req.method} ${req.path} not found` },
  });
}

/** Consistent JSON error envelope + structured logging. */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    const issues = err.issues.slice(0, 20).map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    res.status(422).json({
      error: {
        code: "validation_failed",
        message: "Request validation failed",
        details: issues,
      },
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
    return;
  }

  // multer
  if (typeof err === "object" && err !== null && "type" in err) {
    const e = err as { type?: string; code?: string; message?: string };
    if (e.type === "entity.too.large") {
      res.status(413).json({ error: { code: "payload_too_large", message: "Request body too large" } });
      return;
    }
    if (e.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: { code: "file_too_large", message: "Uploaded file exceeds the 5 MB limit" } });
      return;
    }
    if (e.code === "LIMIT_UNEXPECTED_FILE") {
      res.status(400).json({ error: { code: "unexpected_file", message: "Unexpected file field" } });
      return;
    }
  }

  logger.error(
    {
      reqId: req.id,
      err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
    },
    "unhandled_error",
  );
  res.status(500).json({
    error: {
      code: "internal_error",
      message: isProd ? "Internal server error" : err instanceof Error ? err.message : "Unknown error",
    },
  });
}
