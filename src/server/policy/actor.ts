import type { schema } from "@/db";

export type Role = (typeof schema.userRole.enumValues)[number];

/** Where a user's request came from, recorded on every audit row (ARCHITECTURE.md §4.2). */
export type RequestContext = { requestId: string; ip: string | null; userAgent: string | null };

/** A signed-in staff member acting through the UI, API or Teams. */
export type UserActor = { kind: "user"; id: string; role: Role; name: string; email: string; timezone: string; request?: RequestContext };

/**
 * Work done on nobody's behalf: a candidate using a public link, or a worker job.
 * System actors pass only the specific checks written for them (e.g. a valid scheduling token).
 */
export type SystemActor = { kind: "system"; name: "self_scheduling" | "worker" | "seed" };

export type Actor = UserActor | SystemActor;

export function userActor(u: { id: string; role: Role; name: string; email: string; timezone: string }, request?: RequestContext): UserActor {
  return { kind: "user", id: u.id, role: u.role, name: u.name, email: u.email, timezone: u.timezone, request };
}

export function systemActor(name: SystemActor["name"]): SystemActor {
  return { kind: "system", name };
}

/** User id to store in actor/author columns; null for system actors. */
export function actorUserId(actor: Actor) {
  return actor.kind === "user" ? actor.id : null;
}
