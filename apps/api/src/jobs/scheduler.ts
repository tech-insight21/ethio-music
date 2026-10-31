import cron from "node-cron";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { pgQuery, withTransaction } from "../lib/pg.js";
import { supabaseService } from "../lib/supabase.js";
import { enqueueMany } from "../modules/notifications/notification.service.js";

/**
 * Cron scheduler. Every job declares a `period_key` (minute/day bucket);
 * the `job_runs` PK (job, period_key) insert-or-skip guarantees that
 * overlapping cron fires or extra API replicas never double-execute.
 */

const tasks: cron.ScheduledTask[] = [];

/** Run `fn` at most once per period across all instances. */
async function runOnce(job: string, periodKey: string, fn: () => Promise<void>): Promise<boolean> {
  const claim = await pgQuery<{ job: string }>(
    `insert into job_runs (job, period_key) values ($1, $2)
     on conflict (job, period_key) do nothing
     returning job`,
    [job, periodKey],
  );
  if (claim.length === 0) return false; // already claimed this period
  try {
    await fn();
    await pgQuery(`update job_runs set finished_at = now() where job = $1 and period_key = $2`, [
      job,
      periodKey,
    ]);
    return true;
  } catch (err) {
    // release the claim so the next tick can retry
    await pgQuery(`delete from job_runs where job = $1 and period_key = $2`, [job, periodKey]);
    logger.error({ err: err instanceof Error ? err.message : err, job }, "scheduled_job_failed");
    return false;
  }
}

const minuteKey = (): string => new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
const dayKey = (): string => new Date().toISOString().slice(0, 10);

// ── job: new-release fan-out ────────────────────────────────────────────────

export async function runNewReleasesFanout(): Promise<{ songs: number; queued: number }> {
  const kill = await supabaseService
    .from("platform_settings")
    .select("value")
    .eq("key", "new_release_notifications_enabled")
    .maybeSingle();
  if (kill?.data?.value === false) return { songs: 0, queued: 0 };

  // watermark = last processed approved_at
  const wm = await pgQuery<{ value: string | null }>(
    "select value::text from bot_state where key = 'api_release_watermark'",
  );
  const since = wm[0]?.value ?? new Date(0).toISOString();

  const { data: freshSongs } = await supabaseService
    .from("songs")
    .select("id, title, approved_at, artist:artists(name, slug)")
    .eq("release_status", "approved")
    .gt("approved_at", since)
    .order("approved_at", { ascending: true })
    .limit(50);

  let queued = 0;
  let newest = since;
  for (const song of (freshSongs ?? []) as { id: string; title: string; approved_at: string }[]) {
    newest = song.approved_at > newest ? song.approved_at : newest;
    const followers = await pgQuery<{ follower_id: string }>(
      "select follower_id from follows where artist_id = (select artist_id from songs where id = $1)",
      [song.id],
    );
    const result = await enqueueMany(
      followers.map((f) => f.follower_id),
      (userId) => ({
        userId,
        type: "new_release" as const,
        title: "New release 🎵",
        body: song.title,
        data: { song_id: song.id },
        dedupKey: `new-release:${song.id}:${userId}`,
        channel: "both" as const,
      }),
    );
    queued += result.queued;
  }

  if (newest !== since) {
    await pgQuery(
      `insert into bot_state (key, value) values ('api_release_watermark', $1)
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [newest],
    );
  }
  return { songs: freshSongs?.length ?? 0, queued };
}

// ── job: premium expiry notices + expiry sweep ──────────────────────────────

export async function runPremiumExpiry(): Promise<{ expiring: number; expired: number }> {
  // (a) expiring within 3 days → notice
  const expiring = await pgQuery<{ id: string; user_id: string }>(
    `select id, user_id from subscriptions
      where status = 'active' and ends_at between now() and now() + interval '3 days'`,
  );
  const res = await enqueueMany(
    expiring.map((s) => s.user_id),
    (userId) => ({
      userId,
      type: "subscription" as const,
      title: "Your Premium is expiring soon",
      body: "Renew anytime to keep unlimited streaming.",
      dedupKey: `prem-exp:${expiring.find((e) => e.user_id === userId)!.id}:3d`,
      channel: "both" as const,
    }),
  );

  // (b) ended subscriptions → mark expired + farewell notice
  const ended = await withTransaction(async (tx) => {
    const rows = await tx.query<{ id: string; user_id: string }>(
      `update subscriptions set status = 'expired', updated_at = now()
        where status = 'active' and ends_at < now()
        returning id, user_id`,
    );
    return rows.rows;
  });
  await enqueueMany(
    ended.map((s) => s.user_id),
    (userId) => ({
      userId,
      type: "subscription" as const,
      title: "Premium expired",
      body: "Your Premium subscription ended. Renew to enjoy unlimited streaming again.",
      dedupKey: `prem-exp:${ended.find((e) => e.user_id === userId)!.id}:expired`,
      channel: "both" as const,
    }),
  );
  return { expiring: res.queued, expired: ended.length };
}

// ── job: maintenance ─────────────────────────────────────────────────────────

export async function runMaintenance(): Promise<void> {
  await pgQuery("delete from search_history where created_at < now() - interval '30 days'");
  await pgQuery("delete from analytics_events where created_at < now() - interval '180 days'");
  await pgQuery("delete from user_sessions where expires_at < now() or revoked_at is not null and created_at < now() - interval '30 days'");
  await pgQuery("delete from job_runs where started_at < now() - interval '7 days'");
}

// ── registration ─────────────────────────────────────────────────────────────

export function startScheduler(): void {
  const defs: { name: string; expr: string; key: () => string; fn: () => Promise<unknown> }[] = [
    { name: "new_release_fanout", expr: env.RELEASES_CRON, key: minuteKey, fn: runNewReleasesFanout },
    { name: "premium_expiry", expr: env.PREMIUM_CRON, key: dayKey, fn: runPremiumExpiry },
    { name: "maintenance", expr: env.MAINTENANCE_CRON, key: dayKey, fn: runMaintenance },
  ];
  for (const d of defs) {
    if (!cron.validate(d.expr)) {
      logger.warn({ cron: d.expr, job: d.name }, "invalid_cron_skipped");
      continue;
    }
    const task = cron.schedule(d.expr, () => {
      void runOnce(d.name, d.key(), d.fn as () => Promise<void>);
    });
    tasks.push(task);
  }
  logger.info({ jobs: defs.length }, "scheduler_started");
}

export function stopScheduler(): void {
  for (const t of tasks) t.stop();
  tasks.length = 0;
}
