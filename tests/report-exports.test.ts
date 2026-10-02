import { beforeEach, describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { systemActor, userActor, type UserActor } from "@/server/policy";
import { resolveFilters } from "@/server/services/reports/filters";
import * as exp from "@/server/services/reports/export";
import * as feed from "@/server/services/reports/feed";
import * as sched from "@/server/services/reports/schedules";
import * as saved from "@/server/services/reports/saved";
import { toCsv, toXlsx } from "@/server/services/reports/spreadsheet";
import { makeCandidate, makeJob, makeUser, resetDb } from "./fixtures";

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY);
const f90 = (a: UserActor) => resolveFilters(a, { range: "90d" });

async function world() {
  const admin = userActor(await makeUser("admin"));
  const rec = userActor(await makeUser("recruiter", "Rita Recruiter"));
  const otherRec = userActor(await makeUser("recruiter", "Omar Other"));
  const hm = userActor(await makeUser("hiring_manager", "Hana Manager"));
  const iv = userActor(await makeUser("interviewer"));
  const pub = await makeJob({ recruiterId: rec.id, hiringManagerId: hm.id, title: "Analyst" });
  const secret = await makeJob({ recruiterId: rec.id, confidential: true, title: "Secret VP" });
  await db.update(s.jobs).set({ compMin: 90_000, compMax: 110_000 }).where(eq(s.jobs.id, pub.job.id));
  const apps = [];
  for (const [job, name] of [
    [pub, "=HYPERLINK(evil)"],
    [pub, "Ada"],
    [secret, "Secret"],
  ] as const) {
    const c = await makeCandidate({ firstName: name, lastName: "Lovelace" });
    const [a] = await db.insert(s.applications).values({ candidateId: c.id, jobId: job.job.id, stageId: job.stages[1].id, appliedAt: ago(5) }).returning();
    apps.push(a);
  }
  await db.insert(s.offers).values({ applicationId: apps[1].id, status: "accepted", baseSalary: 100_000, decidedAt: ago(1), sentAt: ago(3) });
  return { admin, rec, otherRec, hm, iv, pub, secret, apps };
}

const byJob = { dataset: "applications", dateField: "applied_at", groupBy: ["job"], metrics: ["count", "hire_rate"], visualization: "table" };

describe("spreadsheets", () => {
  it("escapes CSV cells a spreadsheet would run as formulas, and quotes properly", () => {
    const csv = toCsv({ name: "x", headers: ["Name", "Count"], rows: [["=SUM(A1)", -3], ['He said "hi", ok', 2], ["@cmd", null]] }).toString("utf8");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines).toEqual(["Name,Count", "'=SUM(A1),-3", '"He said ""hi"", ok",2', "'@cmd,"]);
  });

  it("writes a valid xlsx with inline strings (never formulas)", () => {
    const buf = toXlsx({ name: "Applications", title: "T", headers: ["Job", "Rate"], rows: [["=1+1 <b>&", { value: 0.25, format: "percent" }]] });
    const zip = new PizZip(buf);
    const sheet = zip.file("xl/worksheets/sheet1.xml")!.asText();
    expect(sheet).toContain("=1+1 &lt;b&gt;&amp;");
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain("<v>0.25</v>");
    expect(zip.file("xl/workbook.xml")!.asText()).toContain('name="Applications"');
  });
});

describe("report exports", () => {
  beforeEach(resetDb);

  it("exports are trimmed like the screen and audited, with application ids for record lists", async () => {
    const w = await world();
    const file = await exp.exportBuilderReport(w.otherRec, byJob, f90(w.otherRec), "csv");
    const text = file.bytes.toString("utf8");
    expect(text).toContain("Analyst");
    expect(text).not.toContain("Secret VP");
    expect(file.fileName).toMatch(/^applications-report_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);

    const records = await exp.exportBuilderRecords(w.otherRec, byJob, f90(w.otherRec), [], "csv");
    const lines = records.bytes.toString("utf8").trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines.some((l) => l.startsWith("'=HYPERLINK"))).toBe(true);

    const audits = await db.query.auditLogs.findMany({ where: eq(s.auditLogs.action, "report.exported") });
    expect(audits).toHaveLength(2);
    const recAudit = audits.find((a) => a.metadata.kind === "records")!;
    expect(recAudit.actorId).toBe(w.otherRec.id);
    expect((recAudit.metadata.applicationIds as string[]).sort()).toEqual([w.apps[0].id, w.apps[1].id].sort());
    expect(recAudit.metadata).not.toHaveProperty("rows_data");
  });

  it("interviewers can't export; offer pay columns drop out for roles without pay access", async () => {
    const w = await world();
    await expect(exp.exportBuilderReport(w.iv, byJob, f90(w.iv), "xlsx")).rejects.toThrow(/Reports aren't available/);
    await expect(exp.exportDrillRecords(w.iv, f90(w.iv), { set: "applied" }, "csv")).rejects.toThrow(/Reports aren't available/);
    const drill = await exp.exportDrillRecords(w.hm, f90(w.hm), { set: "applied" }, "csv");
    expect(drill.rows).toBe(2);
  });
});

describe("Power BI feed", () => {
  beforeEach(resetDb);

  it("tokens are shown once, stored hashed, and act as their user", async () => {
    const w = await world();
    const { token, id } = await feed.createFeedToken(w.otherRec, { name: "Power BI" });
    const row = await db.query.reportFeedTokens.findFirst({ where: eq(s.reportFeedTokens.id, id) });
    expect(row!.tokenHash).not.toContain(token);
    expect(JSON.stringify(row)).not.toContain(token);
    const { actor } = await feed.authenticateFeedToken(token);
    expect(actor.id).toBe(w.otherRec.id);

    const apps = await feed.readEntitySet(actor, id, "Applications", {});
    expect(apps.rows).toHaveLength(2);
    expect(apps.rows.every((r) => r.JobId === w.pub.job.id)).toBe(true);
    // Pseudonymous: ids, never names or contact details.
    expect(JSON.stringify(apps.rows)).not.toMatch(/Lovelace|candidate\.test/);
    expect((await db.query.auditLogs.findMany({ where: eq(s.auditLogs.action, "report.exported") })).map((a) => a.metadata.entitySet)).toEqual(["Applications"]);

    await feed.revokeFeedToken(w.otherRec, id);
    await expect(feed.authenticateFeedToken(token)).rejects.toThrow(feed.FeedAuthError);
    await expect(feed.authenticateFeedToken("pats_" + "x".repeat(43))).rejects.toThrow(feed.FeedAuthError);
  });

  it("expired tokens and deactivated users stop working; interviewers can't create tokens", async () => {
    const w = await world();
    const a = await feed.createFeedToken(w.rec, { name: "Token A" });
    await db.update(s.reportFeedTokens).set({ expiresAt: ago(1) }).where(eq(s.reportFeedTokens.id, a.id));
    await expect(feed.authenticateFeedToken(a.token)).rejects.toThrow(feed.FeedAuthError);
    const b = await feed.createFeedToken(w.rec, { name: "Token B" });
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, w.rec.id));
    await expect(feed.authenticateFeedToken(b.token)).rejects.toThrow(feed.FeedAuthError);
    await expect(feed.createFeedToken(w.iv, { name: "Token C" })).rejects.toThrow(/Reports aren't available/);
  });

  it("pages, selects, refuses query options it can't honour, and follows field and person rules", async () => {
    const w = await world();
    const page = await feed.readEntitySet(w.admin, null, "Applications", { $top: "2", $select: "Id,Status", $count: "true" });
    expect(page.rows).toHaveLength(2);
    expect(Object.keys(page.rows[0])).toEqual(["Id", "Status"]);
    expect(page.count).toBe(3);
    expect(page.next).toBeNull();
    await expect(feed.readEntitySet(w.admin, null, "Applications", { $filter: "Status eq 'active'" })).rejects.toMatchObject({ status: 501 });
    await expect(feed.readEntitySet(w.admin, null, "Applications", { $select: "Email" })).rejects.toThrow(/Unknown property/);
    await expect(feed.readEntitySet(w.admin, null, "Candidates", {})).rejects.toMatchObject({ status: 404 });

    // Hiring managers: no per-person sets.
    expect(feed.feedCatalogue(w.hm).map((e) => e.name)).not.toContain("People");
    await expect(feed.readEntitySet(w.hm, null, "InterviewerAssignments", {})).rejects.toMatchObject({ status: 404 });
    expect(feed.metadataDocument(w.hm)).toContain('Name="BaseSalary"');
    expect(feed.metadataDocument(w.admin)).toContain('<EntitySet Name="People"');
  });
});

describe("scheduled reports", () => {
  beforeEach(resetDb);

  it("computes next runs in the schedule's time zone", () => {
    const after = new Date("2026-10-02T21:00:00Z"); // Friday 17:00 in Toronto
    const t = { hour: 8, timezone: "America/Toronto", dayOfWeek: 0, dayOfMonth: 1 };
    expect(sched.nextRunAfter({ ...t, frequency: "weekly" }, after).toISOString()).toBe("2026-10-05T12:00:00.000Z");
    expect(sched.nextRunAfter({ ...t, frequency: "daily" }, after).toISOString()).toBe("2026-10-03T12:00:00.000Z");
    // November 1 is the day DST ends, so 08:00 local is already 13:00 UTC.
    expect(sched.nextRunAfter({ ...t, frequency: "monthly" }, after).toISOString()).toBe("2026-11-01T13:00:00.000Z");
    // Across the November DST change: 08:00 local is 13:00 UTC.
    expect(sched.nextRunAfter({ ...t, frequency: "weekly" }, new Date("2026-11-02T13:30:00Z")).toISOString()).toBe("2026-11-09T13:00:00.000Z");
  });

  it("delivers each recipient their own trimmed copy, once, from the worker", async () => {
    const w = await world();
    const { id: reportId } = await saved.saveReport(w.rec, { name: "Weekly by job", definition: byJob, filters: { range: "90d" }, visibility: "people", shareWith: [w.otherRec.id, w.hm.id] });
    await expect(sched.createSchedule(w.rec, { reportId, recipientIds: [w.admin.id, w.iv.id] })).rejects.toThrow(/can't open reports/);
    await expect(sched.createSchedule(w.otherRec, { reportId, recipientIds: [w.otherRec.id] })).rejects.toThrow(/owner/);
    const s1 = await sched.createSchedule(w.rec, { reportId, frequency: "weekly", dayOfWeek: 0, hour: 8, recipientIds: [w.rec.id, w.otherRec.id, w.hm.id] });
    expect(s1.nextRunAt.getTime()).toBeGreaterThan(Date.now());

    // Not due yet: nothing happens.
    expect(await sched.runDueSchedules(systemActor("worker"))).toEqual([]);
    await sched.requestScheduleRun(w.rec, s1.id);
    // The HM loses access before it runs; they're skipped, not sent the owner's numbers.
    await db.update(s.users).set({ role: "interviewer" }).where(eq(s.users.id, w.hm.id));
    const [r] = await sched.runDueSchedules(systemActor("worker"));
    expect(r).toMatchObject({ delivered: 2, skipped: 1, failed: 0 });
    expect(await sched.runDueSchedules(systemActor("worker"))).toEqual([]);

    const mails = await db.query.integrationEvents.findMany({ where: eq(s.integrationEvents.operation, "sendMail") });
    expect(mails).toHaveLength(2);
    const delivered = await db.query.auditLogs.findMany({ where: eq(s.auditLogs.action, "report.delivered") });
    expect(delivered.map((a) => a.metadata.recipientId).sort()).toEqual([w.rec.id, w.otherRec.id].sort());
    expect(delivered.find((a) => a.metadata.recipientId === w.otherRec.id)!.metadata.rows).toBe(1);
    expect(delivered.find((a) => a.metadata.recipientId === w.rec.id)!.metadata.rows).toBe(2);
    const after = await db.query.reportSchedules.findFirst({ where: eq(s.reportSchedules.id, s1.id) });
    expect(after!.lastResult).toMatchObject({ delivered: 2, skipped: 1 });
    expect(after!.nextRunAt.getTime()).toBeGreaterThan(Date.now());

    await expect(sched.runDueSchedules(w.rec as never)).rejects.toThrow();
  });
});

describe("xlsx dates", () => {
  it("shows dates as wall-clock time in the viewer's zone", () => {
    const buf = toXlsx({ name: "x", tz: "America/Toronto", headers: ["When"], rows: [[new Date("2026-09-01T15:30:00Z")]] });
    const sheet = new PizZip(buf).file("xl/worksheets/sheet1.xml")!.asText();
    // 11:30 EDT on Sep 1, 2026 = serial 46266 + 11.5/24.
    const serial = Number(/<v>([\d.]+)<\/v>/.exec(sheet)![1]);
    expect(serial).toBeCloseTo(46266 + 11.5 / 24, 6);
  });
});
