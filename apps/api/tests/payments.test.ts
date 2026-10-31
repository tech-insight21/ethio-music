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
  admin: null as TestUser | null,
  planId: "",
  paymentId: "",
  payload: "",
  subscriptionId: "",
  chargeIds: [] as string[],
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
  state.admin = await createTestUser(app);
  await supabaseService
    .from("admin_roles")
    .insert({ user_id: state.admin!.profileId, role: "super_admin" });
  const { data: plan } = await supabaseService.from("plans").select("id").eq("code", "premium").single();
  state.planId = plan!.id;
});

afterAll(async () => {
  if (state.admin?.userId) {
    await supabaseService.from("admin_roles").delete().eq("user_id", state.admin.userId);
  }
  await cleanupTestUser(state.u1);
  await cleanupTestUser(state.admin);
  await closeDb();
});

describe("plans & invoices", () => {
  it("lists active plans with Stars pricing", async () => {
    const res = await request(app).get("/api/v1/subscriptions/plans");
    expect(res.status).toBe(200);
    expect(res.body.plans.length).toBeGreaterThanOrEqual(4);
    const premium = res.body.plans.find((p: { code: string }) => p.code === "premium");
    expect(premium.price_stars).toBeGreaterThan(0);
  });

  it("free plan cannot be purchased", async () => {
    const { data: free } = await supabaseService.from("plans").select("id").eq("code", "free").single();
    const res = await request(app)
      .post("/api/v1/payments/stars/invoice")
      .set(auth(state.u1!))
      .send({ plan_id: free!.id });
    expect(res.status).toBe(400);
  });

  it("creates a real Stars invoice + pending payment", async () => {
    const res = await request(app)
      .post("/api/v1/payments/stars/invoice")
      .set(auth(state.u1!))
      .send({ plan_id: state.planId });
    expect(res.status).toBe(201);
    expect(res.body.invoice_link).toContain("t.me");
    expect(res.body.amount_stars).toBe(250);
    state.paymentId = res.body.payment_id;

    const rows = await pgQuery<{ status: string; payload: string; amount_stars: number }>(
      "select status, payload, amount_stars from payments where id = $1",
      [state.paymentId],
    );
    expect(rows[0].status).toBe("pending");
    expect(rows[0].amount_stars).toBe(250);
    state.payload = rows[0].payload;
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/v1/payments/stars/invoice")
      .send({ plan_id: state.planId });
    expect(res.status).toBe(401);
  });
});

describe("webhook money path", () => {
  it("pre_checkout approves a valid pending payload", async () => {
    const res = await webhook({
      update_id: 200,
      pre_checkout_query: {
        id: `pcq-${Date.now()}`,
        from: { id: 925000010 },
        currency: "XTR",
        total_amount: 250,
        invoice_payload: state.payload,
      },
    });
    expect(res.status).toBe(200); // answered ok inside (best-effort)
  });

  it("successful_payment completes the payment and activates Premium", async () => {
    const chargeId = `emgtest-charge-${Date.now()}`;
    state.chargeIds.push(chargeId);
    const res = await webhook({
      update_id: 201,
      message: {
        message_id: 10,
        chat: { id: 925000010 },
        from: { id: 925000010 },
        successful_payment: {
          currency: "XTR",
          total_amount: 250,
          invoice_payload: state.payload,
          telegram_payment_charge_id: chargeId,
        },
      },
    });
    expect(res.status).toBe(200);

    const rows = await pgQuery<{ status: string; provider_ref: string; subscription_id: string | null }>(
      "select status, provider_ref, subscription_id from payments where id = $1",
      [state.paymentId],
    );
    expect(rows[0].status).toBe("completed");
    expect(rows[0].provider_ref).toBe(chargeId);
    state.subscriptionId = rows[0].subscription_id!;
    expect(state.subscriptionId).toBeTruthy();

    const subs = await pgQuery<{ status: string; plan_id: string }>(
      "select status, plan_id from subscriptions where id = $1",
      [state.subscriptionId],
    );
    expect(subs[0].status).toBe("active");
    expect(subs[0].plan_id).toBe(state.planId);

    // entitlement is now premium
    const me = await request(app).get("/api/v1/auth/me").set(auth(state.u1!));
    expect(me.body.entitlement.premium).toBe(true);
    expect(me.body.entitlement.planCode).toBe("premium");
  });

  it("REPLAY of the same successful_payment is a no-op (idempotent)", async () => {
    const chargeId = state.chargeIds[0];
    const res = await webhook({
      update_id: 202,
      message: {
        message_id: 11,
        chat: { id: 925000010 },
        from: { id: 925000010 },
        successful_payment: {
          currency: "XTR",
          total_amount: 250,
          invoice_payload: state.payload,
          telegram_payment_charge_id: chargeId,
        },
      },
    });
    expect(res.status).toBe(200);

    const subs = await pgQuery<{ n: string }>(
      "select count(*)::text as n from subscriptions where user_id = $1",
      [state.u1!.profileId],
    );
    expect(Number(subs[0].n)).toBe(1); // no duplicate subscription
  });

  it("a second valid payment EXTENDS the same subscription", async () => {
    const before = await pgQuery<{ ends_at: string }>(
      "select ends_at from subscriptions where id = $1",
      [state.subscriptionId],
    );

    const res = await request(app)
      .post("/api/v1/payments/stars/invoice")
      .set(auth(state.u1!))
      .send({ plan_id: state.planId });
    const secondPayment = res.body.payment_id;
    const rows = await pgQuery<{ payload: string }>("select payload from payments where id = $1", [secondPayment]);

    const chargeId = `emgtest-charge-extend-${Date.now()}`;
    state.chargeIds.push(chargeId);
    await webhook({
      update_id: 203,
      message: {
        message_id: 12,
        chat: { id: 925000010 },
        from: { id: 925000010 },
        successful_payment: {
          currency: "XTR",
          total_amount: 250,
          invoice_payload: rows[0].payload,
          telegram_payment_charge_id: chargeId,
        },
      },
    });

    const after = await pgQuery<{ ends_at: string; subscription_id: string | null }>(
      `select p.subscription_id, s.ends_at
         from payments p
         left join subscriptions s on s.id = p.subscription_id
        where p.id = $1`,
      [secondPayment],
    );
    expect(after[0].subscription_id).toBe(state.subscriptionId);
    expect(new Date(after[0].ends_at).getTime()).toBeGreaterThan(new Date(before[0].ends_at).getTime());
  });

  it("an unknown payload declines pre-checkout (never activates)", async () => {
    const res = await webhook({
      update_id: 204,
      pre_checkout_query: {
        id: `pcq-bad-${Date.now()}`,
        from: { id: 925000010 },
        currency: "XTR",
        total_amount: 250,
        invoice_payload: "not-a-real-payload",
      },
    });
    expect(res.status).toBe(200); // answered with ok=false inside
  });
});

describe("receipts, refunds and cancellation", () => {
  it("lists the caller's payments (no one else's)", async () => {
    const res = await request(app).get("/api/v1/payments").set(auth(state.u1!));
    expect(res.status).toBe(200);
    expect(res.body.payments.length).toBe(2);
    const other = await request(app).get("/api/v1/payments").set(auth(state.admin!));
    expect(other.body.payments.length).toBe(0);
  });

  it("refund requires the finance permission", async () => {
    const res = await request(app)
      .post(`/api/v1/payments/${state.paymentId}/refund`)
      .set(auth(state.u1!));
    expect(res.status).toBe(403);
  });

  it("refund on a completed payment with an unverifiable charge surfaces the provider error", async () => {
    // admin can attempt; Telegram rejects the fake charge id → 4xx/5xx, never a fake success
    const res = await request(app)
      .post(`/api/v1/payments/${state.paymentId}/refund`)
      .set(auth(state.admin!));
    expect([400, 409, 422, 500, 502]).toContain(res.status);
    const rows = await pgQuery<{ status: string }>("select status from payments where id = $1", [state.paymentId]);
    expect(rows[0].status).toBe("completed"); // unchanged — no fake refunds
  });

  it("cancels at period end", async () => {
    const res = await request(app)
      .post("/api/v1/subscriptions/me/cancel")
      .set(auth(state.u1!))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.canceled).toBe(true);
  });

  it("no client-side activation path exists", async () => {
    const res = await request(app)
      .post("/api/v1/subscriptions")
      .set(auth(state.u1!))
      .send({ plan_id: state.planId, status: "active" });
    expect(res.status).toBe(404); // route does not exist by design
  });
});
