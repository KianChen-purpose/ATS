import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { fmt } from "@/lib/utils";
import { m365 } from "@/server/integrations/m365";
import {
  actorUserId,
  assertCanSeeJobs,
  canManageRecruiting,
  NotFoundError,
  requireRecruiting,
  visibleJobsFilter,
  type Actor,
  type UserActor,
} from "@/server/policy";
import { recordAudit } from "./audit";
import { viewCandidateProfile } from "./candidates";
import { sendAndLogEmail } from "./email";

const SENDER_MAILBOX = () => process.env.M365_SENDER_MAILBOX ?? "careers@purpose.demo";

// ---------------------------------------------------------------------------
// Interviews hub
// ---------------------------------------------------------------------------

export type InterviewView = "upcoming" | "past" | "feedback" | "cancelled";
export type InterviewScope = "mine" | "all";

const PAGE_LIMIT = 200;

function baseConditions(actor: UserActor, scope: InterviewScope): SQL[] {
  const conds: SQL[] = [];
  const visible = visibleJobsFilter(actor);
  if (visible) conds.push(visible);
  if (scope === "mine" || !canManageRecruiting(actor)) {
    conds.push(sql`EXISTS (SELECT 1 FROM interview_interviewers ii WHERE ii.interview_id = ${s.interviews.id} AND ii.user_id = ${actor.id})`);
  }
  return conds;
}

/** Interviews still missing a scorecard from at least one interviewer (or from me, in "mine" scope). */
function missingFeedbackCondition(actor: UserActor, scope: InterviewScope): SQL {
  return scope === "mine"
    ? sql`NOT EXISTS (SELECT 1 FROM scorecards sc WHERE sc.interview_id = ${s.interviews.id} AND sc.author_id = ${actor.id})`
    : sql`EXISTS (
        SELECT 1 FROM interview_interviewers ii
        WHERE ii.interview_id = ${s.interviews.id}
          AND NOT EXISTS (SELECT 1 FROM scorecards sc WHERE sc.interview_id = ii.interview_id AND sc.author_id = ii.user_id)
      )`;
}

function viewCondition(actor: UserActor, scope: InterviewScope, view: InterviewView, now: Date): SQL {
  switch (view) {
    case "upcoming":
      return and(eq(s.interviews.status, "scheduled"), gte(s.interviews.endAt, now))!;
    case "past":
      return and(ne(s.interviews.status, "cancelled"), lt(s.interviews.endAt, now))!;
    case "feedback":
      return and(ne(s.interviews.status, "cancelled"), lt(s.interviews.endAt, now), missingFeedbackCondition(actor, scope))!;
    case "cancelled":
      return eq(s.interviews.status, "cancelled");
  }
}

export async function interviewCounts(actor: UserActor, scope: InterviewScope) {
  const now = new Date();
  const base = baseConditions(actor, scope);
  const views: InterviewView[] = ["upcoming", "past", "feedback", "cancelled"];
  const results = await Promise.all(
    views.map((v) =>
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(s.interviews)
        .innerJoin(s.applications, eq(s.applications.id, s.interviews.applicationId))
        .innerJoin(s.jobs, eq(s.jobs.id, s.applications.jobId))
        .where(and(...base, viewCondition(actor, scope, v, now))),
    ),
  );
  return Object.fromEntries(views.map((v, i) => [v, results[i][0].n])) as Record<InterviewView, number>;
}

export async function listInterviews(actor: UserActor, opts: { scope: InterviewScope; view: InterviewView; jobId?: string }) {
  const now = new Date();
  const conds = [...baseConditions(actor, opts.scope), viewCondition(actor, opts.scope, opts.view, now)];
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
    return {
      ...r,
      // Booked titles end in " – Candidate Name"; the list already shows the name.
      title: r.title.replace(` – ${r.firstName} ${r.lastName}`, ""),
      interviewers,
      isInterviewer: interviewers.some((i) => i.id === actor.id),
      mySubmitted: submitted.has(actor.id),
      missingCount: interviewers.filter((i) => !i.submitted).length,
      isPast: r.endAt < now,
    };
  });
}

export type InterviewListRow = Awaited<ReturnType<typeof listInterviews>>[number];

// ---------------------------------------------------------------------------
// Scheduler page
// ---------------------------------------------------------------------------

/** Everything the scheduling screen needs, or null if the actor can't schedule for this candidate. */
export async function getSchedulerData(actor: UserActor, candidateId: string, applicationId?: string, replaceInterviewId?: string) {
  if (!canManageRecruiting(actor)) return null;
  const profile = await viewCandidateProfile(actor, candidateId, "scheduler");
  if (!profile) return null;
  const app = profile.applications.find((a) => a.id === applicationId) ?? profile.applications.find((a) => a.status === "active");
  if (!app) return null;

  const replace = replaceInterviewId ? app.interviews.find((i) => i.id === replaceInterviewId) : undefined;
  const stages = app.job.stages.filter((st) => st.type === "screen" || st.type === "interview");
  const current = app.job.stages.find((st) => st.id === app.stageId);
  const defaultStage =
    (replace?.stageId && stages.find((st) => st.id === replace.stageId)) ||
    (current && stages.find((st) => st.id === current.id)) ||
    stages.find((st) => st.position > (current?.position ?? 0)) ||
    stages[0];

  const people = await db
    .select({ id: s.users.id, name: s.users.name, title: s.users.title, avatarColor: s.users.avatarColor, role: s.users.role })
    .from(s.users)
    .where(eq(s.users.active, true))
    .orderBy(asc(s.users.name));
  const job = app.job;
  const defaultInterviewerIds = (
    replace
      ? replace.interviewers.map((i) => i.userId)
      : defaultStage?.type === "screen"
        ? [job.recruiterId]
        : [job.hiringManagerId, ...job.team.slice(0, 1).map((t) => t.userId)]
  ).filter((x): x is string => Boolean(x));

  return { profile, app, stages, defaultStage, people, defaultInterviewerIds, replace };
}

export async function getAvailability(actor: Actor, interviewerIds: string[], from: Date, days: number) {
  requireRecruiting(actor, "You don't have permission to schedule interviews.");
  const users = await db.query.users.findMany({ where: inArray(s.users.id, interviewerIds) });
  const to = new Date(from.getTime() + days * 86_400_000);
  const byEmail = await m365().calendar.getSchedule(users.map((u) => u.email), from, to);
  return Object.fromEntries(
    users.map((u) => [u.id, (byEmail[u.email] ?? []).map((b) => ({ start: b.start.toISOString(), end: b.end.toISOString(), status: b.status }))]),
  );
}

// ---------------------------------------------------------------------------
// Booking & cancelling
// ---------------------------------------------------------------------------

/**
 * Core interview booking used by recruiter scheduling and candidate self-scheduling:
 * creates the Outlook event with a Teams meeting, stores the interview, logs activity,
 * notifies interviewers in Teams and emails the candidate a confirmation.
 * Internal: callers authorize first.
 */
export async function bookInterviewCore(
  actor: Actor,
  opts: {
    applicationId: string;
    stageId: string | null;
    interviewerIds: string[];
    start: Date;
    durationMin: number;
    organizerEmail: string;
    notifyCandidate: boolean;
    replaceInterviewId?: string;
  },
) {
  const app = await db.query.applications.findFirst({
    where: eq(s.applications.id, opts.applicationId),
    with: { candidate: true, job: { with: { brand: true } } },
  });
  if (!app) throw new NotFoundError("Application");
  const [stage, interviewers, form] = await Promise.all([
    opts.stageId ? db.query.jobStages.findFirst({ where: and(eq(s.jobStages.id, opts.stageId), eq(s.jobStages.jobId, app.jobId)) }) : null,
    db.query.users.findMany({ where: and(inArray(s.users.id, opts.interviewerIds), eq(s.users.active, true)) }),
    db.query.feedbackForms.findFirst(),
  ]);
  if (interviewers.length === 0) throw new Error("Pick at least one interviewer");

  const candidateName = `${app.candidate.firstName} ${app.candidate.lastName}`;
  const stageName = stage?.name ?? "Interview";
  const end = new Date(opts.start.getTime() + opts.durationMin * 60_000);

  if (opts.replaceInterviewId) await cancelInterviewCore(actor, opts.replaceInterviewId, false, "Rescheduled");

  const event = await m365().calendar.createEvent({
    organizer: opts.organizerEmail,
    subject: `${stageName} – ${candidateName} (${app.job.title})`,
    body: `${app.job.brand.name} interview for ${app.job.title}.\nCandidate profile: /candidates/${app.candidateId}`,
    start: opts.start,
    end,
    teamsMeeting: true,
    attendees: [
      ...interviewers.map((u) => ({ email: u.email, name: u.name })),
      ...(app.candidate.email ? [{ email: app.candidate.email, name: candidateName }] : []),
    ],
  });

  const interview = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.interviews)
      .values({
        applicationId: app.id,
        stageId: stage?.id ?? null,
        feedbackFormId: form?.id ?? null,
        title: `${stageName} – ${candidateName}`,
        startAt: opts.start,
        endAt: end,
        location: "Microsoft Teams",
        meetingUrl: event.joinUrl,
        externalEventId: event.eventId,
        status: "scheduled",
        createdById: actorUserId(actor),
      })
      .returning();
    await tx.insert(s.interviewInterviewers).values(interviewers.map((u) => ({ interviewId: row.id, userId: u.id })));
    await tx.insert(s.activities).values({
      candidateId: app.candidateId,
      applicationId: app.id,
      type: "interview_scheduled",
      actorId: actorUserId(actor),
      body: `${opts.replaceInterviewId ? "Rescheduled" : "Scheduled"} ${stageName} for ${fmt(opts.start, "EEE MMM d, h:mm a")} with ${interviewers.map((u) => u.name).join(", ")}`,
      metadata: { interviewId: row.id },
    });
    await recordAudit(tx, actor, opts.replaceInterviewId ? "interview.rescheduled" : "interview.scheduled", "interview", row.id, {
      applicationId: app.id,
      replaced: opts.replaceInterviewId ?? null,
    });
    return row;
  });

  for (const u of interviewers) {
    await m365().teams.notify({
      toEmail: u.email,
      title: `New interview: ${candidateName}`,
      text: `${stageName} for ${app.job.title} on ${fmt(opts.start, "EEE MMM d, h:mm a")} ET`,
      url: `/candidates/${app.candidateId}`,
    });
  }

  if (opts.notifyCandidate && app.candidate.email) {
    const body = `Hi ${app.candidate.firstName},\n\nYour ${stageName.toLowerCase()} for the ${app.job.title} role at ${app.job.brand.name} is confirmed:\n\n${fmt(opts.start, "EEEE, MMMM d 'at' h:mm a")} Eastern (${opts.durationMin} min)\nWith: ${interviewers.map((u) => u.name).join(", ")}\nJoin on Microsoft Teams: ${event.joinUrl}\n\nA calendar invitation is on its way. Reply to this email if you need to change the time.\n\nThanks,\n${app.job.brand.name} Talent Team`;
    await sendAndLogEmail(actor, {
      candidateId: app.candidateId,
      applicationId: app.id,
      from: opts.organizerEmail,
      to: app.candidate.email,
      subject: `Interview confirmed – ${app.job.title}`,
      body,
    });
  }
  return interview;
}

export async function cancelInterviewCore(actor: Actor, interviewId: string, notifyCandidate: boolean, reason = "Cancelled") {
  const iv = await db.query.interviews.findFirst({
    where: eq(s.interviews.id, interviewId),
    with: { application: { with: { candidate: true, job: { with: { brand: true } } } }, interviewers: { with: { user: true } } },
  });
  if (!iv) throw new NotFoundError("Interview");
  if (iv.status === "cancelled") return iv;
  const organizer = iv.interviewers[0]?.user.email ?? SENDER_MAILBOX();
  if (iv.externalEventId) await m365().calendar.cancelEvent(organizer, iv.externalEventId, reason);
  const c = iv.application.candidate;
  await db.transaction(async (tx) => {
    await tx.update(s.interviews).set({ status: "cancelled" }).where(eq(s.interviews.id, iv.id));
    await tx.insert(s.activities).values({
      candidateId: c.id,
      applicationId: iv.applicationId,
      type: "interview_cancelled",
      actorId: actorUserId(actor),
      body: `${reason}: ${iv.title.split(" – ")[0]} on ${fmt(iv.startAt, "EEE MMM d, h:mm a")}`,
      metadata: { interviewId: iv.id },
    });
    await recordAudit(tx, actor, "interview.cancelled", "interview", iv.id, { reason });
  });
  if (notifyCandidate && c.email) {
    await sendAndLogEmail(actor, {
      candidateId: c.id,
      applicationId: iv.applicationId,
      from: organizer,
      to: c.email,
      subject: `Interview cancelled – ${iv.application.job.title}`,
      body: `Hi ${c.firstName},\n\nYour interview on ${fmt(iv.startAt, "EEEE, MMMM d 'at' h:mm a")} Eastern has been cancelled. We'll be in touch shortly to find a new time.\n\n${iv.application.job.brand.name} Talent Team`,
    });
  }
  return iv;
}

/** Throws unless the actor can see the job behind every listed interview. */
async function loadVisibleInterviews(actor: Actor, interviewIds: string[]) {
  const ids = [...new Set(interviewIds)];
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: s.interviews.id, applicationId: s.interviews.applicationId, jobId: s.applications.jobId, candidateId: s.applications.candidateId })
    .from(s.interviews)
    .innerJoin(s.applications, eq(s.applications.id, s.interviews.applicationId))
    .where(inArray(s.interviews.id, ids));
  if (rows.length !== ids.length) throw new NotFoundError("Interview");
  await assertCanSeeJobs(actor, rows.map((r) => r.jobId));
  return rows;
}

export const scheduleSchema = z.object({
  applicationId: z.string().uuid(),
  stageId: z.string().uuid().nullable(),
  interviewerIds: z.array(z.string().uuid()).min(1, "Pick at least one interviewer").max(20),
  startISO: z.string().datetime(),
  durationMin: z.number().int().min(15).max(480),
  notifyCandidate: z.boolean(),
  replaceInterviewId: z.string().uuid().optional(),
});

export async function scheduleInterview(actor: Actor, d: z.output<typeof scheduleSchema>) {
  const user = requireRecruiting(actor, "You don't have permission to schedule interviews.");
  const app = await db.query.applications.findFirst({ where: eq(s.applications.id, d.applicationId) });
  if (!app) throw new NotFoundError("Application");
  await assertCanSeeJobs(actor, [app.jobId]);
  if (d.replaceInterviewId) {
    const [old] = await loadVisibleInterviews(actor, [d.replaceInterviewId]);
    if (old.applicationId !== app.id) throw new NotFoundError("Interview");
  }
  const iv = await bookInterviewCore(actor, {
    applicationId: d.applicationId,
    stageId: d.stageId,
    interviewerIds: d.interviewerIds,
    start: new Date(d.startISO),
    durationMin: d.durationMin,
    organizerEmail: user.email,
    notifyCandidate: d.notifyCandidate,
    replaceInterviewId: d.replaceInterviewId,
  });
  return { interviewId: iv.id, candidateId: app.candidateId };
}

export async function cancelInterview(actor: Actor, interviewId: string, notifyCandidate: boolean) {
  requireRecruiting(actor, "You don't have permission to cancel interviews.");
  const [row] = await loadVisibleInterviews(actor, [interviewId]);
  await cancelInterviewCore(actor, interviewId, notifyCandidate);
  return { candidateId: row.candidateId };
}

/** Teams nudge to interviewers who haven't submitted feedback. */
export async function sendFeedbackReminders(actor: Actor, interviewIds: string[]) {
  requireRecruiting(actor);
  await loadVisibleInterviews(actor, interviewIds);
  const ivs = await db.query.interviews.findMany({
    where: inArray(s.interviews.id, interviewIds),
    with: { interviewers: { with: { user: true } }, scorecards: true },
  });
  let sent = 0;
  for (const iv of ivs) {
    const done = new Set(iv.scorecards.map((sc) => sc.authorId));
    for (const { user: u } of iv.interviewers.filter((i) => !done.has(i.userId))) {
      await m365().teams.notify({
        toEmail: u.email,
        title: "Feedback reminder",
        text: `Please submit your feedback for ${iv.title} (${fmt(iv.startAt, "MMM d")}).`,
        url: `/interviews/${iv.id}/feedback`,
      });
      sent++;
    }
  }
  await db.transaction(async (tx) => {
    for (const iv of ivs) await recordAudit(tx, actor, "feedback.reminder_sent", "interview", iv.id);
  });
  return { sent };
}

export { SENDER_MAILBOX };
