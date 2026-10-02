import Link from "next/link";
import { Briefcase, FileSignature, Lock } from "lucide-react";
import { requireActor } from "@/lib/session";
import { approvalInbox, type InboxItem } from "@/server/services/approval-inbox";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/card";
import { ApprovalDecision } from "@/components/approvals/approval-decision";
import { ApprovalSteps } from "@/components/approvals/approval-steps";
import { compRange, fmt, money, timeAgo } from "@/lib/utils";

export const metadata = { title: "Approvals" };

const OUTCOME = { approved: "green", rejected: "red", cancelled: "neutral", pending: "amber" } as const;

function Item({ item, timezone }: { item: InboxItem; timezone: string }) {
  const o = item.offer;
  const outOfBand = o?.baseSalary != null && ((item.job.compMin != null && o.baseSalary < item.job.compMin) || (item.job.compMax != null && o.baseSalary > item.job.compMax));
  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            {o ? <FileSignature size={13} aria-hidden /> : <Briefcase size={13} aria-hidden />}
            {o ? "Offer" : "New job"} · {item.job.brand}
            {item.job.department && ` · ${item.job.department}`}
            {item.job.confidential && (
              <Badge tone="red">
                <Lock size={10} /> Confidential
              </Badge>
            )}
          </div>
          <h2 className="mt-1 text-base">{o ? `${o.candidateName} · ${item.job.title}` : item.job.title}</h2>
          <p className="text-xs text-zinc-500">
            Requested by {item.requestedBy ?? "PATS"} · {timeAgo(item.createdAt)}
          </p>
        </div>
        {item.yourTurn ? <ApprovalDecision requestId={item.requestId} /> : <Badge tone={OUTCOME[item.status]}>{item.status}</Badge>}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        {o ? (
          <>
            <div><dt className="text-xs text-zinc-500">Base</dt><dd className={outOfBand ? "font-medium text-amber-800" : ""}>{o.baseSalary != null ? money(o.baseSalary, o.currency) : "—"}</dd></div>
            <div><dt className="text-xs text-zinc-500">Band</dt><dd>{compRange(item.job.compMin, item.job.compMax, item.job.currency)}{outOfBand && <span className="ml-1 text-xs text-amber-800">outside</span>}</dd></div>
            <div><dt className="text-xs text-zinc-500">Target bonus</dt><dd>{o.bonusPercent != null ? `${o.bonusPercent}%` : "—"}</dd></div>
            <div><dt className="text-xs text-zinc-500">Start</dt><dd>{o.startDate ? fmt(o.startDate + "T12:00:00Z", "MMM d, yyyy") : "—"}</dd></div>
            {o.signOnBonus != null && <div><dt className="text-xs text-zinc-500">Sign-on</dt><dd>{money(o.signOnBonus, o.currency)}</dd></div>}
            {o.equity && <div className="col-span-2 sm:col-span-3"><dt className="text-xs text-zinc-500">Equity / LTIP</dt><dd>{o.equity}</dd></div>}
          </>
        ) : (
          <>
            <div><dt className="text-xs text-zinc-500">Hiring manager</dt><dd>{item.job.hiringManager ?? "—"}</dd></div>
            <div><dt className="text-xs text-zinc-500">Open headcount</dt><dd>{item.job.openings}</dd></div>
            <div><dt className="text-xs text-zinc-500">Comp band</dt><dd>{compRange(item.job.compMin, item.job.compMax, item.job.currency)}</dd></div>
          </>
        )}
      </dl>

      <div className="mt-3 border-t border-zinc-100 pt-3">
        <ApprovalSteps steps={item.steps} timezone={timezone} />
      </div>
      {item.status !== "pending" && item.completedAt && <p className="mt-2 text-xs text-zinc-500">Completed {timeAgo(item.completedAt)}</p>}
    </article>
  );
}

export default async function ApprovalsPage() {
  const user = await requireActor();
  const { waiting, recent } = await approvalInbox(user);
  const recentOnly = recent.filter((r) => !waiting.some((w) => w.requestId === r.requestId));
  return (
    <>
      <PageHeader title="Approvals" subtitle="Job and offer approvals you're named on" />
      <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">
        <section>
          <h2 className="mb-2 text-base">Waiting on you {waiting.length > 0 && <Badge tone="accent">{waiting.length}</Badge>}</h2>
          {waiting.length === 0 ? (
            <div className="rounded-lg border border-zinc-200 bg-white"><EmptyState title="Nothing waiting on you" description="You'll get a Teams notification when an approval needs you." /></div>
          ) : (
            <div className="space-y-3">{waiting.map((it) => <Item key={it.requestId} item={it} timezone={user.timezone} />)}</div>
          )}
        </section>
        {recentOnly.length > 0 && (
          <section>
            <h2 className="mb-2 text-base">Recently decided</h2>
            <div className="space-y-3">{recentOnly.map((it) => <Item key={it.requestId} item={it} timezone={user.timezone} />)}</div>
          </section>
        )}
        <p className="text-xs text-zinc-500">
          Approvers see the summary of what they&apos;re asked to approve. To open the full job or candidate, you need access to the job.{" "}
          <Link href="/jobs" className="underline">Your jobs</Link>
        </p>
      </div>
    </>
  );
}
