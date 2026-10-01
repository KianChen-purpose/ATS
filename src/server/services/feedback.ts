import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { RECOMMENDATION_LABELS } from "@/lib/utils";
import { m365 } from "@/server/integrations/m365";
import { assertCanSeeJobs, ForbiddenError, NotFoundError, requireUserActor, type Actor, type UserActor } from "@/server/policy";
import { recordAudit } from "./audit";

/** The scorecard page: only panel members of the interview may open it. */
export async function getFeedbackPage(actor: UserActor, interviewId: string) {
  const iv = await db.query.interviews.findFirst({
    where: eq(s.interviews.id, interviewId),
    with: {
      stage: true,
      feedbackForm: true,
      interviewers: { with: { user: true } },
      application: { with: { candidate: true, job: { with: { brand: true } } } },
    },
  });
  if (!iv || !iv.interviewers.some((i) => i.userId === actor.id)) return null;
  const mine = await db.query.scorecards.findFirst({ where: and(eq(s.scorecards.interviewId, iv.id), eq(s.scorecards.authorId, actor.id)) });
  return { interview: iv, mine };
}

export const scorecardSchema = z.object({
  interviewId: z.string().uuid(),
  overall: z.enum(s.recommendation.enumValues, { message: "Pick an overall recommendation" }),
  ratings: z.record(z.string(), z.number().int().min(1).max(4)),
  notes: z.string().trim().min(10, "Add at least a sentence of notes").max(20_000),
});

export async function submitScorecard(actor: Actor, d: z.output<typeof scorecardSchema>) {
  const user = requireUserActor(actor);
  const iv = await db.query.interviews.findFirst({
    where: eq(s.interviews.id, d.interviewId),
    with: {
      interviewers: true,
      application: { with: { candidate: true, job: { with: { recruiter: true } } } },
    },
  });
  if (!iv) throw new NotFoundError("Interview");
  if (!iv.interviewers.some((i) => i.userId === user.id)) throw new ForbiddenError("You weren't an interviewer on this interview.");
  await assertCanSeeJobs(actor, [iv.application.jobId]);
  if (iv.status === "cancelled") throw new Error("This interview was cancelled.");

  const stageName = iv.title.split(" – ")[0];
  await db.transaction(async (tx) => {
    const [card] = await tx
      .insert(s.scorecards)
      .values({ applicationId: iv.applicationId, interviewId: iv.id, authorId: user.id, overall: d.overall, ratings: d.ratings, notes: d.notes })
      .onConflictDoNothing()
      .returning({ id: s.scorecards.id });
    if (!card) throw new Error("You've already submitted feedback for this interview.");
    await tx.insert(s.activities).values({
      candidateId: iv.application.candidateId,
      applicationId: iv.applicationId,
      type: "feedback_submitted",
      actorId: user.id,
      body: `Submitted feedback for ${stageName}`,
      metadata: { overall: d.overall, stage: stageName },
    });
    if (iv.status === "scheduled" && iv.endAt < new Date()) {
      await tx.update(s.interviews).set({ status: "completed" }).where(eq(s.interviews.id, iv.id));
    }
    await recordAudit(tx, actor, "scorecard.submitted", "scorecard", card.id, { interviewId: iv.id, applicationId: iv.applicationId });
  });

  const recruiter = iv.application.job.recruiter;
  if (recruiter && recruiter.id !== user.id) {
    const c = iv.application.candidate;
    await m365().teams.notify({
      toEmail: recruiter.email,
      title: `${user.name} submitted feedback: ${RECOMMENDATION_LABELS[d.overall].label}`,
      text: `${stageName} · ${c.firstName} ${c.lastName} · ${iv.application.job.title}`,
      url: `/candidates/${c.id}`,
    });
  }
  return { candidateId: iv.application.candidateId };
}
