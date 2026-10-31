import { logger } from "../lib/logger.js";

/**
 * Cron scheduler (node-cron) with `job_runs` PK dedup so overlapping or
 * duplicated instances never double-fire. Full jobs arrive with the
 * notifications phase.
 */
const tasks: { stop: () => void }[] = [];

export function startScheduler(): void {
  logger.info("scheduler_stub_started");
}

export function stopScheduler(): void {
  for (const t of tasks) t.stop();
  tasks.length = 0;
}
