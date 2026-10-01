import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { canManageRecruiting } from "@/server/policy";
import { getJobFormOptions } from "@/server/services/jobs";
import { PageHeader } from "@/components/ui/page-header";
import { NewJobForm } from "@/components/jobs/new-job-form";

export const metadata = { title: "New job" };

export default async function NewJobPage() {
  const user = await requireActor();
  if (!canManageRecruiting(user)) notFound();
  const { brands, departments, locations, users } = await getJobFormOptions(user);
  return (
    <>
      <PageHeader title="New job" subtitle="Creates the job with the standard Purpose interview plan" />
      <div className="mx-auto max-w-3xl px-6 py-6">
        <NewJobForm brands={brands} departments={departments} locations={locations} users={users.map((u) => ({ id: u.id, name: u.name, role: u.role }))} />
      </div>
    </>
  );
}
