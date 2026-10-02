import "server-only";
import { and, asc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { DEFAULT_STAGES } from "@/lib/stages";
import {
  assertCanSeeJobs,
  canViewCompensation,
  canViewJobRow,
  NotFoundError,
  requireRecruiting,
  type UserActor,
  type Actor,
  visibleJobsFilter,
} from "@/server/policy";
import { cancelPendingApprovals, latestApproval, notifyApprover, startApproval } from "./approvals";
import { recordAudit } from "./audit";
import type { Tx } from "./tx";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type JobListFilters = { status?: string; brand?: string; q?: string };

export async function listJobs(actor: UserActor, f: JobListFilters) {
  const where: (SQL | undefined)[] = [visibleJobsFilter(actor)];
  if (f.status && f.status !== "all") where.push(eq(s.jobs.status, f.status as "open"));
  if (f.brand) where.push(eq(s.brands.slug, f.brand));
  if (f.q) where.push(ilike(s.jobs.title, `%${f.q}%`));

  const hm = sql.raw("hm");
  const rec = sql.raw("rec");
  return db
    .select({
      id: s.jobs.id,
      title: s.jobs.title,
      status: s.jobs.status,
      confidential: s.jobs.confidential,
      openedAt: s.jobs.openedAt,
      createdAt: s.jobs.createdAt,
      brand: s.brands.name,
      brandColor: s.brands.primaryColor,
      department: s.departments.name,
      location: s.locations.name,
      hmName: sql<string | null>`${hm}.name`,
      recruiterName: sql<string | null>`${rec}.name`,
      openings: sql<number>`(SELECT count(*)::int FROM openings o WHERE o.job_id = ${s.jobs.id} AND o.status = 'open')`,
      /** Active application counts keyed by stage type. */
      byType: sql<Record<string, number>>`(
        SELECT coalesce(jsonb_object_agg(t.type, t.n), '{}'::jsonb) FROM (
          SELECT st.type, count(*)::int AS n FROM applications a
          JOIN job_stages st ON st.id = a.stage_id
          WHERE a.job_id = ${s.jobs.id} AND a.status = 'active'
          GROUP BY st.type
        ) t)`,
      hired: sql<number>`(SELECT count(*)::int FROM applications a WHERE a.job_id = ${s.jobs.id} AND a.status = 'hired')`,
    })
    .from(s.jobs)
    .innerJoin(s.brands, eq(s.brands.id, s.jobs.brandId))
    .leftJoin(s.departments, eq(s.departments.id, s.jobs.departmentId))
    .leftJoin(s.locations, eq(s.locations.id, s.jobs.locationId))
    .leftJoin(sql`users hm`, sql`hm.id = ${s.jobs.hiringManagerId}`)
    .leftJoin(sql`users rec`, sql`rec.id = ${s.jobs.recruiterId}`)
    .where(and(...where))
    .orderBy(asc(s.jobs.title));
}

export async function jobStatusCounts(actor: UserActor) {
  const rows = await db
    .select({ status: s.jobs.status, n: sql<number>`count(*)::int` })
    .from(s.jobs)
    .where(visibleJobsFilter(actor))
    .groupBy(s.jobs.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
}

export async function getJobDetail(actor: UserActor, jobId: string) {
  const job = await db.query.jobs.findFirst({
    where: eq(s.jobs.id, jobId),
    with: {
      brand: true,
      department: true,
      location: true,
      hiringManager: true,
      recruiter: true,
      coordinator: true,
      stages: { orderBy: asc(s.jobStages.position) },
      openings: { orderBy: asc(s.openings.code) },
      team: { with: { user: true } },
    },
  });
  if (!job || !canViewJobRow(actor, job, job.team.map((t) => t.userId))) return null;
  return canViewCompensation(actor) ? job : { ...job, compMin: null, compMax: null };
}

/** The job's latest approval run, for the job page (visibility checked). */
export async function getJobApproval(actor: UserActor, jobId: string) {
  await assertCanSeeJobs(actor, [jobId]);
  return latestApproval("job", jobId);
}

export type PipelineApp = Awaited<ReturnType<typeof getPipeline>>[number];

export async function getPipeline(actor: UserActor, jobId: string, status: "active" | "archived" | "hired") {
  await assertCanSeeJobs(actor, [jobId]);
  return db
    .select({
      id: s.applications.id,
      stageId: s.applications.stageId,
      status: s.applications.status,
      appliedAt: s.applications.appliedAt,
      stageEnteredAt: s.applications.stageEnteredAt,
      candidateId: s.candidates.id,
      firstName: s.candidates.firstName,
      lastName: s.candidates.lastName,
      currentTitle: s.candidates.currentTitle,
      currentCompany: s.candidates.currentCompany,
      location: s.candidates.location,
      source: s.sources.name,
      sourceCategory: s.sources.category,
      archiveReason: s.archiveReasons.name,
      feedback: sql<Record<string, number>>`(
        SELECT coalesce(jsonb_object_agg(t.overall, t.n), '{}'::jsonb) FROM (
          SELECT sc.overall, count(*)::int AS n FROM scorecards sc WHERE sc.application_id = ${s.applications.id} GROUP BY sc.overall
        ) t)`,
      nextInterview: sql<string | null>`(
        SELECT min(i.start_at) FROM interviews i
        WHERE i.application_id = ${s.applications.id} AND i.start_at > now() AND i.status = 'scheduled')`,
    })
    .from(s.applications)
    .innerJoin(s.candidates, eq(s.candidates.id, s.applications.candidateId))
    .leftJoin(s.sources, eq(s.sources.id, s.applications.sourceId))
    .leftJoin(s.archiveReasons, eq(s.archiveReasons.id, s.applications.archiveReasonId))
    .where(and(eq(s.applications.jobId, jobId), eq(s.applications.status, status)))
    .orderBy(asc(s.applications.stageEnteredAt));
}

export async function pipelineCounts(actor: UserActor, jobId: string) {
  await assertCanSeeJobs(actor, [jobId]);
  const rows = await db
    .select({ status: s.applications.status, n: sql<number>`count(*)::int` })
    .from(s.applications)
    .where(eq(s.applications.jobId, jobId))
    .groupBy(s.applications.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
}

export async function listBrands() {
  return db.query.brands.findMany({ orderBy: asc(s.brands.name) });
}

/** Dropdown data for the new-job form. */
export async function getJobFormOptions(actor: Actor) {
  requireRecruiting(actor);
  const [brands, departments, locations, users] = await Promise.all([
    listBrands(),
    db.query.departments.findMany({ orderBy: asc(s.departments.name) }),
    db.query.locations.findMany({ orderBy: asc(s.locations.name) }),
    db
      .select({ id: s.users.id, name: s.users.name, role: s.users.role, title: s.users.title })
      .from(s.users)
      .where(eq(s.users.active, true))
      .orderBy(asc(s.users.name)),
  ]);
  return { brands, departments, locations, users };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const optionalId = z.string().uuid().optional().or(z.literal("")).transform((v) => v || null);
const optionalInt = z.coerce.number().int().positive().optional().or(z.literal("")).transform((v) => (v === "" || v === undefined ? null : v));

export const createJobSchema = z.object({
  title: z.string().trim().min(2, "Title is required"),
  brandId: z.string().uuid(),
  departmentId: optionalId,
  locationId: optionalId,
  employmentType: z.enum(s.employmentType.enumValues),
  workplaceType: z.enum(s.workplaceType.enumValues),
  compMin: optionalInt,
  compMax: optionalInt,
  hiringManagerId: optionalId,
  recruiterId: optionalId,
  coordinatorId: optionalId,
  description: z.string().optional(),
  openings: z.coerce.number().int().min(1).max(50).default(1),
  confidential: z.coerce.boolean().default(false),
  status: z.enum(["draft", "open"]),
});

/**
 * Opening a job that has never been open goes through the job approval chain, if one applies
 * (ARCHITECTURE.md §7.4). Returns the status the job should take and who to notify.
 */
async function requestOpen(tx: Tx, actor: Actor, job: typeof s.jobs.$inferSelect) {
  const started = await startApproval(tx, actor, "job", job.id, {
    job: { id: job.id, brandId: job.brandId, departmentId: job.departmentId, hiringManagerId: job.hiringManagerId, recruiterId: job.recruiterId },
  });
  return started ? { status: "pending_approval" as const, notify: started.firstApproverId } : { status: "open" as const, notify: null };
}

/** Values for a job that is (re)opening now. */
function openValues(job: { openedAt: Date | null; confidential: boolean }, firstOpen: boolean) {
  return { status: "open" as const, openedAt: job.openedAt ?? new Date(), closedAt: null, publishedOnCareerSite: firstOpen ? !job.confidential : undefined };
}

export async function createJob(actor: Actor, d: z.output<typeof createJobSchema>) {
  const user = requireRecruiting(actor, "You don't have permission to create jobs.");
  const { jobId, notify } = await db.transaction(async (tx) => {
    const [job] = await tx
      .insert(s.jobs)
      .values({
        title: d.title,
        brandId: d.brandId,
        departmentId: d.departmentId,
        locationId: d.locationId,
        employmentType: d.employmentType,
        workplaceType: d.workplaceType,
        compMin: d.compMin,
        compMax: d.compMax,
        hiringManagerId: d.hiringManagerId,
        recruiterId: d.recruiterId ?? user.id,
        coordinatorId: d.coordinatorId,
        description: d.description || null,
        confidential: d.confidential,
        status: "draft",
      })
      .returning();
    await tx.insert(s.jobStages).values(DEFAULT_STAGES.map((st, i) => ({ ...st, jobId: job.id, position: i })));
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(substring(code from 5)::int), 999) + 1` }).from(s.openings);
    await tx.insert(s.openings).values(Array.from({ length: d.openings }, (_, i) => ({ jobId: job.id, code: `REQ-${next + i}` })));
    await recordAudit(tx, actor, "job.created", "job", job.id, { title: d.title });
    let notify: string | null = null;
    if (d.status === "open") {
      const r = await requestOpen(tx, actor, job);
      notify = r.notify;
      await tx.update(s.jobs).set(r.status === "open" ? openValues(job, true) : { status: r.status }).where(eq(s.jobs.id, job.id));
      await recordAudit(tx, actor, "job.status_changed", "job", job.id, { from: "draft", to: r.status });
    }
    return { jobId: job.id, notify };
  });
  if (notify) await notifyApprover(notify, "Job approval needed", `${d.title} is waiting for your approval.`, `/jobs/${jobId}`);
  return jobId;
}

/** Statuses a person can pick. "pending_approval" is only ever set by the approval flow. */
export const jobStatusSchema = z.enum(["draft", "open", "on_hold", "closed"]);

export async function setJobStatus(actor: Actor, jobId: string, status: z.output<typeof jobStatusSchema>) {
  requireRecruiting(actor, "You don't have permission to change job status.");
  await assertCanSeeJobs(actor, [jobId]);
  const job = await db.query.jobs.findFirst({ where: eq(s.jobs.id, jobId) });
  if (!job) throw new NotFoundError("Job");
  if (job.status === status) return { status };
  if (job.status === "pending_approval" && status !== "draft") throw new Error("This job is waiting for approval. Withdraw it to draft to make changes.");

  const { to, notify } = await db.transaction(async (tx) => {
    let to: (typeof s.jobStatus.enumValues)[number] = status;
    let notify: string | null = null;
    if (job.status === "pending_approval") {
      await cancelPendingApprovals(tx, actor, "job", job.id);
      await tx.update(s.jobs).set({ status: "draft" }).where(eq(s.jobs.id, jobId));
    } else if (status === "open" && !job.openedAt) {
      // First time opening: needs approval if a chain applies.
      const r = await requestOpen(tx, actor, job);
      to = r.status;
      notify = r.notify;
      await tx.update(s.jobs).set(r.status === "open" ? openValues(job, true) : { status: r.status }).where(eq(s.jobs.id, jobId));
    } else {
      await tx
        .update(s.jobs)
        .set(
          status === "open"
            ? openValues(job, false)
            : { status, closedAt: status === "closed" ? new Date() : null, publishedOnCareerSite: false },
        )
        .where(eq(s.jobs.id, jobId));
    }
    await recordAudit(tx, actor, "job.status_changed", "job", jobId, { from: job.status, to });
    return { to, notify };
  });
  if (notify) await notifyApprover(notify, "Job approval needed", `${job.title} is waiting for your approval.`, `/jobs/${jobId}`);
  return { status: to };
}

/** Apply a finished job approval (called by the approval flow inside its transaction). */
export async function applyJobApprovalOutcome(tx: Tx, actor: Actor, jobId: string, outcome: "approved" | "rejected") {
  const job = await tx.query.jobs.findFirst({ where: eq(s.jobs.id, jobId) });
  if (!job || job.status !== "pending_approval") return job ?? null;
  await tx.update(s.jobs).set(outcome === "approved" ? openValues(job, true) : { status: "draft" }).where(eq(s.jobs.id, jobId));
  await recordAudit(tx, actor, "job.status_changed", "job", jobId, { from: "pending_approval", to: outcome === "approved" ? "open" : "draft", via: "approval" });
  return job;
}

// ---------------------------------------------------------------------------
// Openings (requisitions)
// ---------------------------------------------------------------------------

export const addOpeningsSchema = z.object({
  jobId: z.string().uuid(),
  count: z.number().int().min(1).max(50),
  reason: z.enum(s.openingReason.enumValues),
  targetStartDate: z.string().date().nullable(),
});

export async function addOpenings(actor: Actor, d: z.output<typeof addOpeningsSchema>) {
  requireRecruiting(actor, "You don't have permission to change openings.");
  await assertCanSeeJobs(actor, [d.jobId]);
  return db.transaction(async (tx) => {
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(substring(code from 5)::int), 999) + 1` }).from(s.openings);
    const rows = await tx
      .insert(s.openings)
      .values(Array.from({ length: d.count }, (_, i) => ({ jobId: d.jobId, code: `REQ-${next + i}`, reason: d.reason, targetStartDate: d.targetStartDate })))
      .returning();
    for (const o of rows) await recordAudit(tx, actor, "opening.created", "opening", o.id, { jobId: d.jobId, code: o.code, reason: d.reason });
    return rows;
  });
}

export async function closeOpening(actor: Actor, openingId: string) {
  requireRecruiting(actor, "You don't have permission to change openings.");
  const opening = await db.query.openings.findFirst({ where: eq(s.openings.id, openingId) });
  if (!opening) throw new NotFoundError("Opening");
  await assertCanSeeJobs(actor, [opening.jobId]);
  if (opening.status !== "open") throw new Error("Only open openings can be closed.");
  await db.transaction(async (tx) => {
    await tx.update(s.openings).set({ status: "closed" }).where(eq(s.openings.id, openingId));
    await recordAudit(tx, actor, "opening.closed", "opening", openingId, { jobId: opening.jobId });
  });
  return opening;
}

export async function setCareerSitePublished(actor: Actor, jobId: string, published: boolean) {
  requireRecruiting(actor, "You don't have permission to publish jobs.");
  await assertCanSeeJobs(actor, [jobId]);
  await db.transaction(async (tx) => {
    await tx.update(s.jobs).set({ publishedOnCareerSite: published }).where(eq(s.jobs.id, jobId));
    await recordAudit(tx, actor, published ? "job.published" : "job.unpublished", "job", jobId);
  });
}

/** Open/on-hold jobs the actor can see, for pickers. */
export async function listPickableJobs(actor: UserActor) {
  return db
    .select({ id: s.jobs.id, title: s.jobs.title, brand: s.brands.name })
    .from(s.jobs)
    .innerJoin(s.brands, eq(s.brands.id, s.jobs.brandId))
    .where(and(visibleJobsFilter(actor), inArray(s.jobs.status, ["open", "on_hold"])))
    .orderBy(asc(s.jobs.title));
}
