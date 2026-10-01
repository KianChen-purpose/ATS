import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { commonFreeSlots } from "@/lib/availability";
import { fmt } from "@/lib/utils";
import { m365 } from "@/server/integrations/m365";
import { assertCanSeeJobs, NotFoundError, requireRecruiting, systemActor, type Actor } from "@/server/policy";
import { recordAudit } from "./audit";
import { sendAndLogEmail } from "./email";
import { bookInterviewCore, SENDER_MAILBOX } from "./interviews";

export const linkSchema = z.object({
  applicationId: z.string().uuid(),
  stageId: z.string().uuid().nullable(),
  interviewerIds: z.array(z.string().uuid()).min(1).max(20),
  durationMin: z.number().int().min(15).max(240),
  days: z.number().int().min(1).max(21),
  sendEmail: z.boolean(),
});

/** Create a self-scheduling link and (optionally) email it to the candidate. */
export async function createSchedulingLink(actor: Actor, d: z.output<typeof linkSchema>) {
  const user = requireRecruiting(actor, "You don't have permission to schedule interviews.");
  const app = await db.query.applications.findFirst({
    where: eq(s.applications.id, d.applicationId),
    with: { candidate: true, job: { with: { brand: true } } },
  });
  if (!app) throw new NotFoundError("Application");
  await assertCanSeeJobs(actor, [app.jobId]);

  const token = randomBytes(18).toString("base64url");
  const windowStart = new Date();
  const windowEnd = new Date(windowStart.getTime() + d.days * 86_400_000);
  await db.transaction(async (tx) => {
    const [link] = await tx
      .insert(s.schedulingLinks)
      .values({ token, applicationId: d.applicationId, stageId: d.stageId, interviewerIds: d.interviewerIds, durationMinutes: d.durationMin, windowStart, windowEnd, createdById: user.id })
      .returning({ id: s.schedulingLinks.id });
    await recordAudit(tx, actor, "scheduling_link.created", "scheduling_link", link.id, { applicationId: d.applicationId });
  });
  const url = `${process.env.APP_URL ?? "http://localhost:3000"}/schedule/${token}`;

  if (d.sendEmail && app.candidate.email) {
    const stage = d.stageId ? await db.query.jobStages.findFirst({ where: eq(s.jobStages.id, d.stageId) }) : null;
    await sendAndLogEmail(actor, {
      candidateId: app.candidateId,
      applicationId: app.id,
      from: user.email,
      to: app.candidate.email,
      subject: `Schedule your ${stage?.name ?? "interview"} – ${app.job.brand.name}`,
      body: `Hi ${app.candidate.firstName},\n\nWe'd love to move forward with a ${d.durationMin}-minute ${stage?.name?.toLowerCase() ?? "interview"} for the ${app.job.title} role. Please pick a time that works for you:\n\n${url}\n\nThe link shows times in your local time zone and is valid until ${fmt(windowEnd, "MMMM d")}.\n\nThanks,\n${user.name}`,
    });
  }
  return { url, candidateId: app.candidateId };
}

// ---------------------------------------------------------------------------
// Public (candidate) side: no staff session. Only the token authorizes, and only
// data about this one interview request is ever returned.
// ---------------------------------------------------------------------------

export type PublicSchedulingPage =
  | { state: "invalid" }
  | { state: "booked"; brand: { name: string; primaryColor: string } }
  | { state: "expired"; brand: { name: string; primaryColor: string } }
  | {
      state: "open";
      brand: { name: string; primaryColor: string };
      candidateFirstName: string;
      stageName: string | null;
      jobTitle: string;
      durationMin: number;
      slots: string[];
    };

export async function getPublicSchedulingPage(token: string): Promise<PublicSchedulingPage> {
  const link = await db.query.schedulingLinks.findFirst({
    where: eq(s.schedulingLinks.token, token),
    with: { stage: true, application: { with: { candidate: true, job: { with: { brand: true } } } } },
  });
  if (!link) return { state: "invalid" };
  const { job, candidate } = link.application;
  const brand = { name: job.brand.name, primaryColor: job.brand.primaryColor };
  if (link.bookedInterviewId || link.claimedAt) return { state: "booked", brand };
  if (link.windowEnd < new Date()) return { state: "expired", brand };
  return {
    state: "open",
    brand,
    candidateFirstName: candidate.firstName,
    stageName: link.stage?.name ?? null,
    jobTitle: job.title,
    durationMin: link.durationMinutes,
    slots: await openSlots(link),
  };
}

async function openSlots(link: typeof s.schedulingLinks.$inferSelect) {
  const users = await db.query.users.findMany({ where: inArray(s.users.id, link.interviewerIds) });
  const from = new Date(Math.max(Date.now(), link.windowStart.getTime()));
  const days = Math.ceil((link.windowEnd.getTime() - from.getTime()) / 86_400_000);
  const busy = await m365().calendar.getSchedule(users.map((u) => u.email), from, link.windowEnd);
  return commonFreeSlots({ busy, from, days, durationMin: link.durationMinutes }).map((x) => x.start.toISOString());
}

export const bookLinkSchema = z.object({ token: z.string().min(16).max(128), startISO: z.string().datetime() });

/** Candidate books a slot from their link. */
export async function bookSchedulingLink(d: z.output<typeof bookLinkSchema>) {
  const actor = systemActor("self_scheduling");
  const link = await db.query.schedulingLinks.findFirst({
    where: and(eq(s.schedulingLinks.token, d.token), isNull(s.schedulingLinks.claimedAt)),
  });
  if (!link || link.windowEnd < new Date()) throw new Error("This scheduling link has expired or was already used.");
  // Re-check the slot is still free right before booking.
  const slots = await openSlots(link);
  if (!slots.includes(d.startISO)) throw new Error("Sorry, that time was just taken. Please pick another.");

  // Claim the link first so two concurrent bookings can't both succeed.
  const claimed = await db
    .update(s.schedulingLinks)
    .set({ claimedAt: new Date() })
    .where(and(eq(s.schedulingLinks.id, link.id), isNull(s.schedulingLinks.claimedAt)))
    .returning({ id: s.schedulingLinks.id });
  if (claimed.length === 0) throw new Error("This scheduling link has expired or was already used.");

  const creator = link.createdById ? await db.query.users.findFirst({ where: eq(s.users.id, link.createdById) }) : null;
  try {
    const iv = await bookInterviewCore(actor, {
      applicationId: link.applicationId,
      stageId: link.stageId,
      interviewerIds: link.interviewerIds,
      start: new Date(d.startISO),
      durationMin: link.durationMinutes,
      organizerEmail: creator?.email ?? SENDER_MAILBOX(),
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
  } catch (e) {
    await db.update(s.schedulingLinks).set({ claimedAt: null }).where(eq(s.schedulingLinks.id, link.id));
    throw e;
  }
}
