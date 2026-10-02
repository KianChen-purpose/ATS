"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/session";
import * as svc from "@/server/services/application-forms";

export async function addApplicationQuestion(input: z.input<typeof svc.questionSchema>) {
  const parsed = svc.questionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the question." };
  await svc.addQuestion(await requireActor(), parsed.data);
  revalidatePath(`/jobs/${parsed.data.jobId}`);
  return { ok: true as const };
}

export async function setApplicationQuestionActive(questionId: string, active: boolean) {
  const q = await svc.setQuestionActive(await requireActor(), z.string().uuid().parse(questionId), z.boolean().parse(active));
  revalidatePath(`/jobs/${q.jobId}`);
}

export async function moveApplicationQuestion(questionId: string, direction: "up" | "down") {
  const q = await svc.moveQuestion(await requireActor(), z.string().uuid().parse(questionId), z.enum(["up", "down"]).parse(direction));
  revalidatePath(`/jobs/${q.jobId}`);
}
