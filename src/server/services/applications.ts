import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { renderTemplate } from "@/lib/templates";
import { m365 } from "@/server/integrations/m365";
import { assertCanSeeJobs, NotFoundError, requireRecruiting, requireUserActor, type Actor, type UserActor } from "@/server/policy";
import type { Tx } from "./tx";
import { recordAudit } from "./audit";
import { assertCanSeeCandidate } from "./candidates";
import { sendAndLogEmail } from "./email";

/**
 * Loads applications by id and checks the actor can see every one of their jobs.
 * All-or-nothing: if any id is missing or not visible, the whole call fails (ARCHITECTURE.md §3.2).
 */
async function loadVisibleApplications(actor: Actor, applicationIds: string[]) {
  const ids = [...new Set(applicationIds)];
  if (ids.length === 0) throw new Error("Pick at least one application");
  const apps = await db.query.applications.findMany({
    where: inArray(s.applications.id, ids),
    with: { stage: true, candidate: true, job: { with: { brand: true } } },
  });
  if (apps.length !== ids.length) throw new NotFoundError("Application");
  await assertCanSeeJobs(actor, apps.map((a) => a.jobId));
  return apps;
}

// ---------------------------------------------------------------------------

/**
 * Move one application to a stage inside the caller's transaction: exactly one stage event,
 * a timeline entry and an audit row. Moving to a "hired" stage marks it hired. No-op if nothing changes.
 * Internal: callers authorize first.
 */
export async function applyStageMove(
  tx: Tx,
  actor: UserActor,
  app: { id: string; candidateId: string; stageId: string; status: string; stage: { name: string } },
  stage: { id: string; name: string; type: string },
  now = new Date(),
) {
  const status = stage.type === "hired" ? "hired" : "active";
  if (app.stageId === stage.id && app.status === status) return false;
  await tx
    .update(s.applications)
    .set({ stageId: stage.id, status, stageEnteredAt: now, archivedAt: null, archiveReasonId: null, hiredAt: status === "hired" ? now : null })
    .where(eq(s.applications.id, app.id));
  await tx.insert(s.applicationStageEvents).values({ applicationId: app.id, fromStageId: app.stageId, toStageId: stage.id, status, movedById: actor.id });
  await tx.insert(s.activities).values({
    candidateId: app.candidateId,
    applicationId: app.id,
    type: status === "hired" ? "hired" : "stage_change",
    actorId: actor.id,
    body: status === "hired" ? "Marked as hired 🎉" : `Moved from ${app.stage.name} to ${stage.name}`,
    metadata: { fromStage: app.stage.name, toStage: stage.name },
  });
  await tx.update(s.candidates).set({ updatedAt: now }).where(eq(s.candidates.id, app.candidateId));
  await recordAudit(tx, actor, status === "hired" ? "application.hired" : "application.stage_changed", "application", app.id, {
    fromStageId: app.stageId,
    toStageId: stage.id,
  });
  return true;
}

export const moveToStageSchema = z.object({
  applicationIds: z.array(z.string().uuid()).min(1).max(500),
  stageId: z.string().uuid(),
});

/** Move applications to a stage. Moving to a "hired" stage marks them hired. Returns jobId + candidate ids. */
export async function moveToStage(actor: Actor, d: z.output<typeof moveToStageSchema>) {
  const user = requireRecruiting(actor);
  const stage = await db.query.jobStages.findFirst({ where: eq(s.jobStages.id, d.stageId) });
  if (!stage) throw new NotFoundError("Stage");
  const apps = await loadVisibleApplications(actor, d.applicationIds);
  if (apps.some((a) => a.jobId !== stage.jobId)) throw new Error("All applications must be on the stage's job.");

  const now = new Date();
  await db.transaction(async (tx) => {
    for (const app of apps) await applyStageMove(tx, user, app, stage, now);
  });
  return { jobId: stage.jobId, candidateIds: apps.map((a) => a.candidateId) };
}

// ---------------------------------------------------------------------------

export const archiveSchema = z.object({
  applicationIds: z.array(z.string().uuid()).min(1).max(500),
  reasonId: z.string().uuid(),
  sendEmail: z.boolean().default(false),
  emailSubject: z.string().optional(),
  emailBody: z.string().optional(),
});

export async function archiveApplications(actor: Actor, d: z.output<typeof archiveSchema>) {
  const user = requireRecruiting(actor);
  const reason = await db.query.archiveReasons.findFirst({ where: eq(s.archiveReasons.id, d.reasonId) });
  if (!reason) throw new NotFoundError("Archive reason");
  const apps = await loadVisibleApplications(actor, d.applicationIds);
  const now = new Date();

  await db.transaction(async (tx) => {
    for (const app of apps) {
      await tx.update(s.applications).set({ status: "archived", archiveReasonId: reason.id, archivedAt: now }).where(eq(s.applications.id, app.id));
      await tx.insert(s.applicationStageEvents).values({ applicationId: app.id, fromStageId: app.stageId, toStageId: app.stageId, status: "archived", movedById: user.id });
      await tx.insert(s.activities).values({
        candidateId: app.candidateId,
        applicationId: app.id,
        type: "archived",
        actorId: user.id,
        body: `Archived: ${reason.name}`,
        metadata: { reason: reason.name },
      });
      await recordAudit(tx, actor, "application.archived", "application", app.id, { reason: reason.name });
    }
  });

  // Emails go out after the archive commits; a failed send doesn't undo the archive.
  if (d.sendEmail && d.emailSubject && d.emailBody) {
    for (const app of apps) {
      if (!app.candidate.email) continue;
      const vars = {
        candidate: { firstName: app.candidate.firstName, lastName: app.candidate.lastName },
        job: { title: app.job.title },
        brand: { name: app.job.brand.name },
        sender: { name: user.name },
      };
      await sendAndLogEmail(actor, {
        candidateId: app.candidateId,
        applicationId: app.id,
        from: user.email,
        to: app.candidate.email,
        subject: renderTemplate(d.emailSubject, vars),
        body: renderTemplate(d.emailBody, vars),
      });
    }
  }
  return { jobId: apps[0].jobId, candidateIds: apps.map((a) => a.candidateId) };
}

export async function unarchiveApplication(actor: Actor, applicationId: string) {
  const user = requireRecruiting(actor);
  const [app] = await loadVisibleApplications(actor, [applicationId]);
  await db.transaction(async (tx) => {
    await tx.update(s.applications).set({ status: "active", archiveReasonId: null, archivedAt: null, stageEnteredAt: new Date() }).where(eq(s.applications.id, app.id));
    await tx.insert(s.applicationStageEvents).values({ applicationId: app.id, fromStageId: app.stageId, toStageId: app.stageId, status: "active", movedById: user.id });
    await tx.insert(s.activities).values({ candidateId: app.candidateId, applicationId: app.id, type: "unarchived", actorId: user.id, body: "Unarchived application" });
    await recordAudit(tx, actor, "application.unarchived", "application", app.id);
  });
  return { jobId: app.jobId, candidateId: app.candidateId };
}

// ---------------------------------------------------------------------------

export const noteSchema = z.object({
  candidateId: z.string().uuid(),
  applicationId: z.string().uuid().nullable(),
  body: z.string().trim().min(1).max(20_000),
});

export async function addNote(actor: Actor, d: z.output<typeof noteSchema>) {
  const user = requireUserActor(actor);
  if (d.applicationId) {
    const [app] = await loadVisibleApplications(actor, [d.applicationId]);
    if (app.candidateId !== d.candidateId) throw new NotFoundError("Application");
  } else {
    await assertCanSeeCandidate(user, d.candidateId);
  }

  const note = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.activities)
      .values({ candidateId: d.candidateId, applicationId: d.applicationId, type: "note", actorId: user.id, body: d.body })
      .returning({ id: s.activities.id });
    await recordAudit(tx, actor, "note.created", "activity", row.id, { candidateId: d.candidateId, applicationId: d.applicationId });
    return row;
  });

  // @mentions: "@First Last" → Teams notification
  const users = await db.query.users.findMany({ where: eq(s.users.active, true) });
  const mentioned = users.filter((u) => d.body.includes(`@${u.name}`) && u.id !== user.id);
  if (mentioned.length) {
    const candidate = await db.query.candidates.findFirst({ where: eq(s.candidates.id, d.candidateId) });
    for (const u of mentioned) {
      await m365().teams.notify({
        toEmail: u.email,
        title: `${user.name} mentioned you on ${candidate?.firstName} ${candidate?.lastName}`,
        text: d.body.slice(0, 200),
        url: `/candidates/${d.candidateId}`,
      });
    }
  }
  return note;
}

// ---------------------------------------------------------------------------

export const candidateEmailSchema = z.object({
  candidateId: z.string().uuid(),
  applicationId: z.string().uuid().nullable(),
  subject: z.string().trim().min(1, "Subject is required").max(300),
  body: z.string().trim().min(1, "Body is required").max(50_000),
});

export async function sendCandidateEmail(actor: Actor, d: z.output<typeof candidateEmailSchema>) {
  const user = requireRecruiting(actor);
  if (d.applicationId) {
    const [app] = await loadVisibleApplications(actor, [d.applicationId]);
    if (app.candidateId !== d.candidateId) throw new NotFoundError("Application");
  } else {
    await assertCanSeeCandidate(user, d.candidateId);
  }
  const candidate = await db.query.candidates.findFirst({ where: eq(s.candidates.id, d.candidateId) });
  if (!candidate?.email) throw new Error("Candidate has no email address");
  await sendAndLogEmail(actor, { candidateId: d.candidateId, applicationId: d.applicationId, from: user.email, to: candidate.email, subject: d.subject, body: d.body });
}

// ---------------------------------------------------------------------------

export const addToJobSchema = z.object({ candidateId: z.string().uuid(), jobId: z.string().uuid() });

export async function addCandidateToJob(actor: Actor, d: z.output<typeof addToJobSchema>) {
  const user = requireRecruiting(actor);
  await assertCanSeeJobs(actor, [d.jobId]);
  await assertCanSeeCandidate(user, d.candidateId);
  const [stages, source, job] = await Promise.all([
    db.query.jobStages.findMany({ where: eq(s.jobStages.jobId, d.jobId), orderBy: asc(s.jobStages.position) }),
    db.query.sources.findFirst({ where: eq(s.sources.name, "LinkedIn Recruiter") }),
    db.query.jobs.findFirst({ where: eq(s.jobs.id, d.jobId) }),
  ]);
  const first = stages.find((st) => st.type === "review") ?? stages[0];
  await db.transaction(async (tx) => {
    const [app] = await tx
      .insert(s.applications)
      .values({ candidateId: d.candidateId, jobId: d.jobId, stageId: first.id, sourceId: source?.id, creditedToId: user.id })
      .onConflictDoNothing()
      .returning();
    if (!app) throw new Error("Candidate is already on this job");
    await tx.insert(s.applicationStageEvents).values({ applicationId: app.id, toStageId: first.id, status: "active", movedById: user.id });
    await tx.insert(s.activities).values({ candidateId: d.candidateId, applicationId: app.id, type: "application_created", actorId: user.id, body: `Added to ${job?.title}` });
    await recordAudit(tx, actor, "application.created", "application", app.id, { candidateId: d.candidateId, jobId: d.jobId });
  });
}
