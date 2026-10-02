import Link from "next/link";
import { CalendarClock, ClipboardCheck, FileSignature, Video } from "lucide-react";
import { requireActor } from "@/lib/session";
import { getHomeData } from "@/server/services/home";
import { approvalInbox } from "@/server/services/approval-inbox";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { fmt, money, timeAgo } from "@/lib/utils";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const user = await requireActor();
  const [{ upcoming, feedbackDue, myJobs, stats }, { waiting: approvals }] = await Promise.all([getHomeData(user), approvalInbox(user)]);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <h1 className="text-xl font-semibold text-zinc-900">
        {greeting}, {user.name.split(" ")[0]}
      </h1>
      <p className="mt-0.5 text-zinc-500">Here&apos;s what needs your attention today.</p>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open jobs" value={stats.openJobs} href="/jobs" />
        <Stat label="Active candidates" value={stats.activeCandidates} href="/candidates" />
        <Stat label="Interviews next 7 days" value={stats.interviewsThisWeek} href="/interviews" />
        <Stat label="Offers in flight" value={stats.openOffers} href="/offers" />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><CalendarClock size={15} className="text-zinc-400" />My upcoming interviews</span>} />
          {upcoming.length === 0 ? (
            <EmptyState title="No upcoming interviews" />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {upcoming.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="w-16 shrink-0 text-center">
                    <div className="text-[11px] font-medium text-zinc-500 uppercase">{fmt(i.startAt, "EEE d")}</div>
                    <div className="text-[13px] font-semibold whitespace-nowrap">{fmt(i.startAt, "h:mm a")}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link href={`/candidates/${i.candidateId}`} className="font-medium hover:underline">
                      {i.firstName} {i.lastName}
                    </Link>
                    <div className="truncate text-xs text-zinc-500">{i.title.split(" – ")[0]} · {i.jobTitle}</div>
                  </div>
                  {i.meetingUrl && (
                    <a href={i.meetingUrl} target="_blank" className="inline-flex items-center gap-1 rounded-md bg-teams px-2 py-1 text-xs font-medium text-white hover:bg-teams-hover">
                      <Video size={12} /> Join Teams
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><ClipboardCheck size={15} className="text-zinc-400" />Feedback due</span>}
            action={feedbackDue.length > 0 ? <Badge tone="amber">{feedbackDue.length}</Badge> : undefined}
          />
          {feedbackDue.length === 0 ? (
            <EmptyState title="You're all caught up" description="No outstanding scorecards." />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {feedbackDue.map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar name={`${f.firstName} ${f.lastName}`} size={26} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{f.firstName} {f.lastName}</div>
                    <div className="truncate text-xs text-zinc-500">{f.title.split(" – ")[0]} · {timeAgo(f.startAt)}</div>
                  </div>
                  <Link href={`/interviews/${f.id}/feedback`} className="rounded-md bg-accent-600 px-2 py-1 text-xs font-medium text-white hover:bg-accent-700">
                    Submit feedback
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {approvals.length > 0 && (
          <Card>
            <CardHeader
              title={<span className="flex items-center gap-2"><FileSignature size={15} className="text-zinc-400" />Waiting for your approval</span>}
              action={<Link href="/approvals" className="text-xs text-accent-700 hover:underline">Open approvals ({approvals.length})</Link>}
            />
            <ul className="divide-y divide-zinc-100">
              {approvals.slice(0, 6).map((a) => (
                <li key={a.requestId} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{a.offer ? a.offer.candidateName : a.job.title}</div>
                    <div className="truncate text-xs text-zinc-500">
                      {a.offer ? `Offer · ${a.job.title}${a.offer.baseSalary != null ? ` · ${money(a.offer.baseSalary, a.offer.currency)} base` : ""}` : `New job · ${a.job.brand}`}
                    </div>
                  </div>
                  <Link href="/approvals" className="rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium hover:bg-zinc-50">
                    Review
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card className={approvals.length > 0 ? "" : "lg:col-span-2"}>
          <CardHeader title="My jobs" action={<Link href="/jobs" className="text-xs text-accent-700 hover:underline">All jobs</Link>} />
          {myJobs.length === 0 ? (
            <EmptyState title="You're not on any hiring teams yet" />
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-[11px] font-medium text-zinc-500 uppercase">
                  <th className="px-4 py-2">Job</th>
                  <th className="px-4 py-2 text-right">Active</th>
                  <th className="px-4 py-2 text-right">New (7d)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {myJobs.map((j) => (
                  <tr key={j.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-2">
                      <Link href={`/jobs/${j.id}`} className="font-medium hover:underline">{j.title}</Link>
                      <span className="ml-2 text-xs text-zinc-500">{j.brand}</span>
                      {j.status === "on_hold" && <Badge tone="amber" className="ml-2">On hold</Badge>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{j.active}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{j.newThisWeek > 0 ? <Badge tone="green">+{j.newThisWeek}</Badge> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="rounded-lg border border-zinc-200 bg-white px-4 py-3 hover:border-zinc-300">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900">{value}</div>
    </Link>
  );
}
