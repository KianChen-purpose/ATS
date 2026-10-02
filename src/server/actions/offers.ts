"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/session";
import * as svc from "@/server/services/offers";

const id = z.string().uuid();

function refresh(candidateId?: string) {
  if (candidateId) revalidatePath(`/candidates/${candidateId}`);
  revalidatePath("/offers");
  revalidatePath("/");
}

export async function createOffer(input: z.input<typeof svc.createOfferSchema>) {
  const parsed = svc.createOfferSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the offer details." };
  const offer = await svc.createOffer(await requireActor(), parsed.data);
  refresh();
  return { offerId: offer.id };
}

export async function updateOffer(offerId: string, input: z.input<typeof svc.offerTermsSchema>) {
  const parsed = svc.offerTermsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the offer details." };
  await svc.updateOffer(await requireActor(), id.parse(offerId), parsed.data);
  refresh();
  return { offerId };
}

export async function submitOffer(offerId: string) {
  const r = await svc.submitOffer(await requireActor(), id.parse(offerId));
  refresh();
  return r;
}

export async function sendOffer(offerId: string) {
  const r = await svc.sendOffer(await requireActor(), id.parse(offerId));
  refresh(r.candidateId);
}

export async function recordOfferResponse(input: z.input<typeof svc.responseSchema>) {
  const r = await svc.recordOfferResponse(await requireActor(), svc.responseSchema.parse(input));
  refresh(r.candidateId);
  revalidatePath(`/jobs/${r.jobId}`);
}

export async function withdrawOffer(offerId: string) {
  const r = await svc.withdrawOffer(await requireActor(), id.parse(offerId));
  refresh(r.candidateId);
}

export async function returnOfferToDraft(offerId: string) {
  const r = await svc.returnOfferToDraft(await requireActor(), id.parse(offerId));
  refresh(r.candidateId);
}
