import Link from "next/link";
import { LayoutDashboard, FileBarChart } from "lucide-react";
import { requireActor } from "@/lib/session";
import { datasetByKey } from "@/server/services/reports/datasets";
import { listDashboards, listSavedReports, shareablePeople } from "@/server/services/reports/saved";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { NewDashboardButton } from "@/components/reports/save-report";
import { NoReportAccess, ReportShell, reportFilters } from "@/components/reports/report-page";
import { timeAgo } from "@/lib/utils";

export const metadata = { title: "Saved reports" };

const VIS: Record<string, string> = { private: "Only you", people: "Shared with people", everyone: "Everyone" };

export default async function SavedReports(props: PageProps<"/reports/saved">) {
  const actor = await requireActor();
  const f = reportFilters(actor, await props.searchParams);
  if (!f) return <NoReportAccess />;
  const [reports, dashboards, people] = await Promise.all([listSavedReports(actor), listDashboards(actor), shareablePeople(actor)]);
  const visLabel = (v: string, mine: boolean, owner: string) => (mine ? VIS[v] : `From ${owner}`);

  return (
    <ReportShell actor={actor} tab="saved" filters={f} subtitle="Your reports and dashboards, and ones shared with you. Each person sees numbers for the jobs they can access.">
      <Card>
        <CardHeader title="Dashboards" action={<NewDashboardButton people={people} />} />
        {dashboards.length === 0 ? (
          <EmptyState icon={<LayoutDashboard size={24} />} title="No dashboards yet" description="Create one, then add saved reports to it as tiles." />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {dashboards.map((d) => (
              <li key={d.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-zinc-50/60">
                <Link href={`/reports/dashboards/${d.id}`} className="font-medium hover:underline">
                  {d.name}
                  <span className="ml-2 text-xs font-normal text-zinc-500">
                    {d.tiles} {d.tiles === 1 ? "tile" : "tiles"}
                  </span>
                </Link>
                <span className="text-xs text-zinc-500">
                  {visLabel(d.visibility, d.mine, d.owner)} · {timeAgo(d.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title="Saved reports" action={<Link href="/reports/builder" className={buttonClass("secondary")}>New report</Link>} />
        {reports.length === 0 ? (
          <EmptyState icon={<FileBarChart size={24} />} title="No saved reports yet" description="Build one in the Builder tab and save it." />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {reports.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-4 px-4 py-2.5 hover:bg-zinc-50/60">
                <Link href={`/reports/saved/${r.id}`} className="min-w-0 hover:underline">
                  <span className="font-medium">{r.name}</span>
                  <span className="ml-2 text-xs text-zinc-500">{datasetByKey(r.dataset)?.label ?? r.dataset}</span>
                  {r.description && <span className="block truncate text-xs text-zinc-500">{r.description}</span>}
                </Link>
                <span className="shrink-0 text-xs text-zinc-500">
                  {visLabel(r.visibility, r.mine, r.owner)} · {timeAgo(r.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </ReportShell>
  );
}
