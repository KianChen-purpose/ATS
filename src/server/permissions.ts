import "server-only";
import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { schema as s } from "@/db";
import type { CurrentUser } from "@/lib/session";

/** Roles that can see every non-confidential job. */
const BROAD_ROLES = new Set(["admin", "recruiter", "coordinator", "executive"]);

export function canManageRecruiting(user: CurrentUser) {
  return ["admin", "recruiter", "coordinator"].includes(user.role);
}

/**
 * SQL filter for the jobs a user may see.
 * - Admins & executives: everything.
 * - Recruiters/coordinators: all non-confidential jobs, plus confidential ones they're assigned to.
 * - Hiring managers & interviewers: only jobs where they're on the hiring team.
 */
export function visibleJobsFilter(user: CurrentUser): SQL | undefined {
  if (user.role === "admin" || user.role === "executive") return undefined;
  const onTeam = or(
    eq(s.jobs.hiringManagerId, user.id),
    eq(s.jobs.recruiterId, user.id),
    eq(s.jobs.coordinatorId, user.id),
    sql`EXISTS (SELECT 1 FROM job_hiring_team t WHERE t.job_id = ${s.jobs.id} AND t.user_id = ${user.id})`,
  )!;
  if (BROAD_ROLES.has(user.role)) return or(eq(s.jobs.confidential, false), onTeam);
  return onTeam;
}

export function canViewJobRow(
  user: CurrentUser,
  job: { confidential: boolean; hiringManagerId: string | null; recruiterId: string | null; coordinatorId: string | null },
  teamUserIds: string[],
) {
  if (user.role === "admin" || user.role === "executive") return true;
  const onTeam =
    [job.hiringManagerId, job.recruiterId, job.coordinatorId].includes(user.id) || teamUserIds.includes(user.id);
  if (BROAD_ROLES.has(user.role)) return !job.confidential || onTeam;
  return onTeam;
}

export { and };
