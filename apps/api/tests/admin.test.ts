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
  superAdmin: null as TestUser | null,
  moderator: null as TestUser | null,
  plain: null as TestUser | null,
  createdAdminUserId: null as string | null,
  createdAdminEmail: "",
};

const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

beforeAll(async () => {
  state.superAdmin = await createTestUser(app);
  state.moderator = await createTestUser(app);
  state.plain = await createTestUser(app);
  await supabaseService
    .from("admin_roles")
    .insert({ user_id: state.superAdmin.profileId, role: "super_admin" });
  await supabaseService
    .from("admin_roles")
    .insert({ user_id: state.moderator.profileId, role: "moderator" });
});

afterAll(async () => {
  if (state.createdAdminUserId) {
    await supabaseService.from("admin_roles").delete().eq("user_id", state.createdAdminUserId);
    await supabaseService.auth.admin.deleteUser(state.createdAdminUserId).catch(() => undefined);
  }
  for (const u of [state.superAdmin, state.moderator, state.plain]) {
    if (u?.userId) {
      await supabaseService.from("admin_roles").delete().eq("user_id", u.userId);
    }
    await cleanupTestUser(u);
  }
  await closeDb();
});

describe("admin RBAC gates", () => {
  it("401 anonymous / 403 non-staff on the admin surface", async () => {
    const anon = await request(app).get("/api/v1/admin/users");
    expect(anon.status).toBe(401);

    const plain = await request(app).get("/api/v1/admin/users").set(auth(state.plain!));
    expect(plain.status).toBe(403);
  });

  it("moderator cannot manage users but can read the review queue", async () => {
    const users = await request(app).get("/api/v1/admin/users").set(auth(state.moderator!));
    expect(users.status).toBe(403);

    const queue = await request(app).get("/api/v1/admin/submissions").set(auth(state.moderator!));
    expect(queue.status).toBe(200);
  });
});

describe("staff administration", () => {
  it("creates an admin account (super_admin only)", async () => {
    const denied = await request(app)
      .post("/api/v1/admin/admins")
      .set(auth(state.moderator!))
      .send({ email: "x@y.z", password: "longenough123", role: "admin" });
    expect(denied.status).toBe(403);

    const email = `emg-admin-${Date.now()}@test.ethiomusic.local`;
    const res = await request(app)
      .post("/api/v1/admin/admins")
      .set(auth(state.superAdmin!))
      .send({ email, password: "super-secret-123", full_name: "EMG Staff", role: "admin" });
    expect(res.status).toBe(201);
    state.createdAdminUserId = res.body.admin.user_id;
    state.createdAdminEmail = email;

    // the new staff member can actually log in through the admin flow
    const login = await request(app)
      .post("/api/v1/auth/admin/login")
      .send({ email, password: "super-secret-123" });
    expect(login.status).toBe(200);
    expect(login.body.roles).toEqual(["admin"]);
  });

  it("rejects weak passwords", async () => {
    const res = await request(app)
      .post("/api/v1/admin/admins")
      .set(auth(state.superAdmin!))
      .send({ email: `weak-${Date.now()}@test.ethiomusic.local`, password: "short", role: "admin" });
    expect(res.status).toBe(422);
  });

  it("lists the staff roster", async () => {
    const res = await request(app).get("/api/v1/admin/admins").set(auth(state.superAdmin!));
    expect(res.status).toBe(200);
    expect(res.body.admins.length).toBeGreaterThanOrEqual(2);
  });

  it("blocks changing your OWN administrator role", async () => {
    const res = await request(app)
      .put(`/api/v1/admin/admins/${state.superAdmin!.profileId}/role`)
      .set(auth(state.superAdmin!))
      .send({ role: "moderator" });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain("own");

    const revoke = await request(app)
      .delete(`/api/v1/admin/admins/${state.superAdmin!.profileId}/role`)
      .set(auth(state.superAdmin!));
    expect(revoke.status).toBe(403);
  });

  it("changes and revokes another user's role", async () => {
    const target = state.createdAdminUserId!;
    const change = await request(app)
      .put(`/api/v1/admin/admins/${target}/role`)
      .set(auth(state.superAdmin!))
      .send({ role: "moderator" });
    expect(change.status).toBe(200);

    const revoke = await request(app)
      .delete(`/api/v1/admin/admins/${target}/role`)
      .set(auth(state.superAdmin!));
    expect(revoke.status).toBe(204);

    // revoked staff lose access within the role-cache TTL
    await new Promise((r) => setTimeout(r, 200));
  });
});

describe("user suspension", () => {
  it("suspends and reactivates a user (self-protection included)", async () => {
    const self = await request(app)
      .put(`/api/v1/admin/users/${state.superAdmin!.profileId}/status`)
      .set(auth(state.superAdmin!))
      .send({ is_active: false });
    expect(self.status).toBe(403);

    const suspend = await request(app)
      .put(`/api/v1/admin/users/${state.plain!.profileId}/status`)
      .set(auth(state.superAdmin!))
      .send({ is_active: false });
    expect(suspend.status).toBe(200);
    expect(suspend.body.user.is_active).toBe(false);

    // a suspended account is rejected at the authentication gate
    const blocked = await request(app).get("/api/v1/auth/me").set(auth(state.plain!));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toContain("suspended");

    // and a system notification was enqueued (dedup key present)
    const notes = await supabaseService
      .from("notifications")
      .select("id, dedup_key, title")
      .eq("user_id", state.plain!.profileId);
    expect(notes.data?.some((n) => n.dedup_key?.includes("acct-status"))).toBe(true);

    const reactivate = await request(app)
      .put(`/api/v1/admin/users/${state.plain!.profileId}/status`)
      .set(auth(state.superAdmin!))
      .send({ is_active: true });
    expect(reactivate.status).toBe(200);

    const ok = await request(app).get("/api/v1/auth/me").set(auth(state.plain!));
    expect(ok.status).toBe(200);
  });
});

describe("submissions review pipeline", () => {
  it("approves a pending artist submission → artist goes live", async () => {
    // register an artist as the plain user
    const reg = await request(app)
      .post("/api/v1/artists")
      .set(auth(state.plain!))
      .send({ name: `EMG Review Artist ${Date.now()}` });
    expect(reg.status).toBe(201);
    const artistId = reg.body.artist.id as string;

    const queue = await request(app)
      .get("/api/v1/admin/submissions?status=pending")
      .set(auth(state.moderator!));
    const submission = queue.body.submissions.find(
      (s: { artist: { id: string } }) => s.artist.id === artistId,
    );
    expect(submission).toBeTruthy();

    const approve = await request(app)
      .patch(`/api/v1/admin/submissions/${submission.id}`)
      .set(auth(state.moderator!))
      .send({ status: "approved" });
    expect(approve.status).toBe(200);

    const artist = await supabaseService.from("artists").select("status").eq("id", artistId).single();
    expect(artist.data?.status).toBe("approved");

    // the owner got notified
    const notes = await supabaseService
      .from("notifications")
      .select("title")
      .eq("user_id", state.plain!.profileId);
    expect(notes.data?.some((n) => n.title.includes("Artist approved"))).toBe(true);

    // cleanup
    await supabaseService.from("artists").delete().eq("id", artistId);
  });
});

describe("audit logs & platform settings", () => {
  it("audit trail captures privileged actions", async () => {
    const res = await request(app)
      .get("/api/v1/admin/audit-logs?limit=50")
      .set(auth(state.superAdmin!));
    expect(res.status).toBe(200);
    const actions = res.body.logs.map((l: { action: string }) => l.action);
    expect(actions).toContain("admin.create");
    expect(actions).toContain("admin.role.change");
    expect(actions).toContain("user.status");
    expect(actions).toContain("submission.review");
  });

  it("settings are staff-readable but super-admin-writable", async () => {
    const list = await request(app).get("/api/v1/admin/settings").set(auth(state.moderator!));
    expect(list.status).toBe(200);
    expect(list.body.settings.length).toBeGreaterThanOrEqual(4);

    const denied = await request(app)
      .put("/api/v1/admin/settings")
      .set(auth(state.moderator!))
      .send({ key: "maintenance_mode", value: true });
    expect(denied.status).toBe(403);

    const res = await request(app)
      .put("/api/v1/admin/settings")
      .set(auth(state.superAdmin!))
      .send({ key: "min_app_version", value: "1.1.0" });
    expect(res.status).toBe(200);
    expect(res.body.setting.value).toBe("1.1.0");
  });
});
