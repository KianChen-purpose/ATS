"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/session";
import * as svc from "@/server/services/feedback";

export async function submitScorecard(input: z.input<typeof svc.scorecardSchema>) {
  const d = svc.scorecardSchema.parse(input);
  const r = await svc.submitScorecard(await requireActor(), d);
  revalidatePath(`/candidates/${r.candidateId}`);
  revalidatePath("/interviews");
  revalidatePath("/");
  return r;
}
