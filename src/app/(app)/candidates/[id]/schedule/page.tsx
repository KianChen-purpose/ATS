import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireActor } from "@/lib/session";
import { getSchedulerData } from "@/server/services/interviews";
import { Scheduler } from "@/components/scheduling/scheduler";

export const metadata = { title: "Schedule interview" };

export default async function SchedulePage(props: PageProps<"/candidates/[id]/schedule">) {
  const user = await requireActor();
  const { id } = await props.params;
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const data = await getSchedulerData(user, id, str("app"), str("replace"));
  if (!data) notFound();
  const { profile, app, stages, defaultStage, people, defaultInterviewerIds, replace } = data;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-zinc-200 bg-white px-6 py-3">
        <Link href={`/candidates/${id}?app=${app.id}`} className="rounded p-1 text-zinc-500 hover:bg-zinc-100"><ChevronLeft size={16} /></Link>
        <div>
          <h1 className="font-semibold">{replace ? "Reschedule" : "Schedule"} interview · {profile.firstName} {profile.lastName}</h1>
          <div className="text-xs text-zinc-500">{app.job.title} · {app.job.brand.name}</div>
        </div>
      </div>
      <Scheduler
        candidate={{ id: profile.id, name: `${profile.firstName} ${profile.lastName}`, email: profile.email }}
        applicationId={app.id}
        jobTitle={app.job.title}
        stages={stages}
        defaultStageId={defaultStage?.id ?? null}
        people={people}
        defaultInterviewerIds={defaultInterviewerIds}
        replaceInterview={replace ? { id: replace.id, title: replace.title, startAt: replace.startAt.toISOString() } : undefined}
      />
    </div>
  );
}
