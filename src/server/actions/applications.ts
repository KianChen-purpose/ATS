"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/session";
import * as svc from "@/server/services/applications";
import { tagsSchema, updateCandidateTags as updateTags } from "@/server/services/candidates";

function refresh(jobId?: string, candidateIds: string[] = []) {
  if (jobId) revalidatePath(`/jobs/${jobId}`);
  if (candidateIds.length === 1) revalidatePath(`/candidates/${candidateIds[0]}`);
  revalidatePath("/candidates");
  revalidatePath("/jobs");
}

export async function moveToStage(applicationIds: string[], stageId: string) {
  const d = svc.moveToStageSchema.parse({ applicationIds, stageId });
  const r = await svc.moveToStage(await requireActor(), d);
  refresh(r.jobId, r.candidateIds);
}

export async function archiveApplications(input: z.input<typeof svc.archiveSchema>) {
  const d = svc.archiveSchema.parse(input);
  const r = await svc.archiveApplications(await requireActor(), d);
  refresh(r.jobId, r.candidateIds);
}

export async function unarchiveApplication(applicationId: string) {
  const id = z.string().uuid().parse(applicationId);
  const r = await svc.unarchiveApplication(await requireActor(), id);
  refresh(r.jobId, [r.candidateId]);
}

export async function addNote(candidateId: string, applicationId: string | null, body: string) {
  if (!body.trim()) return;
  const d = svc.noteSchema.parse({ candidateId, applicationId, body });
  await svc.addNote(await requireActor(), d);
  revalidatePath(`/candidates/${d.candidateId}`);
}

export async function sendCandidateEmail(input: z.input<typeof svc.candidateEmailSchema>) {
  const d = svc.candidateEmailSchema.parse(input);
  await svc.sendCandidateEmail(await requireActor(), d);
  revalidatePath(`/candidates/${d.candidateId}`);
}

export async function addCandidateToJob(candidateId: string, jobId: string) {
  const d = svc.addToJobSchema.parse({ candidateId, jobId });
  await svc.addCandidateToJob(await requireActor(), d);
  refresh(d.jobId, [d.candidateId]);
}

export async function updateCandidateTags(candidateId: string, tags: string[]) {
  const id = z.string().uuid().parse(candidateId);
  await updateTags(await requireActor(), id, tagsSchema.parse(tags));
  revalidatePath(`/candidates/${id}`);
}
