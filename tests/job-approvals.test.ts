import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userActor } from "@/server/policy";
import * as approvals from "@/server/services/approvals";
import { decideApproval } from "@/server/services/approval-decisions";
import * as jobs from "@/server/services/jobs";
import { makeBrand, makeJob, makeUser, resetDb } from "./fixtures";

async function world(withChain = true) {
  const admin = userActor(await makeUser("admin"));
  const rec = userActor(await makeUser("recruiter"));
  const hm = userActor(await makeUser("hiring_manager"));
  const cpo = userActor(await makeUser("executive", "CPO"));
  const brand = await makeBrand();
  if (withChain) {
    await approvals.saveChain(
      admin,
      approvals.chainSchema.parse({
        name: "Jobs",
        subject: "job",
        brandId: null,
        departmentId: null,
        minAmount: null,
        steps: [{ approverType: "hiring_manager", approverId: null }, { approverType: "user", approverId: cpo.id }],
      }),
    );
  }
  const create = (status: "draft" | "open", confidential = false) =>
    jobs.createJob(
      rec,
      jobs.createJobSchema.parse({ title: "Analyst", brandId: brand.id, employmentType: "full_time", workplaceType: "hybrid", status, confidential, hiringManagerId: hm.id, openings: 1 }),
    );
  return { admin, rec, hm, cpo, brand, create };
}

const job = (id: string) => db.query.jobs.findFirst({ where: eq(s.jobs.id, id) });
const pendingRequest = async (jobId: string) => (await approvals.latestApproval("job", jobId))!;

describe("job approvals", () => {
  beforeEach(resetDb);

  it("opening a new job waits for the chain, then opens and publishes on final approval", async () => {
    const w = await world();
    const id = await w.create("open");
    expect((await job(id))?.status).toBe("pending_approval");
    expect((await job(id))?.publishedOnCareerSite).toBe(false);
    const req = await pendingRequest(id);
    await decideApproval(w.hm, { requestId: req.id, decision: "approved" });
    expect((await job(id))?.status).toBe("pending_approval");
    await decideApproval(w.cpo, { requestId: req.id, decision: "approved" });
    const opened = await job(id);
    expect(opened).toMatchObject({ status: "open", publishedOnCareerSite: true });
    expect(opened?.openedAt).toBeInstanceOf(Date);
    const audit = await db.query.auditLogs.findMany({ where: eq(s.auditLogs.entityId, id) });
    expect(audit.some((a) => a.action === "job.status_changed" && (a.metadata as { via?: string }).via === "approval")).toBe(true);
  });

  it("a rejection sends the job back to draft", async () => {
    const w = await world();
    const id = await w.create("open");
    await decideApproval(w.hm, { requestId: (await pendingRequest(id)).id, decision: "rejected", comment: "Not in the plan" });
    expect((await job(id))?.status).toBe("draft");
  });

  it("without a chain the job opens immediately; reopening never re-requests approval", async () => {
    const w = await world(false);
    const id = await w.create("open");
    expect((await job(id))?.status).toBe("open");
    await jobs.setJobStatus(w.rec, id, "on_hold");
    await jobs.setJobStatus(w.rec, id, "open");
    expect((await job(id))?.status).toBe("open");
    expect(await approvals.latestApproval("job", id)).toBeUndefined();
  });

  it("a pending job can only be withdrawn to draft, which cancels the request", async () => {
    const w = await world();
    const id = await w.create("draft");
    expect((await jobs.setJobStatus(w.rec, id, "open")).status).toBe("pending_approval");
    await expect(jobs.setJobStatus(w.rec, id, "closed")).rejects.toThrow(/waiting for approval/);
    await jobs.setJobStatus(w.rec, id, "draft");
    expect((await job(id))?.status).toBe("draft");
    expect((await approvals.latestApproval("job", id))?.status).toBe("cancelled");
  });

  it("approval_requests carry the job id; people not on the chain can't decide", async () => {
    const w = await world();
    const id = await w.create("open");
    const req = await pendingRequest(id);
    expect(req.jobId).toBe(id);
    await expect(decideApproval(w.rec, { requestId: req.id, decision: "approved" })).rejects.toThrow(/isn't waiting on you/);
    await expect(decideApproval(w.cpo, { requestId: req.id, decision: "approved" })).rejects.toThrow(/isn't waiting on you/);
  });
});

describe("openings", () => {
  beforeEach(resetDb);

  it("recruiters add and close openings on jobs they can see; each change is audited", async () => {
    const rec = userActor(await makeUser("recruiter"));
    const hm = userActor(await makeUser("hiring_manager"));
    const { job: j } = await makeJob({ recruiterId: rec.id, hiringManagerId: hm.id });
    const rows = await jobs.addOpenings(rec, { jobId: j.id, count: 2, reason: "backfill", targetStartDate: "2027-01-15" });
    expect(rows.map((r) => r.reason)).toEqual(["backfill", "backfill"]);
    await jobs.closeOpening(rec, rows[0].id);
    await expect(jobs.closeOpening(rec, rows[0].id)).rejects.toThrow(/Only open/);
    const actions = (await db.query.auditLogs.findMany()).map((a) => a.action).sort();
    expect(actions).toEqual(["opening.closed", "opening.created", "opening.created"]);
    await expect(jobs.addOpenings(hm, { jobId: j.id, count: 1, reason: "new_headcount", targetStartDate: null })).rejects.toThrow(/permission/);

    const outsider = userActor(await makeUser("recruiter"));
    const { job: secret } = await makeJob({ confidential: true, recruiterId: rec.id });
    await expect(jobs.addOpenings(outsider, { jobId: secret.id, count: 1, reason: "new_headcount", targetStartDate: null })).rejects.toThrow(/not found/);
  });
});
