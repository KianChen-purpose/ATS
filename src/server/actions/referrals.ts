"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/session";
import { resumeKind } from "@/server/services/career-applications";
import { referralSchema, submitReferral } from "@/server/services/referrals";

export type ReferralState = { status: "idle" } | { status: "done"; alreadyReferred: boolean } | { status: "error"; error: string };

export async function referCandidate(_prev: ReferralState, form: FormData): Promise<ReferralState> {
  const actor = await requireActor();
  const parsed = referralSchema.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  if (!parsed.success) return { status: "error", error: parsed.error.issues[0]?.message ?? "Check the form." };
  const file = form.get("resume");
  let resume: { name: string; bytes: Buffer; contentType: string } | null = null;
  if (file instanceof File && file.size > 0) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const kind = resumeKind({ name: file.name, bytes });
    if (!kind) return { status: "error", error: "Resumes must be a PDF or Word (.docx) file under 5 MB." };
    resume = { name: file.name, bytes, contentType: kind.contentType };
  }
  const r = await submitReferral(actor, parsed.data, resume);
  revalidatePath("/referrals");
  return { status: "done", alreadyReferred: r.alreadyReferred };
}
