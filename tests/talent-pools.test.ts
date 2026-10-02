import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userActor } from "@/server/policy";
import * as apps from "@/server/services/applications";
import * as cands from "@/server/services/candidates";
import * as pools from "@/server/services/talent-pools";
import { makeApplication, makeCandidate, makeJob, makeUser, resetDb } from "./fixtures";

async function world() {
  const rec = userActor(await makeUser("recruiter"));
  const otherRec = userActor(await makeUser("recruiter"));
  const hm = userActor(await makeUser("hiring_manager"));
  const pool = await pools.createPool(rec, pools.poolSchema.parse({ name: "Engineers" }));
  return { rec, otherRec, hm, pool };
}

describe("talent pools", () => {
  beforeEach(resetDb);

  it("are for recruiting roles only", async () => {
    const w = await world();
    await expect(pools.createPool(w.hm, pools.poolSchema.parse({ name: "Mine" }))).rejects.toThrow(/recruiting team/);
    await expect(pools.listPools(w.hm)).rejects.toThrow(/recruiting team/);
    expect((await pools.listPools(w.otherRec)).map((p) => p.name)).toEqual(["Engineers"]);
  });

  it("new prospects have no application and are visible to prospect roles only", async () => {
    const w = await world();
    const r = await pools.createProspect(w.rec, pools.prospectSchema.parse({ poolId: w.pool.id, firstName: "Imani", lastName: "Okoro", email: "imani@example.org", note: "Met at a meetup" }));
    if (!("candidateId" in r)) throw new Error("expected a new prospect");
    expect(await db.query.applications.findMany({ where: eq(s.applications.candidateId, r.candidateId) })).toHaveLength(0);
    expect(await cands.getCandidateProfile(w.otherRec, r.candidateId)).toBeTruthy();
    expect(await cands.getCandidateProfile(w.hm, r.candidateId)).toBeNull();
    expect(await pools.createProspect(w.rec, pools.prospectSchema.parse({ poolId: w.pool.id, firstName: "X", lastName: "Y", email: "IMANI@example.org" }))).toEqual({ duplicateId: r.candidateId });
    const audit = (await db.query.auditLogs.findMany()).map((a) => a.action);
    expect(audit).toEqual(expect.arrayContaining(["talent_pool.created", "candidate.created", "talent_pool.member_added"]));
  });

  it("members only on jobs you can't see are hidden from you, and can't be added", async () => {
    const w = await world();
    const secret = await makeJob({ confidential: true, recruiterId: w.rec.id });
    const c = await makeCandidate();
    await makeApplication(c.id, secret);
    await pools.addToPool(w.rec, w.pool.id, c.id);
    expect((await pools.getPool(w.rec, w.pool.id))?.members).toHaveLength(1);
    expect((await pools.getPool(w.otherRec, w.pool.id))?.members).toHaveLength(0);
    expect((await pools.listPools(w.otherRec))[0].members).toBe(0);
    await expect(pools.addToPool(w.otherRec, w.pool.id, c.id)).rejects.toThrow(/not found/);
    expect(await pools.searchForPool(w.otherRec, w.pool.id, c.lastName)).toHaveLength(0);
    // Already-in-pool people aren't offered again.
    expect(await pools.searchForPool(w.rec, w.pool.id, c.lastName)).toHaveLength(0);
  });

  it("stage changes are audited, and adding to a job marks the member Applied", async () => {
    const w = await world();
    const r = await pools.createProspect(w.rec, pools.prospectSchema.parse({ poolId: w.pool.id, firstName: "Mateo", lastName: "Silva" }));
    if (!("candidateId" in r)) throw new Error("expected a new prospect");
    await pools.setProspectStage(w.rec, w.pool.id, r.candidateId, "interested");
    const job = await makeJob({ recruiterId: w.rec.id });
    await apps.addCandidateToJob(w.rec, { candidateId: r.candidateId, jobId: job.job.id });
    const [member] = (await pools.getPool(w.rec, w.pool.id))!.members;
    expect(member.stage).toBe("applied");
    expect((await db.query.auditLogs.findMany()).map((a) => a.action)).toContain("talent_pool.member_stage_changed");
    await pools.removeFromPool(w.rec, w.pool.id, r.candidateId);
    expect((await pools.getPool(w.rec, w.pool.id))!.members).toHaveLength(0);
  });

  it("shows whether a member has a current talent-pool consent", async () => {
    const w = await world();
    const c = await makeCandidate();
    await pools.addToPool(w.rec, w.pool.id, c.id);
    expect((await pools.getPool(w.rec, w.pool.id))!.members[0].talentPoolConsent).toBe(false);
    await db.insert(s.consentRecords).values({ candidateId: c.id, purpose: "talent_pool", granted: true, policyVersion: "2026-10", source: "career_site" });
    expect((await pools.getPool(w.rec, w.pool.id))!.members[0].talentPoolConsent).toBe(true);
  });
});
