import { beforeEach, describe, expect, it } from "vitest";
import { userActor } from "@/server/policy";
import * as approvals from "@/server/services/approvals";
import { decideApproval } from "@/server/services/approval-decisions";
import { approvalInbox, waitingCount } from "@/server/services/approval-inbox";
import * as cands from "@/server/services/candidates";
import * as jobs from "@/server/services/jobs";
import * as offers from "@/server/services/offers";
import { makeApplication, makeCandidate, makeJob, makeUser, resetDb } from "./fixtures";

describe("approvals inbox", () => {
  beforeEach(resetDb);

  async function world() {
    const admin = userActor(await makeUser("admin"));
    const rec = userActor(await makeUser("recruiter"));
    const hm = userActor(await makeUser("hiring_manager"));
    // A named approver who is NOT on the confidential job's hiring team.
    const finance = userActor(await makeUser("hiring_manager", "Finance Approver"));
    await approvals.saveChain(
      admin,
      approvals.chainSchema.parse({
        name: "Offers",
        subject: "offer",
        brandId: null,
        departmentId: null,
        minAmount: null,
        steps: [{ approverType: "hiring_manager", approverId: null }, { approverType: "user", approverId: finance.id }],
      }),
    );
    const job = await makeJob({ confidential: true, recruiterId: rec.id, hiringManagerId: hm.id });
    const cand = await makeCandidate({ firstName: "Grace", lastName: "Hopper" });
    const app = await makeApplication(cand.id, job);
    const offer = await offers.createOffer(
      rec,
      offers.createOfferSchema.parse({ applicationId: app.id, baseSalary: 150_000, bonusPercent: 15, signOnBonus: 10_000, equity: null, startDate: null, openingId: null, notes: "internal only" }),
    );
    await offers.submitOffer(rec, offer.id);
    const req = (await approvals.latestApproval("offer", offer.id))!;
    return { admin, rec, hm, finance, job, cand, app, offer, req };
  }

  it("shows each approver only their own turn, with the summary they need", async () => {
    const w = await world();
    expect(await waitingCount(w.finance)).toBe(0);
    expect((await approvalInbox(w.hm)).waiting.map((i) => i.requestId)).toEqual([w.req.id]);

    await decideApproval(w.hm, { requestId: w.req.id, decision: "approved" });
    expect(await waitingCount(w.hm)).toBe(0);
    expect((await approvalInbox(w.hm)).recent.map((i) => i.requestId)).toEqual([w.req.id]);

    const { waiting } = await approvalInbox(w.finance);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ yourTurn: true, job: { confidential: true }, offer: { candidateName: "Grace Hopper", baseSalary: 150_000, signOnBonus: 10_000 } });
    expect(JSON.stringify(waiting[0])).not.toContain("internal only"); // offer notes aren't part of the summary
  });

  it("the summary is not access to the job or candidate", async () => {
    const w = await world();
    await decideApproval(w.hm, { requestId: w.req.id, decision: "approved" });
    expect(await jobs.getJobDetail(w.finance, w.job.job.id)).toBeNull();
    expect(await cands.getCandidateProfile(w.finance, w.cand.id)).toBeNull();
    expect((await offers.listOffers(w.finance, "pending_approval")).rows).toHaveLength(0);
    // ...but they can decide their step
    expect((await decideApproval(w.finance, { requestId: w.req.id, decision: "approved" })).outcome).toBe("approved");
  });

  it("people who aren't named on a request never see it", async () => {
    const w = await world();
    const other = userActor(await makeUser("executive"));
    expect(await approvalInbox(other)).toEqual({ waiting: [], recent: [] });
  });

  it("approvers without the compensation right see no amounts", async () => {
    const admin = userActor(await makeUser("admin"));
    const rec = userActor(await makeUser("recruiter"));
    const ivApprover = userActor(await makeUser("interviewer"));
    await approvals.saveChain(
      admin,
      approvals.chainSchema.parse({ name: "Offers", subject: "offer", brandId: null, departmentId: null, minAmount: null, steps: [{ approverType: "user", approverId: ivApprover.id }] }),
    );
    const job = await makeJob({ recruiterId: rec.id });
    const app = await makeApplication((await makeCandidate()).id, job);
    const offer = await offers.createOffer(rec, offers.createOfferSchema.parse({ applicationId: app.id, baseSalary: 99_000, bonusPercent: null, signOnBonus: null, equity: null, startDate: null, openingId: null, notes: null }));
    await offers.submitOffer(rec, offer.id);
    const [item] = (await approvalInbox(ivApprover)).waiting;
    expect(item.offer?.baseSalary).toBeNull();
    expect(item.job.compMin).toBeNull();
  });
});
