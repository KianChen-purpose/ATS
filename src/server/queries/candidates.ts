import "server-only";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { CurrentUser } from "@/lib/session";
import { canViewJobRow, visibleJobsFilter } from "@/server/permissions";

export async function getCandidateProfile(user: CurrentUser, candidateId: string) {
  const candidate = await db.query.candidates.findFirst({
    where: eq(s.candidates.id, candidateId),
    with: {
      owner: true,
      applications: {
        orderBy: desc(s.applications.appliedAt),
        with: {
          job: { with: { brand: true, stages: { orderBy: asc(s.jobStages.position) }, team: true } },
          stage: true,
          source: true,
          archiveReason: true,
          creditedTo: true,
          referrer: true,
          interviews: {
            orderBy: asc(s.interviews.startAt),
            with: { stage: true, interviewers: { with: { user: true } } },
          },
          scorecards: { orderBy: desc(s.scorecards.submittedAt), with: { author: true, interview: true } },
          offers: { orderBy: desc(s.offers.createdAt), with: { approvals: { orderBy: asc(s.offerApprovals.position), with: { approver: true } } } },
        },
      },
      activities: { orderBy: desc(s.activities.createdAt), with: { actor: true } },
      emails: { orderBy: desc(s.emails.sentAt), with: { sentBy: true } },
    },
  });
  if (!candidate) return null;

  const visibleApps = candidate.applications.filter((a) =>
    canViewJobRow(user, a.job, a.job.team.map((t) => t.userId)),
  );
  if (visibleApps.length === 0 && candidate.applications.length > 0) return null;
  const visibleAppIds = new Set(visibleApps.map((a) => a.id));

  const seesComp = user.role !== "interviewer";
  const applications = visibleApps.map((a) => {
    // Blind feedback: interviewers only see others' scorecards after submitting their own.
    const submittedOwn = a.scorecards.some((sc) => sc.authorId === user.id);
    const blind = user.role === "interviewer" && !submittedOwn;
    return {
      ...a,
      scorecards: blind ? a.scorecards.filter((sc) => sc.authorId === user.id) : a.scorecards,
      feedbackHidden: blind ? a.scorecards.length : 0,
      offers: seesComp ? a.offers : [],
    };
  });

  return {
    ...candidate,
    applications,
    activities: candidate.activities.filter((act) => !act.applicationId || visibleAppIds.has(act.applicationId)),
  };
}

export type CandidateProfile = NonNullable<Awaited<ReturnType<typeof getCandidateProfile>>>;

export async function getProfileOptions(user: CurrentUser) {
  const [archiveReasons, templates, jobs] = await Promise.all([
    db.query.archiveReasons.findMany(),
    db.query.emailTemplates.findMany({ orderBy: asc(s.emailTemplates.name) }),
    db
      .select({ id: s.jobs.id, title: s.jobs.title, brand: s.brands.name })
      .from(s.jobs)
      .innerJoin(s.brands, eq(s.brands.id, s.jobs.brandId))
      .where(and(visibleJobsFilter(user), inArray(s.jobs.status, ["open", "on_hold"])))
      .orderBy(asc(s.jobs.title)),
  ]);
  return { archiveReasons, templates, jobs };
}

export type CandidateListFilters = {
  q?: string;
  jobId?: string;
  status?: string;
  sourceId?: string;
  page?: number;
};

export const CANDIDATES_PAGE_SIZE = 50;

export async function listCandidates(user: CurrentUser, f: CandidateListFilters) {
  const jobFilter = visibleJobsFilter(user);
  const appConds: SQL[] = [];
  if (f.jobId) appConds.push(sql`a.job_id = ${f.jobId}`);
  if (f.status && f.status !== "all") appConds.push(sql`a.status = ${f.status}`);
  if (f.sourceId) appConds.push(sql`a.source_id = ${f.sourceId}`);
  const visibleJobIds = db.select({ id: s.jobs.id }).from(s.jobs).where(jobFilter);

  const where: SQL[] = [
    sql`EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = ${s.candidates.id} AND a.job_id IN (${visibleJobIds})
        ${appConds.length ? sql`AND ${sql.join(appConds, sql` AND `)}` : sql``})`,
  ];
  if (f.q) {
    const like = `%${f.q}%`;
    where.push(sql`(
      (${s.candidates.firstName} || ' ' || ${s.candidates.lastName}) ILIKE ${like}
      OR ${s.candidates.email} ILIKE ${like}
      OR ${s.candidates.currentCompany} ILIKE ${like}
      OR ${s.candidates.currentTitle} ILIKE ${like}
      OR array_to_string(${s.candidates.tags}, ' ') ILIKE ${like}
      OR ${s.candidates.resumeText} ILIKE ${like}
    )`);
  }
  const page = Math.max(1, f.page ?? 1);
  // Drizzle renders columns unqualified inside single-table selects; qualify explicitly for correlated subqueries.
  const candId = sql.raw(`"candidates"."id"`);
  const lastActivity = sql<string | null>`(SELECT max(created_at) FROM activities act WHERE act.candidate_id = ${candId})`;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: s.candidates.id,
        firstName: s.candidates.firstName,
        lastName: s.candidates.lastName,
        email: s.candidates.email,
        currentTitle: s.candidates.currentTitle,
        currentCompany: s.candidates.currentCompany,
        location: s.candidates.location,
        tags: s.candidates.tags,
        updatedAt: s.candidates.updatedAt,
        apps: sql<{ id: string; jobId: string; jobTitle: string; stage: string; status: string; source: string | null }[]>`(
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', a.id, 'jobId', j.id, 'jobTitle', j.title, 'stage', st.name, 'status', a.status, 'source', src.name
          ) ORDER BY a.applied_at DESC), '[]'::jsonb)
          FROM applications a
          JOIN jobs j ON j.id = a.job_id
          JOIN job_stages st ON st.id = a.stage_id
          LEFT JOIN sources src ON src.id = a.source_id
          WHERE a.candidate_id = ${candId} AND a.job_id IN (${visibleJobIds}))`,
        lastActivity,
      })
      .from(s.candidates)
      .where(and(...where))
      .orderBy(sql`${lastActivity} DESC NULLS LAST`)
      .limit(CANDIDATES_PAGE_SIZE)
      .offset((page - 1) * CANDIDATES_PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(s.candidates).where(and(...where)),
  ]);
  return { rows, total, page };
}
