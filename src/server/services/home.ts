import "server-only";
import { and, asc, count, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";

import { visibleJobIds, visibleJobsFilter, type UserActor } from "@/server/policy";

export async function getHomeData(actor: UserActor) {
  const userId = actor.id;
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000);

  const [upcoming, feedbackDue, approvals, myJobs, stats] = await Promise.all([
    // My upcoming interviews
    db
      .select({
        id: s.interviews.id,
        title: s.interviews.title,
        startAt: s.interviews.startAt,
        endAt: s.interviews.endAt,
        meetingUrl: s.interviews.meetingUrl,
        candidateId: s.candidates.id,
        firstName: s.candidates.firstName,
        lastName: s.candidates.lastName,
        jobTitle: s.jobs.title,
      })
      .from(s.interviews)
      .innerJoin(s.interviewInterviewers, eq(s.interviewInterviewers.interviewId, s.interviews.id))
      .innerJoin(s.applications, eq(s.applications.id, s.interviews.applicationId))
      .innerJoin(s.candidates, eq(s.candidates.id, s.applications.candidateId))
      .innerJoin(s.jobs, eq(s.jobs.id, s.applications.jobId))
      .where(and(eq(s.interviewInterviewers.userId, userId), gte(s.interviews.startAt, now), eq(s.interviews.status, "scheduled")))
      .orderBy(asc(s.interviews.startAt))
      .limit(8),

    // Interviews I attended without submitting feedback
    db
      .select({
        id: s.interviews.id,
        title: s.interviews.title,
        startAt: s.interviews.startAt,
        applicationId: s.applications.id,
        candidateId: s.candidates.id,
        firstName: s.candidates.firstName,
        lastName: s.candidates.lastName,
        jobTitle: s.jobs.title,
      })
      .from(s.interviews)
      .innerJoin(s.interviewInterviewers, eq(s.interviewInterviewers.interviewId, s.interviews.id))
      .innerJoin(s.applications, eq(s.applications.id, s.interviews.applicationId))
      .innerJoin(s.candidates, eq(s.candidates.id, s.applications.candidateId))
      .innerJoin(s.jobs, eq(s.jobs.id, s.applications.jobId))
      .where(
        and(
          eq(s.interviewInterviewers.userId, userId),
          lt(s.interviews.endAt, now),
          sql`${s.interviews.status} <> 'cancelled'`,
          sql`NOT EXISTS (SELECT 1 FROM scorecards sc WHERE sc.interview_id = ${s.interviews.id} AND sc.author_id = ${userId})`,
        ),
      )
      .orderBy(sql`${s.interviews.startAt} DESC`)
      .limit(8),

    // Offer approvals waiting on me (all earlier approvers have approved)
    db
      .select({
        approvalId: s.approvalSteps.id,
        requestId: s.approvalRequests.id,
        offerId: s.offers.id,
        baseSalary: s.offers.baseSalary,
        currency: s.offers.currency,
        createdAt: s.offers.createdAt,
        candidateId: s.candidates.id,
        firstName: s.candidates.firstName,
        lastName: s.candidates.lastName,
        jobTitle: s.jobs.title,
      })
      .from(s.approvalSteps)
      .innerJoin(s.approvalRequests, eq(s.approvalRequests.id, s.approvalSteps.requestId))
      .innerJoin(s.offers, and(eq(s.approvalRequests.subject, "offer"), eq(s.offers.id, s.approvalRequests.subjectId)))
      .innerJoin(s.applications, eq(s.applications.id, s.offers.applicationId))
      .innerJoin(s.candidates, eq(s.candidates.id, s.applications.candidateId))
      .innerJoin(s.jobs, eq(s.jobs.id, s.applications.jobId))
      .where(
        and(
          eq(s.approvalSteps.approverId, userId),
          eq(s.approvalSteps.status, "pending"),
          eq(s.approvalRequests.status, "pending"),
          sql`NOT EXISTS (SELECT 1 FROM approval_steps p WHERE p.request_id = ${s.approvalSteps.requestId} AND p.position < ${s.approvalSteps.position} AND p.status <> 'approved')`,
        ),
      ),

    // Jobs I own
    db
      .select({
        id: s.jobs.id,
        title: s.jobs.title,
        status: s.jobs.status,
        brand: s.brands.name,
        active: sql<number>`(SELECT count(*)::int FROM applications a WHERE a.job_id = ${s.jobs.id} AND a.status = 'active')`,
        newThisWeek: sql<number>`(SELECT count(*)::int FROM applications a WHERE a.job_id = ${s.jobs.id} AND a.applied_at > now() - interval '7 days')`,
      })
      .from(s.jobs)
      .innerJoin(s.brands, eq(s.brands.id, s.jobs.brandId))
      .where(
        and(
          inArray(s.jobs.status, ["open", "on_hold"]),
          or(eq(s.jobs.recruiterId, userId), eq(s.jobs.hiringManagerId, userId), eq(s.jobs.coordinatorId, userId)),
        ),
      )
      .orderBy(asc(s.jobs.title)),

    Promise.all([
      // Headline counts only include jobs the viewer can see.
      db.select({ n: count() }).from(s.jobs).where(and(eq(s.jobs.status, "open"), visibleJobsFilter(actor))),
      db
        .select({ n: count() })
        .from(s.applications)
        .where(and(eq(s.applications.status, "active"), inArray(s.applications.jobId, visibleJobIds(actor)))),
      db
        .select({ n: count() })
        .from(s.interviews)
        .innerJoin(s.applications, eq(s.applications.id, s.interviews.applicationId))
        .where(
          and(
            gte(s.interviews.startAt, now),
            lt(s.interviews.startAt, weekAhead),
            eq(s.interviews.status, "scheduled"),
            inArray(s.applications.jobId, visibleJobIds(actor)),
          ),
        ),
      db
        .select({ n: count() })
        .from(s.offers)
        .innerJoin(s.applications, eq(s.applications.id, s.offers.applicationId))
        .where(and(inArray(s.offers.status, ["pending_approval", "approved", "sent"]), inArray(s.applications.jobId, visibleJobIds(actor)))),
    ]).then(([a, b, c, d]) => ({ openJobs: a[0].n, activeCandidates: b[0].n, interviewsThisWeek: c[0].n, openOffers: d[0].n })),
  ]);

  return { upcoming, feedbackDue, approvals, myJobs, stats };
}
