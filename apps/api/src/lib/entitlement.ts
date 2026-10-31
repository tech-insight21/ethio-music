import { supabaseService } from "./supabase.js";
import { logger } from "./logger.js";

export interface Entitlement {
  premium: boolean;
  planCode: string | null;
  planName: string | null;
  expiresAt: string | null;
}

const PREMIUM_PLAN_CODES = new Set(["premium", "family"]);

/** Verified premium entitlement, straight from the subscriptions table. */
export async function getEntitlement(userId: string): Promise<Entitlement> {
  try {
    const { data, error } = await supabaseService
      .from("subscriptions")
      .select("ends_at, plan:plans(code,name)")
      .eq("user_id", userId)
      .eq("status", "active")
      .gt("ends_at", new Date().toISOString())
      .order("ends_at", { ascending: false })
      .limit(1);

    if (error) throw error;
    const row = data?.[0] as
      | { ends_at: string; plan: { code: string; name: string } | null }
      | undefined;

    if (!row?.plan) {
      return { premium: false, planCode: null, planName: null, expiresAt: null };
    }
    return {
      premium: PREMIUM_PLAN_CODES.has(row.plan.code),
      planCode: row.plan.code,
      planName: row.plan.name,
      expiresAt: row.ends_at,
    };
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : err, userId },
      "entitlement_lookup_failed",
    );
    // Fail closed: an error must never grant premium.
    return { premium: false, planCode: null, planName: null, expiresAt: null };
  }
}
