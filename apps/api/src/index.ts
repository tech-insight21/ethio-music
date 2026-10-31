import "dotenv/config";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { closePg } from "./lib/pg.js";
import { startWorker, stopWorker } from "./jobs/worker.js";
import { startScheduler, stopScheduler } from "./jobs/scheduler.js";

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "ethio_music_api_listening");
});

if (env.WORKER_ENABLED && env.NODE_ENV !== "test") {
  startWorker();
  startScheduler();
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "graceful_shutdown_start");
  stopScheduler();
  stopWorker();
  server.close(async () => {
    await closePg();
    logger.info("graceful_shutdown_complete");
    process.exit(0);
  });
  // hard exit if connections hang around
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
