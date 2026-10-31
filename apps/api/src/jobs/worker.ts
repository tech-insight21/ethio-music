import { logger } from "../lib/logger.js";

/**
 * Notification queue worker. Polls `notifications` for due rows, claims a
 * batch with FOR UPDATE SKIP LOCKED (multi-instance safe), delivers to
 * Telegram respecting preferences + rate limits, tracks results.
 * Replaced by the full implementation in the notifications phase.
 */
let running = false;
let timer: NodeJS.Timeout | null = null;

export function startWorker(): void {
  if (running) return;
  running = true;
  logger.info("notification_worker_stub_started");
}

export function stopWorker(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  running = false;
}

export function isWorkerRunning(): boolean {
  return running;
}
