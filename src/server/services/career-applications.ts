import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { m365 } from "@/server/integrations/m365";
import { systemActor } from "@/server/policy";
import { recordAudit } from "./audit";
import { sendAndLogEmail } from "./email";
import { storeFile } from "./files";

/**
 * Public applications from the career site (PRD §4.7). No staff session: the system actor
 * "career_site" writes everything, and consent is captured on every application (§5.2).
 */

export const CONSENT_POLICY_VERSION = "2026-10";
const RESUME_MAX_BYTES = 5 * 1024 * 1024;
const RESUME_TYPES = {
  pdf: { contentType: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  docx: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: [0x50, 0x4b, 0x03, 0x04] }, // PK zip
} as const;

export const applySchema = z.object({
  jobId: z.string().uuid(),
  locale: z.enum(["en", "fr-CA"]),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(40).optional().transform((v) => v || null),
  location: z.string().trim().max(120).optional().transform((v) => v || null),
  linkedinUrl: z.string().trim().url().max(300).optional().or(z.literal("")).transform((v) => v || null),
  answers: z.record(z.string().uuid(), z.string().trim().max(5000)),
  consentProcessing: z.literal(true, { message: "consent_required" }),
  consentTalentPool: z.boolean(),
});

export type ApplyResult = { ok: true } | { ok: false; error: "job_closed" | "invalid" | "resume" | "answers"; field?: string };

function resumeKind(file: { name: string; bytes: Buffer }) {
  const ext = file.name.toLowerCase().split(".").pop();
  const t = ext === "pdf" ? RESUME_TYPES.pdf : ext === "docx" ? RESUME_TYPES.docx : null;
  if (!t || file.bytes.length === 0 || file.bytes.length > RESUME_MAX_BYTES) return null;
  // Trust the bytes, not the name or the browser's content type.
  return t.magic.every((b, i) => file.bytes[i] === b) ? t : null;
}

const confirmation = (locale: "en" | "fr-CA", v: { firstName: string; jobTitle: string; brand: string }) =>
  locale === "fr-CA"
    ? {
        subject: `Nous avons bien reçu votre candidature – ${v.jobTitle}`,
        body: `Bonjour ${v.firstName},\n\nMerci d'avoir postulé au poste de ${v.jobTitle} chez ${v.brand}. Notre équipe examinera votre candidature et communiquera avec vous si votre profil correspond au poste.\n\nL'équipe Talents de ${v.brand}`,
      }
    : {
        subject: `We received your application – ${v.jobTitle}`,
        body: `Hi ${v.firstName},\n\nThanks for applying for the ${v.jobTitle} role at ${v.brand}. Our team will review your application and get in touch if there's a match.\n\nThe ${v.brand} Talent Team`,
      };

/**
 * Submit an application. Re-applying to the same job reports success without creating
 * anything, so the form can't be used to find out who has applied.
 */
export async function submitApplication(d: z.output<typeof applySchema>, resume: { name: string; bytes: Buffer } | null): Promise<ApplyResult> {
  const actor = systemActor("career_site");
  const job = await db.query.jobs.findFirst({
    where: and(eq(s.jobs.id, d.jobId), eq(s.jobs.status, "open"), eq(s.jobs.publishedOnCareerSite, true), eq(s.jobs.confidential, false)),
    with: { brand: true, stages: { orderBy: asc(s.jobStages.position) }, recruiter: true },
  });
  if (!job) return { ok: false, error: "job_closed" };

  const questions = await db.query.applicationQuestions.findMany({
    where: and(eq(s.applicationQuestions.jobId, job.id), eq(s.applicationQuestions.active, true)),
    orderBy: asc(s.applicationQuestions.position),
  });
  for (const q of questions) {
    const a = d.answers[q.id];
    if (q.required && !a) return { ok: false, error: "answers", field: q.id };
    if (a && q.kind === "yes_no" && !["yes", "no"].includes(a)) return { ok: false, error: "answers", field: q.id };
    if (a && q.kind === "single_select" && !q.options.some((o) => o.value === a)) return { ok: false, error: "answers", field: q.id };
  }
  const resumeType = resume ? resumeKind(resume) : null;
  if (resume && !resumeType) return { ok: false, error: "resume" };

  const knockedOut = questions.filter((q) => q.passAnswers && !q.passAnswers.includes(d.answers[q.id] ?? ""));
  const review = job.stages.find((st) => st.type === "review") ?? job.stages[0];
  const [source, knockoutReason] = await Promise.all([
    db.query.sources.findFirst({ where: eq(s.sources.name, "Career Site") }),
    db.query.archiveReasons.findFirst({ where: eq(s.archiveReasons.name, "Knockout question") }),
  ]);

  const outcome = await db.transaction(async (tx) => {
    // Same person = same email (case-insensitive), unless that record was anonymized.
    const existing = await tx.query.candidates.findFirst({
      where: and(sql`lower(${s.candidates.email}) = ${d.email}`, isNull(s.candidates.anonymizedAt)),
    });
    let candidateId: string;
    if (existing) {
      candidateId = existing.id;
      const dup = await tx.query.applications.findFirst({ where: and(eq(s.applications.candidateId, existing.id), eq(s.applications.jobId, job.id)) });
      if (dup) return { duplicate: true as const, candidateId };
      // Fill gaps only; never overwrite what recruiters already have.
      await tx
        .update(s.candidates)
        .set({
          phone: existing.phone ?? d.phone,
          location: existing.location ?? d.location,
          linkedinUrl: existing.linkedinUrl ?? d.linkedinUrl,
          preferredLocale: d.locale,
          updatedAt: new Date(),
        })
        .where(eq(s.candidates.id, existing.id));
    } else {
      const [c] = await tx
        .insert(s.candidates)
        .values({ firstName: d.firstName, lastName: d.lastName, email: d.email, phone: d.phone, location: d.location, linkedinUrl: d.linkedinUrl, preferredLocale: d.locale })
        .returning();
      candidateId = c.id;
      await recordAudit(tx, actor, "candidate.created", "candidate", c.id, { via: "career_site" });
    }

    // Consent is evidence (append-only): one row per purpose the candidate answered.
    await tx.insert(s.consentRecords).values([
      { candidateId, purpose: "application_processing", granted: true, policyVersion: CONSENT_POLICY_VERSION, locale: d.locale, source: "career_site" },
      ...(d.consentTalentPool
        ? [{ candidateId, purpose: "talent_pool" as const, granted: true, policyVersion: CONSENT_POLICY_VERSION, locale: d.locale, source: "career_site" as const, expiresAt: new Date(Date.now() + 2 * 365 * 86_400_000) }]
        : []),
    ]);

    const [app] = await tx
      .insert(s.applications)
      .values({ candidateId, jobId: job.id, stageId: review.id, sourceId: source?.id ?? null })
      .returning();
    await tx.insert(s.applicationStageEvents).values({ applicationId: app.id, toStageId: review.id, status: "active" });
    await tx.insert(s.activities).values({ candidateId, applicationId: app.id, type: "application_created", body: "Applied on the career site", metadata: { locale: d.locale } });
    await recordAudit(tx, actor, "application.created", "application", app.id, { candidateId, jobId: job.id, via: "career_site" });

    if (questions.length) {
      await tx.insert(s.applicationAnswers).values(
        questions.filter((q) => d.answers[q.id]).map((q) => ({ applicationId: app.id, questionId: q.id, value: d.answers[q.id], knockedOut: knockedOut.includes(q) })),
      );
    }

    if (knockedOut.length) {
      await tx.update(s.applications).set({ status: "archived", archivedAt: new Date(), archiveReasonId: knockoutReason?.id ?? null }).where(eq(s.applications.id, app.id));
      await tx.insert(s.applicationStageEvents).values({ applicationId: app.id, fromStageId: review.id, toStageId: review.id, status: "archived" });
      await tx.insert(s.activities).values({ candidateId, applicationId: app.id, type: "archived", body: "Archived: Knockout question", metadata: { questionIds: knockedOut.map((q) => q.id) } });
      await recordAudit(tx, actor, "application.archived", "application", app.id, { reason: "knockout" });
    }
    return { duplicate: false as const, candidateId, applicationId: app.id };
  });

  if (outcome.duplicate) return { ok: true };

  if (resume && resumeType) {
    const file = await storeFile(db, actor, {
      kind: "resume",
      fileName: resume.name.replace(/[\\/:*?"<>|]/g, "").slice(0, 120),
      contentType: resumeType.contentType,
      bytes: resume.bytes,
      candidateId: outcome.candidateId,
      applicationId: outcome.applicationId,
      jobId: job.id,
    });
    await db.update(s.candidates).set({ resumeFileId: file.id, resumeFileName: file.fileName }).where(eq(s.candidates.id, outcome.candidateId));
  }

  const mail = confirmation(d.locale, { firstName: d.firstName, jobTitle: job.title, brand: job.brand.name });
  await sendAndLogEmail(actor, {
    candidateId: outcome.candidateId,
    applicationId: outcome.applicationId,
    from: process.env.M365_SENDER_MAILBOX ?? "careers@purpose.demo",
    to: d.email,
    subject: mail.subject,
    body: mail.body,
    auditAction: "email.sent",
  });
  if (job.recruiter) {
    await m365().teams.notify({ toEmail: job.recruiter.email, title: `New application: ${job.title}`, text: "A candidate applied on the career site.", url: `/jobs/${job.id}` });
  }
  return { ok: true };
}
