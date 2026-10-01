"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/server/audit";
import { canManageRecruiting } from "@/server/permissions";
import { m365 } from "@/server/integrations/m365";

async function requireRecruiter() {
  const user = await requireUser();
  if (!canManageRecruiting(user)) throw new Error("You don't have permission to do that.");
  return user;
}

function refresh(jobId?: string, candidateId?: string) {
  if (jobId) revalidatePath(`/jobs/${jobId}`);
  if (candidateId) revalidatePath(`/candidates/${candidateId}`);
  revalidatePath("/candidates");
  revalidatePath("/jobs");
}

/** Move one or more applications to a stage. Moving to a "hired" stage marks them hired. */
export async function moveToStage(applicationIds: string[], stageId: string) {
  const user = await requireRecruiter();
  const stage = await db.query.jobStages.findFirst({ where: eq(s.jobStages.id, stageId) });
  if (!stage) throw new Error("Stage not found");
  const apps = await db.query.applications.findMany({
    where: and(inArray(s.applications.id, applicationIds), eq(s.applications.jobId, stage.jobId)),
    with: { stage: true },
  });
  const now = new Date();
  const status = stage.type === "hired" ? "hired" : "active";

  await db.transaction(async (tx) => {
    for (const app of apps) {
      if (app.stageId === stageId && app.status === status) continue;
      await tx
        .update(s.applications)
        .set({ stageId, status, stageEnteredAt: now, archivedAt: null, archiveReasonId: null, hiredAt: status === "hired" ? now : null })
        .where(eq(s.applications.id, app.id));
      await tx.insert(s.applicationStageEvents).values({
        applicationId: app.id,
        fromStageId: app.stageId,
        toStageId: stageId,
        status,
        movedById: user.id,
      });
      await tx.insert(s.activities).values({
        candidateId: app.candidateId,
        applicationId: app.id,
        type: status === "hired" ? "hired" : "stage_change",
        actorId: user.id,
        body: status === "hired" ? "Marked as hired 🎉" : `Moved from ${app.stage.name} to ${stage.name}`,
        metadata: { fromStage: app.stage.name, toStage: stage.name },
      });
      await tx.update(s.candidates).set({ updatedAt: now }).where(eq(s.candidates.id, app.candidateId));
    }
  });
  await audit(user.id, "application.stage_changed", "application", null, { applicationIds, stageId });
  refresh(stage.jobId, apps.length === 1 ? apps[0].candidateId : undefined);
}

const archiveSchema = z.object({
  applicationIds: z.array(z.string().uuid()).min(1),
  reasonId: z.string().uuid(),
  sendEmail: z.boolean().default(false),
  emailSubject: z.string().optional(),
  emailBody: z.string().optional(),
});

export async function archiveApplications(input: z.input<typeof archiveSchema>) {
  const user = await requireRecruiter();
  const { applicationIds, reasonId, sendEmail, emailSubject, emailBody } = archiveSchema.parse(input);
  const reason = await db.query.archiveReasons.findFirst({ where: eq(s.archiveReasons.id, reasonId) });
  if (!reason) throw new Error("Archive reason not found");
  const apps = await db.query.applications.findMany({
    where: inArray(s.applications.id, applicationIds),
    with: { candidate: true, job: { with: { brand: true } } },
  });
  const now = new Date();

  for (const app of apps) {
    await db.transaction(async (tx) => {
      await tx.update(s.applications).set({ status: "archived", archiveReasonId: reasonId, archivedAt: now }).where(eq(s.applications.id, app.id));
      await tx.insert(s.applicationStageEvents).values({ applicationId: app.id, fromStageId: app.stageId, toStageId: app.stageId, status: "archived", movedById: user.id });
      await tx.insert(s.activities).values({
        candidateId: app.candidateId,
        applicationId: app.id,
        type: "archived",
        actorId: user.id,
        body: `Archived: ${reason.name}`,
        metadata: { reason: reason.name },
      });
    });
    if (sendEmail && emailSubject && emailBody && app.candidate.email) {
      const { renderTemplate } = await import("@/lib/templates");
      const vars = {
        candidate: { firstName: app.candidate.firstName, lastName: app.candidate.lastName },
        job: { title: app.job.title },
        brand: { name: app.job.brand.name },
        sender: { name: user.name },
      };
      await deliverEmail(user, app.candidateId, app.id, renderTemplate(emailSubject, vars), renderTemplate(emailBody, vars));
    }
  }
  await audit(user.id, "application.archived", "application", null, { applicationIds, reason: reason.name });
  refresh(apps[0]?.jobId, apps.length === 1 ? apps[0].candidateId : undefined);
}

export async function unarchiveApplication(applicationId: string) {
  const user = await requireRecruiter();
  const app = await db.query.applications.findFirst({ where: eq(s.applications.id, applicationId) });
  if (!app) throw new Error("Application not found");
  await db.update(s.applications).set({ status: "active", archiveReasonId: null, archivedAt: null, stageEnteredAt: new Date() }).where(eq(s.applications.id, app.id));
  await db.insert(s.applicationStageEvents).values({ applicationId: app.id, fromStageId: app.stageId, toStageId: app.stageId, status: "active", movedById: user.id });
  await db.insert(s.activities).values({ candidateId: app.candidateId, applicationId: app.id, type: "unarchived", actorId: user.id, body: "Unarchived application" });
  refresh(app.jobId, app.candidateId);
}

export async function addNote(candidateId: string, applicationId: string | null, body: string) {
  const user = await requireUser();
  const text = body.trim();
  if (!text) return;
  await db.insert(s.activities).values({ candidateId, applicationId, type: "note", actorId: user.id, body: text });

  // @mentions: "@First Last" → Teams notification
  const users = await db.query.users.findMany();
  const mentioned = users.filter((u) => text.includes(`@${u.name}`) && u.id !== user.id);
  const candidate = await db.query.candidates.findFirst({ where: eq(s.candidates.id, candidateId) });
  for (const u of mentioned) {
    await m365().teams.notify({
      toEmail: u.email,
      title: `${user.name} mentioned you on ${candidate?.firstName} ${candidate?.lastName}`,
      text: text.slice(0, 200),
      url: `/candidates/${candidateId}`,
    });
  }
  revalidatePath(`/candidates/${candidateId}`);
}

async function deliverEmail(
  user: Awaited<ReturnType<typeof requireUser>>,
  candidateId: string,
  applicationId: string | null,
  subject: string,
  body: string,
) {
  const candidate = await db.query.candidates.findFirst({ where: eq(s.candidates.id, candidateId) });
  if (!candidate?.email) throw new Error("Candidate has no email address");
  const sent = await m365().mail.send({ from: user.email, to: candidate.email, subject, body });
  await db.insert(s.emails).values({
    candidateId,
    direction: "outbound",
    fromAddress: user.email,
    toAddress: candidate.email,
    subject,
    body,
    sentById: user.id,
    externalMessageId: sent.messageId,
    externalThreadId: sent.threadId,
  });
  await db.insert(s.activities).values({ candidateId, applicationId, type: "email", actorId: user.id, body: `Emailed: ${subject}` });
}

export async function sendCandidateEmail(input: { candidateId: string; applicationId: string | null; subject: string; body: string }) {
  const user = await requireRecruiter();
  if (!input.subject.trim() || !input.body.trim()) throw new Error("Subject and body are required");
  await deliverEmail(user, input.candidateId, input.applicationId, input.subject.trim(), input.body);
  await audit(user.id, "email.sent", "candidate", input.candidateId, { subject: input.subject });
  revalidatePath(`/candidates/${input.candidateId}`);
}

export async function addCandidateToJob(candidateId: string, jobId: string) {
  const user = await requireRecruiter();
  const stages = await db.query.jobStages.findMany({ where: eq(s.jobStages.jobId, jobId), orderBy: (st, { asc }) => asc(st.position) });
  const first = stages.find((st) => st.type === "review") ?? stages[0];
  const source = await db.query.sources.findFirst({ where: eq(s.sources.name, "LinkedIn Recruiter") });
  const [app] = await db
    .insert(s.applications)
    .values({ candidateId, jobId, stageId: first.id, sourceId: source?.id, creditedToId: user.id })
    .onConflictDoNothing()
    .returning();
  if (!app) throw new Error("Candidate is already on this job");
  await db.insert(s.applicationStageEvents).values({ applicationId: app.id, toStageId: first.id, status: "active", movedById: user.id });
  const job = await db.query.jobs.findFirst({ where: eq(s.jobs.id, jobId) });
  await db.insert(s.activities).values({ candidateId, applicationId: app.id, type: "application_created", actorId: user.id, body: `Added to ${job?.title}` });
  refresh(jobId, candidateId);
}

export async function updateCandidateTags(candidateId: string, tags: string[]) {
  await requireRecruiter();
  const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  await db.update(s.candidates).set({ tags: clean, updatedAt: new Date() }).where(eq(s.candidates.id, candidateId));
  revalidatePath(`/candidates/${candidateId}`);
}
