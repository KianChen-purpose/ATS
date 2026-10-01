"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { requireUser } from "@/lib/session";
import { m365 } from "@/server/integrations/m365";
import { audit } from "@/server/audit";
import { RECOMMENDATION_LABELS } from "@/lib/utils";

const schema = z.object({
  interviewId: z.string().uuid(),
  overall: z.enum(s.recommendation.enumValues, { message: "Pick an overall recommendation" }),
  ratings: z.record(z.string(), z.number().int().min(1).max(4)),
  notes: z.string().trim().min(10, "Add at least a sentence of notes"),
});

export async function submitScorecard(input: z.input<typeof schema>) {
  const user = await requireUser();
  const d = schema.parse(input);
  const iv = await db.query.interviews.findFirst({
    where: eq(s.interviews.id, d.interviewId),
    with: {
      interviewers: true,
      application: { with: { candidate: true, job: { with: { recruiter: true } } } },
    },
  });
  if (!iv) throw new Error("Interview not found");
  if (!iv.interviewers.some((i) => i.userId === user.id)) throw new Error("You weren't an interviewer on this interview.");
  const existing = await db.query.scorecards.findFirst({ where: and(eq(s.scorecards.interviewId, iv.id), eq(s.scorecards.authorId, user.id)) });
  if (existing) throw new Error("You've already submitted feedback for this interview.");

  await db.insert(s.scorecards).values({
    applicationId: iv.applicationId,
    interviewId: iv.id,
    authorId: user.id,
    overall: d.overall,
    ratings: d.ratings,
    notes: d.notes,
  });
  const stageName = iv.title.split(" – ")[0];
  await db.insert(s.activities).values({
    candidateId: iv.application.candidateId,
    applicationId: iv.applicationId,
    type: "feedback_submitted",
    actorId: user.id,
    body: `Submitted feedback for ${stageName}`,
    metadata: { overall: d.overall, stage: stageName },
  });
  if (iv.status === "scheduled" && iv.endAt < new Date()) {
    await db.update(s.interviews).set({ status: "completed" }).where(eq(s.interviews.id, iv.id));
  }
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
  await audit(user.id, "scorecard.submitted", "interview", iv.id);
  revalidatePath(`/candidates/${iv.application.candidateId}`);
  revalidatePath("/interviews");
  revalidatePath("/");
  return { candidateId: iv.application.candidateId };
}
