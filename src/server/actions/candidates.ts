"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/server/audit";
import { canManageRecruiting } from "@/server/permissions";

const schema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  phone: z.string().trim().optional(),
  location: z.string().trim().optional(),
  currentTitle: z.string().trim().optional(),
  currentCompany: z.string().trim().optional(),
  linkedinUrl: z.string().trim().url("LinkedIn must be a URL").optional().or(z.literal("")),
  tags: z.string().optional(),
  resumeText: z.string().optional(),
  jobId: z.string().uuid().optional().or(z.literal("")),
  sourceId: z.string().uuid().optional().or(z.literal("")),
});

export async function createCandidate(_prev: unknown, formData: FormData) {
  const user = await requireUser();
  if (!canManageRecruiting(user)) return { error: "You don't have permission to add candidates." };
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  // Duplicate detection on email.
  if (d.email) {
    const existing = await db.query.candidates.findFirst({ where: sql`lower(${s.candidates.email}) = lower(${d.email})` });
    if (existing) return { error: `A candidate with this email already exists: ${existing.firstName} ${existing.lastName}`, duplicateId: existing.id };
  }

  const candidateId = await db.transaction(async (tx) => {
    const [c] = await tx
      .insert(s.candidates)
      .values({
        firstName: d.firstName,
        lastName: d.lastName,
        email: d.email || null,
        phone: d.phone || null,
        location: d.location || null,
        currentTitle: d.currentTitle || null,
        currentCompany: d.currentCompany || null,
        linkedinUrl: d.linkedinUrl || null,
        tags: (d.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
        resumeText: d.resumeText || null,
        ownerId: user.id,
      })
      .returning();
    if (d.jobId) {
      const stages = await tx.query.jobStages.findMany({ where: eq(s.jobStages.jobId, d.jobId), orderBy: asc(s.jobStages.position) });
      const source = d.sourceId ? await tx.query.sources.findFirst({ where: eq(s.sources.id, d.sourceId) }) : null;
      const stage = (source?.category === "sourced" ? stages.find((st) => st.type === "lead") : stages.find((st) => st.type === "review")) ?? stages[0];
      const [app] = await tx
        .insert(s.applications)
        .values({ candidateId: c.id, jobId: d.jobId, stageId: stage.id, sourceId: d.sourceId || null, creditedToId: user.id })
        .returning();
      await tx.insert(s.applicationStageEvents).values({ applicationId: app.id, toStageId: stage.id, status: "active", movedById: user.id });
      await tx.insert(s.activities).values({ candidateId: c.id, applicationId: app.id, type: "application_created", actorId: user.id, body: `Added manually${source ? ` (${source.name})` : ""}` });
    } else {
      await tx.insert(s.activities).values({ candidateId: c.id, type: "application_created", actorId: user.id, body: "Added to PATS" });
    }
    return c.id;
  });
  await audit(user.id, "candidate.created", "candidate", candidateId);
  revalidatePath("/candidates");
  redirect(`/candidates/${candidateId}`);
}

