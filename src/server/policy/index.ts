import "server-only";
import { eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { Actor, Role, UserActor } from "./actor";
import { ForbiddenError, NotFoundError } from "./errors";

export * from "./actor";
export * from "./errors";

/**
 * Authorization for PATS (ARCHITECTURE.md §3). Job visibility is the root of access:
 * anything tied to a job is visible only if the actor can see that job.
 */

/** Roles that can see every non-confidential job and candidates with no applications. */
const BROAD_ROLES: ReadonlySet<Role> = new Set(["admin", "recruiter", "coordinator", "executive"]);
const RECRUITING_ROLES: ReadonlySet<Role> = new Set(["admin", "recruiter", "coordinator"]);
/** Roles that see candidates who have no applications (sourced prospects). */
const PROSPECT_ROLES: ReadonlySet<Role> = new Set(["admin", "recruiter", "coordinator"]);

export function canManageRecruiting(actor: Pick<UserActor, "role">) {
  return RECRUITING_ROLES.has(actor.role);
}

export function requireUserActor(actor: Actor): UserActor {
  if (actor.kind !== "user") throw new ForbiddenError();
  return actor;
}

/** Recruiting-team actions (move stages, email, schedule, create jobs/candidates). */
export function requireRecruiting(actor: Actor, message?: string): UserActor {
  const u = requireUserActor(actor);
  if (!canManageRecruiting(u)) throw new ForbiddenError(message);
  return u;
}

export function canSeeProspects(actor: UserActor) {
  return PROSPECT_ROLES.has(actor.role);
}

/** Field-level: compensation (job comp ranges, offers). */
export function canViewCompensation(actor: UserActor) {
  return actor.role !== "interviewer";
}

/** Privacy operations: anonymization, data subject requests, retention settings. */
export function canAdministerPrivacy(actor: Actor) {
  return actor.kind === "system" ? actor.name === "worker" : actor.role === "admin";
}

/** Field-level: integration log and other admin settings. */
export function canViewSettings(actor: UserActor) {
  return actor.role === "admin";
}

/** Blind feedback: may this actor see other people's scorecards on an application? */
export function canSeeOthersFeedback(actor: UserActor, submittedOwn: boolean) {
  return actor.role !== "interviewer" || submittedOwn;
}

/**
 * SQL filter over `jobs` for the jobs an actor may see (undefined = no restriction).
 * - Admins & executives: everything.
 * - Recruiters/coordinators: all non-confidential jobs, plus confidential ones they're on.
 * - Hiring managers & interviewers: only jobs where they're on the hiring team.
 */
export function visibleJobsFilter(actor: UserActor): SQL | undefined {
  if (actor.role === "admin" || actor.role === "executive") return undefined;
  const onTeam = or(
    eq(s.jobs.hiringManagerId, actor.id),
    eq(s.jobs.recruiterId, actor.id),
    eq(s.jobs.coordinatorId, actor.id),
    sql`EXISTS (SELECT 1 FROM job_hiring_team t WHERE t.job_id = ${s.jobs.id} AND t.user_id = ${actor.id})`,
  )!;
  if (BROAD_ROLES.has(actor.role)) return or(eq(s.jobs.confidential, false), onTeam);
  return onTeam;
}

/** Subquery of visible job ids, for `x.job_id IN (...)` filters. */
export function visibleJobIds(actor: UserActor) {
  return db.select({ id: s.jobs.id }).from(s.jobs).where(visibleJobsFilter(actor));
}

export function canViewJobRow(
  actor: UserActor,
  job: { confidential: boolean; hiringManagerId: string | null; recruiterId: string | null; coordinatorId: string | null },
  teamUserIds: string[],
) {
  if (actor.role === "admin" || actor.role === "executive") return true;
  const onTeam = [job.hiringManagerId, job.recruiterId, job.coordinatorId].includes(actor.id) || teamUserIds.includes(actor.id);
  if (BROAD_ROLES.has(actor.role)) return !job.confidential || onTeam;
  return onTeam;
}

/** Throws NotFound unless the actor can see every listed job. */
export async function assertCanSeeJobs(actor: Actor, jobIds: string[]) {
  const u = requireUserActor(actor);
  const unique = [...new Set(jobIds)];
  if (unique.length === 0) return;
  const filter = visibleJobsFilter(u);
  const rows = await db
    .select({ id: s.jobs.id })
    .from(s.jobs)
    .where(filter ? sql`${inArray(s.jobs.id, unique)} AND ${filter}` : inArray(s.jobs.id, unique));
  if (rows.length !== unique.length) throw new NotFoundError("Job");
}
