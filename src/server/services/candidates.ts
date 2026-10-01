import "server-only";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import {
  assertCanSeeJobs,
  canSeeOthersFeedback,
  canSeeProspects,
  canViewCompensation,
  canViewJobRow,
  NotFoundError,
  requireRecruiting,
  visibleJobIds,
  type Actor,
  type UserActor,
} from "@/server/policy";
import { searchIndex } from "@/server/integrations/search";
import { recordAudit, recordView } from "./audit";
import { listPickableJobs } from "./jobs";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getCandidateProfile(actor: UserActor, candidateId: string) {
  const candidate = await db.query.candidates.findFirst({
    where: eq(s.candidates.id, candidateId),
    with: {
      owner: true,
      applications: {
        orderBy: desc(s.applications.appliedAt),
        with: {
          job: { with: { brand: true, stages: { orderBy: asc(s.jobStages.position) }, team: true } },
          stage: true,
          source: true,
          archiveReason: true,
          creditedTo: true,
          referrer: true,
          interviews: {
            orderBy: asc(s.interviews.startAt),
            with: { stage: true, interviewers: { with: { user: true } } },
          },
          scorecards: { orderBy: desc(s.scorecards.submittedAt), with: { author: true, interview: true } },
          offers: { orderBy: desc(s.offers.createdAt), with: { approvals: { orderBy: asc(s.offerApprovals.position), with: { approver: true } } } },
        },
      },
      activities: { orderBy: desc(s.activities.createdAt), with: { actor: true } },
      emails: { orderBy: desc(s.emails.sentAt), with: { sentBy: true } },
    },
  });
  if (!candidate) return null;

  const visibleApps = candidate.applications.filter((a) => canViewJobRow(actor, a.job, a.job.team.map((t) => t.userId)));
  if (visibleApps.length === 0 && candidate.applications.length > 0) return null;
  if (candidate.applications.length === 0 && !canSeeProspects(actor)) return null;
  const visibleAppIds = new Set(visibleApps.map((a) => a.id));

  const seesComp = canViewCompensation(actor);
  const applications = visibleApps.map((a) => {
    const submittedOwn = a.scorecards.some((sc) => sc.authorId === actor.id);
    const blind = !canSeeOthersFeedback(actor, submittedOwn);
    return {
      ...a,
      scorecards: blind ? a.scorecards.filter((sc) => sc.authorId === actor.id) : a.scorecards,
      feedbackHidden: blind ? a.scorecards.length : 0,
      offers: seesComp ? a.offers : [],
    };
  });

  // Rows tied to a job follow that job's visibility; candidate-level rows are for prospect roles only (§3.7).
  const visibleRow = (applicationId: string | null) => (applicationId ? visibleAppIds.has(applicationId) : canSeeProspects(actor));
  return {
    ...candidate,
    applications,
    activities: candidate.activities.filter((act) => visibleRow(act.applicationId)),
    emails: candidate.emails.filter((e) => visibleRow(e.applicationId)),
  };
}

export type CandidateProfile = NonNullable<Awaited<ReturnType<typeof getCandidateProfile>>>;

/**
 * Load a candidate profile for display and audit the view (the profile includes the resume).
 * Use this from pages; getCandidateProfile is for internal reads that don't show the profile.
 */
export async function viewCandidateProfile(actor: UserActor, candidateId: string, via: "profile" | "job_panel" | "scheduler") {
  const profile = await getCandidateProfile(actor, candidateId);
  if (profile) await recordView(db, actor, "candidate.viewed", "candidate", candidateId, { via, includesResume: Boolean(profile.resumeText) });
  return profile;
}

/** Throws NotFound unless the actor can see the candidate (ARCHITECTURE.md §3.3). */
export async function assertCanSeeCandidate(actor: UserActor, candidateId: string) {
  const apps = await db
    .select({ jobId: s.applications.jobId })
    .from(s.applications)
    .where(eq(s.applications.candidateId, candidateId));
  if (apps.length === 0) {
    const exists = await db.query.candidates.findFirst({ where: eq(s.candidates.id, candidateId), columns: { id: true } });
    if (!exists || !canSeeProspects(actor)) throw new NotFoundError("Candidate");
    return;
  }
  const visible = await db
    .select({ id: s.jobs.id })
    .from(s.jobs)
    .where(sql`${s.jobs.id} IN (${sql.join(apps.map((a) => sql`${a.jobId}`), sql`, `)}) AND ${s.jobs.id} IN (${visibleJobIds(actor)})`)
    .limit(1);
  if (visible.length === 0) throw new NotFoundError("Candidate");
}

export async function getProfileOptions(actor: UserActor) {
  const [archiveReasons, templates, jobs, forms] = await Promise.all([
    db.query.archiveReasons.findMany(),
    db.query.emailTemplates.findMany({ orderBy: asc(s.emailTemplates.name) }),
    listPickableJobs(actor),
    db.query.feedbackForms.findMany(),
  ]);
  const attributeLabels = Object.fromEntries(forms.flatMap((f) => f.attributes.map((a) => [a.key, a.label])));
  return { archiveReasons, templates, jobs, attributeLabels };
}

export async function listSources() {
  return db.query.sources.findMany({ orderBy: asc(s.sources.name) });
}

export type CandidateListFilters = { q?: string; jobId?: string; status?: string; sourceId?: string; page?: number };

export const CANDIDATES_PAGE_SIZE = 50;

export async function listCandidates(actor: UserActor, f: CandidateListFilters) {
  const appConds: SQL[] = [];
  if (f.jobId) appConds.push(sql`a.job_id = ${f.jobId}`);
  if (f.status && f.status !== "all") appConds.push(sql`a.status = ${f.status}`);
  if (f.sourceId) appConds.push(sql`a.source_id = ${f.sourceId}`);
  const jobIds = visibleJobIds(actor);

  const where: SQL[] = [
    sql`EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = ${s.candidates.id} AND a.job_id IN (${jobIds})
        ${appConds.length ? sql`AND ${sql.join(appConds, sql` AND `)}` : sql``})`,
  ];
  if (f.q) where.push(searchIndex().candidateTextFilter(f.q, { includeResume: true }));
  const page = Math.max(1, f.page ?? 1);
  // Drizzle renders columns unqualified inside single-table selects; qualify explicitly for correlated subqueries.
  const candId = sql.raw(`"candidates"."id"`);
  const lastActivity = sql<string | null>`(SELECT max(created_at) FROM activities act WHERE act.candidate_id = ${candId})`;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: s.candidates.id,
        firstName: s.candidates.firstName,
        lastName: s.candidates.lastName,
        email: s.candidates.email,
        currentTitle: s.candidates.currentTitle,
        currentCompany: s.candidates.currentCompany,
        location: s.candidates.location,
        tags: s.candidates.tags,
        updatedAt: s.candidates.updatedAt,
        apps: sql<{ id: string; jobId: string; jobTitle: string; stage: string; status: string; source: string | null }[]>`(
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', a.id, 'jobId', j.id, 'jobTitle', j.title, 'stage', st.name, 'status', a.status, 'source', src.name
          ) ORDER BY a.applied_at DESC), '[]'::jsonb)
          FROM applications a
          JOIN jobs j ON j.id = a.job_id
          JOIN job_stages st ON st.id = a.stage_id
          LEFT JOIN sources src ON src.id = a.source_id
          WHERE a.candidate_id = ${candId} AND a.job_id IN (${jobIds}))`,
        lastActivity,
      })
      .from(s.candidates)
      .where(and(...where))
      .orderBy(sql`${lastActivity} DESC NULLS LAST`)
      .limit(CANDIDATES_PAGE_SIZE)
      .offset((page - 1) * CANDIDATES_PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(s.candidates).where(and(...where)),
  ]);
  return { rows, total, page };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const optional = z.string().trim().optional().transform((v) => v || null);

export const createCandidateSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")).transform((v) => v || null),
  phone: optional,
  location: optional,
  currentTitle: optional,
  currentCompany: optional,
  linkedinUrl: z.string().trim().url("LinkedIn must be a URL").optional().or(z.literal("")).transform((v) => v || null),
  tags: z.string().optional().transform((v) => (v ?? "").split(",").map((t) => t.trim()).filter(Boolean)),
  resumeText: z.string().optional().transform((v) => v || null),
  jobId: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
  sourceId: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
});

export type CreateCandidateResult = { candidateId: string } | { error: string; duplicateId?: string };

export async function createCandidate(actor: Actor, d: z.output<typeof createCandidateSchema>): Promise<CreateCandidateResult> {
  const user = requireRecruiting(actor, "You don't have permission to add candidates.");
  if (d.jobId) await assertCanSeeJobs(actor, [d.jobId]);

  // Duplicate detection on email.
  if (d.email) {
    const existing = await db.query.candidates.findFirst({ where: sql`lower(${s.candidates.email}) = lower(${d.email})` });
    if (existing) return { error: `A candidate with this email already exists: ${existing.firstName} ${existing.lastName}`, duplicateId: existing.id };
  }

  const candidateId = await db.transaction(async (tx) => {
    const [c] = await tx
      .insert(s.candidates)
      .values({
        firstName: d.firstName,
        lastName: d.lastName,
        email: d.email,
        phone: d.phone,
        location: d.location,
        currentTitle: d.currentTitle,
        currentCompany: d.currentCompany,
        linkedinUrl: d.linkedinUrl,
        tags: d.tags,
        resumeText: d.resumeText,
        ownerId: user.id,
      })
      .returning();
    await recordAudit(tx, actor, "candidate.created", "candidate", c.id);
    if (d.jobId) {
      const stages = await tx.query.jobStages.findMany({ where: eq(s.jobStages.jobId, d.jobId), orderBy: asc(s.jobStages.position) });
      const source = d.sourceId ? await tx.query.sources.findFirst({ where: eq(s.sources.id, d.sourceId) }) : null;
      const stage = (source?.category === "sourced" ? stages.find((st) => st.type === "lead") : stages.find((st) => st.type === "review")) ?? stages[0];
      const [app] = await tx
        .insert(s.applications)
        .values({ candidateId: c.id, jobId: d.jobId, stageId: stage.id, sourceId: d.sourceId, creditedToId: user.id })
        .returning();
      await tx.insert(s.applicationStageEvents).values({ applicationId: app.id, toStageId: stage.id, status: "active", movedById: user.id });
      await tx.insert(s.activities).values({ candidateId: c.id, applicationId: app.id, type: "application_created", actorId: user.id, body: `Added manually${source ? ` (${source.name})` : ""}` });
      await recordAudit(tx, actor, "application.created", "application", app.id, { candidateId: c.id, jobId: d.jobId });
    } else {
      await tx.insert(s.activities).values({ candidateId: c.id, type: "application_created", actorId: user.id, body: "Added to PATS" });
    }
    return c.id;
  });
  return { candidateId };
}

export const tagsSchema = z.array(z.string().trim().max(50)).max(50);

export async function updateCandidateTags(actor: Actor, candidateId: string, tags: z.output<typeof tagsSchema>) {
  const user = requireRecruiting(actor);
  await assertCanSeeCandidate(user, candidateId);
  const clean = [...new Set(tags.filter(Boolean))];
  await db.transaction(async (tx) => {
    await tx.update(s.candidates).set({ tags: clean, updatedAt: new Date() }).where(eq(s.candidates.id, candidateId));
    await recordAudit(tx, actor, "candidate.tags_updated", "candidate", candidateId, { tags: clean });
  });
}
