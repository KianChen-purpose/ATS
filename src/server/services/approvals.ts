import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { m365 } from "@/server/integrations/m365";
import { actorUserId, ForbiddenError, NotFoundError, requireUserActor, type Actor, type UserActor } from "@/server/policy";
import { recordAudit } from "./audit";
import type { DbOrTx, Tx } from "./tx";

/**
 * Generic approval chains (ARCHITECTURE.md §7.4), shared by job/requisition and offer approvals.
 * This module knows nothing about jobs or offers beyond the context it is given; the subject's
 * own service applies the outcome (opening a job, marking an offer approved) in the same transaction.
 */

export type ApprovalSubject = (typeof s.approvalSubject.enumValues)[number];

// ---------------------------------------------------------------------------
// Chain configuration (admin)
// ---------------------------------------------------------------------------

function requireApprovalAdmin(actor: Actor) {
  const u = requireUserActor(actor);
  if (u.role !== "admin") throw new ForbiddenError("Only admins can configure approval chains.");
  return u;
}

export const chainSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(2).max(120),
    subject: z.enum(s.approvalSubject.enumValues),
    brandId: z.string().uuid().nullable(),
    departmentId: z.string().uuid().nullable(),
    minAmount: z.number().int().min(0).nullable(),
    steps: z
      .array(
        z.object({
          approverType: z.enum(s.approverType.enumValues),
          approverId: z.string().uuid().nullable(),
        }),
      )
      .min(1, "Add at least one approver")
      .max(10),
  })
  .superRefine((c, ctx) => {
    c.steps.forEach((st, i) => {
      if (st.approverType === "user" && !st.approverId) ctx.addIssue({ code: "custom", message: `Step ${i + 1}: pick a person`, path: ["steps", i] });
    });
    if (c.subject === "job" && c.minAmount != null) ctx.addIssue({ code: "custom", message: "Amount thresholds only apply to offers", path: ["minAmount"] });
  });

export async function listChains(actor: Actor) {
  requireApprovalAdmin(actor);
  return db.query.approvalChains.findMany({
    orderBy: [asc(s.approvalChains.subject), asc(s.approvalChains.name)],
    with: { brand: true, department: true, steps: { orderBy: asc(s.approvalChainSteps.position), with: { approver: true } } },
  });
}

/** Create or replace a chain. Running requests keep the approvers they were resolved with. */
export async function saveChain(actor: Actor, d: z.output<typeof chainSchema>) {
  requireApprovalAdmin(actor);
  return db.transaction(async (tx) => {
    const values = { name: d.name, subject: d.subject, brandId: d.brandId, departmentId: d.departmentId, minAmount: d.minAmount, updatedAt: new Date() };
    const [chain] = d.id
      ? await tx.update(s.approvalChains).set(values).where(eq(s.approvalChains.id, d.id)).returning()
      : await tx.insert(s.approvalChains).values(values).returning();
    if (!chain) throw new NotFoundError("Approval chain");
    await tx.delete(s.approvalChainSteps).where(eq(s.approvalChainSteps.chainId, chain.id));
    await tx.insert(s.approvalChainSteps).values(
      d.steps.map((st, i) => ({ chainId: chain.id, position: i, approverType: st.approverType, approverId: st.approverType === "user" ? st.approverId : null })),
    );
    await recordAudit(tx, actor, d.id ? "approval_chain.updated" : "approval_chain.created", "approval_chain", chain.id, {
      subject: d.subject,
      brandId: d.brandId,
      departmentId: d.departmentId,
      minAmount: d.minAmount,
      steps: d.steps,
    });
    return chain;
  });
}

export async function setChainActive(actor: Actor, chainId: string, active: boolean) {
  requireApprovalAdmin(actor);
  await db.transaction(async (tx) => {
    const [row] = await tx.update(s.approvalChains).set({ active, updatedAt: new Date() }).where(eq(s.approvalChains.id, chainId)).returning();
    if (!row) throw new NotFoundError("Approval chain");
    await recordAudit(tx, actor, active ? "approval_chain.activated" : "approval_chain.deactivated", "approval_chain", chainId);
  });
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type ApprovalContext = {
  job: { id: string; brandId: string; departmentId: string | null; hiringManagerId: string | null; recruiterId: string | null };
  /** Offers: base salary in whole dollars. */
  amount?: number | null;
};

/** The most specific active chain for this subject and context, or null if none applies. */
export async function resolveChain(tx: DbOrTx, subject: ApprovalSubject, ctx: ApprovalContext) {
  const chains = await tx.query.approvalChains.findMany({
    where: and(
      eq(s.approvalChains.subject, subject),
      eq(s.approvalChains.active, true),
      or(isNull(s.approvalChains.brandId), eq(s.approvalChains.brandId, ctx.job.brandId)),
      ctx.job.departmentId ? or(isNull(s.approvalChains.departmentId), eq(s.approvalChains.departmentId, ctx.job.departmentId)) : isNull(s.approvalChains.departmentId),
      or(isNull(s.approvalChains.minAmount), lte(s.approvalChains.minAmount, ctx.amount ?? 0)),
    ),
    with: { steps: { orderBy: asc(s.approvalChainSteps.position) } },
  });
  const rank = (c: (typeof chains)[number]) => [c.brandId ? 1 : 0, c.departmentId ? 1 : 0, c.minAmount ?? -1] as const;
  chains.sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    return rb[0] - ra[0] || rb[1] - ra[1] || rb[2] - ra[2] || a.createdAt.getTime() - b.createdAt.getTime();
  });
  return chains[0] ?? null;
}

function resolveApprovers(chain: NonNullable<Awaited<ReturnType<typeof resolveChain>>>, ctx: ApprovalContext) {
  const ids = chain.steps.map((st, i) => {
    const id = st.approverType === "user" ? st.approverId : st.approverType === "hiring_manager" ? ctx.job.hiringManagerId : ctx.job.recruiterId;
    if (!id) throw new Error(`Approval chain "${chain.name}" step ${i + 1} has no approver for this job (no ${st.approverType.replace("_", " ")} set).`);
    return id;
  });
  // The same person twice in a row approves once.
  return ids.filter((id, i) => id !== ids[i - 1]);
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * Start an approval inside the caller's transaction. Returns null when no chain applies
 * (the subject needs no approval). Any earlier pending request for the subject is cancelled.
 */
export async function startApproval(tx: Tx, actor: Actor, subject: ApprovalSubject, subjectId: string, ctx: ApprovalContext) {
  await cancelPendingApprovals(tx, actor, subject, subjectId);
  const chain = await resolveChain(tx, subject, ctx);
  if (!chain) return null;
  const approvers = resolveApprovers(chain, ctx);
  const [request] = await tx
    .insert(s.approvalRequests)
    .values({ subject, subjectId, jobId: ctx.job.id, chainId: chain.id, requestedById: actorUserId(actor) })
    .returning();
  await tx.insert(s.approvalSteps).values(approvers.map((approverId, position) => ({ requestId: request.id, position, approverId })));
  await recordAudit(tx, actor, "approval.requested", "approval_request", request.id, { subject, subjectId, chainId: chain.id, approvers });
  return { request, firstApproverId: approvers[0] };
}

export async function cancelPendingApprovals(tx: Tx, actor: Actor, subject: ApprovalSubject, subjectId: string) {
  const pending = await tx.query.approvalRequests.findMany({
    where: and(eq(s.approvalRequests.subject, subject), eq(s.approvalRequests.subjectId, subjectId), eq(s.approvalRequests.status, "pending")),
  });
  for (const r of pending) {
    await tx.update(s.approvalRequests).set({ status: "cancelled", completedAt: new Date() }).where(eq(s.approvalRequests.id, r.id));
    await tx.update(s.approvalSteps).set({ status: "skipped" }).where(and(eq(s.approvalSteps.requestId, r.id), eq(s.approvalSteps.status, "pending")));
    await recordAudit(tx, actor, "approval.cancelled", "approval_request", r.id, { subject, subjectId });
  }
}

export const decisionSchema = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().trim().max(2000).optional(),
});

/**
 * Record the actor's decision on the request's current step (inside the caller's transaction).
 * Only the approver of the lowest pending step may decide. A rejection ends the request.
 */
export async function recordDecision(tx: Tx, actor: Actor, d: z.output<typeof decisionSchema>) {
  const user = requireUserActor(actor);
  const request = await tx.query.approvalRequests.findFirst({
    where: eq(s.approvalRequests.id, d.requestId),
    with: { steps: { orderBy: asc(s.approvalSteps.position) } },
  });
  if (!request) throw new NotFoundError("Approval");
  if (request.status !== "pending") throw new Error("This approval is no longer pending.");
  const current = request.steps.find((st) => st.status === "pending");
  if (!current || current.approverId !== user.id) throw new ForbiddenError("This approval isn't waiting on you.");
  if (d.decision === "rejected" && !d.comment) throw new Error("Add a comment explaining the rejection.");

  const now = new Date();
  // Guard against a concurrent decision on the same step.
  const updated = await tx
    .update(s.approvalSteps)
    .set({ status: d.decision, comment: d.comment || null, decidedAt: now })
    .where(and(eq(s.approvalSteps.id, current.id), eq(s.approvalSteps.status, "pending")))
    .returning({ id: s.approvalSteps.id });
  if (updated.length === 0) throw new Error("This approval step was already decided.");
  await recordAudit(tx, actor, d.decision === "approved" ? "approval.step_approved" : "approval.step_rejected", "approval_step", current.id, {
    requestId: request.id,
    position: current.position,
  });

  const next = request.steps.find((st) => st.position > current.position && st.status === "pending");
  let outcome: "pending" | "approved" | "rejected" = "pending";
  if (d.decision === "rejected") {
    outcome = "rejected";
    await tx.update(s.approvalSteps).set({ status: "skipped" }).where(and(eq(s.approvalSteps.requestId, request.id), eq(s.approvalSteps.status, "pending")));
  } else if (!next) {
    outcome = "approved";
  }
  if (outcome !== "pending") {
    await tx.update(s.approvalRequests).set({ status: outcome, completedAt: now }).where(eq(s.approvalRequests.id, request.id));
    await recordAudit(tx, actor, `approval.${outcome}`, "approval_request", request.id, { subject: request.subject, subjectId: request.subjectId });
  }
  return { request, outcome, nextApproverId: outcome === "pending" ? next!.approverId : null };
}

/** Latest approval request for a subject, with its steps and approvers (for display). */
export async function latestApproval(subject: ApprovalSubject, subjectId: string) {
  return db.query.approvalRequests.findFirst({
    where: and(eq(s.approvalRequests.subject, subject), eq(s.approvalRequests.subjectId, subjectId)),
    orderBy: desc(s.approvalRequests.createdAt),
    with: { steps: { orderBy: asc(s.approvalSteps.position), with: { approver: true } }, requestedBy: true },
  });
}

export async function latestApprovals(subject: ApprovalSubject, subjectIds: string[]) {
  if (subjectIds.length === 0) return new Map<string, NonNullable<Awaited<ReturnType<typeof latestApproval>>>>();
  const rows = await db.query.approvalRequests.findMany({
    where: and(eq(s.approvalRequests.subject, subject), inArray(s.approvalRequests.subjectId, subjectIds)),
    orderBy: desc(s.approvalRequests.createdAt),
    with: { steps: { orderBy: asc(s.approvalSteps.position), with: { approver: true } }, requestedBy: true },
  });
  const out = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!out.has(r.subjectId)) out.set(r.subjectId, r);
  return out;
}

/** Pending steps that are the actor's turn (every earlier step approved). */
export async function myPendingSteps(actor: UserActor) {
  return db
    .select({
      stepId: s.approvalSteps.id,
      requestId: s.approvalRequests.id,
      subject: s.approvalRequests.subject,
      subjectId: s.approvalRequests.subjectId,
      jobId: s.approvalRequests.jobId,
      position: s.approvalSteps.position,
      createdAt: s.approvalRequests.createdAt,
    })
    .from(s.approvalSteps)
    .innerJoin(s.approvalRequests, eq(s.approvalRequests.id, s.approvalSteps.requestId))
    .where(
      and(
        eq(s.approvalSteps.approverId, actor.id),
        eq(s.approvalSteps.status, "pending"),
        eq(s.approvalRequests.status, "pending"),
        sql`NOT EXISTS (SELECT 1 FROM approval_steps p WHERE p.request_id = ${s.approvalSteps.requestId} AND p.position < ${s.approvalSteps.position} AND p.status <> 'approved')`,
      ),
    )
    .orderBy(asc(s.approvalRequests.createdAt));
}

/** Teams nudge to whoever's turn it is. Call after the transaction commits. */
export async function notifyApprover(approverId: string, title: string, text: string, url: string) {
  const u = await db.query.users.findFirst({ where: eq(s.users.id, approverId) });
  if (u) await m365().teams.notify({ toEmail: u.email, title, text, url });
}
