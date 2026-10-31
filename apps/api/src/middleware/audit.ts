import type { Request } from "express";
import { logger } from "../lib/logger.js";
import { supabaseService } from "../lib/supabase.js";
import type { AdminRole } from "../lib/rbac.js";

export interface AuditInput {
  actorId: string;
  actorRole: AdminRole | "user";
  action: string; // e.g. "song.approve", "admin.role.grant"
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  req: Request;
}

/**
 * Append-only audit trail for privileged mutations. Fire-and-forget:
 * audit failures are logged but never block the business operation.
 */
export function writeAudit(input: AuditInput): void {
  const { actorId, actorRole, action, entityType, entityId, before, after, req } = input;
  void (async () => {
    const { error } = await supabaseService.from("audit_logs").insert({
      actor_id: actorId,
      actor_role: actorRole,
      action,
      entity_type: entityType,
      entity_id: entityId ?? null,
      before: (before ?? {}) as object,
      after: (after ?? {}) as object,
      ip: req.ip ?? null,
      user_agent: req.headers["user-agent"]?.toString().slice(0, 300) ?? null,
    });
    if (error) logger.error({ err: error.message, action }, "audit_write_failed");
  })().catch((e: unknown) =>
    logger.error({ err: e instanceof Error ? e.message : e, action }, "audit_write_failed"),
  );
}
