import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userActor } from "@/server/policy";
import * as approvals from "@/server/services/approvals";
import { decideApproval } from "@/server/services/approval-decisions";
import * as jobs from "@/server/services/jobs";
import * as offers from "@/server/services/offers";
import { installDefaultLetterTemplates, makeApplication, makeCandidate, makeJob, makeUser, resetDb } from "./fixtures";

const BASE_TERMS = { baseSalary: 120_000, bonusPercent: 10, signOnBonus: null, equity: null, startDate: "2027-01-04", openingId: null, notes: null };
const terms = (o: Partial<Parameters<typeof offers.createOffer>[1]> & { applicationId: string }) => offers.createOfferSchema.parse({ ...BASE_TERMS, ...o });

async function world({ chain = true } = {}) {
  await installDefaultLetterTemplates();
  const admin = userActor(await makeUser("admin"));
  const rec = userActor(await makeUser("recruiter"));
  const hm = userActor(await makeUser("hiring_manager"));
  const iv = userActor(await makeUser("interviewer"));
  const cfo = userActor(await makeUser("executive", "CFO"));
  if (chain) {
    await approvals.saveChain(
      admin,
      approvals.chainSchema.parse({
        name: "Offers",
        subject: "offer",
        brandId: null,
        departmentId: null,
        minAmount: null,
        steps: [{ approverType: "hiring_manager", approverId: null }, { approverType: "user", approverId: cfo.id }],
      }),
    );
  }
  const job = await makeJob({ recruiterId: rec.id, hiringManagerId: hm.id, team: [iv.id] });
  const [opening] = await jobs.addOpenings(rec, { jobId: job.job.id, count: 1, reason: "new_headcount", targetStartDate: null });
  const cand = await makeCandidate({ preferredLocale: "fr-CA" });
  const app = await makeApplication(cand.id, job);
  return { admin, rec, hm, iv, cfo, job, opening, cand, app };
}

const offerRow = (id: string) => db.query.offers.findFirst({ where: eq(s.offers.id, id) });

describe("offers", () => {
  beforeEach(resetDb);

  it("draft → approval → send → accept hires the candidate and fills the opening", async () => {
    const w = await world();
    const offer = await offers.createOffer(w.rec, terms({ applicationId: w.app.id }));
    await expect(offers.sendOffer(w.rec, offer.id)).rejects.toThrow(/approved/);

    expect((await offers.submitOffer(w.rec, offer.id)).status).toBe("pending_approval");
    await expect(offers.updateOffer(w.rec, offer.id, offers.offerTermsSchema.parse({ ...BASE_TERMS, baseSalary: 1 }))).rejects.toThrow(/draft/);
    const req = (await approvals.latestApproval("offer", offer.id))!;
    expect(req.jobId).toBe(w.job.job.id);
    await decideApproval(w.hm, { requestId: req.id, decision: "approved" });
    await decideApproval(w.cfo, { requestId: req.id, decision: "approved" });
    expect((await offerRow(offer.id))?.status).toBe("approved");

    await offers.sendOffer(w.rec, offer.id);
    const sent = await offerRow(offer.id);
    expect(sent?.status).toBe("sent");
    const [email] = await db.query.emails.findMany({ where: eq(s.emails.applicationId, w.app.id) });
    expect(email.subject).toMatch(/^Votre offre/); // candidate prefers fr-CA

    await offers.recordOfferResponse(w.rec, { offerId: offer.id, response: "accepted" });
    const app = await db.query.applications.findFirst({ where: eq(s.applications.id, w.app.id) });
    expect(app?.status).toBe("hired");
    const events = await db.query.applicationStageEvents.findMany({ where: eq(s.applicationStageEvents.applicationId, w.app.id) });
    expect(events.filter((e) => e.status === "hired")).toHaveLength(1);
    const opening = await db.query.openings.findFirst({ where: eq(s.openings.id, w.opening.id) });
    expect(opening?.status).toBe("filled");
    expect((await offerRow(offer.id))?.openingId).toBe(w.opening.id);

    const actions = (await db.query.auditLogs.findMany({ where: eq(s.auditLogs.entityId, offer.id) })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["offer.created", "offer.submitted", "offer.status_changed", "offer.sent", "offer.accepted"]));
    expect((await db.query.auditLogs.findMany({ where: eq(s.auditLogs.entityId, w.app.id) })).map((a) => a.action)).toContain("application.hired");
  });

  it("a rejected approval returns the offer to draft; without a chain submit approves straight away", async () => {
    const w = await world();
    const offer = await offers.createOffer(w.rec, terms({ applicationId: w.app.id }));
    await offers.submitOffer(w.rec, offer.id);
    const req = (await approvals.latestApproval("offer", offer.id))!;
    await decideApproval(w.hm, { requestId: req.id, decision: "rejected", comment: "Above band" });
    expect((await offerRow(offer.id))?.status).toBe("draft");

    await resetDb();
    const w2 = await world({ chain: false });
    const o2 = await offers.createOffer(w2.rec, terms({ applicationId: w2.app.id }));
    expect((await offers.submitOffer(w2.rec, o2.id)).status).toBe("approved");
  });

  it("one live offer per application; withdraw cancels pending approvals; decline keeps the application", async () => {
    const w = await world();
    const offer = await offers.createOffer(w.rec, terms({ applicationId: w.app.id }));
    await expect(offers.createOffer(w.rec, terms({ applicationId: w.app.id }))).rejects.toThrow(/already has an offer/);
    await offers.submitOffer(w.rec, offer.id);
    await offers.withdrawOffer(w.rec, offer.id);
    expect((await offerRow(offer.id))?.status).toBe("withdrawn");
    expect((await approvals.latestApproval("offer", offer.id))?.status).toBe("cancelled");

    const second = await offers.createOffer(w.rec, terms({ applicationId: w.app.id }));
    await db.update(s.offers).set({ status: "sent" }).where(eq(s.offers.id, second.id));
    await offers.recordOfferResponse(w.rec, { offerId: second.id, response: "declined", declineReason: "Counter-offer" });
    expect((await offerRow(second.id))).toMatchObject({ status: "declined", declineReason: "Counter-offer" });
    expect((await db.query.applications.findFirst({ where: eq(s.applications.id, w.app.id) }))?.status).toBe("active");
  });

  it("only recruiting roles change offers; interviewers can't list them; hidden jobs are off-limits", async () => {
    const w = await world();
    await expect(offers.createOffer(w.hm, terms({ applicationId: w.app.id }))).rejects.toThrow(/permission/);
    const offer = await offers.createOffer(w.rec, terms({ applicationId: w.app.id }));
    expect((await offers.listOffers(w.iv, "draft")).rows).toHaveLength(0);
    expect((await offers.listOffers(w.hm, "draft")).rows.map((r) => r.id)).toEqual([offer.id]);

    const outsider = userActor(await makeUser("recruiter"));
    const secret = await makeJob({ confidential: true, recruiterId: w.rec.id });
    const secretApp = await makeApplication((await makeCandidate()).id, secret);
    await expect(offers.createOffer(outsider, terms({ applicationId: secretApp.id }))).rejects.toThrow(/not found/);
    const secretOffer = await offers.createOffer(w.rec, terms({ applicationId: secretApp.id }));
    await expect(offers.submitOffer(outsider, secretOffer.id)).rejects.toThrow(/not found/);
    expect((await offers.listOffers(outsider, "draft")).rows.map((r) => r.id)).toEqual([offer.id]);
  });

  it("an opening from another job or a filled opening is refused", async () => {
    const w = await world();
    const other = await makeJob({ recruiterId: w.rec.id });
    const [foreign] = await jobs.addOpenings(w.rec, { jobId: other.job.id, count: 1, reason: "backfill", targetStartDate: null });
    await expect(offers.createOffer(w.rec, terms({ applicationId: w.app.id, openingId: foreign.id }))).rejects.toThrow(/not found/);
    await db.update(s.openings).set({ status: "filled" }).where(and(eq(s.openings.id, w.opening.id)));
    await expect(offers.createOffer(w.rec, terms({ applicationId: w.app.id, openingId: w.opening.id }))).rejects.toThrow(/isn't open/);
  });
});
