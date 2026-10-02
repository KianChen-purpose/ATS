import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { canViewCompensation, type UserActor } from "@/server/policy";
import { myPendingSteps } from "./approvals";

/**
 * The approvals inbox. Approvers are chosen by the chain, so they may not be on the job's
 * hiring team. They see the summary of the requests they are named on (and nothing else about
 * the job or candidate) — proposed rule, see ARCHITECTURE.md decision log (pending Kian).
 */

async function summarize(actor: UserActor, requestIds: string[]) {
  if (requestIds.length === 0) return [];
  const requests = await db.query.approvalRequests.findMany({
    where: inArray(s.approvalRequests.id, requestIds),
    orderBy: desc(s.approvalRequests.createdAt),
    with: {
      steps: { orderBy: asc(s.approvalSteps.position), with: { approver: true } },
      requestedBy: true,
      job: { with: { brand: true, department: true, hiringManager: true, openings: true } },
    },
  });
  const offerIds = requests.filter((r) => r.subject === "offer").map((r) => r.subjectId);
  const offerRows = offerIds.length
    ? await db.query.offers.findMany({
        where: inArray(s.offers.id, offerIds),
        with: { application: { with: { candidate: true } } },
      })
    : [];
  const offersById = new Map(offerRows.map((o) => [o.id, o]));
  const seesComp = canViewCompensation(actor);

  return requests.map((r) => {
    const job = r.job;
    const base = {
      requestId: r.id,
      subject: r.subject,
      status: r.status,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      requestedBy: r.requestedBy?.name ?? null,
      steps: r.steps,
      yourTurn: r.status === "pending" && r.steps.find((st) => st.status === "pending")?.approverId === actor.id,
      job: {
        id: job.id,
        title: job.title,
        brand: job.brand.name,
        department: job.department?.name ?? null,
        hiringManager: job.hiringManager?.name ?? null,
        confidential: job.confidential,
        openings: job.openings.filter((o) => o.status === "open").length,
        compMin: seesComp ? job.compMin : null,
        compMax: seesComp ? job.compMax : null,
        currency: job.currency,
      },
    };
    const o = r.subject === "offer" ? offersById.get(r.subjectId) : undefined;
    return {
      ...base,
      offer: o
        ? {
            id: o.id,
            candidateName: `${o.application.candidate.firstName} ${o.application.candidate.lastName}`,
            candidateId: o.application.candidateId,
            applicationId: o.applicationId,
            status: o.status,
            ...(seesComp
              ? { baseSalary: o.baseSalary, bonusPercent: o.bonusPercent, signOnBonus: o.signOnBonus, equity: o.equity, currency: o.currency }
              : { baseSalary: null, bonusPercent: null, signOnBonus: null, equity: null, currency: o.currency }),
            startDate: o.startDate,
          }
        : null,
    };
  });
}

export type InboxItem = Awaited<ReturnType<typeof summarize>>[number];

export async function approvalInbox(actor: UserActor) {
  const waitingSteps = await myPendingSteps(actor);
  const recentRows = await db
    .selectDistinct({ requestId: s.approvalSteps.requestId, decidedAt: s.approvalSteps.decidedAt })
    .from(s.approvalSteps)
    .where(and(eq(s.approvalSteps.approverId, actor.id), inArray(s.approvalSteps.status, ["approved", "rejected"])))
    .orderBy(desc(s.approvalSteps.decidedAt))
    .limit(20);
  const [waiting, recent] = await Promise.all([
    summarize(actor, waitingSteps.map((w) => w.requestId)),
    summarize(actor, recentRows.map((r) => r.requestId)),
  ]);
  return { waiting, recent };
}

/** Number of approvals waiting on the actor (for the nav badge and home). */
export async function waitingCount(actor: UserActor) {
  return (await myPendingSteps(actor)).length;
}
