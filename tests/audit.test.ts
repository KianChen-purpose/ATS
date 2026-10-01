import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userActor } from "@/server/policy";
import { integrationEventRow } from "@/server/integrations/m365/record";
import * as apps from "@/server/services/applications";
import * as cands from "@/server/services/candidates";
import { makeApplication, makeCandidate, makeJob, makeUser, resetDb } from "./fixtures";

/** Drizzle wraps driver errors; the trigger's message is on the cause. */
async function expectAppendOnly(p: Promise<unknown>) {
  const err = await p.then(() => null, (e: Error & { cause?: Error }) => e);
  expect(err, "expected the write to be rejected").not.toBeNull();
  expect(String(err?.cause?.message ?? err?.message)).toMatch(/append-only/);
}

describe("audit and history", () => {
  beforeEach(resetDb);

  async function world() {
    const rec = userActor(await makeUser("recruiter"), { requestId: "req-123", ip: "203.0.113.7", userAgent: "vitest" });
    const job = await makeJob({ recruiterId: rec.id });
    const cand = await makeCandidate({ resumeText: "Ten years in portfolio management." });
    const app = await makeApplication(cand.id, job);
    return { rec, job, cand, app };
  }

  it("audit_logs and application_stage_events reject UPDATE and DELETE", async () => {
    const { rec, job, app } = await world();
    await apps.moveToStage(rec, { applicationIds: [app.id], stageId: job.stages[1].id });
    await expectAppendOnly(db.update(s.auditLogs).set({ action: "tampered" }));
    await expectAppendOnly(db.delete(s.auditLogs));
    await expectAppendOnly(db.update(s.applicationStageEvents).set({ status: "hired" }));
    await expectAppendOnly(db.delete(s.applicationStageEvents));
  });

  it("a failed change leaves no audit row (same transaction)", async () => {
    const { rec, job, app } = await world();
    // Make the stage-event insert fail inside the move's transaction.
    await db.execute(sql`ALTER TABLE application_stage_events ADD CONSTRAINT tmp_block CHECK (status <> 'active') NOT VALID`);
    try {
      await expect(apps.moveToStage(rec, { applicationIds: [app.id], stageId: job.stages[1].id })).rejects.toThrow();
    } finally {
      await db.execute(sql`ALTER TABLE application_stage_events DROP CONSTRAINT tmp_block`);
    }
    expect(await db.query.auditLogs.findMany()).toHaveLength(0);
    expect((await db.query.applications.findFirst({ where: eq(s.applications.id, app.id) }))?.stageId).toBe(job.stages[0].id);
  });

  it("records request id, IP and user agent", async () => {
    const { rec, cand } = await world();
    await cands.updateCandidateTags(rec, cand.id, ["x"]);
    const [row] = await db.query.auditLogs.findMany();
    expect(row).toMatchObject({ actorId: rec.id, entityId: cand.id, requestId: "req-123", ip: "203.0.113.7", userAgent: "vitest" });
  });

  it("profile views are audited; hidden profiles are not", async () => {
    const { rec, cand } = await world();
    await cands.viewCandidateProfile(rec, cand.id, "profile");
    const outsider = userActor(await makeUser("interviewer"));
    expect(await cands.viewCandidateProfile(outsider, cand.id, "profile")).toBeNull();
    const rows = await db.query.auditLogs.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "candidate.viewed", entityType: "candidate", entityId: cand.id, metadata: { via: "profile", includesResume: true } });
  });
});

describe("integration events", () => {
  it("store recipient domains and ids only, never addresses, subjects or bodies", () => {
    const row = integrationEventRow({
      service: "mail",
      operation: "sendMail",
      mode: "mock",
      recipients: ["jane.doe@gmail.com", "kian@purpose.ca"],
      ids: { messageId: "AAMk1", threadId: null },
      error: "550 mailbox jane.doe@gmail.com unavailable",
    });
    const text = JSON.stringify(row);
    expect(text).not.toContain("jane.doe");
    expect(text).not.toContain("kian@");
    expect(row.request).toMatchObject({ recipientDomains: ["gmail.com", "purpose.ca"], recipientCount: 2 });
    expect(row.response).toMatchObject({ messageId: "AAMk1" });
    expect(row.summary).toBe("sendMail · 2 recipients @ gmail.com, purpose.ca");
  });

  it("the mock client logs no PII when sending candidate email", async () => {
    await resetDb();
    const rec = userActor(await makeUser("recruiter"));
    const job = await makeJob({ recruiterId: rec.id });
    const cand = await makeCandidate({ firstName: "Zelda", lastName: "Quist", email: "zelda.quist@example.org" });
    const app = await makeApplication(cand.id, job);
    await apps.sendCandidateEmail(rec, { candidateId: cand.id, applicationId: app.id, subject: "Your offer, Zelda", body: "Secret body text" });
    const events = JSON.stringify(await db.query.integrationEvents.findMany());
    for (const pii of ["Zelda", "Quist", "zelda.quist", "Secret body", "Your offer"]) expect(events).not.toContain(pii);
    expect(events).toContain("example.org");
  });
});
