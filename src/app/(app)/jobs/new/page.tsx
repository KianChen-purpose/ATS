import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { canManageRecruiting } from "@/server/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { NewJobForm } from "@/components/jobs/new-job-form";

export const metadata = { title: "New job" };

export default async function NewJobPage() {
  const user = await requireUser();
  if (!canManageRecruiting(user)) notFound();
  const [brands, departments, locations, users] = await Promise.all([
    db.query.brands.findMany({ orderBy: asc(schema.brands.name) }),
    db.query.departments.findMany({ orderBy: asc(schema.departments.name) }),
    db.query.locations.findMany({ orderBy: asc(schema.locations.name) }),
    db.query.users.findMany({ where: eq(schema.users.active, true), orderBy: asc(schema.users.name) }),
  ]);
  return (
    <>
      <PageHeader title="New job" subtitle="Creates the job with the standard Purpose interview plan" />
      <div className="mx-auto max-w-3xl px-6 py-6">
        <NewJobForm brands={brands} departments={departments} locations={locations} users={users.map((u) => ({ id: u.id, name: u.name, role: u.role }))} />
      </div>
    </>
  );
}
