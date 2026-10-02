import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userActor, type UserActor } from "@/server/policy";
import { resolveFilters } from "@/server/services/reports/filters";
import * as builder from "@/server/services/reports/builder";
import * as saved from "@/server/services/reports/saved";
import { makeCandidate, makeJob, makeUser, resetDb } from "./fixtures";

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY);
const f90 = (a: UserActor, extra: Record<string, string> = {}) => resolveFilters(a, { range: "90d", ...extra });

async function world() {
  const admin = userActor(await makeUser("admin"));
  const rec = userActor(await makeUser("recruiter", "Rita Recruiter"));
  const otherRec = userActor(await makeUser("recruiter"));
  const hm = userActor(await makeUser("hiring_manager"));
  const iv = userActor(await makeUser("interviewer"));
  const [inbound, referral] = await db
    .insert(s.sources)
    .values([
      { name: "Careers page", category: "inbound" },
      { name: "Employee referral", category: "referral" },
    ])
    .returning();
  const pub = await makeJob({ recruiterId: rec.id, hiringManagerId: hm.id, title: "Analyst" });
  const secret = await makeJob({ recruiterId: rec.id, confidential: true, title: "Secret VP" });
  const app = async (job: typeof pub, sourceId: string | null, status: "active" | "hired" | "archived" = "active", appliedDaysAgo = 10) => {
    const c = await makeCandidate();
    const [a] = await db
      .insert(s.applications)
      .values({ candidateId: c.id, jobId: job.job.id, stageId: job.stages[1].id, sourceId, status, appliedAt: ago(appliedDaysAgo), hiredAt: status === "hired" ? ago(2) : null })
      .returning();
    return a;
  };
  await app(pub, inbound.id, "hired");
  await app(pub, inbound.id);
  await app(pub, referral.id);
  await app(pub, null);
  await app(secret, inbound.id);
  await app(pub, inbound.id, "active", 200); // outside the window
  return { admin, rec, otherRec, hm, iv, pub, secret, inbound, referral };
}

const bySource = { dataset: "applications", dateField: "applied_at", groupBy: ["source"], metrics: ["count", "hired", "hire_rate"], visualization: "bar" };

describe("report builder", () => {
  beforeEach(resetDb);

  it("groups, counts and totals within the window and the viewer's visible jobs", async () => {
    const w = await world();
    const r = await builder.runReport(w.admin, bySource, f90(w.admin));
    const rows = Object.fromEntries(r.rows.map((x) => [x.keys[0] ?? "none", x.values]));
    expect(rows["Careers page"]).toEqual([3, 1, 1 / 3]);
    expect(rows["Employee referral"]).toEqual([1, 0, 0]);
    expect(rows.none).toEqual([1, 0, 0]);
    expect(r.totals[0]).toBe(5);

    // The other recruiter can't see the confidential job.
    const other = await builder.runReport(w.otherRec, bySource, f90(w.otherRec));
    expect(other.totals[0]).toBe(4);
    // Hiring managers: only their job.
    expect((await builder.runReport(w.hm, bySource, f90(w.hm))).totals[0]).toBe(4);
  });

  it("filters by dimension values, including empty, and drills down to the same records", async () => {
    const w = await world();
    const def = { ...bySource, filters: [{ dimension: "source_category", values: ["Inbound", builder.NONE] }] };
    const r = await builder.runReport(w.otherRec, def, f90(w.otherRec));
    expect(r.totals[0]).toBe(3);
    const recs = await builder.reportRecords(w.otherRec, def, f90(w.otherRec), ["Careers page"]);
    expect(recs.rows).toHaveLength(2);
    expect(recs.rows.every((x) => x.job.startsWith("Analyst"))).toBe(true);
    expect((await builder.reportRecords(w.otherRec, def, f90(w.otherRec), [builder.NONE])).rows).toHaveLength(1);
    expect(await builder.dimensionValues(w.otherRec, def, "source", f90(w.otherRec))).toEqual(["Careers page", "Employee referral", builder.NONE]);
  });

  it("rejects anything that isn't in the catalogue", async () => {
    const w = await world();
    const f = f90(w.admin);
    await expect(builder.runReport(w.admin, { ...bySource, dataset: "users" }, f)).rejects.toThrow(/Unknown dataset/);
    await expect(builder.runReport(w.admin, { ...bySource, groupBy: ["candidate_email"] }, f)).rejects.toThrow(/isn't a dimension/);
    await expect(builder.runReport(w.admin, { ...bySource, metrics: ["sum(salary)"] }, f)).rejects.toThrow(/isn't a metric/);
    await expect(builder.runReport(w.admin, { ...bySource, dateField: "now()" }, f)).rejects.toThrow(/isn't a date/);
    // A filter value is a parameter, never SQL.
    const r = await builder.runReport(w.admin, { ...bySource, filters: [{ dimension: "source", values: ["x' OR '1'='1"] }] }, f);
    expect(r.totals[0]).toBe(0);
    expect(builder.decodeDefinition("not-base64-json")).toEqual(builder.DEFAULT_DEFINITION);
    expect(builder.validateDefinition({ ...bySource, visualization: "line" }).visualization).toBe("bar");
  });

  it("per-person breakdowns follow the team-analytics rule; compensation metrics are dropped for those who can't see pay", async () => {
    const w = await world();
    const byRecruiter = { ...bySource, groupBy: ["recruiter"] };
    await expect(builder.runReport(w.hm, byRecruiter, f90(w.hm))).rejects.toThrow(/by person/);
    await expect(builder.runReport(w.hm, { dataset: "interviewer_load", dateField: "start_at", metrics: ["count"] }, f90(w.hm))).rejects.toThrow(/by person/);
    await expect(builder.runReport(w.iv, bySource, f90(w.iv))).rejects.toThrow(/Reports aren't available/);
    const r = await builder.runReport(w.rec, byRecruiter, f90(w.rec));
    expect(r.rows[0].keys[0]).toBe("Rita Recruiter");
    expect(builder.builderCatalogue(w.hm).find((d) => d.key === "applications")!.dimensions.some((d) => d.key === "recruiter")).toBe(false);
    expect(builder.builderCatalogue(w.hm).some((d) => d.key === "interviewer_load")).toBe(false);
  });

  it("every dataset and metric in the catalogue runs", async () => {
    const w = await world();
    for (const ds of builder.builderCatalogue(w.admin)) {
      for (const dim of [undefined, ...ds.dimensions.map((d) => d.key)]) {
        const def = { dataset: ds.key, dateField: ds.dateFields[0].key, groupBy: dim ? [dim] : [], metrics: ds.metrics.slice(0, 4).map((m) => m.key) };
        await expect(builder.runReport(w.admin, def, f90(w.admin))).resolves.toBeDefined();
      }
      const rest = ds.metrics.slice(4).map((m) => m.key);
      if (rest.length) await builder.runReport(w.admin, { dataset: ds.key, dateField: ds.dateFields[0].key, metrics: rest }, f90(w.admin));
    }
  });
});

describe("saved reports and dashboards", () => {
  beforeEach(resetDb);

  it("saves, shares with named people, and each viewer runs it under their own access", async () => {
    const w = await world();
    const { id } = await saved.saveReport(w.rec, { name: "Sources", definition: bySource, filters: { range: "90d" }, visibility: "people", shareWith: [w.hm.id] });
    const audit = await db.query.auditLogs.findMany({ where: eq(s.auditLogs.entityId, id) });
    expect(audit.map((a) => a.action)).toEqual(["saved_report.created"]);

    expect((await saved.listSavedReports(w.hm)).map((r) => r.name)).toEqual(["Sources"]);
    expect(await saved.listSavedReports(w.otherRec)).toEqual([]);
    await expect(saved.getSavedReport(w.otherRec, id)).rejects.toThrow(/not found/i);

    const asHm = await saved.getSavedReport(w.hm, id);
    expect(asHm.canEdit).toBe(false);
    expect((await builder.runReport(w.hm, asHm.definition, f90(w.hm))).totals[0]).toBe(4);
    expect((await builder.runReport(w.rec, asHm.definition, f90(w.rec))).totals[0]).toBe(5);

    await expect(saved.saveReport(w.hm, { id, name: "Mine now", definition: bySource })).rejects.toThrow(/owner/);
    await expect(saved.deleteSavedReport(w.hm, id)).rejects.toThrow(/owner/);
  });

  it("can't share with someone who can't open reports, or save what you can't run", async () => {
    const w = await world();
    await expect(saved.saveReport(w.rec, { name: "Sources", definition: bySource, visibility: "people", shareWith: [w.iv.id] })).rejects.toThrow(/only be shared/);
    await expect(saved.saveReport(w.hm, { name: "By recruiter", definition: { ...bySource, groupBy: ["recruiter"] } })).rejects.toThrow(/by person/);
    await expect(saved.saveReport(w.rec, { name: "Bad", definition: { dataset: "nope" } })).rejects.toThrow();
  });

  it("dashboards hold reports the editor can open and hide tiles a viewer can't", async () => {
    const w = await world();
    const pub = await saved.saveReport(w.rec, { name: "Everyone's", definition: bySource, visibility: "everyone" });
    const priv = await saved.saveReport(w.rec, { name: "Private", definition: bySource });
    const otherPriv = await saved.saveReport(w.otherRec, { name: "Not yours", definition: bySource });
    await expect(saved.saveDashboard(w.rec, { name: "Board", reportIds: [otherPriv.id] })).rejects.toThrow(/not found/i);
    const { id } = await saved.saveDashboard(w.rec, { name: "Board", reportIds: [pub.id, priv.id], visibility: "everyone" });
    const mine = await saved.getDashboard(w.rec, id);
    expect(mine.items.map((i) => i.name)).toEqual(["Everyone's", "Private"]);
    const theirs = await saved.getDashboard(w.hm, id);
    expect(theirs.items.map((i) => i.name)).toEqual(["Everyone's"]);
    expect(theirs.hiddenTiles).toBe(1);

    // Deleting a report removes its tile.
    await saved.deleteSavedReport(w.rec, pub.id);
    expect((await saved.getDashboard(w.rec, id)).items.map((i) => i.name)).toEqual(["Private"]);
    await saved.addToDashboard(w.rec, id, pub.id).catch((e) => expect(String(e)).toMatch(/not found/i));
    await saved.deleteDashboard(w.rec, id);
    const actions = (await db.query.auditLogs.findMany()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["report_dashboard.created", "saved_report.deleted", "report_dashboard.deleted"]));
  });
});
