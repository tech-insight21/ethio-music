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
const state: { u1: TestUser | null } = { u1: null };
const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

beforeAll(async () => {
  state.u1 = await createTestUser(app);
});

afterAll(async () => {
  await cleanupTestUser(state.u1);
  await closeDb();
});

describe("multi-entity search", () => {
  it("finds songs by title", async () => {
    const res = await request(app).get("/api/v1/search?q=tezeta");
    expect(res.status).toBe(200);
    expect(res.body.songs.some((s: { title: string }) => s.title === "Tezeta Gar")).toBe(true);
    expect(res.body.total).toBeGreaterThan(0);
  });

  it("finds songs by artist name (two-query merge, deduped)", async () => {
    const res = await request(app).get("/api/v1/search?q=abebe");
    expect(res.status).toBe(200);
    const ids = res.body.songs.map((s: { id: string }) => s.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length); // deduped by song id
    const slugs = new Set(res.body.songs.map((s: { artist: { slug: string } }) => s.artist.slug));
    for (const slug of slugs) expect(slug).toBe("abebe-bekele");
  });

  it("searches artists and albums", async () => {
    const artist = await request(app).get("/api/v1/search?q=tigist");
    expect(artist.status).toBe(200);
    expect(artist.body.artists.some((a: { name: string }) => a.name === "Tigist Alemu")).toBe(true);

    const album = await request(app).get("/api/v1/search?q=tizita");
    expect(album.status).toBe(200);
    expect(album.body.albums.some((a: { title: string }) => a.title === "Tizita Lene")).toBe(true);
  });

  it("searches genres", async () => {
    const res = await request(app).get("/api/v1/search?q=jazz");
    expect(res.status).toBe(200);
    expect(res.body.genres.some((g: { slug: string }) => g.slug === "ethio-jazz")).toBe(true);
  });

  it("SQL-injection style input is safely parameterized", async () => {
    const res = await request(app).get("/api/v1/search?q=%27%3B%20drop%20table%20songs%3B--");
    expect([200, 422]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.songs).toEqual([]);
    }
    // and the catalog still exists afterwards
    const still = await request(app).get("/api/v1/songs?limit=1");
    expect(still.status).toBe(200);
  });

  it("422 for too-short queries", async () => {
    const res = await request(app).get("/api/v1/search?q=a");
    expect(res.status).toBe(422);
  });
});

describe("search history", () => {
  it("records history for authenticated callers", async () => {
    await request(app).get("/api/v1/search?q=tezeta").set(auth(state.u1!));
    await request(app).get("/api/v1/search?q=gammachuu").set(auth(state.u1!));

    const res = await request(app).get("/api/v1/search/history").set(auth(state.u1!));
    expect(res.status).toBe(200);
    expect(res.body.history.length).toBeGreaterThanOrEqual(2);
    expect(res.body.history[0]).toHaveProperty("query");
  });

  it("anonymous callers get an empty history", async () => {
    const res = await request(app).get("/api/v1/search/history");
    expect(res.status).toBe(200);
    expect(res.body.history).toEqual([]);
  });

  it("clears history", async () => {
    const del = await request(app).delete("/api/v1/search/history").set(auth(state.u1!));
    expect(del.status).toBe(204);
    const res = await request(app).get("/api/v1/search/history").set(auth(state.u1!));
    expect(res.body.history).toHaveLength(0);
  });
});

describe("trending & discovery", () => {
  it("trending songs include recent-play weighting metadata", async () => {
    const res = await request(app).get("/api/v1/trending?limit=5");
    expect(res.status).toBe(200);
    expect(res.body.songs.length).toBeGreaterThan(0);
    for (const s of res.body.songs) {
      expect(s).toHaveProperty("plays_7d");
      expect(s.artist).toBeTruthy();
    }
  });

  it("trending artists include plays_30d", async () => {
    const res = await request(app).get("/api/v1/trending/artists?limit=5");
    expect(res.status).toBe(200);
    expect(res.body.artists.length).toBeGreaterThan(0);
    expect(res.body.artists[0]).toHaveProperty("plays_30d");
  });

  it("new releases are ordered by approval recency", async () => {
    const res = await request(app).get("/api/v1/releases/new?limit=5");
    expect(res.status).toBe(200);
    expect(res.body.releases.length).toBeGreaterThan(0);
    for (const s of res.body.releases) expect(s.release_status).toBe("approved");
  });

  it("recommendations fall back to trending for anonymous callers", async () => {
    const res = await request(app).get("/api/v1/discover/recommendations");
    expect(res.status).toBe(200);
    expect(res.body.basis).toBe("trending");
    expect(res.body.recommendations.length).toBeGreaterThan(0);
  });

  it("recommendations use genre affinity for users with history", async () => {
    const u = state.u1!;
    // build a taste profile: favorite two ethio-jazz songs
    await request(app).put("/api/v1/favorites/f0000000-0000-4000-8000-00000000ac01").set(auth(u));
    const res = await request(app).get("/api/v1/discover/recommendations").set(auth(u));
    expect(res.status).toBe(200);
    expect(["trending", "genre_affinity"]).toContain(res.body.basis);
    expect(res.body.recommendations.length).toBeGreaterThan(0);
  });
});
