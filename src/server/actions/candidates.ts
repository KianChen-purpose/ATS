"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/session";
import { ForbiddenError } from "@/server/policy/errors";
import * as svc from "@/server/services/candidates";

export async function createCandidate(_prev: unknown, formData: FormData) {
  const parsed = svc.createCandidateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  let result: svc.CreateCandidateResult;
  try {
    result = await svc.createCandidate(await requireActor(), parsed.data);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  if ("error" in result) return result;
  revalidatePath("/candidates");
  redirect(`/candidates/${result.candidateId}`);
}
