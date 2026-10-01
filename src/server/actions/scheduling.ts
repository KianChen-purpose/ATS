"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { requireUser } from "@/lib/session";
import { canManageRecruiting } from "@/server/permissions";
import { m365 } from "@/server/integrations/m365";
import { audit } from "@/server/audit";
import { bookInterview, cancelInterviewCore } from "@/server/scheduling";
import { sendAndLogEmail } from "@/server/email";
import { commonFreeSlots } from "@/lib/availability";
import { fmt } from "@/lib/utils";

async function requireScheduler() {
  const user = await requireUser();
  if (!canManageRecruiting(user)) throw new Error("You don't have permission to schedule interviews.");
  return user;
}

/** Outlook free/busy for interviewers, keyed by user id, for the scheduling grid. */
export async function getAvailability(interviewerIds: string[], fromISO: string, days: number) {
  await requireScheduler();
  const users = await db.query.users.findMany({ where: inArray(s.users.id, interviewerIds) });
  const from = new Date(fromISO);
  const to = new Date(from.getTime() + days * 86_400_000);
  const byEmail = await m365().calendar.getSchedule(users.map((u) => u.email), from, to);
  return Object.fromEntries(
    users.map((u) => [u.id, (byEmail[u.email] ?? []).map((b) => ({ start: b.start.toISOString(), end: b.end.toISOString(), status: b.status }))]),
  );
}

const scheduleSchema = z.object({
  applicationId: z.string().uuid(),
  stageId: z.string().uuid().nullable(),
  interviewerIds: z.array(z.string().uuid()).min(1, "Pick at least one interviewer"),
  startISO: z.string().datetime(),
  durationMin: z.number().int().min(15).max(480),
  notifyCandidate: z.boolean(),
  replaceInterviewId: z.string().uuid().optional(),
});

export async function scheduleInterview(input: z.input<typeof scheduleSchema>) {
  const user = await requireScheduler();
  const d = scheduleSchema.parse(input);
  const iv = await bookInterview({
    applicationId: d.applicationId,
    stageId: d.stageId,
    interviewerIds: d.interviewerIds,
    start: new Date(d.startISO),
    durationMin: d.durationMin,
    actorId: user.id,
    organizerEmail: user.email,
    notifyCandidate: d.notifyCandidate,
    replaceInterviewId: d.replaceInterviewId,
  });
  await audit(user.id, "interview.scheduled", "interview", iv.id);
  const app = await db.query.applications.findFirst({ where: eq(s.applications.id, d.applicationId) });
  revalidatePath(`/candidates/${app?.candidateId}`);
  revalidatePath("/interviews");
  return { interviewId: iv.id, candidateId: app?.candidateId };
}

export async function cancelInterview(interviewId: string, notifyCandidate: boolean) {
  const user = await requireScheduler();
  const iv = await cancelInterviewCore(interviewId, user.id, notifyCandidate);
  await audit(user.id, "interview.cancelled", "interview", interviewId);
  revalidatePath(`/candidates/${iv.application.candidateId}`);
  revalidatePath("/interviews");
}

const linkSchema = z.object({
  applicationId: z.string().uuid(),
  stageId: z.string().uuid().nullable(),
  interviewerIds: z.array(z.string().uuid()).min(1),
  durationMin: z.number().int().min(15).max(240),
  days: z.number().int().min(1).max(21),
  sendEmail: z.boolean(),
});

/** Create a self-scheduling link and (optionally) email it to the candidate. */
export async function createSchedulingLink(input: z.input<typeof linkSchema>) {
  const user = await requireScheduler();
  const d = linkSchema.parse(input);
  const token = randomBytes(18).toString("base64url");
  const windowStart = new Date();
  const windowEnd = new Date(windowStart.getTime() + d.days * 86_400_000);
  await db.insert(s.schedulingLinks).values({
    token,
    applicationId: d.applicationId,
    stageId: d.stageId,
    interviewerIds: d.interviewerIds,
    durationMinutes: d.durationMin,
    windowStart,
    windowEnd,
    createdById: user.id,
  });
  const url = `${process.env.APP_URL ?? "http://localhost:3000"}/schedule/${token}`;

  const app = await db.query.applications.findFirst({
    where: eq(s.applications.id, d.applicationId),
    with: { candidate: true, job: { with: { brand: true } } },
  });
  if (d.sendEmail && app?.candidate.email) {
    const stage = d.stageId ? await db.query.jobStages.findFirst({ where: eq(s.jobStages.id, d.stageId) }) : null;
    await sendAndLogEmail({
      candidateId: app.candidateId,
      applicationId: app.id,
      from: user.email,
      to: app.candidate.email,
      subject: `Schedule your ${stage?.name ?? "interview"} – ${app.job.brand.name}`,
      body: `Hi ${app.candidate.firstName},\n\nWe'd love to move forward with a ${d.durationMin}-minute ${stage?.name?.toLowerCase() ?? "interview"} for the ${app.job.title} role. Please pick a time that works for you:\n\n${url}\n\nThe link shows times in your local time zone and is valid until ${fmt(windowEnd, "MMMM d")}.\n\nThanks,\n${user.name}`,
      sentById: user.id,
    });
  }
  await audit(user.id, "scheduling_link.created", "application", d.applicationId);
  revalidatePath(`/candidates/${app?.candidateId}`);
  return { url };
}

/** Public: open slots for a self-scheduling link. No staff session required. */
export async function getSchedulingLinkSlots(token: string) {
  const link = await db.query.schedulingLinks.findFirst({ where: eq(s.schedulingLinks.token, token) });
  if (!link || link.bookedInterviewId || link.windowEnd < new Date()) return null;
  const users = await db.query.users.findMany({ where: inArray(s.users.id, link.interviewerIds) });
  const from = new Date(Math.max(Date.now(), link.windowStart.getTime()));
  const days = Math.ceil((link.windowEnd.getTime() - from.getTime()) / 86_400_000);
  const busy = await m365().calendar.getSchedule(users.map((u) => u.email), from, link.windowEnd);
  return commonFreeSlots({ busy, from, days, durationMin: link.durationMinutes }).map((x) => x.start.toISOString());
}

/** Public: candidate books a slot from their link. */
export async function bookSchedulingLink(token: string, startISO: string) {
  const link = await db.query.schedulingLinks.findFirst({
    where: and(eq(s.schedulingLinks.token, token), isNull(s.schedulingLinks.bookedInterviewId)),
  });
  if (!link || link.windowEnd < new Date()) throw new Error("This scheduling link has expired or was already used.");
  // Re-check the slot is still free right before booking.
  const slots = await getSchedulingLinkSlots(token);
  if (!slots?.includes(startISO)) throw new Error("Sorry, that time was just taken. Please pick another.");
  const creator = link.createdById ? await db.query.users.findFirst({ where: eq(s.users.id, link.createdById) }) : null;
  const iv = await bookInterview({
    applicationId: link.applicationId,
    stageId: link.stageId,
    interviewerIds: link.interviewerIds,
    start: new Date(startISO),
    durationMin: link.durationMinutes,
    actorId: null,
    organizerEmail: creator?.email ?? process.env.M365_SENDER_MAILBOX ?? "careers@purpose.demo",
    notifyCandidate: true,
  });
  await db.update(s.schedulingLinks).set({ bookedInterviewId: iv.id }).where(eq(s.schedulingLinks.id, link.id));
  if (creator) {
    await m365().teams.notify({
      toEmail: creator.email,
      title: "Candidate self-scheduled an interview",
      text: `${iv.title} on ${fmt(iv.startAt, "EEE MMM d, h:mm a")} ET`,
      url: `/interviews`,
    });
  }
  return { startISO: iv.startAt.toISOString(), meetingUrl: iv.meetingUrl };
}

/** Teams nudge to interviewers who haven't submitted feedback. */
export async function sendFeedbackReminders(interviewIds: string[]) {
  const user = await requireScheduler();
  const ivs = await db.query.interviews.findMany({
    where: inArray(s.interviews.id, interviewIds),
    with: { interviewers: { with: { user: true } }, scorecards: true, application: true },
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
  await audit(user.id, "feedback.reminders_sent", "interview", null, { interviewIds, sent });
  return { sent };
}
