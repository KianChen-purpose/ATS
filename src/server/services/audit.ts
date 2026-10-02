import "server-only";
import { schema as s } from "@/db";
import { actorUserId, type Actor } from "@/server/policy";
import type { DbOrTx } from "./tx";

/**
 * Append an audit row. Call it with the transaction that makes the change it records, one row per
 * entity. Views of personal data are audited too (see recordView).
 */
export async function recordAudit(
  tx: DbOrTx,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  await tx.insert(s.auditLogs).values({
    actorId: actorUserId(actor),
    action,
    entityType,
    entityId,
    metadata: actor.kind === "system" ? { ...metadata, systemActor: actor.name } : metadata,
    requestId: actor.kind === "user" ? (actor.request?.requestId ?? null) : null,
    ip: actor.kind === "user" ? (actor.request?.ip ?? null) : null,
    userAgent: actor.kind === "user" ? (actor.request?.userAgent ?? null) : null,
  });
}

/** Audit a view of personal data (candidate profile, resume) or an export. */
export async function recordView(tx: DbOrTx, actor: Actor, action: `${string}.viewed` | `${string}.exported`, entityType: string, entityId: string, metadata: Record<string, unknown> = {}) {
  await recordAudit(tx, actor, action, entityType, entityId, metadata);
}
