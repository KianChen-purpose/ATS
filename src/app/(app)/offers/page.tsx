import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { canViewCompensation } from "@/server/policy";
import { listOffers, type OfferListView } from "@/server/services/offers";
import { PageHeader } from "@/components/ui/page-header";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/card";
import { OfferStatusBadge } from "@/components/offers/offer-card";
import { fmt, money, timeAgo } from "@/lib/utils";

export const metadata = { title: "Offers" };

const VIEWS: { key: OfferListView; label: string }[] = [
  { key: "draft", label: "Drafts" },
  { key: "pending_approval", label: "Pending approval" },
  { key: "approved", label: "Approved" },
  { key: "sent", label: "Sent" },
  { key: "accepted", label: "Accepted" },
  { key: "closed", label: "Declined & withdrawn" },
];

export default async function OffersPage(props: PageProps<"/offers">) {
  const user = await requireActor();
  if (!canViewCompensation(user)) notFound();
  const sp = await props.searchParams;
  const view = (VIEWS.find((v) => v.key === sp.view)?.key ?? "pending_approval") as OfferListView;
  const { rows, counts } = await listOffers(user, view);

  return (
    <>
      <PageHeader title="Offers" subtitle="Offers on jobs you can see">
        <FilterTabs active={view} hrefFor={(k) => `/offers?view=${k}`} tabs={VIEWS.map((v) => ({ ...v, count: counts[v.key] ?? 0 }))} />
      </PageHeader>
      <div className="px-6 py-4">
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          {rows.length === 0 ? (
            <EmptyState title="No offers here" description="Create offers from a candidate's profile, on the Offers tab." />
          ) : (
            <table className="w-full">
              <thead className="border-b border-zinc-200 bg-zinc-50/60">
                <tr className="text-left text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
                  <th className="px-4 py-2">Candidate</th>
                  <th className="px-3 py-2">Job</th>
                  <th className="px-3 py-2 text-right">Base</th>
                  <th className="px-3 py-2">Band</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Approvals</th>
                  <th className="px-3 py-2">Start</th>
                  <th className="px-4 py-2 text-right">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((o) => {
                  const steps = o.approval && o.approval.status !== "cancelled" ? o.approval.steps : [];
                  const done = steps.filter((st) => st.status === "approved").length;
                  const waiting = steps.find((st) => st.status === "pending");
                  const outOfBand = (o.compMin != null && o.baseSalary < o.compMin) || (o.compMax != null && o.baseSalary > o.compMax);
                  return (
                    <tr key={o.id} className="hover:bg-zinc-50">
                      <td className="px-4 py-2">
                        <Link href={`/candidates/${o.candidateId}?app=${o.applicationId}`} className="flex items-center gap-2.5 font-medium hover:text-accent-700">
                          <Avatar name={`${o.firstName} ${o.lastName}`} size={26} />
                          {o.firstName} {o.lastName}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <Link href={`/jobs/${o.jobId}`} className="hover:underline">{o.jobTitle}</Link>
                        <div className="text-xs text-zinc-500">{o.brand}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money(o.baseSalary, o.currency)}
                        {o.bonusPercent != null && <div className="text-xs text-zinc-500">+{o.bonusPercent}% bonus</div>}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className={outOfBand ? "font-medium text-amber-800" : "text-zinc-500"}>
                          {o.compMin != null || o.compMax != null ? `${money(o.compMin)}–${money(o.compMax)}` : "—"}
                          {outOfBand && " · outside band"}
                        </span>
                      </td>
                      <td className="px-3 py-2"><OfferStatusBadge status={o.status} /></td>
                      <td className="px-3 py-2 text-xs text-zinc-600">
                        {steps.length === 0 ? "—" : waiting ? `${done}/${steps.length} · waiting on ${waiting.approver.name}` : `${done}/${steps.length}`}
                      </td>
                      <td className="px-3 py-2 text-xs">{o.startDate ? fmt(o.startDate + "T12:00:00Z", "MMM d, yyyy") : "—"}</td>
                      <td className="px-4 py-2 text-right text-xs text-zinc-500">{timeAgo(o.decidedAt ?? o.sentAt ?? o.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
