import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { m365 } from "@/server/integrations/m365";
import { NotFoundError, requireUserActor, type Actor, type UserActor } from "@/server/policy";
import { recordAudit } from "./audit";
import { storeFile } from "./files";
import { markPoolMembersApplied } from "./talent-pools";

/**
 * Employee referrals (PRD §4.8). Any signed-in employee can refer someone to a public open role.
 * Referrers see a coarse status for the people they referred and nothing else (no feedback,
 * reasons or profile) — proposed rule, see ARCHITECTURE.md decision log (pending Kian).
 */

export const referralSchema = z.object({
  jobId: z.string().uuid(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(40).optional().transform((v) => v || null),
  linkedinUrl: z.string().trim().url().max(300).optional().or(z.literal("")).transform((v) => v || null),
  relationship: z.string().trim().max(200).optional().transform((v) => v || null),
  note: z.string().trim().min(10, "Tell the recruiter a little about why they'd be great").max(5000),
});

/** Public open roles anyone in the company can refer to (never confidential ones). */
export async function referableJobs() {
  return db
    .select({ id: s.jobs.id, title: s.jobs.title, brand: s.brands.name, location: s.locations.name })
    .from(s.jobs)
    .innerJoin(s.brands, eq(s.brands.id, s.jobs.brandId))
    .leftJoin(s.locations, eq(s.locations.id, s.jobs.locationId))
    .where(and(eq(s.jobs.status, "open"), eq(s.jobs.publishedOnCareerSite, true), eq(s.jobs.confidential, false)))
    .orderBy(asc(s.brands.name), asc(s.jobs.title));
}

export async function submitReferral(actor: Actor, d: z.output<typeof referralSchema>, resume: { name: string; bytes: Buffer; contentType: string } | null) {
  const user = requireUserActor(actor);
  const job = await db.query.jobs.findFirst({
    where: and(eq(s.jobs.id, d.jobId), eq(s.jobs.status, "open"), eq(s.jobs.publishedOnCareerSite, true), eq(s.jobs.confidential, false)),
    with: { stages: { orderBy: asc(s.jobStages.position) }, recruiter: true },
  });
  if (!job) throw new NotFoundError("Job");
  const source = await db.query.sources.findFirst({ where: eq(s.sources.name, "Employee Referral") });
  const review = job.stages.find((st) => st.type === "review") ?? job.stages[0];

  const result = await db.transaction(async (tx) => {
    const existing = await tx.query.candidates.findFirst({ where: and(sql`lower(${s.candidates.email}) = ${d.email}`, isNull(s.candidates.anonymizedAt)) });
    let candidateId = existing?.id;
    if (!candidateId) {
      const [c] = await tx
        .insert(s.candidates)
        .values({ firstName: d.firstName, lastName: d.lastName, email: d.email, phone: d.phone, linkedinUrl: d.linkedinUrl })
        .returning();
      candidateId = c.id;
      await recordAudit(tx, actor, "candidate.created", "candidate", c.id, { via: "referral" });
    }
    let app = await tx.query.applications.findFirst({ where: and(eq(s.applications.candidateId, candidateId), eq(s.applications.jobId, job.id)) });
    const isNew = !app;
    if (!app) {
      [app] = await tx
        .insert(s.applications)
        .values({ candidateId, jobId: job.id, stageId: review.id, sourceId: source?.id ?? null, referrerId: user.id, creditedToId: user.id })
        .returning();
      await tx.insert(s.applicationStageEvents).values({ applicationId: app.id, toStageId: review.id, status: "active", movedById: user.id });
      await recordAudit(tx, actor, "application.created", "application", app.id, { candidateId, jobId: job.id, via: "referral" });
      await markPoolMembersApplied(tx, candidateId);
    }
    const [ref] = await tx
      .insert(s.referrals)
      .values({ referrerId: user.id, applicationId: app.id, jobId: job.id, relationship: d.relationship, note: d.note })
      .onConflictDoNothing()
      .returning();
    if (!ref) return { candidateId, applicationId: app.id, isNew: false, alreadyReferred: true };
    await tx.insert(s.activities).values({
      candidateId,
      applicationId: app.id,
      type: isNew ? "application_created" : "note",
      actorId: user.id,
      body: `${isNew ? "Referred" : "Also referred"} by ${user.name}${d.relationship ? ` (${d.relationship})` : ""}: ${d.note}`,
      metadata: { referralId: ref.id },
    });
    await recordAudit(tx, actor, "referral.created", "referral", ref.id, { applicationId: app.id, jobId: job.id, newApplication: isNew });
    return { candidateId, applicationId: app.id, isNew, alreadyReferred: false };
  });

  if (resume && result.isNew) {
    const file = await storeFile(db, actor, { kind: "resume", fileName: resume.name.slice(0, 120), contentType: resume.contentType, bytes: resume.bytes, candidateId: result.candidateId, applicationId: result.applicationId, jobId: job.id });
    await db.update(s.candidates).set({ resumeFileId: file.id, resumeFileName: file.fileName }).where(and(eq(s.candidates.id, result.candidateId), isNull(s.candidates.resumeFileId)));
  }
  if (job.recruiter && !result.alreadyReferred) {
    await m365().teams.notify({ toEmail: job.recruiter.email, title: `New referral: ${job.title}`, text: `${user.name} referred someone.`, url: `/jobs/${job.id}` });
  }
  return { alreadyReferred: result.alreadyReferred };
}

export type ReferralStatus = "submitted" | "interviewing" | "offer" | "hired" | "closed";

/** The actor's referrals with a coarse status only. */
export async function myReferrals(actor: UserActor) {
  const rows = await db
    .select({
      id: s.referrals.id,
      createdAt: s.referrals.createdAt,
      firstName: s.candidates.firstName,
      lastName: s.candidates.lastName,
      jobTitle: s.jobs.title,
      brand: s.brands.name,
      appStatus: s.applications.status,
      stageType: s.jobStages.type,
    })
    .from(s.referrals)
    .innerJoin(s.applications, eq(s.applications.id, s.referrals.applicationId))
    .innerJoin(s.candidates, eq(s.candidates.id, s.applications.candidateId))
    .innerJoin(s.jobs, eq(s.jobs.id, s.referrals.jobId))
    .innerJoin(s.brands, eq(s.brands.id, s.jobs.brandId))
    .innerJoin(s.jobStages, eq(s.jobStages.id, s.applications.stageId))
    .where(eq(s.referrals.referrerId, actor.id))
    .orderBy(desc(s.referrals.createdAt));
  return rows.map(({ appStatus, stageType, ...r }) => {
    const status: ReferralStatus =
      appStatus === "hired" ? "hired" : appStatus === "archived" ? "closed" : stageType === "offer" ? "offer" : stageType === "screen" || stageType === "interview" ? "interviewing" : "submitted";
    return { ...r, status };
  });
}
