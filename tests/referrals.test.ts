import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userActor } from "@/server/policy";
import * as cands from "@/server/services/candidates";
import * as privacy from "@/server/services/privacy";
import * as refs from "@/server/services/referrals";
import { makeJob, makeUser, resetDb } from "./fixtures";

async function world() {
  const rec = userActor(await makeUser("recruiter"));
  const tom = userActor(await makeUser("interviewer", "Tom Referrer"));
  const nina = userActor(await makeUser("interviewer", "Nina Referrer"));
  const pub = await makeJob({ recruiterId: rec.id, title: "Public Role" });
  const secret = await makeJob({ recruiterId: rec.id, confidential: true, title: "Secret Role" });
  for (const j of [pub, secret]) await db.update(s.jobs).set({ status: "open", publishedOnCareerSite: true }).where(eq(s.jobs.id, j.job.id));
  await db.insert(s.sources).values({ name: "Employee Referral", category: "referral" });
  const input = (o: Partial<Record<string, unknown>> = {}) =>
    refs.referralSchema.parse({ jobId: pub.job.id, firstName: "Grace", lastName: "Hopper", email: "grace@example.org", note: "Brilliant engineer, led our platform team.", relationship: "Worked together", ...o });
  return { rec, tom, nina, pub, secret, input };
}

describe("referrals", () => {
  beforeEach(resetDb);

  it("any employee can refer to a public open role; it creates an attributed application", async () => {
    const w = await world();
    expect((await refs.referableJobs()).map((j) => j.title)).toEqual(["Public Role"]);
    await refs.submitReferral(w.tom, w.input(), null);
    const [app] = await db.query.applications.findMany({ where: eq(s.applications.jobId, w.pub.job.id), with: { source: true } });
    expect(app).toMatchObject({ referrerId: w.tom.id, status: "active" });
    expect(app.source?.name).toBe("Employee Referral");
    expect(await db.query.applicationStageEvents.findMany({ where: eq(s.applicationStageEvents.applicationId, app.id) })).toHaveLength(1);
    const audit = (await db.query.auditLogs.findMany()).map((a) => a.action);
    expect(audit).toEqual(expect.arrayContaining(["candidate.created", "application.created", "referral.created"]));
    // No consent is recorded on the candidate's behalf.
    expect(await db.query.consentRecords.findMany()).toHaveLength(0);
  });

  it("confidential jobs can't be referred to", async () => {
    const w = await world();
    await expect(refs.submitReferral(w.tom, w.input({ jobId: w.secret.job.id }), null)).rejects.toThrow(/not found/);
  });

  it("referring the same person again doesn't duplicate; a second referrer attaches to the same application", async () => {
    const w = await world();
    await refs.submitReferral(w.tom, w.input(), null);
    expect(await refs.submitReferral(w.tom, w.input({ email: "GRACE@example.org" }), null)).toEqual({ alreadyReferred: true });
    expect(await refs.submitReferral(w.nina, w.input(), null)).toEqual({ alreadyReferred: false });
    expect(await db.query.applications.findMany()).toHaveLength(1);
    expect(await db.query.referrals.findMany()).toHaveLength(2);
    expect((await refs.myReferrals(w.nina)).map((r) => r.status)).toEqual(["submitted"]);
  });

  it("referrers see a coarse status only, and no profile access", async () => {
    const w = await world();
    await refs.submitReferral(w.tom, w.input(), null);
    const [app] = await db.query.applications.findMany();
    const interview = w.pub.stages.find((st) => st.type === "interview")!;
    await db.update(s.applications).set({ stageId: interview.id }).where(eq(s.applications.id, app.id));
    expect((await refs.myReferrals(w.tom))[0].status).toBe("interviewing");
    await db.update(s.applications).set({ status: "archived" }).where(eq(s.applications.id, app.id));
    const [row] = await refs.myReferrals(w.tom);
    expect(row.status).toBe("closed");
    expect(Object.keys(row).sort()).toEqual(["brand", "createdAt", "firstName", "id", "jobTitle", "lastName", "status"]);
    expect(await cands.getCandidateProfile(w.tom, app.candidateId)).toBeNull();
  });

  it("anonymizing the candidate wipes the referral note", async () => {
    const w = await world();
    await refs.submitReferral(w.tom, w.input(), null);
    const [app] = await db.query.applications.findMany();
    await privacy.anonymizeCandidate(userActor(await makeUser("admin")), app.candidateId, { reason: "deletion_request" });
    const [ref] = await db.query.referrals.findMany();
    expect(ref).toMatchObject({ note: null, relationship: null });
    const acts = await db.query.activities.findMany({ where: eq(s.activities.candidateId, app.candidateId) });
    expect(JSON.stringify(acts)).not.toContain("Brilliant engineer");
  });
});
