import "server-only";
import { schema as s } from "@/db";
import { actorUserId, type Actor } from "@/server/policy";
import type { DbOrTx } from "./tx";

/** Append an audit row. Call it with the transaction that makes the change it records. */
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
  });
}
