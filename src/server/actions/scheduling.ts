"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/session";
import * as interviews from "@/server/services/interviews";
import * as links from "@/server/services/scheduling-links";

/** Outlook free/busy for interviewers, keyed by user id, for the scheduling grid. */
export async function getAvailability(interviewerIds: string[], fromISO: string, days: number) {
  const d = z
    .object({ ids: z.array(z.string().uuid()).max(20), from: z.string().datetime(), days: z.number().int().min(1).max(31) })
    .parse({ ids: interviewerIds, from: fromISO, days });
  return interviews.getAvailability(await requireActor(), d.ids, new Date(d.from), d.days);
}

export async function scheduleInterview(input: z.input<typeof interviews.scheduleSchema>) {
  const d = interviews.scheduleSchema.parse(input);
  const r = await interviews.scheduleInterview(await requireActor(), d);
  revalidatePath(`/candidates/${r.candidateId}`);
  revalidatePath("/interviews");
  return r;
}

export async function cancelInterview(interviewId: string, notifyCandidate: boolean) {
  const id = z.string().uuid().parse(interviewId);
  const r = await interviews.cancelInterview(await requireActor(), id, z.boolean().parse(notifyCandidate));
  revalidatePath(`/candidates/${r.candidateId}`);
  revalidatePath("/interviews");
}

export async function sendFeedbackReminders(interviewIds: string[]) {
  const ids = z.array(z.string().uuid()).min(1).max(500).parse(interviewIds);
  const r = await interviews.sendFeedbackReminders(await requireActor(), ids);
  revalidatePath("/interviews");
  return r;
}

/** Create a self-scheduling link and (optionally) email it to the candidate. */
export async function createSchedulingLink(input: z.input<typeof links.linkSchema>) {
  const d = links.linkSchema.parse(input);
  const r = await links.createSchedulingLink(await requireActor(), d);
  revalidatePath(`/candidates/${r.candidateId}`);
  return { url: r.url };
}

/** Public: candidate books a slot from their link. No staff session; the token authorizes. */
export async function bookSchedulingLink(token: string, startISO: string) {
  return links.bookSchedulingLink(links.bookLinkSchema.parse({ token, startISO }));
}
