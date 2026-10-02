import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { TZDate } from "@date-fns/tz";
import { db, schema as s } from "@/db";
import { m365 } from "@/server/integrations/m365";
import { canViewReports, ForbiddenError, NotFoundError, systemActor, userActor, type Actor, type UserActor } from "@/server/policy";
import { recordAudit } from "../audit";
import { runReport, validateDefinition } from "./builder";
import { resultTable } from "./export";
import { resolveFilters } from "./filters";
import { getSavedReport } from "./saved";
import { EXPORT_TYPES, renderTable } from "./spreadsheet";
import { assertCanViewReports } from "./standard";

/**
 * Scheduled report delivery by email (PRD §7.3). The worker process (src/worker) picks up due
 * schedules; requests never send mail themselves (ARCHITECTURE.md D5). Each recipient gets their own
 * copy, run under their own access, so a schedule can't send anyone numbers they couldn't open.
 * Teams delivery and PDF come with the Teams app (Phase 6).
 */

export const FREQUENCIES = ["daily", "weekly", "monthly"] as const;
const SENDER_MAILBOX = () => process.env.M365_SENDER_MAILBOX ?? "careers@purpose.demo";
const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

const validTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const scheduleSchema = z
  .object({
    reportId: z.uuid(),
    frequency: z.enum(FREQUENCIES).default("weekly"),
    dayOfWeek: z.coerce.number().int().min(0).max(6).nullable().default(0),
    dayOfMonth: z.coerce.number().int().min(1).max(28).nullable().default(1),
    hour: z.coerce.number().int().min(0).max(23).default(8),
    timezone: z.string().refine(validTimeZone, "Unknown time zone.").default("America/Toronto"),
    format: z.enum(["xlsx", "csv"]).default("xlsx"),
    recipientIds: z.array(z.uuid()).min(1, "Add at least one recipient.").max(25),
  })
  .transform((d) => ({ ...d, dayOfWeek: d.frequency === "weekly" ? (d.dayOfWeek ?? 0) : null, dayOfMonth: d.frequency === "monthly" ? (d.dayOfMonth ?? 1) : null }));
export type ScheduleInput = z.input<typeof scheduleSchema>;

type Timing = { frequency: (typeof FREQUENCIES)[number]; dayOfWeek: number | null; dayOfMonth: number | null; hour: number; timezone: string };

/** The first run strictly after `after`, at the schedule's local hour. */
export function nextRunAfter(t: Timing, after: Date): Date {
  const local = new TZDate(after.getTime(), t.timezone);
  for (let i = 0; i <= 62; i++) {
    const d = new TZDate(local.getFullYear(), local.getMonth(), local.getDate() + i, t.hour, 0, 0, t.timezone);
    if (d.getTime() <= after.getTime()) continue;
    const dow = (d.getDay() + 6) % 7;
    if (t.frequency === "daily") return new Date(d.getTime());
    if (t.frequency === "weekly" && dow === t.dayOfWeek) return new Date(d.getTime());
    if (t.frequency === "monthly" && d.getDate() === t.dayOfMonth) return new Date(d.getTime());
  }
  throw new Error("Couldn't compute the next run.");
}

/** Recipients must be active staff who can open this report. */
async function assertRecipients(reportId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  const users = await db.query.users.findMany({ where: inArray(s.users.id, unique) });
  if (users.length !== unique.length) throw new NotFoundError("Recipient");
  for (const u of users) {
    const a = userActor(u);
    if (!u.active || !canViewReports(a)) throw new ForbiddenError(`${u.name} can't open reports.`);
    try {
      await getSavedReport(a, reportId);
    } catch {
      throw new ForbiddenError(`${u.name} doesn't have access to this report. Share it with them first.`);
    }
  }
  return unique;
}

async function ownedReport(actor: UserActor, reportId: string) {
  const report = await getSavedReport(actor, reportId);
  if (!report.canEdit) throw new ForbiddenError("Only the report's owner can schedule it.");
  return report;
}

export async function createSchedule(actor: UserActor, input: ScheduleInput) {
  assertCanViewReports(actor);
  const d = scheduleSchema.parse(input);
  await ownedReport(actor, d.reportId);
  const recipientIds = await assertRecipients(d.reportId, d.recipientIds);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.reportSchedules)
      .values({ ...d, recipientIds, ownerId: actor.id, nextRunAt: nextRunAfter(d, new Date()) })
      .returning();
    await recordAudit(tx, actor, "report_schedule.created", "report_schedule", row.id, { reportId: d.reportId, frequency: d.frequency, recipients: recipientIds.length, format: d.format });
    return row;
  });
}

async function ownedSchedule(actor: UserActor, id: string) {
  const row = await db.query.reportSchedules.findFirst({ where: eq(s.reportSchedules.id, id) });
  if (!row) throw new NotFoundError("Schedule");
  if (row.ownerId !== actor.id && actor.role !== "admin") throw new ForbiddenError("Only the schedule's owner can change it.");
  return row;
}

export async function setScheduleActive(actor: UserActor, id: string, active: boolean) {
  assertCanViewReports(actor);
  const row = await ownedSchedule(actor, id);
  await db.transaction(async (tx) => {
    await tx
      .update(s.reportSchedules)
      .set({ active, updatedAt: new Date(), ...(active ? { nextRunAt: nextRunAfter(row, new Date()) } : {}) })
      .where(eq(s.reportSchedules.id, id));
    await recordAudit(tx, actor, active ? "report_schedule.resumed" : "report_schedule.paused", "report_schedule", id);
  });
}

export async function deleteSchedule(actor: UserActor, id: string) {
  assertCanViewReports(actor);
  await ownedSchedule(actor, id);
  await db.transaction(async (tx) => {
    await tx.delete(s.reportSchedules).where(eq(s.reportSchedules.id, id));
    await recordAudit(tx, actor, "report_schedule.deleted", "report_schedule", id);
  });
}

/** "Send now": due immediately; the worker sends it on its next pass. */
export async function requestScheduleRun(actor: UserActor, id: string) {
  assertCanViewReports(actor);
  const row = await ownedSchedule(actor, id);
  if (!row.active) throw new ForbiddenError("Resume the schedule first.");
  await db.transaction(async (tx) => {
    await tx.update(s.reportSchedules).set({ nextRunAt: new Date(), updatedAt: new Date() }).where(eq(s.reportSchedules.id, id));
    await recordAudit(tx, actor, "report_schedule.run_requested", "report_schedule", id);
  });
}

export async function listSchedules(actor: UserActor, reportId: string) {
  const report = await getSavedReport(actor, reportId);
  if (!report.canEdit) return [];
  const rows = await db.query.reportSchedules.findMany({ where: eq(s.reportSchedules.reportId, reportId), orderBy: asc(s.reportSchedules.createdAt) });
  const ids = [...new Set(rows.flatMap((r) => r.recipientIds))];
  const people = ids.length ? await db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, ids)) : [];
  const name = new Map(people.map((p) => [p.id, p.name]));
  return rows.map((r) => ({ ...r, recipients: r.recipientIds.map((id) => ({ id, name: name.get(id) ?? "Unknown" })) }));
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export type DeliveryResult = { scheduleId: string; delivered: number; skipped: number; failed: number };

/**
 * Claims due schedules (FOR UPDATE SKIP LOCKED, so several workers can run) and advances their next
 * run before sending, so a crash mid-send never sends the same run twice.
 */
export async function runDueSchedules(actor: Actor = systemActor("worker"), now = new Date(), limit = 10): Promise<DeliveryResult[]> {
  if (actor.kind !== "system" || actor.name !== "worker") throw new ForbiddenError();
  const claimed = await db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(s.reportSchedules)
      .where(and(eq(s.reportSchedules.active, true), sql`${s.reportSchedules.nextRunAt} <= ${now.toISOString()}::timestamptz`))
      .orderBy(asc(s.reportSchedules.nextRunAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    for (const d of due) await tx.update(s.reportSchedules).set({ nextRunAt: nextRunAfter(d, now), lastRunAt: now }).where(eq(s.reportSchedules.id, d.id));
    return due;
  });
  const results: DeliveryResult[] = [];
  for (const sched of claimed) results.push(await deliver(actor, sched, now));
  return results;
}

async function deliver(worker: Actor, sched: typeof s.reportSchedules.$inferSelect, now: Date): Promise<DeliveryResult> {
  const result: DeliveryResult = { scheduleId: sched.id, delivered: 0, skipped: 0, failed: 0 };
  const owner = await db.query.users.findFirst({ where: eq(s.users.id, sched.ownerId) });
  const recipients = await db.query.users.findMany({ where: inArray(s.users.id, sched.recipientIds) });
  for (const user of recipients) {
    const actor = userActor(user);
    try {
      // Access is re-checked at send time: people change roles and reports change hands.
      if (!owner?.active || !user.active || !canViewReports(actor)) throw new ForbiddenError();
      const report = await getSavedReport(actor, sched.reportId);
      const f = resolveFilters(actor, report.filters, now);
      const res = await runReport(actor, validateDefinition(report.definition), f);
      const file = renderTable(resultTable(res, `${report.name} · ${f.fromDay} to ${f.toDay}`), sched.format);
      const fileName = `${report.name.replace(/[^\w\- ]+/g, "").trim() || "report"} ${f.toDay}.${EXPORT_TYPES[sched.format].ext}`;
      await m365().mail.send({
        from: SENDER_MAILBOX(),
        to: user.email,
        subject: `${report.name} (${f.fromDay} to ${f.toDay})`,
        body: [
          `Hi ${user.name.split(" ")[0]},`,
          "",
          `Your scheduled PATS report "${report.name}" is attached (${res.rows.length} rows, ${f.fromDay} to ${f.toDay}).`,
          "The numbers cover only the jobs you have access to.",
          "",
          `Open it in PATS: ${appUrl()}/reports/saved/${report.id}`,
          "",
          `Sent on a schedule set up by ${owner.name}. To stop receiving it, ask them to remove you.`,
        ].join("\n"),
        attachments: [{ name: fileName, contentType: EXPORT_TYPES[sched.format].contentType.split(";")[0], bytes: file }],
      });
      await db.transaction((tx) =>
        recordAudit(tx, worker, "report.delivered", "saved_report", sched.reportId, { scheduleId: sched.id, recipientId: user.id, rows: res.rows.length, format: sched.format }),
      );
      result.delivered++;
    } catch (e) {
      if (e instanceof ForbiddenError || e instanceof NotFoundError) result.skipped++;
      else {
        result.failed++;
        // No message text: provider errors can carry addresses (ARCHITECTURE.md §4.6).
        console.error(`[report-schedules] delivery failed for schedule ${sched.id}: ${(e as Error).name}`);
      }
    }
  }
  result.skipped += sched.recipientIds.length - recipients.length;
  await db.update(s.reportSchedules).set({ lastResult: { delivered: result.delivered, skipped: result.skipped, failed: result.failed, at: now.toISOString() } }).where(eq(s.reportSchedules.id, sched.id));
  return result;
}
