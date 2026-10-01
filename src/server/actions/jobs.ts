"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/server/audit";
import { canManageRecruiting } from "@/server/permissions";
import { DEFAULT_STAGES } from "@/lib/stages";


const jobSchema = z.object({
  title: z.string().trim().min(2, "Title is required"),
  brandId: z.string().uuid(),
  departmentId: z.string().uuid().optional().or(z.literal("")),
  locationId: z.string().uuid().optional().or(z.literal("")),
  employmentType: z.enum(s.employmentType.enumValues),
  workplaceType: z.enum(s.workplaceType.enumValues),
  compMin: z.coerce.number().int().positive().optional().or(z.literal("")),
  compMax: z.coerce.number().int().positive().optional().or(z.literal("")),
  hiringManagerId: z.string().uuid().optional().or(z.literal("")),
  recruiterId: z.string().uuid().optional().or(z.literal("")),
  coordinatorId: z.string().uuid().optional().or(z.literal("")),
  description: z.string().optional(),
  openings: z.coerce.number().int().min(1).max(50).default(1),
  confidential: z.coerce.boolean().default(false),
  status: z.enum(["draft", "open"]),
});

const blank = <T,>(v: T | "" | undefined) => (v === "" || v === undefined ? null : v);

export async function createJob(_prev: unknown, formData: FormData) {
  const user = await requireUser();
  if (!canManageRecruiting(user)) return { error: "You don't have permission to create jobs." };
  const raw = Object.fromEntries(formData);
  const parsed = jobSchema.safeParse({ ...raw, confidential: raw.confidential === "on" });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const jobId = await db.transaction(async (tx) => {
    const [job] = await tx
      .insert(s.jobs)
      .values({
        title: d.title,
        brandId: d.brandId,
        departmentId: blank(d.departmentId),
        locationId: blank(d.locationId),
        employmentType: d.employmentType,
        workplaceType: d.workplaceType,
        compMin: blank(d.compMin) as number | null,
        compMax: blank(d.compMax) as number | null,
        hiringManagerId: blank(d.hiringManagerId),
        recruiterId: blank(d.recruiterId) ?? user.id,
        coordinatorId: blank(d.coordinatorId),
        description: d.description || null,
        confidential: d.confidential,
        status: d.status,
        openedAt: d.status === "open" ? new Date() : null,
        publishedOnCareerSite: d.status === "open" && !d.confidential,
      })
      .returning();
    await tx.insert(s.jobStages).values(DEFAULT_STAGES.map((st, i) => ({ ...st, jobId: job.id, position: i })));
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(substring(code from 5)::int), 999) + 1` }).from(s.openings);
    await tx.insert(s.openings).values(Array.from({ length: d.openings }, (_, i) => ({ jobId: job.id, code: `REQ-${next + i}` })));
    return job.id;
  });
  await audit(user.id, "job.created", "job", jobId, { title: d.title });
  revalidatePath("/jobs");
  redirect(`/jobs/${jobId}`);
}

export async function setJobStatus(jobId: string, status: (typeof s.jobStatus.enumValues)[number]) {
  const user = await requireUser();
  if (!canManageRecruiting(user)) throw new Error("You don't have permission to change job status.");
  const job = await db.query.jobs.findFirst({ where: eq(s.jobs.id, jobId) });
  if (!job) throw new Error("Job not found");
  await db
    .update(s.jobs)
    .set({
      status,
      openedAt: status === "open" && !job.openedAt ? new Date() : job.openedAt,
      closedAt: status === "closed" ? new Date() : null,
      publishedOnCareerSite: status === "open" ? !job.confidential && job.publishedOnCareerSite : false,
    })
    .where(eq(s.jobs.id, jobId));
  await audit(user.id, "job.status_changed", "job", jobId, { from: job.status, to: status });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
}

export async function setCareerSitePublished(jobId: string, published: boolean) {
  const user = await requireUser();
  if (!canManageRecruiting(user)) throw new Error("You don't have permission to publish jobs.");
  await db.update(s.jobs).set({ publishedOnCareerSite: published }).where(eq(s.jobs.id, jobId));
  await audit(user.id, published ? "job.published" : "job.unpublished", "job", jobId);
  revalidatePath(`/jobs/${jobId}`);
}
