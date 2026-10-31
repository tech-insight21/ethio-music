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
  admin: null as TestUser | null,
  user: null as TestUser | null,
  songIds: [] as string[],
  artistIds: [] as string[],
  albumIds: [] as string[],
  genreIds: [] as string[],
  artworkPaths: [] as string[],
};

async function grantAdmin(userId: string): Promise<void> {
  await supabaseService.from("admin_roles").insert({ user_id: userId, role: "super_admin" });
}

async function revokeAdmin(userId: string): Promise<void> {
  await supabaseService.from("admin_roles").delete().eq("user_id", userId);
}

beforeAll(async () => {
  state.admin = await createTestUser(app, { username_prefix: undefined });
  state.user = await createTestUser(app);
  if (state.admin.userId) await grantAdmin(state.admin.userId);
  if (state.admin.userId) await revokeAdmin(state.admin.userId); // grant again below once, keep symmetric
  if (state.admin.userId) await grantAdmin(state.admin.userId);
});

afterAll(async () => {
  for (const id of state.songIds) {
    await supabaseService.from("songs").delete().eq("id", id);
  }
  for (const id of state.albumIds) {
    await supabaseService.from("albums").delete().eq("id", id);
  }
  for (const id of state.artistIds) {
    await supabaseService.from("artists").delete().eq("id", id);
  }
  for (const id of state.genreIds) {
    await supabaseService.from("genres").delete().eq("id", id);
  }
  for (const p of state.artworkPaths) {
    await supabaseService.storage.from("covers").remove([p]).catch(() => undefined);
  }
  if (state.admin?.userId) await revokeAdmin(state.admin.userId);
  await cleanupTestUser(state.admin);
  await cleanupTestUser(state.user);
  await closeDb();
});

const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

describe("public catalog reads", () => {
  it("lists genres (seeded)", async () => {
    const res = await request(app).get("/api/v1/genres");
    expect(res.status).toBe(200);
    expect(res.body.genres.length).toBeGreaterThanOrEqual(8);
    expect(res.body.genres.map((g: { slug: string }) => g.slug)).toContain("ethio-jazz");
  });

  it("lists approved songs with pagination meta", async () => {
    const res = await request(app).get("/api/v1/songs?limit=5&offset=0&sort=popular");
    expect(res.status).toBe(200);
    expect(res.body.songs.length).toBeGreaterThan(0);
    expect(res.body.songs.length).toBeLessThanOrEqual(5);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(10);
    const counts = res.body.songs.map((s: { play_count: number }) => s.play_count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    for (const song of res.body.songs) {
      expect(song.release_status).toBe("approved");
      expect(song.artist).toBeTruthy();
    }
  });

  it("fetches one song by slug with artist + album + genres", async () => {
    const res = await request(app).get("/api/v1/songs/tezeta-gar");
    expect(res.status).toBe(200);
    expect(res.body.song.title).toBe("Tezeta Gar");
    expect(res.body.song.artist.slug).toBe("abebe-bekele");
    expect(res.body.song.album.slug).toBe("addis-after-dark");
    expect(res.body.song.genres.length).toBeGreaterThan(0);
  });

  it("404 for unknown song", async () => {
    const res = await request(app).get("/api/v1/songs/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("lists artists sorted by monthly listeners", async () => {
    const res = await request(app).get("/api/v1/artists?limit=10");
    expect(res.status).toBe(200);
    expect(res.body.artists.length).toBeGreaterThanOrEqual(6);
    const listeners = res.body.artists.map((a: { monthly_listeners: number }) => a.monthly_listeners);
    expect([...listeners].sort((a, b) => b - a)).toEqual(listeners);
  });

  it("artist detail includes follower count; albums + songs resolve", async () => {
    const artist = await request(app).get("/api/v1/artists/abebe-bekele");
    expect(artist.status).toBe(200);
    expect(artist.body.artist.name).toBe("Abebe Bekele");

    const albums = await request(app).get("/api/v1/artists/abebe-bekele/albums");
    expect(albums.status).toBe(200);
    expect(albums.body.albums.map((a: { title: string }) => a.title)).toContain("Addis After Dark");

    const songs = await request(app).get("/api/v1/artists/abebe-bekele/songs");
    expect(songs.status).toBe(200);
    expect(songs.body.songs.length).toBeGreaterThanOrEqual(3);
  });

  it("album detail + ordered tracks", async () => {
    const res = await request(app).get("/api/v1/albums/addis-after-dark/songs");
    expect(res.status).toBe(200);
    expect(res.body.songs.length).toBe(2);
    expect(res.body.songs.map((s: { track_number: number }) => s.track_number)).toEqual([1, 2]);
  });

  it("records a play (song_plays + counter) without auth", async () => {
    const { data: before } = await supabaseService
      .from("songs")
      .select("play_count")
      .eq("slug", "anbessa")
      .single();
    const res = await request(app).post("/api/v1/songs/anbessa/play").send({ source: "api" });
    expect(res.status).toBe(200);
    expect(res.body.preview_only).toBe(true);
    const { data: after } = await supabaseService
      .from("songs")
      .select("play_count")
      .eq("slug", "anbessa")
      .single();
    expect(Number(after?.play_count)).toBe(Number(before?.play_count) + 1);
  });
});

describe("authorization gates on catalog writes", () => {
  it("401 without a token", async () => {
    const res = await request(app).post("/api/v1/songs").send({});
    expect(res.status).toBe(401);
  });

  it("403 for a regular (non-staff) user", async () => {
    const res = await request(app)
      .post("/api/v1/genres")
      .set(auth(state.user!))
      .send({ name: "EMG Test Genre" });
    expect(res.status).toBe(403);
  });
});

describe("admin catalog management", () => {
  it("creates a genre", async () => {
    const res = await request(app)
      .post("/api/v1/genres")
      .set(auth(state.admin!))
      .send({ name: `EMG Test Genre ${Date.now()}`, description: "temporary" });
    expect(res.status).toBe(201);
    state.genreIds.push(res.body.genre.id);
  });

  it("rejects a song without mandatory rights_holder", async () => {
    const res = await request(app)
      .post("/api/v1/songs")
      .set(auth(state.admin!))
      .send({ artist_id: "f0000000-0000-4000-8000-00000000aa01", title: "EMG Test", audio_url: "https://example.com/a.mp3" });
    expect(res.status).toBe(422);
  });

  let draftSongId = "";
  let licensedSongId = "";

  it("creates a draft song and refuses approval without license metadata", async () => {
    const create = await request(app)
      .post("/api/v1/songs")
      .set(auth(state.admin!))
      .send({
        artist_id: "f0000000-0000-4000-8000-00000000aa01",
        title: `EMG Test Draft ${Date.now()}`,
        audio_url: "https://trhfksuskfgvlmwzzsyu.supabase.co/storage/v1/object/public/tracks/seed/abebe-bekele/anbessa.mp3",
        rights_holder: "EMG Test Rights",
        genre_ids: [],
      });
    expect(create.status).toBe(201);
    draftSongId = create.body.song.id;
    state.songIds.push(draftSongId);

    const approve = await request(app)
      .post(`/api/v1/songs/${draftSongId}/approve`)
      .set(auth(state.admin!));
    expect(approve.status).toBe(422);
    expect(approve.body.error.message).toContain("license");
  });

  it("creates a licensed song, approves it, then lists it publicly", async () => {
    const create = await request(app)
      .post("/api/v1/songs")
      .set(auth(state.admin!))
      .send({
        artist_id: "f0000000-0000-4000-8000-00000000aa01",
        title: `EMG Test Licensed ${Date.now()}`,
        audio_url: "https://trhfksuskfgvlmwzzsyu.supabase.co/storage/v1/object/public/tracks/seed/abebe-bekele/anbessa.mp3",
        rights_holder: "EMG Test Rights",
        license_type: "owned_master",
        licensed_at: new Date().toISOString(),
        license_document_url: "https://example.com/license.pdf",
        language: "en",
        genre_ids: ["f0000000-0000-4000-8000-00000000a008"],
      });
    expect(create.status).toBe(201);
    licensedSongId = create.body.song.id;
    state.songIds.push(licensedSongId);

    const approve = await request(app)
      .post(`/api/v1/songs/${licensedSongId}/approve`)
      .set(auth(state.admin!));
    expect(approve.status).toBe(200);
    expect(approve.body.song.release_status).toBe("approved");
    expect(approve.body.song.approved_by).toBe(state.admin!.profileId);

    const listed = await request(app).get("/api/v1/songs?limit=100&offset=0");
    expect(listed.body.songs.map((s: { id: string }) => s.id)).toContain(licensedSongId);
  });

  it("takes the song down and hides it from the public list", async () => {
    const takedown = await request(app)
      .post(`/api/v1/songs/${licensedSongId}/takedown`)
      .set(auth(state.admin!));
    expect(takedown.status).toBe(200);
    expect(takedown.body.song.release_status).toBe("taken_down");

    const listed = await request(app).get("/api/v1/songs?limit=100&offset=0");
    expect(listed.body.songs.map((s: { id: string }) => s.id)).not.toContain(licensedSongId);
  });

  it("uploads artwork (type+size validated) and links it", async () => {
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
        "1f15c4890000000d4944415478da63fcffff3f030005fe02fea72d5e2b0000000049454e44ae426082",
      "hex",
    );
    const res = await request(app)
      .post(`/api/v1/songs/${licensedSongId}/artwork`)
      .set(auth(state.admin!))
      .attach("artwork", png, { filename: "cover.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.song.cover_url).toContain("/storage/v1/object/public/covers/songs/");
    state.artworkPaths.push(res.body.song.cover_url.split("/covers/")[1]);

    const bad = await request(app)
      .post(`/api/v1/songs/${licensedSongId}/artwork`)
      .set(auth(state.admin!))
      .attach("artwork", Buffer.from("<svg/>"), { filename: "evil.svg", contentType: "image/svg+xml" });
    expect([422, 500]).toContain(bad.status);
  });

  it("updates the authoritative audio reference", async () => {
    const res = await request(app)
      .post(`/api/v1/songs/${licensedSongId}/audio-url`)
      .set(auth(state.admin!))
      .send({
        audio_url: "https://trhfksuskfgvlmwzzsyu.supabase.co/storage/v1/object/public/tracks/seed/abebe-bekele/tezeta-gar.mp3",
        licensed_at: new Date().toISOString(),
      });
    expect(res.status).toBe(200);
    expect(res.body.song.audio_url).toContain("tezeta-gar");
  });

  it("creates an album and deletes it again", async () => {
    const create = await request(app)
      .post("/api/v1/albums")
      .set(auth(state.admin!))
      .send({
        artist_id: "f0000000-0000-4000-8000-00000000aa01",
        title: `EMG Test Album ${Date.now()}`,
        album_type: "ep",
        release_date: "2026-01-01",
      });
    expect(create.status).toBe(201);
    const albumId = create.body.album.id;
    state.albumIds.push(albumId);

    const del = await request(app).delete(`/api/v1/albums/${albumId}`).set(auth(state.admin!));
    expect(del.status).toBe(204);
    state.albumIds = state.albumIds.filter((i) => i !== albumId);
  });

  it("self-service artist registration lands as pending with a submission", async () => {
    const res = await request(app)
      .post("/api/v1/artists")
      .set(auth(state.user!))
      .send({ name: `EMG Test Artist ${Date.now()}`, bio: "integration test", region: "Addis Ababa" });
    expect(res.status).toBe(201);
    expect(res.body.artist.status).toBe("pending");
    expect(res.body.artist.owner_id).toBe(state.user!.profileId);
    state.artistIds.push(res.body.artist.id);

    const submissions = await supabaseService
      .from("artist_submissions")
      .select("id, status")
      .eq("artist_id", res.body.artist.id);
    expect(submissions.data?.length).toBe(1);
    expect(submissions.data?.[0]?.status).toBe("pending");

    // owner can re-submit
    const again = await request(app)
      .post(`/api/v1/artists/${res.body.artist.id}/submissions`)
      .set(auth(state.user!))
      .send({ message: "please review" });
    expect(again.status).toBe(201);
  });

  it("audit logs captured the catalog mutations", async () => {
    const { data } = await supabaseService
      .from("audit_logs")
      .select("action")
      .eq("actor_id", state.admin!.profileId)
      .order("created_at", { ascending: false })
      .limit(20);
    const actions = (data ?? []).map((r) => r.action);
    expect(actions).toContain("song.create");
    expect(actions).toContain("song.approve");
    expect(actions).toContain("song.takedown");
  });
});
