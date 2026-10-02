import "server-only";
import { z } from "zod";
import { db } from "@/db";
import type { Actor } from "@/server/policy";
import { decisionSchema, notifyApprover, recordDecision } from "./approvals";
import { applyJobApprovalOutcome } from "./jobs";
import { applyOfferApprovalOutcome } from "./offers";

/**
 * Decide an approval step and apply the result to its subject in the same transaction.
 * The check is "this step is waiting on you" (approvals.recordDecision); approvers are chosen
 * by the chain, so they may not be on the job's hiring team.
 */
export async function decideApproval(actor: Actor, d: z.output<typeof decisionSchema>) {
  const result = await db.transaction(async (tx) => {
    const r = await recordDecision(tx, actor, d);
    let title = "";
    if (r.request.subject === "job" && r.outcome !== "pending") {
      const job = await applyJobApprovalOutcome(tx, actor, r.request.subjectId, r.outcome);
      title = job?.title ?? "";
    }
    if (r.request.subject === "offer" && r.outcome !== "pending") {
      await applyOfferApprovalOutcome(tx, actor, r.request.subjectId, r.outcome);
    }
    return { ...r, title };
  });

  const { request, outcome, nextApproverId } = result;
  const url = request.subject === "job" ? `/jobs/${request.subjectId}` : `/offers`;
  if (nextApproverId) {
    await notifyApprover(nextApproverId, `${request.subject === "job" ? "Job" : "Offer"} approval needed`, "An approval is waiting for you in PATS.", url);
  } else if (request.requestedById) {
    await notifyApprover(
      request.requestedById,
      outcome === "approved" ? "Approved" : "Not approved",
      `${request.subject === "job" ? `Job ${result.title}` : "An offer"} was ${outcome === "approved" ? "approved" : "rejected"}.`,
      url,
    );
  }
  return { outcome, subject: request.subject, subjectId: request.subjectId, jobId: request.jobId };
}
