import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { canManageRecruiting } from "@/server/permissions";
import { getCandidateProfile } from "@/server/queries/candidates";
import { Scheduler } from "@/components/scheduling/scheduler";

export const metadata = { title: "Schedule interview" };

export default async function SchedulePage(props: PageProps<"/candidates/[id]/schedule">) {
  const user = await requireUser();
  if (!canManageRecruiting(user)) notFound();
  const { id } = await props.params;
  const sp = await props.searchParams;
  const profile = await getCandidateProfile(user, id);
  if (!profile) notFound();
  const app = profile.applications.find((a) => a.id === sp.app) ?? profile.applications.find((a) => a.status === "active");
  if (!app) notFound();

  const replace = typeof sp.replace === "string" ? app.interviews.find((i) => i.id === sp.replace) : undefined;
  const stages = app.job.stages.filter((s) => s.type === "screen" || s.type === "interview");
  const current = app.job.stages.find((s) => s.id === app.stageId);
  const defaultStage =
    (replace?.stageId && stages.find((s) => s.id === replace.stageId)) ||
    (current && stages.find((s) => s.id === current.id)) ||
    stages.find((s) => s.position > (current?.position ?? 0)) ||
    stages[0];

  const people = await db.query.users.findMany({
    where: inArray(schema.users.role, ["recruiter", "hiring_manager", "interviewer", "coordinator", "admin", "executive"]),
    orderBy: asc(schema.users.name),
  });
  const job = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, app.jobId), with: { team: true } });
  const defaultInterviewers = replace
    ? replace.interviewers.map((i) => i.userId)
    : defaultStage?.type === "screen"
      ? [job?.recruiterId].filter(Boolean)
      : [job?.hiringManagerId, ...(job?.team.slice(0, 1).map((t) => t.userId) ?? [])].filter(Boolean);

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
        people={people.map((p) => ({ id: p.id, name: p.name, title: p.title, avatarColor: p.avatarColor, role: p.role }))}
        defaultInterviewerIds={defaultInterviewers as string[]}
        replaceInterview={replace ? { id: replace.id, title: replace.title, startAt: replace.startAt.toISOString() } : undefined}
      />
    </div>
  );
}
