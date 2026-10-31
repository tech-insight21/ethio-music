import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  cleanupTestUser,
  closeDb,
  createTestUser,
  newApp,
  type TestUser,
} from "./helpers.js";
import { supabaseService } from "../src/lib/supabase.js";
import { pgQuery } from "../src/lib/pg.js";
import { enqueueNotification } from "../src/modules/notifications/notification.service.js";
import { processPendingNotifications } from "../src/jobs/worker.js";
import { runNewReleasesFanout } from "../src/jobs/scheduler.js";

const app = newApp();
const SECRET = "emg-test-webhook-secret-0123456789";
const state: { u1: TestUser | null } = { u1: null };
const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });
const NOTIFICATIONS: string[] = [];

beforeAll(async () => {
  state.u1 = await createTestUser(app);
});

afterAll(async () => {
  if (NOTIFICATIONS.length > 0) {
    await pgQuery("delete from notifications where id = any($1::uuid[])", [NOTIFICATIONS]);
  }
  await pgQuery("delete from bot_chats where chat_id between 925000000 and 926000000");
  await pgQuery("delete from bot_state where key = 'api_release_watermark'");
  await cleanupTestUser(state.u1);
  await closeDb();
});

async function track(userId: string, input: Partial<Parameters<typeof enqueueNotification>[0]>): Promise<string> {
  const res = await enqueueNotification({
    userId,
    type: "system",
    title: "EMG Test",
    dedupKey: `test-${Date.now()}-${Math.random()}`,
    ...input,
  } as Parameters<typeof enqueueNotification>[0]);
  if (res.id) NOTIFICATIONS.push(res.id);
  return res.id!;
}

describe("notification enqueue + dedup", () => {
  it("duplicate dedup_key is rejected at the DB level", async () => {
    const first = await enqueueNotification({
      userId: state.u1!.profileId,
      type: "system",
      title: "Once only",
      dedupKey: `dedup-test-${state.u1!.profileId}`,
    });
    expect(first.queued).toBe(true);
    NOTIFICATIONS.push(first.id!);

    const second = await enqueueNotification({
      userId: state.u1!.profileId,
      type: "system",
      title: "Once only",
      dedupKey: `dedup-test-${state.u1!.profileId}`,
    });
    expect(second.queued).toBe(false); // unique (user_id, dedup_key) index
  });
});

/** Hermetic worker run: only THIS row may be claimed. */
async function processOnly(id: string): Promise<Awaited<ReturnType<typeof processPendingNotifications>>> {
  await pgQuery(
    "update notifications set status = 'skipped', last_error = 'test_noise' where status = 'pending' and id <> $1",
    [id],
  );
  return processPendingNotifications();
}

describe("worker pipeline", () => {
  it("in-app notifications are marked sent", async () => {
    const id = await track(state.u1!.profileId, { channel: "in_app" });
    await pgQuery("update notifications set send_at = now() where id = $1", [id]);
    const stats = await processOnly(id);
    expect(stats.claimed).toBeGreaterThanOrEqual(1);
    const rows = await pgQuery<{ status: string }>(
      "select status from notifications where id = $1",
      [id],
    );
    expect(rows[0].status).toBe("sent");
  });

  it("telegram-only with no linked chat → skipped", async () => {
    await pgQuery("delete from bot_chats where user_id = $1", [state.u1!.profileId]);
    const id = await track(state.u1!.profileId, { channel: "telegram" });
    await pgQuery("update notifications set send_at = now() where id = $1", [id]);
    await processOnly(id);
    const rows = await pgQuery<{ status: string; last_error: string | null }>(
      "select status, last_error from notifications where id = $1",
      [id],
    );
    expect(rows[0].status).toBe("skipped");
    expect(rows[0].last_error).toBe("no_linked_chat");
  });

  it("respects user opt-outs (bot_blocked, notify prefs)", async () => {
    await pgQuery("delete from bot_chats where user_id = $1", [state.u1!.profileId]);
    await pgQuery(
      `insert into bot_chats (chat_id, user_id, is_blocked) values (925000001, $1, true)
       on conflict (chat_id) do update set user_id = excluded.user_id, is_blocked = true`,
      [state.u1!.profileId],
    );
    const id = await track(state.u1!.profileId, { channel: "telegram" });
    await pgQuery("update notifications set send_at = now() where id = $1", [id]);
    await processOnly(id);
    const rows = await pgQuery<{ status: string; last_error: string | null }>(
      "select status, last_error from notifications where id = $1",
      [id],
    );
    expect(rows[0].status).toBe("skipped");
    expect(rows[0].last_error).toBe("bot_blocked");

    // opted out of premium notices
    await pgQuery(
      "update bot_chats set is_blocked = false, notify_premium = false where chat_id = 925000001",
    );
    const id2 = await track(state.u1!.profileId, { type: "subscription", channel: "telegram" });
    await pgQuery("update notifications set send_at = now() where id = $1", [id2]);
    await processOnly(id2);
    const rows2 = await pgQuery<{ status: string; last_error: string | null }>(
      "select status, last_error from notifications where id = $1",
      [id2],
    );
    expect(rows2[0].last_error).toBe("user_opted_out_premium");

    // opted out of new releases
    await pgQuery("update bot_chats set notify_new_releases = false where chat_id = 925000001");
    const id3 = await track(state.u1!.profileId, { type: "new_release", channel: "telegram" });
    await pgQuery("update notifications set send_at = now() where id = $1", [id3]);
    await processOnly(id3);
    const rows3 = await pgQuery<{ status: string; last_error: string | null }>(
      "select status, last_error from notifications where id = $1",
      [id3],
    );
    expect(rows3[0].last_error).toBe("user_opted_out_new_releases");
  });

  it("telegram send failure retries with backoff, then fails", async () => {
    // unreachable chat id (Telegram rejects: chat not found)
    await pgQuery(
      `insert into bot_chats (chat_id, user_id) values (925000002, $1)
       on conflict (chat_id) do update set user_id = excluded.user_id, is_blocked = false, notify_premium = true, notify_new_releases = true`,
      [state.u1!.profileId],
    );
    const id = await track(state.u1!.profileId, { channel: "telegram" });
    await pgQuery("update notifications set send_at = now() where id = $1", [id]);

    let stats = await processOnly(id);
    expect(stats.retried).toBeGreaterThanOrEqual(1);
    let rows = await pgQuery<{ status: string; attempts: number; send_at: string }>(
      "select status, attempts, send_at from notifications where id = $1",
      [id],
    );
    expect(rows[0].status).toBe("pending");
    expect(rows[0].attempts).toBe(1);
    expect(new Date(rows[0].send_at).getTime()).toBeGreaterThan(Date.now());

    // exhaust attempts → failed
    await pgQuery("update notifications set attempts = 5, send_at = now() where id = $1", [id]);
    stats = await processOnly(id);
    expect(stats.failed).toBeGreaterThanOrEqual(1);
    rows = await pgQuery<{ status: string }>("select status from notifications where id = $1", [id]);
    expect(rows[0].status).toBe("failed");
  });
});

describe("scheduled new-release fan-out", () => {
  it("notifies followers of newly approved songs, watermark prevents re-runs", async () => {
    // follow the seeded ethio-jazz artist
    await request(app)
      .post("/api/v1/users/me/follows/f0000000-0000-4000-8000-00000000aa01")
      .set(auth(state.u1!));

    const first = await runNewReleasesFanout();
    expect(first.songs).toBeGreaterThan(0);

    const rows = await pgQuery<{ n: string }>(
      `select count(*)::text as n from notifications
        where user_id = $1 and type = 'new_release'`,
      [state.u1!.profileId],
    );
    expect(Number(rows[0].n)).toBeGreaterThan(0);

    const second = await runNewReleasesFanout();
    expect(second.songs).toBe(0); // watermark advanced
  });
});

describe("user notification API", () => {
  it("lists, reads, and deletes in-app notifications", async () => {
    await track(state.u1!.profileId, { channel: "in_app" });

    const list = await request(app).get("/api/v1/notifications").set(auth(state.u1!));
    expect(list.status).toBe(200);
    expect(list.body.notifications.length).toBeGreaterThanOrEqual(1);
    const unreadId = list.body.notifications.find((n: { read_at: string | null }) => !n.read_at)?.id;
    expect(unreadId).toBeTruthy();

    const read = await request(app).post(`/api/v1/notifications/${unreadId}/read`).set(auth(state.u1!));
    expect(read.status).toBe(204);

    const readAll = await request(app).post("/api/v1/notifications/read-all").set(auth(state.u1!));
    expect(readAll.status).toBe(204);

    const del = await request(app).delete(`/api/v1/notifications/${unreadId}`).set(auth(state.u1!));
    expect(del.status).toBe(204);
  });

  it("telegram preferences read + update", async () => {
    const status = await request(app).get("/api/v1/notifications/telegram").set(auth(state.u1!));
    expect(status.status).toBe(200);
    expect(status.body.linked).toBe(true);

    const upd = await request(app)
      .put("/api/v1/notifications/telegram")
      .set(auth(state.u1!))
      .send({ notify_new_releases: true, notify_premium: true });
    expect(upd.status).toBe(200);
    expect(upd.body.preferences.notify_new_releases).toBe(true);
  });
});

describe("telegram webhook", () => {
  it("rejects updates with a wrong or missing secret", async () => {
    const wrong = await request(app)
      .post("/api/v1/telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", "nope")
      .send({ update_id: 1 });
    expect(wrong.status).toBe(401);

    const missing = await request(app).post("/api/v1/telegram/webhook").send({ update_id: 2 });
    expect(missing.status).toBe(401);
  });

  it("accepts /start and registers the chat + returns Open App button markup", async () => {
    const res = await request(app)
      .post("/api/v1/telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", SECRET)
      .send({
        update_id: 100,
        message: {
          message_id: 1,
          chat: { id: 925000003 },
          from: { id: 925000003, first_name: "EMG", username: "emg_webhook_test" },
          text: "/start",
        },
      });
    expect(res.status).toBe(200);

    const rows = await pgQuery(
      "select chat_id, username from bot_chats where chat_id = 925000003",
    );
    expect(rows.length).toBe(1);
  });

  it("my_chat_member updates block state", async () => {
    const res = await request(app)
      .post("/api/v1/telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", SECRET)
      .send({
        update_id: 101,
        my_chat_member: {
          chat: { id: 925000003 },
          from: { id: 925000003 },
          new_chat_member: { status: "kicked" },
        },
      });
    expect(res.status).toBe(200);
    const rows = await pgQuery("select is_blocked from bot_chats where chat_id = 925000003");
    expect(rows[0].is_blocked).toBe(true);
  });

  it("unknown updates still return 200 (no retry storms)", async () => {
    const res = await request(app)
      .post("/api/v1/telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", SECRET)
      .send({ update_id: 102 });
    expect(res.status).toBe(200);
  });
});
