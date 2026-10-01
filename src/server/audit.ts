import "server-only";
import { db, schema } from "@/db";

export async function audit(actorId: string | null, action: string, entityType: string, entityId: string | null, metadata: Record<string, unknown> = {}) {
  await db.insert(schema.auditLogs).values({ actorId, action, entityType, entityId, metadata });
}
