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

const app = newApp();
const SECRET = "emg-test-webhook-secret-0123456789";
const state = {
  u1: null as TestUser | null,
  u2: null as TestUser | null,
  admin: null as TestUser | null,
  artistId: "",
  promoId: "",
  cleaned: [] as string[],
};
const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

function webhook(update: object) {
  return request(app)
    .post("/api/v1/telegram/webhook")
    .set("X-Telegram-Bot-Api-Secret-Token", SECRET)
    .send(update);
}

beforeAll(async () => {
  state.u1 = await createTestUser(app);
  state.u2 = await createTestUser(app);
  state.admin = await createTestUser(app);
  await supabaseService.from("admin_roles").insert({ user_id: state.admin!.profileId, role: "super_admin" });

  // approved artist owned by u1
  const artist = await supabaseService
    .from("artists")
    .insert({
      name: `EMG Promo Artist ${Date.now()}`,
      slug: `emg-promo-${Date.now()}`,
      status: "approved",
      owner_id: state.u1!.profileId,
    })
    .select("id")
    .single();
  state.artistId = (artist.data as { id: string }).id;
  state.cleaned.push(state.artistId);
});

afterAll(async () => {
  for (const id of state.cleaned) {
    await supabaseService.from("artists").delete().eq("id", id);
  }
  if (state.admin?.userId) {
    await supabaseService.from("admin_roles").delete().eq("user_id", state.admin.userId);
  }
  await cleanupTestUser(state.u1);
  await cleanupTestUser(state.u2);
  await cleanupTestUser(state.admin);
  await closeDb();
});

describe("promotion lifecycle", () => {
  it("lists active campaigns publicly (seeded one present)", async () => {
    const res = await request(app).get("/api/v1/promotions/active");
    expect(res.status).toBe(200);
    expect(res.body.promotions.length).toBeGreaterThanOrEqual(1);
  });

  it("only the artist owner can request a campaign", async () => {
    const denied = await request(app)
      .post("/api/v1/promotions/requests")
      .set(auth(state.u2!))
      .send({
        artist_id: state.artistId,
        promotion_type: "featured_artist",
        starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      });
    expect(denied.status).toBe(403);

    const ok = await request(app)
      .post("/api/v1/promotions/requests")
      .set(auth(state.u1!))
      .send({
        artist_id: state.artistId,
        promotion_type: "featured_artist",
        starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      });
    expect(ok.status).toBe(201);
    expect(ok.body.promotion.status).toBe("draft");
    state.promoId = ok.body.promotion.id;
  });

  it("unpaid campaigns cannot go live (admin gate)", async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/promotions/${state.promoId}`)
      .set(auth(state.admin!))
      .send({ status: "active" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("payment");
  });

  it("campaign owner buys Stars → webhook pays → admin activates → counters track", async () => {
    const invoice = await request(app)
      .post(`/api/v1/payments/promotions/${state.promoId}/invoice`)
      .set(auth(state.u1!))
      .send({ amount_stars: 100 });
    expect(invoice.status).toBe(201);

    const rows = await pgQuery<{ payload: string }>(
      "select payload from payments where id = $1",
      [invoice.body.payment_id],
    );

    const chargeId = `emg-promo-charge-${Date.now()}`;
    const pay = await webhook({
      update_id: 300,
      message: {
        message_id: 20,
        chat: { id: 925000020 },
        from: { id: 925000020 },
        successful_payment: {
          currency: "XTR",
          total_amount: 100,
          invoice_payload: rows[0].payload,
          telegram_payment_charge_id: chargeId,
        },
      },
    });
    expect(pay.status).toBe(200);

    // paid — now the admin can activate
    const activate = await request(app)
      .patch(`/api/v1/admin/promotions/${state.promoId}`)
      .set(auth(state.admin!))
      .send({ status: "active" });
    expect(activate.status).toBe(200);
    expect(activate.body.promotion.status).toBe("active");

    // counters
    for (let i = 0; i < 3; i++) {
      await request(app).post(`/api/v1/promotions/${state.promoId}/impression`);
    }
    await request(app).post(`/api/v1/promotions/${state.promoId}/click`);

    const report = await request(app)
      .get(`/api/v1/admin/promotions/${state.promoId}/report`)
      .set(auth(state.admin!));
    expect(report.status).toBe(200);
    expect(report.body.performance.impressions).toBeGreaterThanOrEqual(3);
    expect(report.body.performance.clicks).toBeGreaterThanOrEqual(1);
    expect(report.body.performance.ctr).toBeGreaterThan(0);
  });

  it("non-admins cannot manage campaigns", async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/promotions/${state.promoId}`)
      .set(auth(state.u2!))
      .send({ status: "paused" });
    expect(res.status).toBe(403);
  });
});
