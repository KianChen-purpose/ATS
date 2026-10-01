import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { m365 } from "@/server/integrations/m365";
import { fmt } from "@/lib/utils";
import { sendAndLogEmail } from "@/server/email";

/**
 * Core interview booking used by recruiter scheduling and candidate self-scheduling:
 * creates the Outlook event with a Teams meeting, stores the interview, logs activity,
 * notifies interviewers in Teams and emails the candidate a confirmation.
 */
export async function bookInterview(opts: {
  applicationId: string;
  stageId: string | null;
  interviewerIds: string[];
  start: Date;
  durationMin: number;
  actorId: string | null;
  organizerEmail: string;
  notifyCandidate: boolean;
  replaceInterviewId?: string;
}) {
  const app = await db.query.applications.findFirst({
    where: eq(s.applications.id, opts.applicationId),
    with: { candidate: true, job: { with: { brand: true } } },
  });
  if (!app) throw new Error("Application not found");
  const [stage, interviewers, form] = await Promise.all([
    opts.stageId ? db.query.jobStages.findFirst({ where: eq(s.jobStages.id, opts.stageId) }) : null,
    db.query.users.findMany({ where: inArray(s.users.id, opts.interviewerIds) }),
    db.query.feedbackForms.findFirst(),
  ]);
  if (interviewers.length === 0) throw new Error("Pick at least one interviewer");

  const candidateName = `${app.candidate.firstName} ${app.candidate.lastName}`;
  const stageName = stage?.name ?? "Interview";
  const end = new Date(opts.start.getTime() + opts.durationMin * 60_000);
  const subject = `${stageName} – ${candidateName} (${app.job.title})`;

  if (opts.replaceInterviewId) await cancelInterviewCore(opts.replaceInterviewId, opts.actorId, false, "Rescheduled");

  const event = await m365().calendar.createEvent({
    organizer: opts.organizerEmail,
    subject,
    body: `${app.job.brand.name} interview for ${app.job.title}.\nCandidate profile: /candidates/${app.candidateId}`,
    start: opts.start,
    end,
    teamsMeeting: true,
    attendees: [
      ...interviewers.map((u) => ({ email: u.email, name: u.name })),
      ...(app.candidate.email ? [{ email: app.candidate.email, name: candidateName }] : []),
    ],
  });

  const [interview] = await db
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
      createdById: opts.actorId,
    })
    .returning();
  await db.insert(s.interviewInterviewers).values(interviewers.map((u) => ({ interviewId: interview.id, userId: u.id })));
  await db.insert(s.activities).values({
    candidateId: app.candidateId,
    applicationId: app.id,
    type: "interview_scheduled",
    actorId: opts.actorId,
    body: `${opts.replaceInterviewId ? "Rescheduled" : "Scheduled"} ${stageName} for ${fmt(opts.start, "EEE MMM d, h:mm a")} with ${interviewers.map((u) => u.name).join(", ")}`,
    metadata: { interviewId: interview.id },
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
    await sendAndLogEmail({
      candidateId: app.candidateId,
      applicationId: app.id,
      from: opts.organizerEmail,
      to: app.candidate.email,
      subject: `Interview confirmed – ${app.job.title}`,
      body,
      sentById: opts.actorId,
    });
  }
  return interview;
}

export async function cancelInterviewCore(interviewId: string, actorId: string | null, notifyCandidate: boolean, reason = "Cancelled") {
  const iv = await db.query.interviews.findFirst({
    where: eq(s.interviews.id, interviewId),
    with: { application: { with: { candidate: true, job: { with: { brand: true } } } }, interviewers: { with: { user: true } } },
  });
  if (!iv) throw new Error("Interview not found");
  if (iv.status === "cancelled") return iv;
  const organizer = iv.interviewers[0]?.user.email ?? process.env.M365_SENDER_MAILBOX ?? "careers@purpose.demo";
  if (iv.externalEventId) await m365().calendar.cancelEvent(organizer, iv.externalEventId, reason);
  await db.update(s.interviews).set({ status: "cancelled" }).where(eq(s.interviews.id, iv.id));
  const c = iv.application.candidate;
  await db.insert(s.activities).values({
    candidateId: c.id,
    applicationId: iv.applicationId,
    type: "interview_cancelled",
    actorId,
    body: `${reason}: ${iv.title.split(" – ")[0]} on ${fmt(iv.startAt, "EEE MMM d, h:mm a")}`,
    metadata: { interviewId: iv.id },
  });
  if (notifyCandidate && c.email) {
    await sendAndLogEmail({
      candidateId: c.id,
      applicationId: iv.applicationId,
      from: organizer,
      to: c.email,
      subject: `Interview cancelled – ${iv.application.job.title}`,
      body: `Hi ${c.firstName},\n\nYour interview on ${fmt(iv.startAt, "EEEE, MMMM d 'at' h:mm a")} Eastern has been cancelled. We'll be in touch shortly to find a new time.\n\n${iv.application.job.brand.name} Talent Team`,
      sentById: actorId,
    });
  }
  return iv;
}
