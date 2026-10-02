"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/session";
import * as svc from "@/server/services/approvals";

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
