import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userActor, systemActor } from "@/server/policy";
import * as apps from "@/server/services/applications";
import * as cands from "@/server/services/candidates";
import * as jobs from "@/server/services/jobs";
import * as interviews from "@/server/services/interviews";
import * as feedback from "@/server/services/feedback";
import * as links from "@/server/services/scheduling-links";
import { makeApplication, makeCandidate, makeJob, makeUser, resetDb } from "./fixtures";

const auditFor = (entityId: string) => db.query.auditLogs.findMany({ where: eq(s.auditLogs.entityId, entityId) });
const eventsFor = (applicationId: string) =>
  db.query.applicationStageEvents.findMany({ where: eq(s.applicationStageEvents.applicationId, applicationId) });

async function setup() {
  const recruiterRow = await makeUser("recruiter");
  const interviewerRow = await makeUser("interviewer");
  const recruiter = userActor(recruiterRow);
  const job = await makeJob({ recruiterId: recruiterRow.id, team: [interviewerRow.id] });
  const cand = await makeCandidate();
  const app = await makeApplication(cand.id, job);
  return { recruiter, recruiterRow, interviewer: userActor(interviewerRow), interviewerRow, job, cand, app };
}

describe("application services", () => {
  beforeEach(resetDb);

  it("moveToStage writes one stage event and one audit row per application", async () => {
    const { recruiter, job, cand, app } = await setup();
    const app2 = await makeApplication((await makeCandidate()).id, job);
    await apps.moveToStage(recruiter, { applicationIds: [app.id, app2.id], stageId: job.stages[2].id });

    for (const a of [app, app2]) {
      const row = await db.query.applications.findFirst({ where: eq(s.applications.id, a.id) });
      expect(row?.stageId).toBe(job.stages[2].id);
      const events = await eventsFor(a.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ fromStageId: job.stages[0].id, toStageId: job.stages[2].id, status: "active", movedById: recruiter.id });
      expect((await auditFor(a.id)).map((r) => r.action)).toEqual(["application.stage_changed"]);
    }
    expect(cand.id).toBeTruthy();
  });

  it("moving to the hired stage marks the application hired", async () => {
    const { recruiter, job, app } = await setup();
    const hired = job.stages.find((st) => st.type === "hired")!;
    await apps.moveToStage(recruiter, { applicationIds: [app.id], stageId: hired.id });
    const row = await db.query.applications.findFirst({ where: eq(s.applications.id, app.id) });
    expect(row?.status).toBe("hired");
    expect((await eventsFor(app.id))[0].status).toBe("hired");
    expect((await auditFor(app.id))[0].action).toBe("application.hired");
  });

  it("archive and unarchive each write exactly one stage event and audit row", async () => {
    const { recruiter, app } = await setup();
    const [reason] = await db.insert(s.archiveReasons).values({ name: "Not a fit", category: "rejected" }).returning();
    await apps.archiveApplications(recruiter, { applicationIds: [app.id], reasonId: reason.id, sendEmail: false });
    await apps.unarchiveApplication(recruiter, app.id);
    const events = await eventsFor(app.id);
    expect(events.map((e) => e.status).sort()).toEqual(["active", "archived"]);
    expect((await auditFor(app.id)).map((r) => r.action).sort()).toEqual(["application.archived", "application.unarchived"]);
  });

  it("addNote audits the note", async () => {
    const { recruiter, cand, app } = await setup();
    const note = await apps.addNote(recruiter, { candidateId: cand.id, applicationId: app.id, body: "Strong portfolio." });
    expect((await auditFor(note.id)).map((r) => r.action)).toEqual(["note.created"]);
  });

  it("addCandidateToJob creates the application with a stage event and audit row", async () => {
    const { recruiter, recruiterRow, cand } = await setup();
    const other = await makeJob({ recruiterId: recruiterRow.id });
    await apps.addCandidateToJob(recruiter, { candidateId: cand.id, jobId: other.job.id });
    const created = await db.query.applications.findFirst({ where: and(eq(s.applications.candidateId, cand.id), eq(s.applications.jobId, other.job.id)) });
    expect(created).toBeTruthy();
    expect(await eventsFor(created!.id)).toHaveLength(1);
    expect((await auditFor(created!.id)).map((r) => r.action)).toEqual(["application.created"]);
  });

  it("sendCandidateEmail stores the email and audits it", async () => {
    const { recruiter, cand, app } = await setup();
    await apps.sendCandidateEmail(recruiter, { candidateId: cand.id, applicationId: app.id, subject: "Hello", body: "Hi there" });
    const [email] = await db.query.emails.findMany({ where: eq(s.emails.candidateId, cand.id) });
    expect(email.subject).toBe("Hello");
    expect((await auditFor(email.id)).map((r) => r.action)).toEqual(["email.sent"]);
  });
});

describe("job and candidate services", () => {
  beforeEach(resetDb);

  it("createJob creates stages, openings and an audit row", async () => {
    const recruiter = userActor(await makeUser("recruiter"));
    const brand = (await makeJob({})).job.brandId;
    const id = await jobs.createJob(
      recruiter,
      jobs.createJobSchema.parse({ title: "Analyst", brandId: brand, employmentType: "full_time", workplaceType: "hybrid", status: "open", openings: 2 }),
    );
    expect(await db.query.jobStages.findMany({ where: eq(s.jobStages.jobId, id) })).toHaveLength(8);
    expect(await db.query.openings.findMany({ where: eq(s.openings.jobId, id) })).toHaveLength(2);
    expect((await auditFor(id)).map((r) => r.action)).toEqual(["job.created"]);
  });

  it("setJobStatus audits the change", async () => {
    const { recruiter, job } = await setup();
    await jobs.setJobStatus(recruiter, job.job.id, "on_hold");
    const [row] = await auditFor(job.job.id);
    expect(row).toMatchObject({ action: "job.status_changed", metadata: { from: "open", to: "on_hold" } });
  });

  it("createCandidate on a job writes candidate + application audits and a stage event", async () => {
    const { recruiter, job } = await setup();
    const r = await cands.createCandidate(recruiter, cands.createCandidateSchema.parse({ firstName: "Ada", lastName: "L", email: "ada@x.test", jobId: job.job.id }));
    if (!("candidateId" in r)) throw new Error(r.error);
    expect((await auditFor(r.candidateId)).map((x) => x.action)).toEqual(["candidate.created"]);
    const app = await db.query.applications.findFirst({ where: eq(s.applications.candidateId, r.candidateId) });
    expect(await eventsFor(app!.id)).toHaveLength(1);
    expect((await auditFor(app!.id)).map((x) => x.action)).toEqual(["application.created"]);

    const dup = await cands.createCandidate(recruiter, cands.createCandidateSchema.parse({ firstName: "Ada", lastName: "Two", email: "ADA@x.test" }));
    expect(dup).toMatchObject({ duplicateId: r.candidateId });
  });

  it("updateCandidateTags de-duplicates and audits", async () => {
    const { recruiter, cand } = await setup();
    await cands.updateCandidateTags(recruiter, cand.id, ["fintech", "fintech", "remote"]);
    const row = await db.query.candidates.findFirst({ where: eq(s.candidates.id, cand.id) });
    expect(row?.tags).toEqual(["fintech", "remote"]);
    expect((await auditFor(cand.id)).map((x) => x.action)).toEqual(["candidate.tags_updated"]);
  });
});

describe("scheduling and feedback services", () => {
  beforeEach(resetDb);

  const nextWeekday = () => {
    const d = new Date(Date.now() + 3 * 86_400_000);
    while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(15, 0, 0, 0);
    return d;
  };

  it("scheduleInterview, cancelInterview and submitScorecard are audited", async () => {
    const { recruiter, interviewer, interviewerRow, job, app } = await setup();
    const { interviewId } = await interviews.scheduleInterview(recruiter, {
      applicationId: app.id,
      stageId: job.stages[3].id,
      interviewerIds: [interviewerRow.id],
      startISO: nextWeekday().toISOString(),
      durationMin: 45,
      notifyCandidate: true,
    });
    expect((await auditFor(interviewId)).map((x) => x.action)).toEqual(["interview.scheduled"]);

    // Feedback on a past interview
    await db.update(s.interviews).set({ startAt: new Date(Date.now() - 7_200_000), endAt: new Date(Date.now() - 3_600_000) }).where(eq(s.interviews.id, interviewId));
    await feedback.submitScorecard(interviewer, { interviewId, overall: "yes", ratings: { communication: 3 }, notes: "Clear and thoughtful answers." });
    const [card] = await db.query.scorecards.findMany({ where: eq(s.scorecards.interviewId, interviewId) });
    expect((await auditFor(card.id)).map((x) => x.action)).toEqual(["scorecard.submitted"]);
    await expect(
      feedback.submitScorecard(interviewer, { interviewId, overall: "no", ratings: {}, notes: "Second attempt at feedback." }),
    ).rejects.toThrow(/already submitted/);

    await interviews.cancelInterview(recruiter, interviewId, false);
    expect((await auditFor(interviewId)).map((x) => x.action).sort()).toEqual(["interview.cancelled", "interview.scheduled"]);
  });

  it("a self-scheduling link books once, as the system actor", async () => {
    const { recruiter, interviewerRow, job, app } = await setup();
    const { url } = await links.createSchedulingLink(recruiter, { applicationId: app.id, stageId: job.stages[2].id, interviewerIds: [interviewerRow.id], durationMin: 30, days: 14, sendEmail: false });
    const token = url.split("/").pop()!;
    const page = await links.getPublicSchedulingPage(token);
    if (page.state !== "open") throw new Error(`unexpected state ${page.state}`);
    expect(page.slots.length).toBeGreaterThan(0);

    await links.bookSchedulingLink({ token, startISO: page.slots[0] });
    await expect(links.bookSchedulingLink({ token, startISO: page.slots[1] })).rejects.toThrow(/already used/);
    expect((await links.getPublicSchedulingPage(token)).state).toBe("booked");

    const [iv] = await db.query.interviews.findMany({ where: eq(s.interviews.applicationId, app.id) });
    const [row] = await auditFor(iv.id);
    expect(row).toMatchObject({ action: "interview.scheduled", actorId: null, metadata: { systemActor: systemActor("self_scheduling").name } });
  });

  it("stores only a hash of the link token and rejects malformed tokens", async () => {
    const { recruiter, interviewerRow, app } = await setup();
    const { url } = await links.createSchedulingLink(recruiter, { applicationId: app.id, stageId: null, interviewerIds: [interviewerRow.id], durationMin: 30, days: 7, sendEmail: false });
    const token = url.split("/").pop()!;
    expect(token.length).toBeGreaterThanOrEqual(43); // 32 random bytes, base64url
    const [row] = await db.query.schedulingLinks.findMany();
    expect(row.tokenHash).toBe(links.hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect((await links.getPublicSchedulingPage("not a token")).state).toBe("invalid");
    expect((await links.getPublicSchedulingPage(token.slice(0, -2) + "xx")).state).toBe("invalid");
  });

  it("expired links can't be opened or booked", async () => {
    const { recruiter, interviewerRow, app } = await setup();
    const { url } = await links.createSchedulingLink(recruiter, { applicationId: app.id, stageId: null, interviewerIds: [interviewerRow.id], durationMin: 30, days: 7, sendEmail: false });
    const token = url.split("/").pop()!;
    await db.update(s.schedulingLinks).set({ windowEnd: new Date(Date.now() - 1000) });
    expect((await links.getPublicSchedulingPage(token)).state).toBe("expired");
    await expect(links.bookSchedulingLink({ token, startISO: new Date(Date.now() + 86_400_000).toISOString() })).rejects.toThrow(/expired/);
  });
});

describe("rate limiting", () => {
  it("blocks after the limit within a window", async () => {
    const { rateLimit, resetRateLimits, RateLimitError } = await import("@/server/security/rate-limit");
    resetRateLimits();
    for (let i = 0; i < 3; i++) rateLimit("t:1", { limit: 3, windowMs: 60_000 });
    expect(() => rateLimit("t:1", { limit: 3, windowMs: 60_000 })).toThrow(RateLimitError);
    expect(() => rateLimit("t:2", { limit: 3, windowMs: 60_000 })).not.toThrow();
  });
});
