import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { reportingDb } from "@/db/reporting";
import { userActor, type UserActor } from "@/server/policy";
import { resolveFilters } from "@/server/services/reports/filters";
import * as rep from "@/server/services/reports/standard";
import { drillDown } from "@/server/services/reports/drilldown";
import { getReportFilterOptions } from "@/server/services/reports/options";
import { makeCandidate, makeJob, makeUser, resetDb } from "./fixtures";

const DAY = 86_400_000;
const NOW = Date.now();
const ago = (d: number) => new Date(NOW - d * DAY);

type Job = Awaited<ReturnType<typeof makeJob>>;
const stage = (job: Job, type: string, nth = 0) => job.stages.filter((st) => st.type === type)[nth];

/** An application with an explicit stage history: [stage type, days ago, status?][]. */
async function history(job: Job, steps: [string, number, ("active" | "archived" | "hired")?][], opts: { sourceId?: string } = {}) {
  const cand = await makeCandidate();
  const last = steps[steps.length - 1];
  const status = last[2] ?? "active";
  const [app] = await db
    .insert(s.applications)
    .values({
      candidateId: cand.id,
      jobId: job.job.id,
      stageId: stage(job, last[0]).id,
      status,
      sourceId: opts.sourceId,
      appliedAt: ago(steps[0][1]),
      hiredAt: status === "hired" ? ago(last[1]) : null,
      archivedAt: status === "archived" ? ago(last[1]) : null,
    })
    .returning();
  let prev: string | null = null;
  for (const [type, d, st] of steps) {
    const to = stage(job, type).id;
    await db.insert(s.applicationStageEvents).values({ applicationId: app.id, fromStageId: prev, toStageId: to, status: st ?? "active", movedById: prev ? job.job.recruiterId : null, createdAt: ago(d) });
    prev = to;
  }
  return app;
}

async function world() {
  const admin = userActor(await makeUser("admin"));
  const rec = userActor(await makeUser("recruiter"));
  const otherRec = userActor(await makeUser("recruiter"));
  const hm = userActor(await makeUser("hiring_manager"));
  const exec = userActor(await makeUser("executive"));
  const iv = userActor(await makeUser("interviewer"));
  const pub = await makeJob({ recruiterId: rec.id, hiringManagerId: hm.id, title: "Analyst" });
  const secret = await makeJob({ recruiterId: rec.id, confidential: true, title: "Secret VP" });
  return { admin, rec, otherRec, hm, exec, iv, pub, secret };
}

const f90 = (a: UserActor, extra: Record<string, string> = {}) => resolveFilters(a, { range: "90d", ...extra });

describe("report filters", () => {
  it("resolves presets to whole days in the viewer's time zone", () => {
    const a = { kind: "user", id: "x", role: "admin", name: "", email: "", timezone: "America/Toronto" } as UserActor;
    const f = resolveFilters(a, { range: "30d" }, new Date("2026-07-15T12:00:00Z"));
    expect([f.fromDay, f.toDay]).toEqual(["2026-06-16", "2026-07-15"]);
    expect(f.from.toISOString()).toBe("2026-06-16T04:00:00.000Z");
    expect(f.toExclusive.toISOString()).toBe("2026-07-16T04:00:00.000Z");
  });

  it("orders a reversed custom range and ignores junk", () => {
    const a = { kind: "user", id: "x", role: "admin", name: "", email: "", timezone: "America/Toronto" } as UserActor;
    const f = resolveFilters(a, { range: "custom", from: "2026-05-31", to: "2026-05-01", brandId: "not-a-uuid" });
    expect([f.fromDay, f.toDay, f.brandId]).toEqual(["2026-05-01", "2026-05-31", undefined]);
    expect(resolveFilters(a, { range: "custom" }).range).toBe("90d");
    expect(resolveFilters(a, { range: "forever" }).range).toBe("90d");
  });
});

describe("standard reports", () => {
  beforeEach(resetDb);

  it("funnel counts the furthest stage reached, where people dropped, and drills down to the same records", async () => {
    const w = await world();
    await history(w.pub, [["review", 30], ["screen", 25], ["interview", 20], ["interview", 15, "archived"]]);
    await history(w.pub, [["review", 40], ["screen", 35], ["interview", 30], ["offer", 20], ["hired", 10, "hired"]]);
    await history(w.pub, [["review", 5]]);
    await history(w.pub, [["review", 200]]); // outside the window
    const f = f90(w.admin);
    const { total, funnel } = await rep.getFunnel(w.admin, f);
    const by = Object.fromEntries(funnel.map((r) => [r.stage, r]));
    expect(total).toBe(3);
    expect([by.review.reached, by.screen.reached, by.interview.reached, by.offer.reached, by.hired.reached]).toEqual([3, 2, 2, 1, 1]);
    expect(by.interview.archived).toBe(1);
    expect(by.review.active).toBe(1);
    expect(by.screen.conversion).toBe(1);
    expect(by.interview.conversion).toBe(0.5);

    expect((await drillDown(w.admin, f, { set: "reached", stage: "interview" })).rows).toHaveLength(2);
    expect((await drillDown(w.admin, f, { set: "archived_at", stage: "interview" })).rows).toHaveLength(1);
    expect((await drillDown(w.admin, f, { set: "hired" })).rows).toHaveLength(1);
    expect((await drillDown(w.admin, f, { set: "applied" })).rows).toHaveLength(3);
  });

  it("velocity uses the stage history: time to hire, time in stage, time to first touch", async () => {
    const w = await world();
    await history(w.pub, [["review", 40], ["screen", 30], ["interview", 25], ["offer", 15], ["hired", 10, "hired"]]);
    await history(w.pub, [["review", 30], ["screen", 26], ["interview", 20], ["offer", 14], ["hired", 10, "hired"]]);
    const v = await rep.getVelocity(w.admin, f90(w.admin));
    expect(v.timeToHire).toMatchObject({ median: 25, n: 2 });
    const review = v.timeInStage.find((r) => r.type === "review")!;
    expect(review).toMatchObject({ median: 7, n: 2 });
    expect(v.timeInStage.find((r) => r.type === "hired")).toBeUndefined();
    expect(v.timeToFirstTouch).toMatchObject({ median: 7, n: 2, waiting: 0 });
  });

  it("never counts confidential jobs for people outside their hiring team, and trims hiring managers to their jobs", async () => {
    const w = await world();
    const unrelated = await makeJob({ recruiterId: w.otherRec.id, title: "Other team" });
    await history(w.pub, [["review", 10]]);
    await history(w.secret, [["review", 10]]);
    await history(w.secret, [["review", 9]]);
    await history(unrelated, [["review", 8]]);

    const count = async (a: UserActor) => (await rep.getOverview(a, f90(a))).applications;
    expect(await count(w.admin)).toBe(4);
    expect(await count(w.exec)).toBe(4);
    expect(await count(w.rec)).toBe(4); // on the confidential job's team
    expect(await count(w.otherRec)).toBe(2); // public + their own
    expect(await count(w.hm)).toBe(1); // only the job they manage

    // Filtering to a job you can't see yields nothing rather than leaking it.
    expect((await rep.getOverview(w.otherRec, f90(w.otherRec, { jobId: w.secret.job.id }))).applications).toBe(0);
    expect((await drillDown(w.otherRec, f90(w.otherRec, { jobId: w.secret.job.id }), { set: "applied" })).rows).toHaveLength(0);
    const opts = await getReportFilterOptions(w.otherRec);
    expect(opts.jobs.map((j) => j.title).sort()).toEqual(["Analyst", "Other team"]);
  });

  it("interviewers can't open reports; hiring managers don't get per-person team analytics", async () => {
    const w = await world();
    await expect(rep.getOverview(w.iv, f90(w.iv))).rejects.toThrow(/Reports aren't available/);
    await expect(drillDown(w.iv, f90(w.iv), { set: "applied" })).rejects.toThrow(/Reports aren't available/);
    await expect(rep.getRecruiterProductivity(w.hm, f90(w.hm))).rejects.toThrow(/Team analytics/);
    await expect(rep.getInterviewerAnalytics(w.hm, f90(w.hm))).rejects.toThrow(/Team analytics/);
    await expect(rep.getRecruiterProductivity(w.rec, f90(w.rec))).resolves.toBeDefined();
  });

  it("offer analytics: acceptance excludes withdrawn offers; decline reasons are grouped; band position", async () => {
    const w = await world();
    await db.update(s.jobs).set({ compMin: 100_000, compMax: 120_000 }).where(sql`id = ${w.pub.job.id}`);
    const mk = async (status: "accepted" | "declined" | "withdrawn", base: number, reason?: string) => {
      const app = await history(w.pub, [["review", 30], ["offer", 20]]);
      await db.insert(s.offers).values({ applicationId: app.id, status, baseSalary: base, createdAt: ago(20), sentAt: ago(18), decidedAt: ago(15), declineReason: reason });
    };
    await mk("accepted", 110_000);
    await mk("declined", 95_000, "  compensation ");
    await mk("declined", 125_000, "Compensation");
    await mk("withdrawn", 110_000);
    const o = await rep.getOfferAnalytics(w.hm, f90(w.hm));
    expect(o).toMatchObject({ accepted: 1, declined: 2, medianDaysToDecision: 3 });
    expect(o.acceptanceRate).toBeCloseTo(1 / 3);
    expect(o.declineReasons).toEqual([{ reason: "Compensation", n: 2 }]);
    expect(o.band).toMatchObject({ below: 1, within: 1, above: 1, noBand: 0 });
  });

  it("interviewer analytics: timeliness and a calibration figure only past the minimum sample", async () => {
    const w = await world();
    const form = (await db.insert(s.feedbackForms).values({ name: "F" }).returning())[0];
    for (let i = 0; i < 6; i++) {
      const app = await history(w.pub, [["review", 30], ["interview", 20]]);
      const [int] = await db
        .insert(s.interviews)
        .values({ applicationId: app.id, title: "Panel", startAt: ago(10 + i), endAt: new Date(ago(10 + i).getTime() + 3_600_000), status: "completed", feedbackFormId: form.id })
        .returning();
      await db.insert(s.interviewInterviewers).values([{ interviewId: int.id, userId: w.iv.id }, ...(i === 0 ? [{ interviewId: int.id, userId: w.hm.id }] : [])]);
      const late = i >= 4;
      await db.insert(s.scorecards).values({ applicationId: app.id, interviewId: int.id, authorId: w.iv.id, overall: i < 3 ? "yes" : "no", submittedAt: new Date(int.endAt.getTime() + (late ? 48 : 2) * 3_600_000) });
      if (i === 0) await db.insert(s.scorecards).values({ applicationId: app.id, interviewId: int.id, authorId: w.hm.id, overall: "strong_yes", submittedAt: int.endAt });
    }
    const { interviewers } = await rep.getInterviewerAnalytics(w.rec, f90(w.rec));
    const me = interviewers.find((r) => r.user_id === w.iv.id)!;
    const hm = interviewers.find((r) => r.user_id === w.hm.id)!;
    expect(me).toMatchObject({ interviews: 6, submitted: 6, median_hours: 2, positive_rate: 0.5 });
    expect(me.within_24h).toBeCloseTo(4 / 6);
    expect(hm).toMatchObject({ interviews: 1, submitted: 1, positive_rate: null });
  });

  it("the reporting connection is read-only", async () => {
    await expect(reportingDb.execute(sql`INSERT INTO brands (name, slug) VALUES ('x', 'x')`)).rejects.toSatisfy(
      (e: unknown) => /read-only transaction/.test(String((e as { cause?: Error }).cause?.message ?? e)),
    );
  });
});

describe("point-in-time pipeline", () => {
  beforeEach(resetDb);

  it("rebuilds the pipeline on a past day from stage history, not from current state", async () => {
    const { getPipelineSnapshot } = await import("@/server/services/reports/snapshot");
    const w = await world();
    await history(w.pub, [["review", 30], ["screen", 20], ["interview", 10], ["interview", 5, "archived"]]);
    await history(w.pub, [["review", 30], ["screen", 25], ["offer", 18], ["hired", 12, "hired"]]);
    await history(w.pub, [["review", 3]]); // didn't exist yet
    const later = await makeJob({ recruiterId: w.rec.id, title: "Later job" });
    await history(later, [["review", 2]]);

    const tz = w.admin.timezone;
    const day = (d: number) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(ago(d));
    const f = f90(w.admin);
    const snap = await getPipelineSnapshot(w.admin, f, day(22));
    // 22 days ago: the first was still in review, the second had moved to screen.
    expect(snap.then.active).toMatchObject({ review: 1, screen: 1, interview: 0, offer: 0 });
    expect(snap.then.activeTotal).toBe(2);
    expect(snap.then.hired).toBe(0);
    // Now: one archived, one hired, two active in review.
    expect(snap.now).toMatchObject({ activeTotal: 2, archived: 1, hired: 1 });
    expect(snap.jobs.map((j) => [j.title, j.activeTotal, j.activeNow])).toEqual([
      ["Analyst", 2, 1],
      ["Later job", 0, 1],
    ]);

    // Still trimmed to visible jobs.
    const other = await getPipelineSnapshot(w.otherRec, f90(w.otherRec, { jobId: w.secret.job.id }), day(1));
    expect(other.now.activeTotal).toBe(0);
  });
});
