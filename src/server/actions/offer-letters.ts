"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/session";
import * as svc from "@/server/services/offer-letters";

export async function uploadOfferLetterTemplate(_prev: unknown, formData: FormData) {
  const parsed = svc.templateSchema.safeParse({
    name: formData.get("name"),
    brandId: formData.get("brandId") || null,
    locale: formData.get("locale"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the template details." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a .docx file." };
  try {
    await svc.uploadTemplate(await requireActor(), { ...parsed.data, fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/settings/offer-letters");
  return { ok: true as const };
}

export async function setOfferLetterTemplateActive(templateId: string, active: boolean) {
  await svc.setTemplateActive(await requireActor(), z.string().uuid().parse(templateId), z.boolean().parse(active));
  revalidatePath("/settings/offer-letters");
}

/** Generate the letter for an approved offer so the recruiter can review it before sending. */
export async function generateOfferLetter(offerId: string) {
  const { file } = await svc.generateOfferLetter(await requireActor(), z.string().uuid().parse(offerId));
  revalidatePath("/offers");
  return { fileId: file.id };
}
