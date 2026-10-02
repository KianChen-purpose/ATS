import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { actorUserId, canAdministerPrivacy, ForbiddenError, NotFoundError, type Actor } from "@/server/policy";
import { recordAudit } from "./audit";

/**
 * Privacy & compliance services (ARCHITECTURE.md §5): consent, data subject requests and
 * anonymization. Deleting a candidate always means anonymizing: ids, stage history, audit rows
 * and aggregate facts (stages, dates, ratings, offer amounts) stay; personal data goes.
 */

export const DSR_SLA_DAYS = 30; // PIPEDA and Quebec Law 25

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export const consentSchema = z.object({
  candidateId: z.string().uuid(),
  purpose: z.enum(s.consentPurpose.enumValues),
  granted: z.boolean(),
  policyVersion: z.string().min(1).max(50),
  locale: z.enum(s.locale.enumValues).default("en"),
  source: z.enum(s.consentSource.enumValues),
  expiresAt: z.date().nullable().default(null),
});

/** Record a grant or withdrawal. Consent rows are append-only; the newest row per purpose wins. */
export async function recordConsent(actor: Actor, d: z.output<typeof consentSchema>) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.consentRecords)
      .values({ ...d, recordedById: actorUserId(actor) })
      .returning();
    await recordAudit(tx, actor, d.granted ? "consent.granted" : "consent.withdrawn", "consent_record", row.id, {
      candidateId: d.candidateId,
      purpose: d.purpose,
      policyVersion: d.policyVersion,
    });
    return row;
  });
}

/** Current consent per purpose: the latest record, if it is a grant and hasn't expired. */
export async function currentConsents(candidateId: string, now = new Date()) {
  const rows = await db.query.consentRecords.findMany({
    where: eq(s.consentRecords.candidateId, candidateId),
    orderBy: desc(s.consentRecords.createdAt),
  });
  const out: Partial<Record<(typeof s.consentPurpose.enumValues)[number], boolean>> = {};
  for (const r of rows) {
    if (r.purpose in out) continue;
    out[r.purpose] = r.granted && (!r.expiresAt || r.expiresAt > now);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Data subject requests
// ---------------------------------------------------------------------------

export const dsrSchema = z.object({
  requesterEmail: z.string().email(),
  type: z.enum(s.dsrType.enumValues),
  candidateId: z.string().uuid().nullable().default(null),
  notes: z.string().max(5000).optional(),
});

export async function createDataSubjectRequest(actor: Actor, d: z.output<typeof dsrSchema>) {
  if (!canAdministerPrivacy(actor)) throw new ForbiddenError();
  const receivedAt = new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.dataSubjectRequests)
      .values({ ...d, receivedAt, dueAt: new Date(receivedAt.getTime() + DSR_SLA_DAYS * 86_400_000), handledById: actorUserId(actor) })
      .returning();
    await recordAudit(tx, actor, "dsr.created", "data_subject_request", row.id, { type: d.type, candidateId: d.candidateId });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Anonymization
// ---------------------------------------------------------------------------

const REDACTED = "[redacted]";

export type AnonymizeReason = "deletion_request" | "retention";

/**
 * Wipe a candidate's personal data in place.
 * - "retention" (worker job) refuses candidates with an active application.
 * - "deletion_request" archives any active applications first (one stage event each).
 */
export async function anonymizeCandidate(actor: Actor, candidateId: string, opts: { reason: AnonymizeReason; dsrId?: string }) {
  if (!canAdministerPrivacy(actor)) throw new ForbiddenError();
  const candidate = await db.query.candidates.findFirst({ where: eq(s.candidates.id, candidateId), with: { applications: true } });
  if (!candidate) throw new NotFoundError("Candidate");
  if (candidate.anonymizedAt) return { alreadyAnonymized: true as const };

  const active = candidate.applications.filter((a) => a.status === "active");
  if (active.length && opts.reason === "retention") throw new Error("Candidate has an active application; retention can't anonymize them.");
  const appIds = candidate.applications.map((a) => a.id);
  const now = new Date();

  await db.transaction(async (tx) => {
    for (const app of active) {
      await tx.update(s.applications).set({ status: "archived", archivedAt: now }).where(eq(s.applications.id, app.id));
      await tx.insert(s.applicationStageEvents).values({ applicationId: app.id, fromStageId: app.stageId, toStageId: app.stageId, status: "archived", movedById: actorUserId(actor) });
      await recordAudit(tx, actor, "application.archived", "application", app.id, { reason: "candidate_anonymized" });
    }

    await tx
      .update(s.candidates)
      .set({
        firstName: "Anonymized",
        lastName: "Candidate",
        email: null,
        phone: null,
        location: null,
        currentTitle: null,
        currentCompany: null,
        linkedinUrl: null,
        websiteUrl: null,
        tags: [],
        resumeText: null,
        resumeFileName: null,
        timezone: null,
        anonymizedAt: now,
        updatedAt: now,
      })
      .where(eq(s.candidates.id, candidateId));

    // Free text that can describe the person. Structure (types, dates, stages, ratings, amounts) stays.
    await tx
      .update(s.emails)
      .set({ subject: REDACTED, body: REDACTED, fromAddress: REDACTED, toAddress: REDACTED })
      .where(eq(s.emails.candidateId, candidateId));
    await tx
      .update(s.activities)
      .set({ body: null })
      .where(and(eq(s.activities.candidateId, candidateId), inArray(s.activities.type, ["note", "email"])));
    if (appIds.length) {
      await tx.update(s.scorecards).set({ notes: null }).where(inArray(s.scorecards.applicationId, appIds));
      await tx.update(s.offers).set({ notes: null }).where(inArray(s.offers.applicationId, appIds));
      // Interview titles are "Stage – Candidate Name": keep the stage.
      await tx
        .update(s.interviews)
        .set({ title: sql`split_part(${s.interviews.title}, ' – ', 1)` })
        .where(inArray(s.interviews.applicationId, appIds));
    }
    if (opts.dsrId) {
      await tx
        .update(s.dataSubjectRequests)
        .set({ status: "completed", completedAt: now, candidateId })
        .where(eq(s.dataSubjectRequests.id, opts.dsrId));
    }
    await recordAudit(tx, actor, "candidate.anonymized", "candidate", candidateId, { reason: opts.reason, dsrId: opts.dsrId ?? null, archivedApplications: active.length });
  });
  return { alreadyAnonymized: false as const };
}
