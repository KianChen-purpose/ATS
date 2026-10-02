"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireActor } from "@/lib/session";
import { ForbiddenError } from "@/server/policy/errors";
import * as svc from "@/server/services/jobs";

export async function createJob(_prev: unknown, formData: FormData) {
  const raw = Object.fromEntries(formData);
  const parsed = svc.createJobSchema.safeParse({ ...raw, confidential: raw.confidential === "on" });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  let jobId: string;
  try {
    jobId = await svc.createJob(await requireActor(), parsed.data);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  revalidatePath("/jobs");
  redirect(`/jobs/${jobId}`);
}

export async function setJobStatus(jobId: string, status: string) {
  const id = z.string().uuid().parse(jobId);
  await svc.setJobStatus(await requireActor(), id, svc.jobStatusSchema.parse(status));
  revalidatePath("/");
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
}

export async function setCareerSitePublished(jobId: string, published: boolean) {
  const id = z.string().uuid().parse(jobId);
  await svc.setCareerSitePublished(await requireActor(), id, z.boolean().parse(published));
  revalidatePath(`/jobs/${id}`);
}

export async function addOpenings(input: z.input<typeof svc.addOpeningsSchema>) {
  const d = svc.addOpeningsSchema.parse(input);
  await svc.addOpenings(await requireActor(), d);
  revalidatePath(`/jobs/${d.jobId}`);
}

export async function closeOpening(openingId: string) {
  const o = await svc.closeOpening(await requireActor(), z.string().uuid().parse(openingId));
  revalidatePath(`/jobs/${o.jobId}`);
}
