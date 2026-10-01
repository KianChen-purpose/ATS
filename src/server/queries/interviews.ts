import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, ne, sql, type SQL } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { CurrentUser } from "@/lib/session";
import { visibleJobsFilter } from "@/server/permissions";

export type InterviewView = "upcoming" | "past" | "feedback" | "cancelled";
export type InterviewScope = "mine" | "all";

const PAGE_LIMIT = 200;

function baseConditions(user: CurrentUser, scope: InterviewScope): SQL[] {
  const conds: SQL[] = [];
  const visible = visibleJobsFilter(user);
  if (visible) conds.push(visible);
  if (scope === "mine") {
    conds.push(sql`EXISTS (SELECT 1 FROM interview_interviewers ii WHERE ii.interview_id = ${s.interviews.id} AND ii.user_id = ${user.id})`);
  }
  return conds;
}

/** Interviews still missing a scorecard from at least one interviewer (or from me, in "mine" scope). */
function missingFeedbackCondition(user: CurrentUser, scope: InterviewScope): SQL {
  return scope === "mine"
    ? sql`NOT EXISTS (SELECT 1 FROM scorecards sc WHERE sc.interview_id = ${s.interviews.id} AND sc.author_id = ${user.id})`
    : sql`EXISTS (
        SELECT 1 FROM interview_interviewers ii
        WHERE ii.interview_id = ${s.interviews.id}
          AND NOT EXISTS (SELECT 1 FROM scorecards sc WHERE sc.interview_id = ii.interview_id AND sc.author_id = ii.user_id)
      )`;
}

function viewCondition(user: CurrentUser, scope: InterviewScope, view: InterviewView, now: Date): SQL {
  switch (view) {
    case "upcoming":
      return and(eq(s.interviews.status, "scheduled"), gte(s.interviews.endAt, now))!;
    case "past":
      return and(ne(s.interviews.status, "cancelled"), lt(s.interviews.endAt, now))!;
    case "feedback":
      return and(ne(s.interviews.status, "cancelled"), lt(s.interviews.endAt, now), missingFeedbackCondition(user, scope))!;
    case "cancelled":
      return eq(s.interviews.status, "cancelled");
  }
}

export async function interviewCounts(user: CurrentUser, scope: InterviewScope) {
  const now = new Date();
  const base = baseConditions(user, scope);
  const views: InterviewView[] = ["upcoming", "past", "feedback", "cancelled"];
  const results = await Promise.all(
    views.map((v) =>
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(s.interviews)
        .innerJoin(s.applications, eq(s.applications.id, s.interviews.applicationId))
        .innerJoin(s.jobs, eq(s.jobs.id, s.applications.jobId))
        .where(and(...base, viewCondition(user, scope, v, now))),
    ),
  );
  return Object.fromEntries(views.map((v, i) => [v, results[i][0].n])) as Record<InterviewView, number>;
}

export async function listInterviews(user: CurrentUser, opts: { scope: InterviewScope; view: InterviewView; jobId?: string }) {
  const now = new Date();
  const conds = [...baseConditions(user, opts.scope), viewCondition(user, opts.scope, opts.view, now)];
  if (opts.jobId) conds.push(eq(s.jobs.id, opts.jobId));

  const rows = await db
    .select({
      id: s.interviews.id,
      title: s.interviews.title,
      startAt: s.interviews.startAt,
      endAt: s.interviews.endAt,
      status: s.interviews.status,
      meetingUrl: s.interviews.meetingUrl,
      location: s.interviews.location,
      applicationId: s.applications.id,
      candidateId: s.candidates.id,
      firstName: s.candidates.firstName,
      lastName: s.candidates.lastName,
      jobId: s.jobs.id,
      jobTitle: s.jobs.title,
      stageName: s.jobStages.name,
    })
    .from(s.interviews)
    .innerJoin(s.applications, eq(s.applications.id, s.interviews.applicationId))
    .innerJoin(s.candidates, eq(s.candidates.id, s.applications.candidateId))
    .innerJoin(s.jobs, eq(s.jobs.id, s.applications.jobId))
    .leftJoin(s.jobStages, eq(s.jobStages.id, s.interviews.stageId))
    .where(and(...conds))
    .orderBy(opts.view === "upcoming" ? asc(s.interviews.startAt) : desc(s.interviews.startAt))
    .limit(PAGE_LIMIT);

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [panel, cards] = await Promise.all([
    db
      .select({ interviewId: s.interviewInterviewers.interviewId, userId: s.users.id, name: s.users.name, color: s.users.avatarColor })
      .from(s.interviewInterviewers)
      .innerJoin(s.users, eq(s.users.id, s.interviewInterviewers.userId))
      .where(inArray(s.interviewInterviewers.interviewId, ids)),
    db
      .select({ interviewId: s.scorecards.interviewId, authorId: s.scorecards.authorId })
      .from(s.scorecards)
      .where(inArray(s.scorecards.interviewId, ids)),
  ]);

  return rows.map((r) => {
    const submitted = new Set(cards.filter((c) => c.interviewId === r.id).map((c) => c.authorId));
    const interviewers = panel
      .filter((p) => p.interviewId === r.id)
      .map((p) => ({ id: p.userId, name: p.name, color: p.color, submitted: submitted.has(p.userId) }));
    const isInterviewer = interviewers.some((i) => i.id === user.id);
    return {
      ...r,
      // Seeded/booked titles end in " – Candidate Name"; the list already shows the name.
      title: r.title.replace(` – ${r.firstName} ${r.lastName}`, ""),
      interviewers,
      isInterviewer,
      mySubmitted: submitted.has(user.id),
      missingCount: interviewers.filter((i) => !i.submitted).length,
      isPast: r.endAt < now,
    };
  });
}

export type InterviewListRow = Awaited<ReturnType<typeof listInterviews>>[number];
