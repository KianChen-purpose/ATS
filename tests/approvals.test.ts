import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userActor } from "@/server/policy";
import * as approvals from "@/server/services/approvals";
import { makeBrand, makeJob, makeUser, resetDb } from "./fixtures";

async function world() {
  const admin = userActor(await makeUser("admin"));
  const hm = userActor(await makeUser("hiring_manager"));
  const rec = userActor(await makeUser("recruiter"));
  const cfo = userActor(await makeUser("executive", "CFO"));
  const cpo = userActor(await makeUser("executive", "CPO"));
  const brand = await makeBrand();
  const otherBrand = await makeBrand();
  const [dept] = await db.insert(s.departments).values({ name: "Engineering" }).returning();
  const { job } = await makeJob({ brandId: brand.id, hiringManagerId: hm.id, recruiterId: rec.id });
  await db.update(s.jobs).set({ departmentId: dept.id }).where(eq(s.jobs.id, job.id));
  const ctx = (amount?: number): approvals.ApprovalContext => ({
    job: { id: job.id, brandId: brand.id, departmentId: dept.id, hiringManagerId: hm.id, recruiterId: rec.id },
    amount,
  });
  return { admin, hm, rec, cfo, cpo, brand, otherBrand, dept, job, ctx };
}

const chainInput = (o: Partial<Parameters<typeof approvals.saveChain>[1]>) =>
  approvals.chainSchema.parse({ name: "Chain", subject: "offer", brandId: null, departmentId: null, minAmount: null, steps: [{ approverType: "hiring_manager", approverId: null }], ...o });

describe("approval chains", () => {
  beforeEach(resetDb);

  it("only admins configure chains, and changes are audited", async () => {
    const w = await world();
    await expect(approvals.saveChain(w.rec, chainInput({}))).rejects.toThrow(/admins/);
    const chain = await approvals.saveChain(w.admin, chainInput({}));
    const [row] = await db.query.auditLogs.findMany({ where: eq(s.auditLogs.entityId, chain.id) });
    expect(row.action).toBe("approval_chain.created");
  });

  it("picks the most specific chain: brand, then department, then highest threshold met", async () => {
    const w = await world();
    const any = await approvals.saveChain(w.admin, chainInput({ name: "All" }));
    const brand = await approvals.saveChain(w.admin, chainInput({ name: "Brand", brandId: w.brand.id }));
    const other = await approvals.saveChain(w.admin, chainInput({ name: "Other brand", brandId: w.otherBrand.id }));
    const dept = await approvals.saveChain(w.admin, chainInput({ name: "Brand+dept", brandId: w.brand.id, departmentId: w.dept.id }));
    const senior = await approvals.saveChain(w.admin, chainInput({ name: "Senior", brandId: w.brand.id, departmentId: w.dept.id, minAmount: 200_000 }));
    const pick = async (amount: number) => (await approvals.resolveChain(db, "offer", w.ctx(amount)))?.id;
    expect(await pick(250_000)).toBe(senior.id);
    expect(await pick(150_000)).toBe(dept.id);
    await approvals.setChainActive(w.admin, dept.id, false);
    expect(await pick(150_000)).toBe(brand.id);
    await approvals.setChainActive(w.admin, brand.id, false);
    expect(await pick(150_000)).toBe(any.id);
    expect(other.id).toBeTruthy();
    expect(await approvals.resolveChain(db, "job", w.ctx())).toBeNull();
  });

  it("rejects steps with no resolvable approver and thresholds on job chains", async () => {
    const w = await world();
    expect(() => chainInput({ steps: [{ approverType: "user", approverId: null }] })).toThrow(/pick a person/);
    expect(() => chainInput({ subject: "job", minAmount: 1 })).toThrow(/only apply to offers/);
    await approvals.saveChain(w.admin, chainInput({ steps: [{ approverType: "hiring_manager", approverId: null }] }));
    const ctx = w.ctx(1);
    ctx.job.hiringManagerId = null;
    await expect(db.transaction((tx) => approvals.startApproval(tx, w.rec, "offer", crypto.randomUUID(), ctx))).rejects.toThrow(/no hiring manager/);
  });
});

describe("approval requests", () => {
  beforeEach(resetDb);

  async function started() {
    const w = await world();
    await approvals.saveChain(
      w.admin,
      chainInput({
        steps: [
          { approverType: "hiring_manager", approverId: null },
          { approverType: "hiring_manager", approverId: null }, // duplicate collapses
          { approverType: "user", approverId: w.cpo.id },
          { approverType: "user", approverId: w.cfo.id },
        ],
      }),
    );
    const subjectId = crypto.randomUUID();
    const r = await db.transaction((tx) => approvals.startApproval(tx, w.rec, "offer", subjectId, w.ctx(100_000)));
    return { ...w, subjectId, requestId: r!.request.id, first: r!.firstApproverId };
  }

  const decide = (actor: Parameters<typeof approvals.recordDecision>[1], requestId: string, decision: "approved" | "rejected", comment?: string) =>
    db.transaction((tx) => approvals.recordDecision(tx, actor, { requestId, decision, comment }));

  it("freezes approvers at start, runs strictly in order, and approves after the last step", async () => {
    const w = await started();
    expect(w.first).toBe(w.hm.id);
    const steps = await db.query.approvalSteps.findMany({ where: eq(s.approvalSteps.requestId, w.requestId) });
    expect(steps.map((st) => st.approverId)).toEqual([w.hm.id, w.cpo.id, w.cfo.id]);

    expect((await approvals.myPendingSteps(w.cfo)).length).toBe(0);
    await expect(decide(w.cfo, w.requestId, "approved")).rejects.toThrow(/isn't waiting on you/);
    await expect(decide(w.rec, w.requestId, "approved")).rejects.toThrow(/isn't waiting on you/);

    expect((await decide(w.hm, w.requestId, "approved")).outcome).toBe("pending");
    expect((await approvals.myPendingSteps(w.cpo)).map((p) => p.requestId)).toEqual([w.requestId]);
    expect((await decide(w.cpo, w.requestId, "approved")).nextApproverId).toBe(w.cfo.id);
    expect((await decide(w.cfo, w.requestId, "approved")).outcome).toBe("approved");
    await expect(decide(w.cfo, w.requestId, "approved")).rejects.toThrow(/no longer pending/);

    const audit = (await db.query.auditLogs.findMany()).map((a) => a.action);
    expect(audit.filter((a) => a === "approval.step_approved")).toHaveLength(3);
    expect(audit).toContain("approval.requested");
    expect(audit).toContain("approval.approved");
  });

  it("a rejection needs a comment, ends the request and skips the rest", async () => {
    const w = await started();
    await expect(decide(w.hm, w.requestId, "rejected")).rejects.toThrow(/comment/);
    expect((await decide(w.hm, w.requestId, "rejected", "Over budget")).outcome).toBe("rejected");
    const steps = await db.query.approvalSteps.findMany({ where: eq(s.approvalSteps.requestId, w.requestId) });
    expect(steps.map((st) => st.status).sort()).toEqual(["rejected", "skipped", "skipped"]);
  });

  it("starting again cancels the previous pending request", async () => {
    const w = await started();
    await db.transaction((tx) => approvals.startApproval(tx, w.rec, "offer", w.subjectId, w.ctx(100_000)));
    const reqs = await db.query.approvalRequests.findMany({ where: eq(s.approvalRequests.subjectId, w.subjectId) });
    expect(reqs.map((r) => r.status).sort()).toEqual(["cancelled", "pending"]);
    expect((await approvals.latestApproval("offer", w.subjectId))?.status).toBe("pending");
  });
});
