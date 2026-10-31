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
const state: { u1: TestUser | null; u2: TestUser | null } = { u1: null, u2: null };

const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

beforeAll(async () => {
  state.u1 = await createTestUser(app);
  state.u2 = await createTestUser(app);
});

afterAll(async () => {
  await cleanupTestUser(state.u1);
  await cleanupTestUser(state.u2);
  await closeDb();
});

describe("profile management", () => {
  it("GET /users/me returns profile, defaults and free entitlement", async () => {
    const res = await request(app).get("/api/v1/users/me").set(auth(state.u1!));
    expect(res.status).toBe(200);
    expect(res.body.user.username).toMatch(/^emg_test_/);
    expect(res.body.preferences.notify_new_releases).toBe(true);
    expect(res.body.entitlement.premium).toBe(false);
  });

  it("PATCH /users/me updates fields and enforces username format", async () => {
    const ok = await request(app)
      .patch("/api/v1/users/me")
      .set(auth(state.u1!))
      .send({ bio: "Integration test account", language_code: "en" });
    expect(ok.status).toBe(200);
    expect(ok.body.user.bio).toBe("Integration test account");

    const bad = await request(app)
      .patch("/api/v1/users/me")
      .set(auth(state.u1!))
      .send({ username: "Not Valid!" });
    expect(bad.status).toBe(422);
  });

  it("username conflicts return 409", async () => {
    const target = state.u2!.username!;
    const res = await request(app)
      .patch("/api/v1/users/me")
      .set(auth(state.u1!))
      .send({ username: target });
    expect(res.status).toBe(409);
  });

  it("PUT /users/me/preferences merges and persists", async () => {
    const res = await request(app)
      .put("/api/v1/users/me/preferences")
      .set(auth(state.u1!))
      .send({ notify_promotions: false, data_saver: true });
    expect(res.status).toBe(200);
    expect(res.body.preferences.notify_promotions).toBe(false);
    expect(res.body.preferences.data_saver).toBe(true);
    // persisted for the next read
    const again = await request(app).get("/api/v1/users/me").set(auth(state.u1!));
    expect(again.body.preferences.notify_promotions).toBe(false);
  });

  it("rejects invalid preferences (422)", async () => {
    const res = await request(app)
      .put("/api/v1/users/me/preferences")
      .set(auth(state.u1!))
      .send({ notify_new_releases: "yes-please" });
    expect(res.status).toBe(422);
  });

  it("GET /users/me/activity lists personal events", async () => {
    const res = await request(app).get("/api/v1/users/me/activity").set(auth(state.u1!));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
  });
});

describe("follows", () => {
  const ABEBO = "f0000000-0000-4000-8000-00000000aa01";

  it("follow → listed → duplicate is idempotent → unfollow", async () => {
    const follow = await request(app)
      .post(`/api/v1/users/me/follows/${ABEBO}`)
      .set(auth(state.u1!));
    expect(follow.status).toBe(201);

    const dup = await request(app)
      .post(`/api/v1/users/me/follows/${ABEBO}`)
      .set(auth(state.u1!));
    expect(dup.status).toBe(201); // composite PK + ignoreDuplicates

    const list = await request(app).get("/api/v1/users/me/follows").set(auth(state.u1!));
    expect(list.status).toBe(200);
    expect(list.body.follows.some((f: { artist: { id: string } }) => f.artist.id === ABEBO)).toBe(true);

    const unfollow = await request(app)
      .delete(`/api/v1/users/me/follows/${ABEBO}`)
      .set(auth(state.u1!));
    expect(unfollow.status).toBe(204);
  });

  it("cannot follow an unknown artist (404)", async () => {
    const res = await request(app)
      .post("/api/v1/users/me/follows/00000000-0000-4000-8000-00000000dead")
      .set(auth(state.u1!));
    expect(res.status).toBe(404);
  });
});

describe("favorites", () => {
  const SONG = "f0000000-0000-4000-8000-00000000ac01";

  it("favorite → listed → removed (idempotent delete)", async () => {
    const put = await request(app).put(`/api/v1/favorites/${SONG}`).set(auth(state.u2!));
    expect(put.status).toBe(201);
    const dup = await request(app).put(`/api/v1/favorites/${SONG}`).set(auth(state.u2!));
    expect(dup.status).toBe(201);

    const list = await request(app).get("/api/v1/favorites").set(auth(state.u2!));
    expect(list.status).toBe(200);
    expect(list.body.favorites.some((f: { song: { id: string } }) => f.song.id === SONG)).toBe(true);

    const del = await request(app).delete(`/api/v1/favorites/${SONG}`).set(auth(state.u2!));
    expect(del.status).toBe(204);
    const del2 = await request(app).delete(`/api/v1/favorites/${SONG}`).set(auth(state.u2!));
    expect(del2.status).toBe(204);
  });
});

describe("playlists", () => {
  const SONG_A = "f0000000-0000-4000-8000-00000000ac01"; // Tezeta Gar
  const SONG_B = "f0000000-0000-4000-8000-00000000ac03"; // Tizita Lene
  let playlistId = "";

  it("creates a playlist", async () => {
    const res = await request(app)
      .post("/api/v1/playlists")
      .set(auth(state.u1!))
      .send({ title: "EMG Test Mix", description: "integration", is_public: true });
    expect(res.status).toBe(201);
    playlistId = res.body.playlist.id;
    expect(res.body.playlist.owner.id).toBe(state.u1!.profileId);
  });

  it("adds songs, rejects duplicates, lists ordered", async () => {
    const a = await request(app)
      .post(`/api/v1/playlists/${playlistId}/songs/${SONG_A}`)
      .set(auth(state.u1!));
    expect(a.status).toBe(201);
    expect(a.body.entry.position).toBe(0);

    const b = await request(app)
      .post(`/api/v1/playlists/${playlistId}/songs/${SONG_B}`)
      .set(auth(state.u1!));
    expect(b.status).toBe(201);
    expect(b.body.entry.position).toBe(1);

    const dup = await request(app)
      .post(`/api/v1/playlists/${playlistId}/songs/${SONG_A}`)
      .set(auth(state.u1!));
    expect(dup.status).toBe(409);

    const songs = await request(app).get(`/api/v1/playlists/${playlistId}/songs`);
    expect(songs.body.songs.map((s: { song: { id: string } }) => s.song.id)).toEqual([SONG_A, SONG_B]);
  });

  it("reorders via PUT with the new order", async () => {
    const res = await request(app)
      .put(`/api/v1/playlists/${playlistId}/songs`)
      .set(auth(state.u1!))
      .send({ song_ids: [SONG_B, SONG_A] });
    expect(res.status).toBe(200);
    expect(res.body.songs.map((s: { song: { id: string } }) => s.song.id)).toEqual([SONG_B, SONG_A]);
    expect(res.body.songs.map((s: { position: number }) => s.position)).toEqual([0, 1]);
  });

  it("enforces ownership: private lists are RLS-hidden, public ones still owner-only", async () => {
    const priv = await request(app)
      .post("/api/v1/playlists")
      .set(auth(state.u1!))
      .send({ title: "EMG Private Mix", is_public: false });
    const privId = priv.body.playlist.id;

    const anon = await request(app).get(`/api/v1/playlists/${privId}`);
    expect(anon.status).toBe(404); // RLS hides private lists from anonymous callers

    const patchPriv = await request(app)
      .patch(`/api/v1/playlists/${privId}`)
      .set(auth(state.u2!))
      .send({ title: "hijacked" });
    expect(patchPriv.status).toBe(404); // u2 cannot even see it (RLS)

    const delPriv = await request(app).delete(`/api/v1/playlists/${privId}`).set(auth(state.u2!));
    expect(delPriv.status).toBe(404);

    await request(app).delete(`/api/v1/playlists/${privId}`).set(auth(state.u1!));

    // A PUBLIC list of another user is visible but not editable
    const pub = await request(app)
      .post("/api/v1/playlists")
      .set(auth(state.u1!))
      .send({ title: "EMG Public Mix", is_public: true });
    const pubId = pub.body.playlist.id;

    const patchPub = await request(app)
      .patch(`/api/v1/playlists/${pubId}`)
      .set(auth(state.u2!))
      .send({ title: "hijacked" });
    expect(patchPub.status).toBe(403); // visible → explicit ownership rejection

    const delPub = await request(app).delete(`/api/v1/playlists/${pubId}`).set(auth(state.u2!));
    expect(delPub.status).toBe(403);

    await request(app).delete(`/api/v1/playlists/${pubId}`).set(auth(state.u1!));
  });

  it("public playlists are anonymous-readable with owner info", async () => {
    const res = await request(app).get(`/api/v1/playlists/${playlistId}`);
    expect(res.status).toBe(200);
    expect(res.body.playlist.title).toBe("EMG Test Mix");
    expect(res.body.playlist.owner.username).toMatch(/^emg_test_/);
  });

  it("lists public playlists + /mine", async () => {
    const pub = await request(app).get("/api/v1/playlists?limit=50");
    expect(pub.status).toBe(200);
    expect(pub.body.playlists.some((p: { id: string }) => p.id === playlistId)).toBe(true);

    const mine = await request(app).get("/api/v1/playlists/mine").set(auth(state.u1!));
    expect(mine.status).toBe(200);
    expect(mine.body.playlists.some((p: { id: string }) => p.id === playlistId)).toBe(true);
  });

  it("removes a song and deletes the playlist", async () => {
    const rm = await request(app)
      .delete(`/api/v1/playlists/${playlistId}/songs/${SONG_B}`)
      .set(auth(state.u1!));
    expect(rm.status).toBe(204);

    const del = await request(app).delete(`/api/v1/playlists/${playlistId}`).set(auth(state.u1!));
    expect(del.status).toBe(204);
  });
});
