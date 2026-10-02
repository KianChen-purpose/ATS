"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireActor } from "@/lib/session";
import * as svc from "@/server/services/talent-pools";

const id = z.string().uuid();

export async function createTalentPool(_prev: unknown, form: FormData) {
  const parsed = svc.poolSchema.safeParse({ name: form.get("name"), description: form.get("description") ?? undefined, brandId: form.get("brandId") || null });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the pool details." };
  const pool = await svc.createPool(await requireActor(), parsed.data);
  revalidatePath("/sourcing");
  redirect(`/sourcing/${pool.id}`);
}

export async function addToTalentPool(poolId: string, candidateId: string) {
  const r = await svc.addToPool(await requireActor(), id.parse(poolId), id.parse(candidateId));
  revalidatePath(`/sourcing/${poolId}`);
  return r;
}

export async function createProspect(input: z.input<typeof svc.prospectSchema>) {
  const parsed = svc.prospectSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the prospect details." };
  const r = await svc.createProspect(await requireActor(), parsed.data);
  revalidatePath(`/sourcing/${parsed.data.poolId}`);
  return r;
}

export async function setProspectStage(poolId: string, candidateId: string, stage: string) {
  await svc.setProspectStage(await requireActor(), id.parse(poolId), id.parse(candidateId), svc.stageSchema.parse(stage));
  revalidatePath(`/sourcing/${poolId}`);
}

export async function removeFromTalentPool(poolId: string, candidateId: string) {
  await svc.removeFromPool(await requireActor(), id.parse(poolId), id.parse(candidateId));
  revalidatePath(`/sourcing/${poolId}`);
}

export async function searchCandidatesForPool(poolId: string, q: string) {
  const rows = await svc.searchForPool(await requireActor(), id.parse(poolId), z.string().max(200).parse(q));
  return rows.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, subtitle: [c.currentTitle, c.currentCompany].filter(Boolean).join(" at ") }));
}
