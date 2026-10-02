import { requireActor } from "@/lib/session";
import { myReferrals, referableJobs, type ReferralStatus } from "@/server/services/referrals";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReferralForm } from "@/components/referrals/referral-form";
import { timeAgo } from "@/lib/utils";

export const metadata = { title: "Referrals" };

const STATUS: Record<ReferralStatus, { tone: "neutral" | "accent" | "blue" | "green" | "amber"; label: string }> = {
  submitted: { tone: "neutral", label: "Submitted" },
  interviewing: { tone: "blue", label: "Interviewing" },
  offer: { tone: "accent", label: "Offer stage" },
  hired: { tone: "green", label: "Hired" },
  closed: { tone: "neutral", label: "Not moving forward" },
};

export default async function ReferralsPage() {
  const user = await requireActor();
  const [jobs, mine] = await Promise.all([referableJobs(), myReferrals(user)]);
  return (
    <>
      <PageHeader title="Referrals" subtitle="Refer people you'd love to work with to open roles across Purpose Unlimited" />
      <div className="mx-auto grid max-w-6xl gap-4 px-6 py-6 lg:grid-cols-[1fr_1.1fr]">
        <Card>
          <CardHeader title="Refer someone" />
          <div className="p-4"><ReferralForm jobs={jobs} /></div>
        </Card>
        <Card>
          <CardHeader title="Your referrals" />
          {mine.length === 0 ? (
            <EmptyState title="No referrals yet" description="People you refer will show up here with their status." />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {mine.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="font-medium">{r.firstName} {r.lastName}</div>
                    <div className="truncate text-xs text-zinc-500">{r.jobTitle} · {r.brand} · referred {timeAgo(r.createdAt)}</div>
                  </div>
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">You&apos;ll see where things stand, not interview feedback or reasons.</p>
        </Card>
      </div>
    </>
  );
}
