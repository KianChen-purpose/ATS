import Link from "next/link";
import { CalendarDays, Check, Clock, MapPin, Video } from "lucide-react";
import { requireUser } from "@/lib/session";
import { canManageRecruiting } from "@/server/permissions";
import { interviewCounts, listInterviews, type InterviewScope, type InterviewView } from "@/server/queries/interviews";
import { getProfileOptions } from "@/server/queries/candidates";
import { PageHeader } from "@/components/ui/page-header";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Avatar, candidateColor } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { InterviewRowActions } from "@/components/candidates/interview-row-actions";
import { RemindAllButton } from "@/components/interviews/remind-all-button";
import { cn, fmt } from "@/lib/utils";

export const metadata = { title: "Interviews" };

const VIEWS: InterviewView[] = ["upcoming", "feedback", "past", "cancelled"];

export default async function InterviewsPage(props: PageProps<"/interviews">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);

  const canManage = canManageRecruiting(user);
  const scope: InterviewScope = canManage && str("scope") !== "mine" ? "all" : "mine";
  const view = (VIEWS as string[]).includes(str("view") ?? "") ? (str("view") as InterviewView) : "upcoming";
  const jobId = str("job");

  const [rows, counts, options] = await Promise.all([
    listInterviews(user, { scope, view, jobId }),
    interviewCounts(user, scope),
    getProfileOptions(user),
  ]);

  const href = (next: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ scope: canManage ? scope : undefined, view, job: jobId, ...next })) if (v) p.set(k, v);
    return `/interviews?${p}`;
  };

  // Group by calendar day in the viewer's time zone.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = fmt(r.startAt, "yyyy-MM-dd", user.timezone);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const today = fmt(new Date(), "yyyy-MM-dd", user.timezone);

  return (
    <>
      <PageHeader
        title="Interviews"
        subtitle={scope === "all" ? "All interviews on jobs you can see" : "Interviews you're on the panel for"}
        actions={
          <>
            {canManage && (
              <div className="flex rounded-md border border-zinc-200 bg-white p-0.5 text-xs">
                {(["all", "mine"] as const).map((sc) => (
                  <Link
                    key={sc}
                    href={href({ scope: sc })}
                    className={cn("rounded px-2.5 py-1 font-medium", scope === sc ? "bg-zinc-900 text-white" : "text-zinc-600 hover:text-zinc-900")}
                  >
                    {sc === "all" ? "All interviews" : "My interviews"}
                  </Link>
                ))}
              </div>
            )}
            {canManage && view === "feedback" && rows.length > 0 && <RemindAllButton interviewIds={rows.map((r) => r.id)} />}
          </>
        }
      >
        <FilterTabs
          active={view}
          hrefFor={(key) => href({ view: key })}
          tabs={[
            { key: "upcoming", label: "Upcoming", count: counts.upcoming },
            { key: "feedback", label: scope === "mine" ? "My feedback due" : "Feedback outstanding", count: counts.feedback },
            { key: "past", label: "Past", count: counts.past },
            { key: "cancelled", label: "Cancelled", count: counts.cancelled },
          ]}
        />
      </PageHeader>

      <div className="px-6 py-4">
        <form className="mb-3 flex items-center gap-2">
          {canManage && <input type="hidden" name="scope" value={scope} />}
          <input type="hidden" name="view" value={view} />
          <select name="job" defaultValue={jobId ?? ""} className="h-8 max-w-72 rounded-md border border-zinc-200 bg-white px-2">
            <option value="">All jobs</option>
            {options.jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.title}</option>
            ))}
          </select>
          <button className={buttonClass("secondary")}>Apply</button>
          {jobId && <Link href={href({ job: undefined })} className="text-xs text-zinc-500 hover:text-zinc-800">Clear</Link>}
        </form>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-white">
            <EmptyState
              icon={<CalendarDays size={20} />}
              title={view === "feedback" ? "All feedback is in" : "No interviews here"}
              description={view === "upcoming" ? "Schedule interviews from a candidate's profile." : undefined}
            />
          </div>
        ) : (
          <div className="space-y-5">
            {[...groups.entries()].map(([day, items]) => (
              <section key={day}>
                <h2 className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-zinc-500">
                  {fmt(items[0].startAt, "EEEE, MMMM d", user.timezone)}
                  {day === today && <Badge tone="accent">Today</Badge>}
                </h2>
                <div className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white">
                  {items.map((iv) => (
                    <div key={iv.id} className="flex items-center gap-4 px-4 py-2.5 hover:bg-zinc-50/60">
                      <div className="w-28 shrink-0 text-xs text-zinc-600">
                        <div className="flex items-center gap-1 font-medium text-zinc-900">
                          <Clock size={12} className="text-zinc-400" />
                          {fmt(iv.startAt, "h:mm a", user.timezone)}
                        </div>
                        <div className="pl-4 text-zinc-500">to {fmt(iv.endAt, "h:mm a", user.timezone)}</div>
                      </div>

                      <Link href={`/candidates/${iv.candidateId}?app=${iv.applicationId}`} className="flex min-w-0 flex-1 items-center gap-2.5">
                        <Avatar name={`${iv.firstName} ${iv.lastName}`} color={candidateColor(iv.firstName + iv.lastName)} size={28} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-zinc-900 hover:text-accent-700">
                            {iv.firstName} {iv.lastName}
                            <span className="font-normal text-zinc-500"> · {iv.title}</span>
                          </span>
                          <span className="block truncate text-xs text-zinc-500">
                            {iv.jobTitle}
                            {iv.stageName && ` · ${iv.stageName}`}
                          </span>
                        </span>
                      </Link>

                      <div className="hidden w-48 shrink-0 items-center md:flex">
                        <div className="flex -space-x-1.5">
                          {iv.interviewers.slice(0, 5).map((p) => (
                            <span key={p.id} className="relative" title={`${p.name}${iv.isPast ? (p.submitted ? " — feedback submitted" : " — feedback missing") : ""}`}>
                              <Avatar name={p.name} color={p.color} size={24} className="ring-2 ring-white" />
                              {iv.isPast && iv.status !== "cancelled" && (
                                <span className={cn("absolute -right-0.5 -bottom-0.5 flex size-3 items-center justify-center rounded-full ring-2 ring-white", p.submitted ? "bg-emerald-500" : "bg-amber-400")}>
                                  {p.submitted && <Check size={8} className="text-white" strokeWidth={3} />}
                                </span>
                              )}
                            </span>
                          ))}
                        </div>
                        {iv.interviewers.length > 5 && <span className="ml-1.5 text-[11px] text-zinc-400">+{iv.interviewers.length - 5}</span>}
                      </div>

                      <div className="hidden w-40 shrink-0 text-xs lg:block">
                        {iv.status === "cancelled" ? (
                          <Badge tone="neutral">Cancelled</Badge>
                        ) : iv.isPast ? (
                          iv.missingCount === 0 ? (
                            <Badge tone="green">Feedback complete</Badge>
                          ) : (
                            <Badge tone="amber">{iv.missingCount} feedback missing</Badge>
                          )
                        ) : iv.meetingUrl ? (
                          <a href={iv.meetingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-700 hover:underline">
                            <Video size={12} /> Join Teams meeting
                          </a>
                        ) : iv.location ? (
                          <span className="inline-flex items-center gap-1 text-zinc-600"><MapPin size={12} /> {iv.location}</span>
                        ) : null}
                      </div>

                      <div className="flex w-36 shrink-0 justify-end">
                        {iv.status !== "cancelled" && (
                          <InterviewRowActions
                            interviewId={iv.id}
                            candidateId={iv.candidateId}
                            applicationId={iv.applicationId}
                            upcoming={!iv.isPast}
                            canManage={canManage}
                            canSubmitFeedback={iv.isInterviewer && !iv.mySubmitted && iv.startAt < new Date()}
                            missingFeedback={iv.missingCount > 0}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
            {rows.length >= 200 && <p className="text-xs text-zinc-400">Showing the first 200 interviews. Filter by job to narrow down.</p>}
          </div>
        )}
      </div>
    </>
  );
}
