import Link from "next/link";
import { Link2, Mail, MapPin, Phone, Lock, FileText, Video, EyeOff } from "lucide-react";
import { Avatar, candidateColor } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { cn, daysSince, fmt, money, RECOMMENDATION_LABELS, timeAgo } from "@/lib/utils";
import type { CandidateProfile } from "@/server/services/candidates";
import type { UserActor } from "@/server/policy";
import { canManageRecruiting } from "@/server/policy";
import { ApplicationActions } from "./application-actions";
import { NoteComposer } from "./note-composer";
import { TagEditor } from "./tag-editor";
import { AddToJob } from "./add-to-job";
import { ActivityFeed, PersonChip } from "./activity-feed";
import { InterviewRowActions } from "./interview-row-actions";
import { DebriefMatrix } from "./debrief-matrix";

type Options = {
  archiveReasons: { id: string; name: string; category: string }[];
  templates: { id: string; name: string; subject: string; body: string }[];
  jobs: { id: string; title: string; brand: string }[];
  attributeLabels: Record<string, string>;
};

export function CandidateProfileView({
  profile,
  options,
  user,
  selectedAppId,
  appHref,
}: {
  profile: CandidateProfile;
  options: Options;
  user: UserActor;
  selectedAppId?: string;
  /** Build a link that selects a different application. */
  appHref: (appId: string) => string;
}) {
  const c = profile;
  const name = `${c.firstName} ${c.lastName}`;
  const app =
    c.applications.find((a) => a.id === selectedAppId) ??
    c.applications.find((a) => a.status === "active") ??
    c.applications[0];
  const canManage = canManageRecruiting(user);
  const jobTitles = Object.fromEntries(c.applications.map((a) => [a.id, a.job.title]));
  const allScorecards = c.applications.flatMap((a) => a.scorecards.map((sc) => ({ ...sc, jobTitle: a.job.title })));
  const allInterviews = c.applications.flatMap((a) => a.interviews.map((iv) => ({ ...iv, jobTitle: a.job.title, scorecards: a.scorecards.filter((sc) => sc.interviewId === iv.id) })));
  const offers = c.applications.flatMap((a) => a.offers.map((o) => ({ ...o, jobTitle: a.job.title })));
  const hiddenFeedback = c.applications.reduce((n, a) => n + a.feedbackHidden, 0);
  const now = new Date();

  return (
    <div className="bg-white">
      {/* Header */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start gap-3">
          <Avatar name={name} color={candidateColor(c.firstName + c.lastName)} size={44} />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-zinc-900">{name}</h1>
            <div className="text-zinc-600">{[c.currentTitle, c.currentCompany].filter(Boolean).join(" at ")}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
              {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-zinc-800"><Mail size={12} />{c.email}</a>}
              {c.phone && <span className="inline-flex items-center gap-1"><Phone size={12} />{c.phone}</span>}
              {c.location && <span className="inline-flex items-center gap-1"><MapPin size={12} />{c.location}</span>}
              {c.linkedinUrl && <a href={c.linkedinUrl} target="_blank" className="inline-flex items-center gap-1 hover:text-zinc-800"><Link2 size={12} />LinkedIn</a>}
            </div>
            <div className="mt-2">
              <TagEditor candidateId={c.id} tags={c.tags} editable={canManage} />
            </div>
          </div>
        </div>
      </div>

      {/* Applications */}
      <div className="border-y border-zinc-100 bg-zinc-50/60 px-5 py-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Applications</span>
          {canManage && <AddToJob candidateId={c.id} jobs={options.jobs} existingJobIds={c.applications.map((a) => a.jobId)} />}
        </div>
        <div className="flex flex-wrap gap-2">
          {c.applications.map((a) => (
            <Link
              key={a.id}
              href={appHref(a.id)}
              scroll={false}
              className={cn(
                "min-w-48 rounded-lg border bg-white px-3 py-2 transition-colors",
                a.id === app?.id ? "border-accent-500 ring-2 ring-accent-100" : "border-zinc-200 hover:border-zinc-300",
              )}
            >
              <div className="flex items-center gap-1.5 font-medium text-zinc-900">
                {a.job.confidential && <Lock size={11} className="text-red-500" />}
                {a.job.title}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
                <AppStatus status={a.status} stage={a.stage.name} />
                <span>· {a.job.brand.name}</span>
              </div>
            </Link>
          ))}
        </div>

        {app && (
          <div className="mt-3">
            <StageProgress stages={app.job.stages} currentId={app.stageId} status={app.status} />
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
              <span>Source: <span className="text-zinc-800">{app.source?.name ?? "—"}</span></span>
              {app.referrer && <span>Referred by <span className="text-zinc-800">{app.referrer.name}</span></span>}
              <span>Applied {timeAgo(app.appliedAt)}</span>
              {app.status === "active" && <span>In stage {daysSince(app.stageEnteredAt)}d</span>}
              {app.archiveReason && <span>Archived: <span className="text-zinc-800">{app.archiveReason.name}</span></span>}
              <Link href={`/jobs/${app.jobId}`} className="text-accent-700 hover:underline">View job</Link>
            </div>
          </div>
        )}
        <div className="mt-3">
          <ApplicationActions
            candidate={{ id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email }}
            application={app ? { id: app.id, status: app.status, stageId: app.stageId, jobTitle: app.job.title, brandName: app.job.brand.name } : null}
            stages={app?.job.stages ?? []}
            archiveReasons={options.archiveReasons}
            templates={options.templates}
            sender={{ name: user.name, email: user.email }}
            canManage={canManage}
          />
        </div>
      </div>

      <Tabs
        tabs={[
          {
            key: "activity",
            label: "Activity",
            content: (
              <div className="space-y-5 px-5 py-4">
                <NoteComposer candidateId={c.id} applicationId={app?.id ?? null} />
                <ActivityFeed activities={c.activities} jobTitles={jobTitles} />
              </div>
            ),
          },
          {
            key: "feedback",
            label: "Feedback",
            count: allScorecards.length,
            content: (
              <div className="space-y-3 px-5 py-4">
                {hiddenFeedback > 0 && (
                  <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-zinc-600">
                    <EyeOff size={14} /> {hiddenFeedback} scorecard(s) hidden until you submit your own feedback.
                  </div>
                )}
                {c.applications
                  .filter((a) => a.scorecards.length > 1 && !a.feedbackHidden)
                  .map((a) => (
                    <DebriefMatrix key={a.id} scorecards={a.scorecards} attributeLabels={options.attributeLabels} jobTitle={a.job.title} />
                  ))}
                {allScorecards.length === 0 ? (
                  <EmptyState title="No feedback yet" />
                ) : (
                  allScorecards.map((sc) => (
                    <div key={sc.id} className="rounded-lg border border-zinc-200 p-3">
                      <div className="flex items-center justify-between">
                        <PersonChip name={sc.author.name} color={sc.author.avatarColor} />
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${RECOMMENDATION_LABELS[sc.overall].className}`}>
                          {RECOMMENDATION_LABELS[sc.overall].label}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {sc.interview?.title.split(" – ")[0] ?? "Feedback"} · {sc.jobTitle} · {timeAgo(sc.submittedAt)}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {Object.entries(sc.ratings).map(([k, v]) => (
                          <span key={k} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-700">
                            {options.attributeLabels[k] ?? k.replace(/_/g, " ")}: <strong>{v}</strong>/4
                          </span>
                        ))}
                      </div>
                      {sc.notes && <p className="mt-2 text-zinc-700">{sc.notes}</p>}
                    </div>
                  ))
                )}
              </div>
            ),
          },
          {
            key: "interviews",
            label: "Interviews",
            count: allInterviews.length,
            content: (
              <div className="px-5 py-4">
                {allInterviews.length === 0 ? (
                  <EmptyState title="No interviews scheduled" />
                ) : (
                  <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                    {allInterviews.map((iv) => (
                      <li key={iv.id} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="w-24 shrink-0">
                          <div className="font-medium">{fmt(iv.startAt, "MMM d")}</div>
                          <div className="text-xs text-zinc-500">{fmt(iv.startAt, "h:mm a")}</div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{iv.stage?.name ?? iv.title}</div>
                          <div className="truncate text-xs text-zinc-500">
                            {iv.interviewers.map((i) => i.user.name).join(", ")} · {iv.jobTitle}
                          </div>
                        </div>
                        {iv.status === "scheduled" && iv.startAt > now ? (
                          iv.meetingUrl && (
                            <a href={iv.meetingUrl} target="_blank" className="inline-flex items-center gap-1 rounded-md bg-[#5b5fc7] px-2 py-1 text-xs font-medium text-white">
                              <Video size={12} /> Teams
                            </a>
                          )
                        ) : iv.status === "cancelled" ? (
                          <Badge tone="red">Cancelled</Badge>
                        ) : (
                          <Badge tone={iv.scorecards.length >= iv.interviewers.length ? "green" : "amber"}>
                            {iv.scorecards.length}/{iv.interviewers.length} feedback
                          </Badge>
                        )}
                        {iv.status !== "cancelled" && (
                          <InterviewRowActions
                            interviewId={iv.id}
                            candidateId={c.id}
                            applicationId={iv.applicationId}
                            upcoming={iv.startAt > now}
                            canManage={canManage}
                            canSubmitFeedback={iv.startAt <= now && iv.interviewers.some((i) => i.userId === user.id) && !iv.scorecards.some((sc) => sc.authorId === user.id)}
                            missingFeedback={iv.scorecards.length < iv.interviewers.length}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ),
          },
          {
            key: "emails",
            label: "Emails",
            count: c.emails.length,
            content: (
              <div className="space-y-3 px-5 py-4">
                {c.emails.length === 0 ? (
                  <EmptyState title="No emails yet" />
                ) : (
                  c.emails.map((e) => (
                    <div key={e.id} className="rounded-lg border border-zinc-200">
                      <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{e.subject}</div>
                          <div className="text-xs text-zinc-500">
                            {e.direction === "outbound" ? `${e.fromAddress} → ${e.toAddress}` : `${e.fromAddress} → you`}
                          </div>
                        </div>
                        <span className="shrink-0 text-xs text-zinc-500">{timeAgo(e.sentAt)}</span>
                      </div>
                      <div className="px-3 py-2 whitespace-pre-wrap text-zinc-700">{e.body}</div>
                    </div>
                  ))
                )}
              </div>
            ),
          },
          {
            key: "resume",
            label: "Resume",
            content: (
              <div className="px-5 py-4">
                {c.resumeFileName && (
                  <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-zinc-200 px-2.5 py-1.5">
                    <FileText size={14} className="text-red-500" /> {c.resumeFileName}
                  </div>
                )}
                {c.resumeText ? (
                  <pre className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-sans whitespace-pre-wrap text-zinc-700">{c.resumeText}</pre>
                ) : (
                  <EmptyState title="No resume on file" />
                )}
              </div>
            ),
          },
          ...(user.role !== "interviewer"
            ? [
                {
                  key: "offers",
                  label: "Offers",
                  count: offers.length,
                  content: (
                    <div className="space-y-3 px-5 py-4">
                      {offers.length === 0 ? (
                        <EmptyState title="No offers" />
                      ) : (
                        offers.map((o) => (
                          <div key={o.id} className="rounded-lg border border-zinc-200 p-3">
                            <div className="flex items-center justify-between">
                              <div className="font-medium">{o.jobTitle}</div>
                              <Badge tone={o.status === "accepted" ? "green" : o.status === "declined" ? "red" : "accent"}>{o.status.replace("_", " ")}</Badge>
                            </div>
                            <div className="mt-1 text-zinc-700">
                              {money(o.baseSalary, o.currency)} base{o.bonusPercent ? ` + ${o.bonusPercent}% bonus` : ""}
                              {o.startDate && <> · Start {fmt(o.startDate + "T12:00:00Z", "MMM d, yyyy")}</>}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs">
                              {o.approvals.map((ap) => (
                                <span key={ap.id} className="inline-flex items-center gap-1 rounded bg-zinc-50 px-1.5 py-0.5">
                                  {ap.approver.name}:
                                  <span className={ap.status === "approved" ? "text-emerald-700" : ap.status === "rejected" ? "text-red-700" : "text-amber-700"}>{ap.status}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  ),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

function AppStatus({ status, stage }: { status: string; stage: string }) {
  if (status === "hired") return <Badge tone="green">Hired</Badge>;
  if (status === "archived") return <Badge tone="neutral">Archived · {stage}</Badge>;
  return <Badge tone="accent">{stage}</Badge>;
}

function StageProgress({ stages, currentId, status }: { stages: { id: string; name: string; position: number }[]; currentId: string; status: string }) {
  const current = stages.find((s) => s.id === currentId)?.position ?? 0;
  return (
    <div className="flex gap-1">
      {stages.map((s) => (
        <div key={s.id} className="min-w-0 flex-1" title={s.name}>
          <div
            className={cn(
              "h-1.5 rounded-full",
              s.position < current ? "bg-accent-500" : s.position === current ? (status === "archived" ? "bg-zinc-400" : status === "hired" ? "bg-emerald-500" : "bg-accent-600") : "bg-zinc-200",
            )}
          />
          <div className={cn("mt-1 truncate text-[10px]", s.position === current ? "font-semibold text-zinc-800" : "text-zinc-400")}>{s.name}</div>
        </div>
      ))}
    </div>
  );
}
