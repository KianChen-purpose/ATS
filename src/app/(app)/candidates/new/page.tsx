import { asc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { canManageRecruiting } from "@/server/permissions";
import { getProfileOptions } from "@/server/queries/candidates";
import { PageHeader } from "@/components/ui/page-header";
import { NewCandidateForm } from "@/components/candidates/new-candidate-form";

export const metadata = { title: "Add candidate" };

export default async function NewCandidatePage(props: PageProps<"/candidates/new">) {
  const user = await requireUser();
  if (!canManageRecruiting(user)) notFound();
  const sp = await props.searchParams;
  const [{ jobs }, sources] = await Promise.all([getProfileOptions(user), db.query.sources.findMany({ orderBy: asc(schema.sources.name) })]);
  return (
    <>
      <PageHeader title="Add candidate" />
      <div className="mx-auto max-w-3xl px-6 py-6">
        <NewCandidateForm jobs={jobs} sources={sources} defaultJobId={typeof sp.job === "string" ? sp.job : undefined} />
      </div>
    </>
  );
}
