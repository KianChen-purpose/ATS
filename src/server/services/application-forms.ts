import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { assertCanSeeJobs, NotFoundError, requireRecruiting, type Actor, type UserActor } from "@/server/policy";
import { recordAudit } from "./audit";

/** Per-job application questions (PRD §4.7), managed by recruiting roles. */

export const questionSchema = z
  .object({
    jobId: z.string().uuid(),
    kind: z.enum(s.questionKind.enumValues),
    labelEn: z.string().trim().min(2, "Add the English question").max(500),
    labelFr: z.string().trim().min(2, "Add the French question").max(500),
    options: z
      .array(z.object({ value: z.string().trim().min(1).max(60), en: z.string().trim().min(1).max(200), fr: z.string().trim().min(1).max(200) }))
      .max(20)
      .default([]),
    required: z.boolean().default(false),
    passAnswers: z.array(z.string().min(1)).max(20).nullable().default(null),
  })
  .superRefine((q, ctx) => {
    if (q.kind === "single_select" && q.options.length < 2) ctx.addIssue({ code: "custom", message: "Add at least two choices", path: ["options"] });
    if (q.kind !== "single_select" && q.options.length) ctx.addIssue({ code: "custom", message: "Only choice questions have options", path: ["options"] });
    if (q.passAnswers) {
      if (q.kind === "short_text" || q.kind === "long_text") ctx.addIssue({ code: "custom", message: "Only yes/no and choice questions can be knockouts", path: ["passAnswers"] });
      const allowed = q.kind === "yes_no" ? ["yes", "no"] : q.options.map((o) => o.value);
      if (q.passAnswers.length === 0 || q.passAnswers.some((a) => !allowed.includes(a)))
        ctx.addIssue({ code: "custom", message: "Pick which answers pass", path: ["passAnswers"] });
      if (!q.required) ctx.addIssue({ code: "custom", message: "Knockout questions must be required", path: ["required"] });
    }
  });

export async function listQuestions(actor: UserActor, jobId: string) {
  await assertCanSeeJobs(actor, [jobId]);
  return db.query.applicationQuestions.findMany({ where: eq(s.applicationQuestions.jobId, jobId), orderBy: asc(s.applicationQuestions.position) });
}

export async function addQuestion(actor: Actor, d: z.output<typeof questionSchema>) {
  requireRecruiting(actor, "You don't have permission to edit application forms.");
  await assertCanSeeJobs(actor, [d.jobId]);
  return db.transaction(async (tx) => {
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${s.applicationQuestions.position}), -1) + 1` })
      .from(s.applicationQuestions)
      .where(eq(s.applicationQuestions.jobId, d.jobId));
    const [q] = await tx.insert(s.applicationQuestions).values({ ...d, position: next }).returning();
    await recordAudit(tx, actor, "application_question.created", "application_question", q.id, { jobId: d.jobId, kind: d.kind, knockout: Boolean(d.passAnswers) });
    return q;
  });
}

async function loadQuestion(actor: Actor, questionId: string) {
  const q = await db.query.applicationQuestions.findFirst({ where: eq(s.applicationQuestions.id, questionId) });
  if (!q) throw new NotFoundError("Question");
  await assertCanSeeJobs(actor, [q.jobId]);
  return q;
}

/** Questions are never deleted (answers reference them); they're switched off. */
export async function setQuestionActive(actor: Actor, questionId: string, active: boolean) {
  requireRecruiting(actor, "You don't have permission to edit application forms.");
  const q = await loadQuestion(actor, questionId);
  await db.transaction(async (tx) => {
    await tx.update(s.applicationQuestions).set({ active }).where(eq(s.applicationQuestions.id, q.id));
    await recordAudit(tx, actor, active ? "application_question.activated" : "application_question.deactivated", "application_question", q.id, { jobId: q.jobId });
  });
  return q;
}

export async function moveQuestion(actor: Actor, questionId: string, direction: "up" | "down") {
  requireRecruiting(actor, "You don't have permission to edit application forms.");
  const q = await loadQuestion(actor, questionId);
  const all = await db.query.applicationQuestions.findMany({ where: eq(s.applicationQuestions.jobId, q.jobId), orderBy: asc(s.applicationQuestions.position) });
  const i = all.findIndex((x) => x.id === q.id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= all.length) return q;
  await db.transaction(async (tx) => {
    // Swap positions (renumber to keep them dense).
    const order = [...all];
    [order[i], order[j]] = [order[j], order[i]];
    for (const [pos, x] of order.entries()) await tx.update(s.applicationQuestions).set({ position: pos }).where(eq(s.applicationQuestions.id, x.id));
    await recordAudit(tx, actor, "application_question.moved", "application_question", q.id, { jobId: q.jobId, direction });
  });
  return q;
}

/** Active questions for the public form (no knockout rules sent to the browser). */
export async function publicQuestions(jobId: string) {
  const rows = await db.query.applicationQuestions.findMany({
    where: and(eq(s.applicationQuestions.jobId, jobId), eq(s.applicationQuestions.active, true)),
    orderBy: asc(s.applicationQuestions.position),
  });
  return rows.map((q) => ({ id: q.id, kind: q.kind, labelEn: q.labelEn, labelFr: q.labelFr, options: q.options, required: q.required }));
}
