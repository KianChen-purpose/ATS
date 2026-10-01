import "server-only";
import { and, asc, eq, ilike, sql, type SQL } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { CurrentUser } from "@/lib/session";
import { visibleJobsFilter } from "@/server/permissions";

export type JobListFilters = { status?: string; brand?: string; q?: string };

export async function listJobs(user: CurrentUser, f: JobListFilters) {
  const where: (SQL | undefined)[] = [visibleJobsFilter(user)];
  if (f.status && f.status !== "all") where.push(eq(s.jobs.status, f.status as "open"));
  if (f.brand) where.push(eq(s.brands.slug, f.brand));
  if (f.q) where.push(ilike(s.jobs.title, `%${f.q}%`));

  const hm = sql.raw("hm");
  const rec = sql.raw("rec");
  return db
    .select({
      id: s.jobs.id,
      title: s.jobs.title,
      status: s.jobs.status,
      confidential: s.jobs.confidential,
      openedAt: s.jobs.openedAt,
      createdAt: s.jobs.createdAt,
      brand: s.brands.name,
      brandColor: s.brands.primaryColor,
      department: s.departments.name,
      location: s.locations.name,
      hmName: sql<string | null>`${hm}.name`,
      hmColor: sql<string | null>`${hm}.avatar_color`,
      recruiterName: sql<string | null>`${rec}.name`,
      recruiterColor: sql<string | null>`${rec}.avatar_color`,
      openings: sql<number>`(SELECT count(*)::int FROM openings o WHERE o.job_id = ${s.jobs.id} AND o.status = 'open')`,
      /** Active application counts keyed by stage type. */
      byType: sql<Record<string, number>>`(
        SELECT coalesce(jsonb_object_agg(t.type, t.n), '{}'::jsonb) FROM (
          SELECT st.type, count(*)::int AS n FROM applications a
          JOIN job_stages st ON st.id = a.stage_id
          WHERE a.job_id = ${s.jobs.id} AND a.status = 'active'
          GROUP BY st.type
        ) t)`,
      hired: sql<number>`(SELECT count(*)::int FROM applications a WHERE a.job_id = ${s.jobs.id} AND a.status = 'hired')`,
    })
    .from(s.jobs)
    .innerJoin(s.brands, eq(s.brands.id, s.jobs.brandId))
    .leftJoin(s.departments, eq(s.departments.id, s.jobs.departmentId))
    .leftJoin(s.locations, eq(s.locations.id, s.jobs.locationId))
    .leftJoin(sql`users hm`, sql`hm.id = ${s.jobs.hiringManagerId}`)
    .leftJoin(sql`users rec`, sql`rec.id = ${s.jobs.recruiterId}`)
    .where(and(...where))
    .orderBy(asc(s.jobs.title));
}

export async function jobStatusCounts(user: CurrentUser) {
  const rows = await db
    .select({ status: s.jobs.status, n: sql<number>`count(*)::int` })
    .from(s.jobs)
    .where(visibleJobsFilter(user))
    .groupBy(s.jobs.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
}

export async function getJobDetail(user: CurrentUser, jobId: string) {
  const job = await db.query.jobs.findFirst({
    where: eq(s.jobs.id, jobId),
    with: {
      brand: true,
      department: true,
      location: true,
      hiringManager: true,
      recruiter: true,
      coordinator: true,
      stages: { orderBy: asc(s.jobStages.position) },
      openings: { orderBy: asc(s.openings.code) },
      team: { with: { user: true } },
    },
  });
  if (!job) return null;
  const { canViewJobRow } = await import("@/server/permissions");
  if (!canViewJobRow(user, job, job.team.map((t) => t.userId))) return null;
  return job;
}

export type PipelineApp = Awaited<ReturnType<typeof getPipeline>>[number];

export async function getPipeline(jobId: string, status: "active" | "archived" | "hired") {
  return db
    .select({
      id: s.applications.id,
      stageId: s.applications.stageId,
      status: s.applications.status,
      appliedAt: s.applications.appliedAt,
      stageEnteredAt: s.applications.stageEnteredAt,
      candidateId: s.candidates.id,
      firstName: s.candidates.firstName,
      lastName: s.candidates.lastName,
      currentTitle: s.candidates.currentTitle,
      currentCompany: s.candidates.currentCompany,
      location: s.candidates.location,
      source: s.sources.name,
      sourceCategory: s.sources.category,
      archiveReason: s.archiveReasons.name,
      feedback: sql<Record<string, number>>`(
        SELECT coalesce(jsonb_object_agg(t.overall, t.n), '{}'::jsonb) FROM (
          SELECT sc.overall, count(*)::int AS n FROM scorecards sc WHERE sc.application_id = ${s.applications.id} GROUP BY sc.overall
        ) t)`,
      nextInterview: sql<string | null>`(
        SELECT min(i.start_at) FROM interviews i
        WHERE i.application_id = ${s.applications.id} AND i.start_at > now() AND i.status = 'scheduled')`,
    })
    .from(s.applications)
    .innerJoin(s.candidates, eq(s.candidates.id, s.applications.candidateId))
    .leftJoin(s.sources, eq(s.sources.id, s.applications.sourceId))
    .leftJoin(s.archiveReasons, eq(s.archiveReasons.id, s.applications.archiveReasonId))
    .where(and(eq(s.applications.jobId, jobId), eq(s.applications.status, status)))
    .orderBy(asc(s.applications.stageEnteredAt));
}

export async function pipelineCounts(jobId: string) {
  const rows = await db
    .select({ status: s.applications.status, n: sql<number>`count(*)::int` })
    .from(s.applications)
    .where(eq(s.applications.jobId, jobId))
    .groupBy(s.applications.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
}
