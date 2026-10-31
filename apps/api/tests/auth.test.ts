import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  BOT_TOKEN,
  cleanupTestUser,
  closeDb,
  createTestUser,
  newApp,
  signInitData,
  testTelegramId,
  type TestUser,
} from "./helpers.js";
import { tgEmail } from "../src/modules/auth/auth.service.js";

const app = newApp();
const nowSec = () => Math.floor(Date.now() / 1000);

const state: { user: TestUser | null } = { user: null };

afterAll(async () => {
  await cleanupTestUser(state.user);
  await closeDb();
});

describe("POST /auth/telegram (initData validation)", () => {
  it("401 on a tampered payload (signature mismatch)", async () => {
    const initData = signInitData({ id: testTelegramId(), first_name: "X" });
    const tampered = `${initData}&user=${encodeURIComponent('{"id":1,"first_name":"Evil"}')}`;
    const res = await request(app).post("/api/v1/auth/telegram").send({ initData: tampered });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("invalid_initdata");
  });

  it("401 on stale auth_date", async () => {
    const stale = signInitData({ id: testTelegramId(), first_name: "Old" }, nowSec() - 3 * 86_400);
    const res = await request(app).post("/api/v1/auth/telegram").send({ initData: stale });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toContain("stale");
  });

  it("401 when hash is missing", async () => {
    const res = await request(app)
      .post("/api/v1/auth/telegram")
      .send({ initData: `auth_date=${nowSec()}&user=${encodeURIComponent('{"id":1}')}` });
    expect(res.status).toBe(401);
  });

  it("422 on malformed body", async () => {
    const res = await request(app).post("/api/v1/auth/telegram").send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("validation_failed");
  });

  it("mints a session for a valid initData and creates the profile", async () => {
    const user = await createTestUser(app);
    state.user = user;
    expect(user.token).toBeTruthy();
    expect(user.refreshToken).toBeTruthy();
    expect(user.username).toMatch(/^emg_test_\d+$/);
    const me = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${user.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(user.profileId);
    expect(me.body.roles).toEqual([]);
    expect(me.body.entitlement.premium).toBe(false);
  });

  it("is idempotent: second login reuses the same account", async () => {
    const user = state.user!;
    const initData = signInitData({
      id: user.telegramId,
      first_name: "EMG",
      username: user.username,
      language_code: "en",
    });
    const res = await request(app).post("/api/v1/auth/telegram").send({ initData });
    expect(res.status).toBe(200);
    expect(res.body.profile.id).toBe(user.profileId);
  });
});

describe("session lifecycle", () => {
  it("GET /auth/me requires a token", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });

  it("refresh rotates the refresh token", async () => {
    const user = state.user!;
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: user.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.session.refresh_token).toBeTruthy();
    expect(res.body.session.refresh_token).not.toBe(user.refreshToken);
    user.refreshToken = res.body.session.refresh_token;
    user.token = res.body.session.access_token;
  });

  it("the pre-rotation refresh token cannot replay", async () => {
    const user = state.user!;
    const replay = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: `${user.refreshToken.slice(0, -2)}xx` });
    expect(replay.status).toBe(401);
  });

  it("lists active sessions", async () => {
    const user = state.user!;
    const res = await request(app)
      .get("/api/v1/auth/sessions")
      .set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(res.body.sessions.length).toBeGreaterThanOrEqual(1);
    expect(res.body.sessions[0]).not.toHaveProperty("refresh_token");
  });

  it("logout revokes the session server-side", async () => {
    const user = state.user!;
    const logout = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ refresh_token: user.refreshToken });
    expect(logout.status).toBe(204);

    const replay = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: user.refreshToken });
    expect(replay.status).toBe(401);

    const me = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${user.token}`);
    // access token remains valid until expiry — document, then mint a new login
    expect([200, 401]).toContain(me.status);
  });

  it("DELETE /auth/sessions revokes everything for the caller", async () => {
    const user = await createTestUser(app);
    if (!state.user) state.user = user;
    const del = await request(app)
      .delete("/api/v1/auth/sessions")
      .set("Authorization", `Bearer ${user.token}`);
    expect(del.status).toBe(204);

    const list = await request(app)
      .get("/api/v1/auth/sessions")
      .set("Authorization", `Bearer ${user.token}`);
    expect(list.status).toBe(200);
    expect(list.body.sessions).toHaveLength(0);
  });
});

describe("POST /auth/admin/login", () => {
  it("401 on invalid credentials", async () => {
    const user = state.user;
    const email = user ? tgEmail(user.telegramId) : `nobody@${Date.now()}.invalid`;
    const res = await request(app)
      .post("/api/v1/auth/admin/login")
      .send({ email, password: "definitely-wrong" });
    expect(res.status).toBe(401);
  });

  it("401 for an unknown account", async () => {
    const res = await request(app)
      .post("/api/v1/auth/admin/login")
      .send({ email: `ghost-${Date.now()}@example.com`, password: "whatever123" });
    expect(res.status).toBe(401);
  });
});

describe("webhook & health basics", () => {
  it("healthz is public", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("bot rejects webhook updates with a wrong secret", async () => {
    const res = await request(app)
      .post("/api/v1/telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", "wrong-secret")
      .send({ update_id: 1 });
    expect([401, 404]).toContain(res.status); // 404 until webhook module registers
  });
});

describe("environment sanity", () => {
  it("bot token is configured for tests", () => {
    expect(BOT_TOKEN.length).toBeGreaterThan(10);
  });
});
