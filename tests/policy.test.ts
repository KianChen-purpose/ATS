import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { assertCanSeeJobs, canViewJobRow, userActor, type Role, type UserActor } from "@/server/policy";
import * as apps from "@/server/services/applications";
import * as cands from "@/server/services/candidates";
import * as jobs from "@/server/services/jobs";
import * as interviews from "@/server/services/interviews";
import { getHomeData } from "@/server/services/home";
import { searchEverything } from "@/server/services/search";
import { makeApplication, makeCandidate, makeJob, makeUser, resetDb } from "./fixtures";

/**
 * Role × visibility matrix (ARCHITECTURE.md §3). Two jobs:
 *  - "Public Analyst": ordinary job; hmA, recA and ivA are on its team.
 *  - "Secret CFO": confidential; hmB and recB are on its team.
 * Every role also has an "outsider" user on neither team.
 */
type World = Awaited<ReturnType<typeof buildWorld>>;

async function buildWorld() {
  const u = async (role: Role, name: string) => userActor(await makeUser(role, name));
  const outsiders = {
    admin: await u("admin", "Admin Outsider"),
    executive: await u("executive", "Exec Outsider"),
    recruiter: await u("recruiter", "Recruiter Outsider"),
    coordinator: await u("coordinator", "Coordinator Outsider"),
    hiring_manager: await u("hiring_manager", "HM Outsider"),
    interviewer: await u("interviewer", "Interviewer Outsider"),
  } satisfies Record<Role, UserActor>;
  const hmA = await u("hiring_manager", "HM Public");
  const recA = await u("recruiter", "Recruiter Public");
  const ivA = await u("interviewer", "Interviewer Public");
  const hmB = await u("hiring_manager", "HM Secret");
  const recB = await u("recruiter", "Recruiter Secret");

  const pub = await makeJob({ title: "Public Analyst", hiringManagerId: hmA.id, recruiterId: recA.id, team: [ivA.id] });
  const secret = await makeJob({ title: "Secret CFO", confidential: true, hiringManagerId: hmB.id, recruiterId: recB.id });
  await db.update(s.jobs).set({ compMin: 100_000, compMax: 120_000 }).where(eq(s.jobs.id, pub.job.id));

  const pubCand = await makeCandidate({ firstName: "Paula", lastName: "Public" });
  const pubApp = await makeApplication(pubCand.id, pub);
  const secretCand = await makeCandidate({ firstName: "Sam", lastName: "Secret" });
  const secretApp = await makeApplication(secretCand.id, secret);
  const prospect = await makeCandidate({ firstName: "Pat", lastName: "Prospect" });

  return { outsiders, hmA, recA, ivA, hmB, recB, pub, secret, pubCand, pubApp, secretCand, secretApp, prospect };
}

let w: World;

// [actor, sees public job, sees confidential job, sees prospects]
const matrix = (): [string, UserActor, boolean, boolean, boolean][] => [
  ["admin", w.outsiders.admin, true, true, true],
  ["executive", w.outsiders.executive, true, true, false],
  ["recruiter (not on team)", w.outsiders.recruiter, true, false, true],
  ["coordinator (not on team)", w.outsiders.coordinator, true, false, true],
  ["hiring manager (not on team)", w.outsiders.hiring_manager, false, false, false],
  ["interviewer (not on team)", w.outsiders.interviewer, false, false, false],
  ["hiring manager on public job", w.hmA, true, false, false],
  ["interviewer on public job", w.ivA, true, false, false],
  ["recruiter on confidential job", w.recB, true, true, true],
  ["hiring manager on confidential job", w.hmB, false, true, false],
];

describe("job visibility matrix", () => {
  beforeAll(async () => {
    await resetDb();
    w = await buildWorld();
  });

  it("covers every rule", () => expect(matrix()).toHaveLength(10));

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])("row %i: lists, details, search, candidates and counts agree", async (i) => {
    const [label, actor, seesPub, seesSecret, seesProspects] = matrix()[i];
    const ctx = `${label}`;

    // SQL filter (lists) and row check (details) agree
    const listed = (await jobs.listJobs(actor, { status: "all" })).map((j) => j.title);
    expect(listed.includes("Public Analyst"), ctx).toBe(seesPub);
    expect(listed.includes("Secret CFO"), ctx).toBe(seesSecret);
    expect(Boolean(await jobs.getJobDetail(actor, w.pub.job.id)), ctx).toBe(seesPub);
    expect(Boolean(await jobs.getJobDetail(actor, w.secret.job.id)), ctx).toBe(seesSecret);
    expect(canViewJobRow(actor, w.secret.job, []), ctx).toBe(seesSecret);
    await (seesSecret ? expect(assertCanSeeJobs(actor, [w.secret.job.id])).resolves.toBeUndefined() : expect(assertCanSeeJobs(actor, [w.secret.job.id])).rejects.toThrow());
    if (!seesPub) await expect(jobs.getPipeline(actor, w.pub.job.id, "active")).rejects.toThrow();

    // ⌘K search
    const jobHits = (await searchEverything(actor, "CFO")).jobs;
    expect(jobHits.length > 0, ctx).toBe(seesSecret);
    const candNames = async (q: string) => (await searchEverything(actor, q)).candidates.map((c) => c.name);
    expect((await candNames("Paula")).length > 0, ctx).toBe(seesPub);
    expect((await candNames("Sam Secret")).length > 0, ctx).toBe(seesSecret);
    expect((await candNames("Pat Prospect")).length > 0, ctx).toBe(seesProspects);

    // Candidate list and profiles
    const listedCands = (await cands.listCandidates(actor, { status: "all" })).rows.map((c) => c.lastName);
    expect(listedCands.includes("Public"), ctx).toBe(seesPub);
    expect(listedCands.includes("Secret"), ctx).toBe(seesSecret);
    expect(Boolean(await cands.getCandidateProfile(actor, w.pubCand.id)), ctx).toBe(seesPub);
    expect(Boolean(await cands.getCandidateProfile(actor, w.secretCand.id)), ctx).toBe(seesSecret);
    expect(Boolean(await cands.getCandidateProfile(actor, w.prospect.id)), ctx).toBe(seesProspects);

    // Home headline counts never include hidden jobs
    const { stats } = await getHomeData(actor);
    expect(stats.openJobs, ctx).toBe(Number(seesPub) + Number(seesSecret));
    expect(stats.activeCandidates, ctx).toBe(Number(seesPub) + Number(seesSecret));
  });
});

describe("mutations check the target, not just the role", () => {
  beforeEach(async () => {
    await resetDb();
    w = await buildWorld();
  });

  it("a recruiter can't move, archive, note, email or schedule on a confidential job they're not on", async () => {
    const rec = w.outsiders.recruiter;
    await expect(apps.moveToStage(rec, { applicationIds: [w.secretApp.id], stageId: w.secret.stages[2].id })).rejects.toThrow(/not found/);
    const [reason] = await db.insert(s.archiveReasons).values({ name: "Other", category: "other" }).returning();
    await expect(apps.archiveApplications(rec, { applicationIds: [w.secretApp.id], reasonId: reason.id, sendEmail: false })).rejects.toThrow();
    await expect(apps.unarchiveApplication(rec, w.secretApp.id)).rejects.toThrow();
    await expect(apps.addNote(rec, { candidateId: w.secretCand.id, applicationId: null, body: "hi" })).rejects.toThrow();
    await expect(apps.addNote(rec, { candidateId: w.secretCand.id, applicationId: w.secretApp.id, body: "hi" })).rejects.toThrow();
    await expect(apps.sendCandidateEmail(rec, { candidateId: w.secretCand.id, applicationId: null, subject: "x", body: "y" })).rejects.toThrow();
    await expect(apps.addCandidateToJob(rec, { candidateId: w.pubCand.id, jobId: w.secret.job.id })).rejects.toThrow();
    await expect(cands.updateCandidateTags(rec, w.secretCand.id, ["x"])).rejects.toThrow();
    await expect(jobs.setJobStatus(rec, w.secret.job.id, "closed")).rejects.toThrow();
    await expect(
      interviews.scheduleInterview(rec, { applicationId: w.secretApp.id, stageId: null, interviewerIds: [rec.id], startISO: new Date(Date.now() + 86_400_000 * 3).toISOString(), durationMin: 30, notifyCandidate: false }),
    ).rejects.toThrow();
    // Nothing was written
    expect(await db.query.applicationStageEvents.findMany()).toHaveLength(0);
    expect(await db.query.activities.findMany()).toHaveLength(0);
  });

  it("a bulk move including one hidden application fails entirely", async () => {
    const pubApp2 = await makeApplication((await makeCandidate()).id, w.pub);
    await expect(
      apps.moveToStage(w.outsiders.recruiter, { applicationIds: [w.pubApp.id, pubApp2.id, w.secretApp.id], stageId: w.pub.stages[2].id }),
    ).rejects.toThrow();
    const rows = await db.query.applications.findMany();
    expect(rows.every((r) => r.stageId !== w.pub.stages[2].id)).toBe(true);
    expect(await db.query.applicationStageEvents.findMany()).toHaveLength(0);
  });

  it("hiring managers and interviewers can't do recruiting actions even on their own job", async () => {
    await expect(apps.moveToStage(w.hmA, { applicationIds: [w.pubApp.id], stageId: w.pub.stages[2].id })).rejects.toThrow(/permission/);
    await expect(apps.sendCandidateEmail(w.ivA, { candidateId: w.pubCand.id, applicationId: w.pubApp.id, subject: "x", body: "y" })).rejects.toThrow(/permission/);
    // ...but can leave notes on candidates they can see
    await expect(apps.addNote(w.ivA, { candidateId: w.pubCand.id, applicationId: w.pubApp.id, body: "Great chat." })).resolves.toBeTruthy();
    await expect(apps.addNote(w.ivA, { candidateId: w.prospect.id, applicationId: null, body: "hi" })).rejects.toThrow();
  });
});

describe("field-level and row-level rules", () => {
  beforeEach(async () => {
    await resetDb();
    w = await buildWorld();
  });

  it("interviewers don't see compensation", async () => {
    expect((await jobs.getJobDetail(w.ivA, w.pub.job.id))?.compMin).toBeNull();
    expect((await jobs.getJobDetail(w.hmA, w.pub.job.id))?.compMin).toBe(100_000);
  });

  it("candidate-level emails and notes are only visible to prospect roles", async () => {
    await db.insert(s.emails).values([
      { candidateId: w.pubCand.id, applicationId: w.pubApp.id, direction: "outbound", fromAddress: "a@x", toAddress: "b@x", subject: "Job email", body: "." },
      { candidateId: w.pubCand.id, applicationId: null, direction: "outbound", fromAddress: "a@x", toAddress: "b@x", subject: "General email", body: "." },
    ]);
    await db.insert(s.activities).values({ candidateId: w.pubCand.id, type: "note", body: "Candidate-level note" });
    const forHm = await cands.getCandidateProfile(w.hmA, w.pubCand.id);
    expect(forHm?.emails.map((e) => e.subject)).toEqual(["Job email"]);
    expect(forHm?.activities.some((a) => a.body === "Candidate-level note")).toBe(false);
    const forRec = await cands.getCandidateProfile(w.recA, w.pubCand.id);
    expect(forRec?.emails).toHaveLength(2);
    expect(forRec?.activities.some((a) => a.body === "Candidate-level note")).toBe(true);
  });

  it("blind feedback: interviewers see others' scorecards only after submitting their own", async () => {
    const [form] = await db.insert(s.feedbackForms).values({ name: "f" }).returning();
    const [iv] = await db
      .insert(s.interviews)
      .values({ applicationId: w.pubApp.id, feedbackFormId: form.id, title: "Screen", startAt: new Date(Date.now() - 7_200_000), endAt: new Date(Date.now() - 3_600_000) })
      .returning();
    await db.insert(s.interviewInterviewers).values([{ interviewId: iv.id, userId: w.ivA.id }, { interviewId: iv.id, userId: w.hmA.id }]);
    await db.insert(s.scorecards).values({ applicationId: w.pubApp.id, interviewId: iv.id, authorId: w.hmA.id, overall: "yes", notes: "HM notes" });

    const before = await cands.getCandidateProfile(w.ivA, w.pubCand.id);
    expect(before?.applications[0].scorecards).toHaveLength(0);
    expect(before?.applications[0].feedbackHidden).toBe(1);

    await db.insert(s.scorecards).values({ applicationId: w.pubApp.id, interviewId: iv.id, authorId: w.ivA.id, overall: "no", notes: "My notes" });
    const after = await cands.getCandidateProfile(w.ivA, w.pubCand.id);
    expect(after?.applications[0].scorecards).toHaveLength(2);
    // Hiring managers aren't blind
    expect((await cands.getCandidateProfile(w.hmA, w.pubCand.id))?.applications[0].scorecards).toHaveLength(2);
  });
});
