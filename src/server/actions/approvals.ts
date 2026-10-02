"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/session";
import * as svc from "@/server/services/approvals";
import { decideApproval as decide } from "@/server/services/approval-decisions";

export async function saveApprovalChain(input: z.input<typeof svc.chainSchema>) {
  const parsed = svc.chainSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await svc.saveChain(await requireActor(), parsed.data);
  revalidatePath("/settings/approvals");
  return { ok: true as const };
}

export async function setApprovalChainActive(chainId: string, active: boolean) {
  await svc.setChainActive(await requireActor(), z.string().uuid().parse(chainId), z.boolean().parse(active));
  revalidatePath("/settings/approvals");
}

export async function decideApproval(requestId: string, decision: "approved" | "rejected", comment?: string) {
  const d = svc.decisionSchema.parse({ requestId, decision, comment });
  const r = await decide(await requireActor(), d);
  revalidatePath("/");
  revalidatePath("/approvals");
  revalidatePath(`/jobs/${r.jobId}`);
  revalidatePath("/jobs");
  return { outcome: r.outcome };
}
