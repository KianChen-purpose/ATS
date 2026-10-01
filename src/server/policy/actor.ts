import type { schema } from "@/db";

export type Role = (typeof schema.userRole.enumValues)[number];

/** A signed-in staff member acting through the UI, API or Teams. */
export type UserActor = { kind: "user"; id: string; role: Role; name: string; email: string; timezone: string };

/**
 * Work done on nobody's behalf: a candidate using a public link, or a worker job.
 * System actors pass only the specific checks written for them (e.g. a valid scheduling token).
 */
export type SystemActor = { kind: "system"; name: "self_scheduling" | "worker" | "seed" };

export type Actor = UserActor | SystemActor;

export function userActor(u: { id: string; role: Role; name: string; email: string; timezone: string }): UserActor {
  return { kind: "user", id: u.id, role: u.role, name: u.name, email: u.email, timezone: u.timezone };
}

export function systemActor(name: SystemActor["name"]): SystemActor {
  return { kind: "system", name };
}

/** User id to store in actor/author columns; null for system actors. */
export function actorUserId(actor: Actor) {
  return actor.kind === "user" ? actor.id : null;
}
