"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/session";
import { simulateCandidateReply } from "@/server/services/mail-sync";

/** Demo only (mock mode): make the candidate reply to an email. */
export async function simulateReplyAction(emailId: string, candidateId: string) {
  const r = await simulateCandidateReply(await requireActor(), z.uuid().parse(emailId));
  revalidatePath(`/candidates/${z.uuid().parse(candidateId)}`);
  return r.status;
}
