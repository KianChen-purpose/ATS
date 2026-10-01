import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, LayoutGrid, Lock, Plus, Rows3, X } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { requireActor } from "@/lib/session";
import { getJobDetail, getPipeline, pipelineCounts } from "@/server/services/jobs";
import { getProfileOptions, viewCandidateProfile } from "@/server/services/candidates";
import { canManageRecruiting } from "@/server/policy";
import { PageHeader } from "@/components/ui/page-header";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { JobStatusMenu } from "@/components/jobs/job-status-menu";
import { PipelineBoard } from "@/components/jobs/pipeline-board";
import { PipelineTable } from "@/components/jobs/pipeline-table";
import { CandidateProfileView } from "@/components/candidates/candidate-profile";
import { cn, compRange, fmt } from "@/lib/utils";
import { markdownToHtml } from "@/lib/markdown";

export async function generateMetadata(props: PageProps<"/jobs/[id]">) {
  const user = await requireActor();
  const job = await getJobDetail(user, (await props.params).id);
  return { title: job?.title ?? "Job" };
}

const STAGE_TYPE_LABEL: Record<string, string> = {
  lead: "Lead",
  review: "Review",
  screen: "Screen",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
};

export default async function JobPage(props: PageProps<"/jobs/[id]">) {
  const user = await requireActor();
  const { id } = await props.params;
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const tab = str("tab") ?? "pipeline";
  const view = str("view") ?? "board";
  const status = (["active", "archived", "hired"].includes(str("status") ?? "") ? str("status") : "active") as "active" | "archived" | "hired";

  const job = await getJobDetail(user, id);
  if (!job) notFound();
  const canManage = canManageRecruiting(user);

  const [apps, counts, options] = await Promise.all([getPipeline(user, id, status), pipelineCounts(user, id), getProfileOptions(user)]);
  const panelCandidateId = str("c");
  const panelProfile = panelCandidateId ? await viewCandidateProfile(user, panelCandidateId, "job_panel") : null;

  const href = (next: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { tab, view, status, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/jobs/${id}?${p}`;
  };
  const closeHref = href({ c: undefined, app: undefined });
  // Hired column only matters when looking at active pipeline; archived/hired views show everything as a table.
  const boardStages = job.stages.filter((s) => s.type !== "hired");

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {job.title}
            {job.confidential && (
              <Badge tone="red">
                <Lock size={10} /> Confidential
              </Badge>
            )}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: job.brand.primaryColor }} />
              {job.brand.name}
            </span>
            {job.department && <span>· {job.department.name}</span>}
            {job.location && <span>· {job.location.name}</span>}
            <span>· {job.workplaceType}</span>
            <span>· {compRange(job.compMin, job.compMax, job.currency)}</span>
          </span>
        }
        actions={
          <>
            {job.publishedOnCareerSite && (
              <Link href={`/careers/${job.brand.slug}/jobs/${job.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800">
                <ExternalLink size={12} /> Career site
              </Link>
            )}
            {canManage ? <JobStatusMenu jobId={job.id} status={job.status} /> : <JobStatusBadge status={job.status} />}
          </>
        }
      >
        <FilterTabs
          active={tab}
          hrefFor={(key) => href({ tab: key })}
          tabs={[
            { key: "pipeline", label: "Pipeline", count: counts.active ?? 0 },
            { key: "details", label: "Job details" },
            { key: "plan", label: "Interview plan", count: job.stages.length },
            { key: "openings", label: "Openings & team", count: job.openings.length },
          ]}
        />
      </PageHeader>

      {tab === "pipeline" && (
        <>
          <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-2">
            <div className="flex items-center gap-1">
              {(["active", "hired", "archived"] as const).map((st) => (
                <Link
                  key={st}
                  href={href({ status: st, view: st === "active" ? view : "table" })}
                  className={cn("rounded-md px-2.5 py-1 font-medium capitalize", status === st ? "bg-zinc-100 text-zinc-900" : "text-zinc-500 hover:text-zinc-800")}
                >
                  {st} <span className="text-zinc-400">{counts[st] ?? 0}</span>
                </Link>
              ))}
            </div>
            {status === "active" && (
              <div className="flex items-center gap-2">
              {canManage && (
                <Link href={`/candidates/new?job=${job.id}`} className={buttonClass("secondary", "sm")}>
                  <Plus size={13} /> Add candidate
                </Link>
              )}
              <div className="flex rounded-md border border-zinc-200 p-0.5">
                <Link href={href({ view: "board" })} className={cn("rounded p-1", view === "board" ? "bg-zinc-100 text-zinc-900" : "text-zinc-400")} title="Board view">
                  <LayoutGrid size={15} />
                </Link>
                <Link href={href({ view: "table" })} className={cn("rounded p-1", view === "table" ? "bg-zinc-100 text-zinc-900" : "text-zinc-400")} title="Table view">
                  <Rows3 size={15} />
                </Link>
              </div>
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {status === "active" && view === "board" ? (
              <PipelineBoard stages={boardStages} apps={apps} canManage={canManage} />
            ) : (
              <PipelineTable stages={job.stages} apps={apps} canManage={canManage && status === "active"} archiveReasons={options.archiveReasons} />
            )}
          </div>
        </>
      )}

      {tab === "details" && (
        <div className="mx-auto grid w-full max-w-5xl gap-4 px-6 py-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Description" />
            <div className="prose-job px-5 py-4" dangerouslySetInnerHTML={{ __html: markdownToHtml(job.description ?? "") }} />
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader title="Details" />
              <dl className="divide-y divide-zinc-100">
                {[
                  ["Brand", job.brand.name],
                  ["Department", job.department?.name],
                  ["Location", job.location?.name],
                  ["Workplace", job.workplaceType],
                  ["Employment", job.employmentType.replace("_", " ")],
                  ["Compensation", compRange(job.compMin, job.compMax, job.currency)],
                  ["Opened", job.openedAt ? fmt(job.openedAt, "MMM d, yyyy") : "—"],
                  ["Career site", job.publishedOnCareerSite ? "Published" : "Not published"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 px-4 py-2">
                    <dt className="text-zinc-500">{k}</dt>
                    <dd className="text-right capitalize text-zinc-900">{v ?? "—"}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>
        </div>
      )}

      {tab === "plan" && (
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          <Card>
            <CardHeader title="Interview plan" />
            <ol className="divide-y divide-zinc-100">
              {job.stages.map((s, i) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-semibold text-zinc-600">{i + 1}</span>
                  <span className="flex-1 font-medium">{s.name}</span>
                  <Badge tone="neutral">{STAGE_TYPE_LABEL[s.type]}</Badge>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}

      {tab === "openings" && (
        <div className="mx-auto grid w-full max-w-5xl gap-4 px-6 py-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Openings" />
            <table className="w-full">
              <thead>
                <tr className="text-left text-[11px] font-medium text-zinc-500 uppercase">
                  <th className="px-4 py-2">ID</th>
                  <th className="px-4 py-2">Reason</th>
                  <th className="px-4 py-2">Target start</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {job.openings.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-2 font-mono text-xs">{o.code}</td>
                    <td className="px-4 py-2">{o.reason === "backfill" ? "Backfill" : "New headcount"}</td>
                    <td className="px-4 py-2">{o.targetStartDate ? fmt(o.targetStartDate + "T12:00:00Z", "MMM d, yyyy") : "—"}</td>
                    <td className="px-4 py-2">
                      <Badge tone={o.status === "open" ? "green" : "neutral"}>{o.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card>
            <CardHeader title="Hiring team" />
            <ul className="divide-y divide-zinc-100">
              {[
                job.hiringManager && { user: job.hiringManager, role: "Hiring manager" },
                job.recruiter && { user: job.recruiter, role: "Recruiter" },
                job.coordinator && { user: job.coordinator, role: "Coordinator" },
                ...job.team.map((t) => ({ user: t.user, role: "Interviewer" })),
              ]
                .filter((x): x is NonNullable<typeof x> => !!x)
                .map((m) => (
                  <li key={m.user.id + m.role} className="flex items-center gap-3 px-4 py-2">
                    <Avatar name={m.user.name} color={m.user.avatarColor} size={26} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{m.user.name}</div>
                      <div className="text-xs text-zinc-500">{m.user.title}</div>
                    </div>
                    <Badge tone="neutral">{m.role}</Badge>
                  </li>
                ))}
            </ul>
          </Card>
        </div>
      )}

      {panelProfile && (
        <>
          <Link href={closeHref} scroll={false} className="fixed inset-0 z-30 bg-zinc-900/10" aria-label="Close candidate" />
          <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-[720px] overflow-y-auto border-l border-zinc-200 bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-100 bg-white/95 px-4 py-2 backdrop-blur">
              <Link href={`/candidates/${panelProfile.id}`} className="text-xs text-accent-700 hover:underline">
                Open full profile
              </Link>
              <Link href={closeHref} scroll={false} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" aria-label="Close">
                <X size={16} />
              </Link>
            </div>
            <CandidateProfileView
              profile={panelProfile}
              options={options}
              user={user}
              selectedAppId={str("app")}
              appHref={(appId) => href({ c: panelProfile.id, app: appId })}
            />
          </aside>
        </>
      )}
    </div>
  );
}
