import Link from "next/link";
import { Lock, Plus } from "lucide-react";
import { requireActor } from "@/lib/session";
import { listBrands, listJobs, jobStatusCounts } from "@/server/services/jobs";
import { canManageRecruiting } from "@/server/policy";
import { PageHeader } from "@/components/ui/page-header";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { daysSince } from "@/lib/utils";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";

export const metadata = { title: "Jobs" };

const FUNNEL = [
  { type: "lead", label: "Leads" },
  { type: "review", label: "Review" },
  { type: "screen", label: "Screen" },
  { type: "interview", label: "Interview" },
  { type: "offer", label: "Offer" },
];

export default async function JobsPage(props: PageProps<"/jobs">) {
  const user = await requireActor();
  const sp = await props.searchParams;
  const status = typeof sp.status === "string" ? sp.status : "open";
  const brand = typeof sp.brand === "string" ? sp.brand : undefined;
  const q = typeof sp.q === "string" ? sp.q : undefined;

  const [jobs, counts, brands] = await Promise.all([
    listJobs(user, { status, brand, q }),
    jobStatusCounts(user),
    listBrands(),
  ]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const href = (next: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { status, brand, q, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/jobs?${p}`;
  };

  return (
    <>
      <PageHeader
        title="Jobs"
        actions={
          canManageRecruiting(user) && (
            <Link href="/jobs/new" className={buttonClass("primary")}>
              <Plus size={14} /> New job
            </Link>
          )
        }
      >
        <FilterTabs
          active={status}
          hrefFor={(key) => href({ status: key })}
          tabs={[
            { key: "open", label: "Open", count: counts.open ?? 0 },
            { key: "on_hold", label: "On hold", count: counts.on_hold ?? 0 },
            { key: "draft", label: "Draft", count: counts.draft ?? 0 },
            { key: "closed", label: "Closed", count: counts.closed ?? 0 },
            { key: "all", label: "All", count: total },
          ]}
        />
      </PageHeader>

      <div className="px-6 py-4">
        <form className="mb-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="status" value={status} />
          <input
            name="q"
            defaultValue={q}
            placeholder="Filter jobs…"
            className="h-8 w-64 rounded-md border border-zinc-200 bg-white px-2.5 outline-none focus:border-accent-500"
          />
          <select name="brand" defaultValue={brand ?? ""} className="h-8 rounded-md border border-zinc-200 bg-white px-2">
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.slug}>
                {b.name}
              </option>
            ))}
          </select>
          <button className={buttonClass("secondary")}>Apply</button>
        </form>

        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          {jobs.length === 0 ? (
            <EmptyState title="No jobs match these filters" />
          ) : (
            <table className="w-full">
              <thead className="border-b border-zinc-200 bg-zinc-50/60">
                <tr className="text-left text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
                  <th className="px-4 py-2">Job</th>
                  <th className="px-3 py-2">Hiring team</th>
                  {FUNNEL.map((f) => (
                    <th key={f.type} className="px-2 py-2 text-right">
                      {f.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right">Hired</th>
                  <th className="px-3 py-2 text-right">Openings</th>
                  <th className="px-4 py-2 text-right">Days open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {jobs.map((j) => (
                  <tr key={j.id} className="group hover:bg-zinc-50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: j.brandColor ?? "var(--pats-black)" }} title={j.brand} />
                        <Link href={`/jobs/${j.id}`} className="font-medium text-zinc-900 group-hover:text-accent-700">
                          {j.title}
                        </Link>
                        {j.confidential && (
                          <Badge tone="red">
                            <Lock size={10} /> Confidential
                          </Badge>
                        )}
                        {status === "all" && <JobStatusBadge status={j.status} />}
                      </div>
                      <div className="mt-0.5 pl-4 text-xs text-zinc-500">
                        {[j.brand, j.department, j.location].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex -space-x-1">
                        {j.hmName && <Avatar name={j.hmName} size={22} className="ring-2 ring-white" />}
                        {j.recruiterName && <Avatar name={j.recruiterName} size={22} className="ring-2 ring-white" />}
                      </div>
                    </td>
                    {FUNNEL.map((f) => (
                      <td key={f.type} className="px-2 py-2.5 text-right tabular-nums text-zinc-700">
                        {j.byType[f.type] ? j.byType[f.type] : <span className="text-zinc-300">0</span>}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-right tabular-nums">{j.hired || <span className="text-zinc-300">0</span>}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{j.openings}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-500">{j.openedAt ? daysSince(j.openedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
