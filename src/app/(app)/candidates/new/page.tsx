import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { canManageRecruiting } from "@/server/policy";
import { getProfileOptions, listSources } from "@/server/services/candidates";
import { PageHeader } from "@/components/ui/page-header";
import { NewCandidateForm } from "@/components/candidates/new-candidate-form";

export const metadata = { title: "Add candidate" };

export default async function NewCandidatePage(props: PageProps<"/candidates/new">) {
  const user = await requireActor();
  if (!canManageRecruiting(user)) notFound();
  const sp = await props.searchParams;
  const [{ jobs }, sources] = await Promise.all([getProfileOptions(user), listSources()]);
  return (
    <>
      <PageHeader title="Add candidate" />
      <div className="mx-auto max-w-3xl px-6 py-6">
        <NewCandidateForm jobs={jobs} sources={sources} defaultJobId={typeof sp.job === "string" ? sp.job : undefined} />
      </div>
    </>
  );
}
