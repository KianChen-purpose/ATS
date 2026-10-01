import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { demoAuthEnabled } from "@/server/config";
import { canViewSettings, ForbiddenError, type UserActor } from "@/server/policy";

/** Users offered on the demo sign-in screen (demo auth only). */
export async function listDemoSignInUsers() {
  if (!demoAuthEnabled()) return [];
  return db
    .select({ id: s.users.id, name: s.users.name, title: s.users.title, role: s.users.role, avatarColor: s.users.avatarColor })
    .from(s.users)
    .where(eq(s.users.active, true))
    .orderBy(asc(s.users.name));
}

export async function findActiveUser(userId: string) {
  const user = await db.query.users.findFirst({ where: eq(s.users.id, userId) });
  return user?.active ? user : null;
}

/** Settings → Integrations log. Admin only. */
export async function listIntegrationEvents(actor: UserActor, limit = 50) {
  if (!canViewSettings(actor)) throw new ForbiddenError();
  return db.query.integrationEvents.findMany({ orderBy: desc(s.integrationEvents.createdAt), limit });
}
