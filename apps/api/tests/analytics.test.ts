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

const app = newApp();
const state = {
  u1: null as TestUser | null,
  admin: null as TestUser | null,
  mod: null as TestUser | null,
};
const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

beforeAll(async () => {
  state.u1 = await createTestUser(app);
  state.admin = await createTestUser(app);
  state.mod = await createTestUser(app);
  await supabaseService.from("admin_roles").insert({ user_id: state.admin!.profileId, role: "super_admin" });
  await supabaseService.from("admin_roles").insert({ user_id: state.mod!.profileId, role: "moderator" });
});

afterAll(async () => {
  for (const u of [state.u1, state.admin, state.mod]) {
    if (u?.userId) await supabaseService.from("admin_roles").delete().eq("user_id", u.userId);
    await cleanupTestUser(u);
  }
  await closeDb();
});

describe("event ingestion", () => {
  it("accepts authenticated events", async () => {
    const res = await request(app)
      .post("/api/v1/analytics/events")
      .set(auth(state.u1!))
      .send({ type: "app_open", meta: { screen: "home" } });
    expect(res.status).toBe(202);
    expect(res.body.recorded).toBe(true);
  });

  it("accepts anonymous app_open events without attribution", async () => {
    const res = await request(app)
      .post("/api/v1/analytics/events")
      .send({ type: "app_open", meta: {} });
    expect(res.status).toBe(202);
  });

  it("rejects unknown event types and limits anonymous types", async () => {
    const bad = await request(app)
      .post("/api/v1/analytics/events")
      .set(auth(state.u1!))
      .send({ type: "self_destruct", meta: {} });
    expect(bad.status).toBe(422);

    const anon = await request(app)
      .post("/api/v1/analytics/events")
      .send({ type: "search", meta: { query: "x" } });
    expect(anon.status).toBe(202);
    expect(anon.body.recorded).toBe(false);
  });
});

describe("admin analytics (RBAC-gated)", () => {
  it("403 for non-staff and moderators (analytics:read)", async () => {
    const plain = await request(app).get("/api/v1/analytics/overview").set(auth(state.u1!));
    expect(plain.status).toBe(403);

    const mod = await request(app).get("/api/v1/analytics/overview").set(auth(state.mod!));
    expect(mod.status).toBe(403);
  });

  it("overview returns coherent KPIs", async () => {
    const res = await request(app).get("/api/v1/analytics/overview").set(auth(state.admin!));
    expect(res.status).toBe(200);
    expect(Number(res.body.total_users)).toBeGreaterThan(0);
    expect(Number(res.body.approved_songs)).toBeGreaterThanOrEqual(10);
    expect(Number(res.body.approved_artists)).toBeGreaterThanOrEqual(6);
    expect(Number(res.body.mau)).toBeGreaterThan(0);
  });

  it("listeners returns a 30-day daily series", async () => {
    const res = await request(app).get("/api/v1/analytics/listeners").set(auth(state.admin!));
    expect(res.status).toBe(200);
    expect(res.body.daily.length).toBe(30);
    expect(res.body.daily[0]).toHaveProperty("active_listeners");
    expect(res.body.daily[0]).toHaveProperty("new_users");
  });

  it("content returns top songs/artists/genres + search stats", async () => {
    const res = await request(app).get("/api/v1/analytics/content").set(auth(state.admin!));
    expect(res.status).toBe(200);
    expect(res.body.top_songs.length).toBeGreaterThan(0);
    expect(res.body.top_artists.length).toBeGreaterThan(0);
    expect(res.body.top_genres.length).toBeGreaterThan(0);
    expect(res.body.searches).toHaveProperty("top_queries");
  });

  it("revenue returns totals, daily series, conversions, promotions", async () => {
    const res = await request(app).get("/api/v1/analytics/revenue").set(auth(state.admin!));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.totals)).toBe(true);
    expect(res.body.daily.length).toBe(30);
    expect(res.body.conversions).toHaveProperty("paying_users");
    expect(Array.isArray(res.body.promotions)).toBe(true);
  });
});
