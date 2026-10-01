import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { systemActor, userActor } from "@/server/policy";
import * as apps from "@/server/services/applications";
import * as privacy from "@/server/services/privacy";
import { makeApplication, makeCandidate, makeJob, makeUser, resetDb } from "./fixtures";

async function world() {
  const admin = userActor(await makeUser("admin"));
  const rec = userActor(await makeUser("recruiter"));
  const job = await makeJob({ recruiterId: rec.id });
  const cand = await makeCandidate({
    firstName: "Rosalind",
    lastName: "Franklin",
    email: "rosalind@example.org",
    phone: "416-555-0100",
    linkedinUrl: "https://linkedin.com/in/rf",
    resumeText: "Rosalind Franklin, X-ray crystallography",
    tags: ["science"],
  });
  const app = await makeApplication(cand.id, job);
  return { admin, rec, job, cand, app };
}

describe("anonymizeCandidate", () => {
  beforeEach(resetDb);

  it("wipes personal data everywhere but keeps ids, history and aggregate facts", async () => {
    const { admin, rec, job, cand, app } = await world();
    await apps.moveToStage(rec, { applicationIds: [app.id], stageId: job.stages[3].id });
    await apps.addNote(rec, { candidateId: cand.id, applicationId: app.id, body: "Rosalind mentioned her family situation" });
    await apps.sendCandidateEmail(rec, { candidateId: cand.id, applicationId: app.id, subject: "Hi Rosalind", body: "Dear Rosalind" });
    const [iv] = await db.insert(s.interviews).values({ applicationId: app.id, title: "Onsite – Rosalind Franklin", startAt: new Date(), endAt: new Date() }).returning();
    await db.insert(s.scorecards).values({ applicationId: app.id, interviewId: iv.id, authorId: rec.id, overall: "strong_yes", ratings: { craft: 4 }, notes: "Rosalind was brilliant" });
    const eventsBefore = await db.query.applicationStageEvents.findMany({ where: eq(s.applicationStageEvents.applicationId, app.id) });

    await privacy.anonymizeCandidate(admin, cand.id, { reason: "deletion_request" });

    const after = await db.query.candidates.findFirst({ where: eq(s.candidates.id, cand.id) });
    expect(after).toMatchObject({ firstName: "Anonymized", lastName: "Candidate", email: null, phone: null, linkedinUrl: null, resumeText: null, tags: [] });
    expect(after?.anonymizedAt).toBeInstanceOf(Date);

    // No trace of the person's name or address anywhere in their records
    const related = JSON.stringify({
      emails: await db.query.emails.findMany({ where: eq(s.emails.candidateId, cand.id) }),
      activities: await db.query.activities.findMany({ where: eq(s.activities.candidateId, cand.id) }),
      interviews: await db.query.interviews.findMany({ where: eq(s.interviews.applicationId, app.id) }),
      scorecards: await db.query.scorecards.findMany({ where: eq(s.scorecards.applicationId, app.id) }),
      candidate: after,
    });
    expect(related).not.toMatch(/Rosalind|Franklin|rosalind@|416-555/);

    // History and facts survive: stage events (+1 for archiving the active application), ratings, stage name
    const eventsAfter = await db.query.applicationStageEvents.findMany({ where: eq(s.applicationStageEvents.applicationId, app.id) });
    expect(eventsAfter).toHaveLength(eventsBefore.length + 1);
    expect(eventsAfter.at(-1)?.status).toBe("archived");
    const [card] = await db.query.scorecards.findMany({ where: eq(s.scorecards.applicationId, app.id) });
    expect(card).toMatchObject({ overall: "strong_yes", ratings: { craft: 4 }, notes: null });
    expect((await db.query.interviews.findFirst({ where: eq(s.interviews.id, iv.id) }))?.title).toBe("Onsite");

    const audit = await db.query.auditLogs.findMany({ where: eq(s.auditLogs.entityId, cand.id) });
    expect(audit.map((a) => a.action)).toContain("candidate.anonymized");
  });

  it("candidates and applications can't be hard-deleted", async () => {
    const { cand, app, rec, job } = await world();
    await apps.moveToStage(rec, { applicationIds: [app.id], stageId: job.stages[1].id });
    await expect(db.delete(s.applications).where(eq(s.applications.id, app.id))).rejects.toThrow();
    await expect(db.delete(s.candidates).where(eq(s.candidates.id, cand.id))).rejects.toThrow();
  });

  it("only admins and the worker may anonymize; retention skips active applications", async () => {
    const { rec, cand } = await world();
    await expect(privacy.anonymizeCandidate(rec, cand.id, { reason: "deletion_request" })).rejects.toThrow(/permission/);
    await expect(privacy.anonymizeCandidate(systemActor("self_scheduling"), cand.id, { reason: "retention" })).rejects.toThrow(/permission/);
    await expect(privacy.anonymizeCandidate(systemActor("worker"), cand.id, { reason: "retention" })).rejects.toThrow(/active application/);
  });

  it("completes a linked deletion request and is idempotent", async () => {
    const { admin, cand } = await world();
    const dsr = await privacy.createDataSubjectRequest(admin, { requesterEmail: "rosalind@example.org", type: "deletion", candidateId: cand.id });
    expect(dsr.dueAt.getTime() - dsr.receivedAt.getTime()).toBe(privacy.DSR_SLA_DAYS * 86_400_000);
    await privacy.anonymizeCandidate(admin, cand.id, { reason: "deletion_request", dsrId: dsr.id });
    const done = await db.query.dataSubjectRequests.findFirst({ where: eq(s.dataSubjectRequests.id, dsr.id) });
    expect(done?.status).toBe("completed");
    expect(await privacy.anonymizeCandidate(admin, cand.id, { reason: "deletion_request" })).toEqual({ alreadyAnonymized: true });
  });
});

describe("consent", () => {
  beforeEach(resetDb);

  it("latest record per purpose wins; expiry and withdrawal are respected; rows are append-only", async () => {
    const { rec, cand } = await world();
    const base = { candidateId: cand.id, policyVersion: "2026-10", locale: "fr-CA" as const, source: "career_site" as const, expiresAt: null };
    await privacy.recordConsent(rec, { ...base, purpose: "application_processing", granted: true });
    await privacy.recordConsent(rec, { ...base, purpose: "talent_pool", granted: true, expiresAt: new Date(Date.now() - 1000) });
    await privacy.recordConsent(rec, { ...base, purpose: "marketing", granted: true });
    await privacy.recordConsent(rec, { ...base, purpose: "marketing", granted: false });
    expect(await privacy.currentConsents(cand.id)).toEqual({ application_processing: true, talent_pool: false, marketing: false });

    const err = await db.update(s.consentRecords).set({ granted: true }).then(() => null, (e: Error & { cause?: Error }) => e);
    expect(String(err?.cause?.message)).toMatch(/append-only/);
    expect((await db.query.auditLogs.findMany()).map((a) => a.action).sort()).toEqual(["consent.granted", "consent.granted", "consent.granted", "consent.withdrawn"]);
  });
});
